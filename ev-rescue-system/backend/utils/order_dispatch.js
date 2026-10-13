/**
 * 智能订单分配算法引擎
 * =============================================================
 * 目标：为一个新的救援订单，从「已审核通过、在线状态」的司机中，
 *       基于距离、评分、服务等级(V系数)、近7天接单量(饥饿分配)
 *       四个维度进行加权评分，返回推荐排序列表。
 *
 * 公式(归一化加权求和)：
 *   score(driver) =
 *       W_d * normDistance(driver)      // 越近越高分，线性反比
 *     + W_r * normRating(driver)        // 评分越高分越高
 *     + W_l * normLevel(driver)         // 等级(V系数)越高分越高
 *     + W_o * normOrderShare(driver)    // 饥饿式：近7日接单越少分越高
 *
 * 使用方：orders.create 创建订单时自动调度 / admin.dashboard 手动指派时推荐。
 * =============================================================*/

const db = require('../db');

/**
 * Haversine 地球球面距离（公里）
 * 经纬度采用十进制度（WGS84 GCJ02误差可忽略）
 * @param {number} lat1 司机纬度
 * @param {number} lng1 司机经度
 * @param {number} lat2 订单纬度
 * @param {number} lng2 订单经度
 * @returns {number} km
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return 999;
  const R = 6371.0088;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * 取得系统配置的权重值与阈值
 * @returns {{distW:number, ratingW:number, levelW:number, orderW:number, maxKm:number, maxCandidates:number}}
 */
function readWeights() {
  const g = k => parseFloat(db.getConfig(k, '0'));
  return {
    distW: isFinite(g('dispatch_distance_weight')) ? g('dispatch_distance_weight') : 0.4,
    ratingW: isFinite(g('dispatch_rating_weight')) ? g('dispatch_rating_weight') : 0.25,
    levelW: isFinite(g('dispatch_level_weight')) ? g('dispatch_level_weight') : 0.2,
    orderW: isFinite(g('dispatch_order_weight')) ? g('dispatch_order_weight') : 0.15,
    maxKm: Math.max(1, g('dispatch_max_distance_km') || 30),
    maxCandidates: Math.max(3, parseInt(db.getConfig('dispatch_max_candidates', '10'), 10) || 10)
  };
}

/**
 * 根据司机完成单数 & 评分 计算服务等级id（自动匹配 V1-V7）
 * 仅计算，不写库；写库时机在每次订单完成分账后调用 updateDriverLevel()
 */
function calcDriverLevelId(totalOrders, rating) {
  const lvls = db.data.driver_levels || [];
  if (!lvls.length) return 1;
  let best = 1;
  for (const l of lvls) {
    if (totalOrders >= (l.min_orders || 0) && rating >= (l.min_rating || 0)) {
      best = l.id;
    }
  }
  return best;
}

/**
 * 订单创建/指派时：计算所有可用司机的推荐评分
 * @param {Object} order 订单(需要 pickup_lat,pickup_lng,vehicle_type)
 * @param {Object} [opts] { manualDriverId?:number } 若给了手动指派司机ID，则其 score 强制置顶
 * @returns {Array<{driver_id:number, name:string, phone:string, distance_km:number, score:number, level_id:number, rating:number, accept_count_7d:number, level_coefficient:number, reason:string}>}
 */
function rankDriversForOrder(order, opts = {}) {
  const W = readWeights();
  // ===== 修复 D1：approved 松紧统一（种子/旧库可能存 0/1 或 true/false；宽松判断）=====
  // 之前是 d.approved === 1（严格数值），导致 admin 布尔 true / 默认 0 都过滤；
  // pending-orders/accept 用的是 !driver.approved 宽松，所以两端双重标准，现在对齐宽松。
  const drivers = (db.data.drivers || []).filter(
    d => d && (d.approved === 1 || d.approved === true || String(d.approved) === '1') &&
         (d.status === 'online' || d.status === 'busy')
  );
  if (!drivers.length) return [];

  const pickupLat = parseFloat(order.pickup_lat) || 0;
  const pickupLng = parseFloat(order.pickup_lng) || 0;
  const calcDist = d => {
    // ===== 修复 D2：driver 经纬度 0 → 视为与订单同地（兜底 0.1km），避免 0,0 vs 绵阳算 999km =====
    const dLat = parseFloat(d.lat) || 0;
    const dLng = parseFloat(d.lng) || 0;
    const oLat = pickupLat;
    const oLng = pickupLng;
    const bothValid = dLat && dLng && oLat && oLng;
    if (bothValid) return haversineKm(dLat, dLng, oLat, oLng);
    // 只要订单或司机任一方没坐标，保底近距（通过过滤，但距离分取低）
    return 0.1;
  };
  let candidates = drivers.map(d => ({ driver: d, dist: calcDist(d) }));
  let inRange = candidates.filter(c => c.dist <= W.maxKm);
  if (inRange.length === 0) inRange = candidates.sort((a, b) => a.dist - b.dist).slice(0, 20);

  // 2. 司机等级字典
  const levelsById = new Map((db.data.driver_levels || []).map(l => [l.id, l]));

  // 3. 归一化区间（min-max）
  const dists = inRange.map(c => c.dist);
  const minDist = Math.min(...dists), maxDist = Math.max(...dists, 0.0001);
  const ratings = inRange.map(c => c.driver.rating || 5);
  const maxRating = Math.max(...ratings, 5), minRating = Math.min(...ratings, 0);
  const coefs = inRange.map(c => levelsById.get(c.driver.level_id || 1)?.coefficient || 0.8);
  const maxCoef = Math.max(...coefs, 1.6), minCoef = Math.min(...coefs, 0.5);
  const orders7d = inRange.map(c => c.driver.accept_count_7d || 0);
  const max7d = Math.max(...orders7d, 1), min7d = Math.min(...orders7d, 0);

  const invLerp = (v, min, max) => (max === min ? 0.5 : Math.max(0, Math.min(1, (v - min) / (max - min))));

  const scored = inRange.map(c => {
    const d = c.driver;
    const level = levelsById.get(d.level_id || 1);
    // 距离反向归一化：越近→1，最远→0
    const nDist = 1 - invLerp(c.dist, minDist, maxDist);
    const nRating = invLerp(d.rating || 5, minRating, maxRating);
    const nLevel = invLerp(level?.coefficient || 0.8, minCoef, maxCoef);
    // 近7日接单量反向归一化：饥饿式
    const nOrder = 1 - invLerp(d.accept_count_7d || 0, min7d, max7d);

    const rawScore =
      W.distW * nDist + W.ratingW * nRating + W.levelW * nLevel + W.orderW * nOrder;

    // 如果是手动指定司机，强制最高
    const finalScore =
      opts.manualDriverId === d.id ? rawScore + 9999 : rawScore;

    const reason = [
      `距离${c.dist.toFixed(1)}km(权重${W.distW.toFixed(2)})`,
      `评分${(d.rating || 5).toFixed(2)}(权重${W.ratingW.toFixed(2)})`,
      `${level?.level || 'V1'}(系数${(level?.coefficient || 0.8).toFixed(2)},权重${W.levelW.toFixed(2)})`,
      `7日接${d.accept_count_7d || 0}单(饥饿权重${W.orderW.toFixed(2)})`
    ].join(' + ');

    return {
      driver_id: d.id,
      openid: d.openid,
      name: d.name,
      phone: d.phone,
      avatar: d.avatar || '',
      distance_km: +c.dist.toFixed(2),
      score: +finalScore.toFixed(4),
      score_raw: +rawScore.toFixed(4),
      level_id: d.level_id || 1,
      level_code: level?.level || 'V1',
      level_name: level?.name || '新晋救援者',
      level_coefficient: +((level?.coefficient || 0.8)).toFixed(2),
      rating: +((d.rating || 5).toFixed(2)),
      accept_count_7d: d.accept_count_7d || 0,
      total_orders: d.total_orders || 0,
      reason
    };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, W.maxCandidates);

  // 记录调度日志
  try {
    const log = {
      id: db.nextId('dispatch_logs'),
      order_id: order.id || null,
      order_no: order.order_no || '',
      mode: opts.manualDriverId ? 'manual-recommend' : 'auto',
      candidates_json: JSON.stringify(top.map(s => ({ id: s.driver_id, score: s.score, name: s.name }))),
      selected_driver_id: opts.manualDriverId || (top[0]?.driver_id ?? null),
      is_manual_override: opts.manualDriverId ? 1 : 0,
      remark: `距离权重${W.distW}/评分${W.ratingW}/等级${W.levelW}/接单${W.orderW}，最大半径${W.maxKm}km`,
      created_at: db.now()
    };
    (db.data.dispatch_logs = db.data.dispatch_logs || []).push(log);
    db.save();
  } catch (e) { /* 日志失败不影响主流程 */ }

  return top;
}

/**
 * 订单完成后：升级/降级司机等级（基于累计单量与平均分）
 * @param {number} driverId
 */
function updateDriverLevelAfterOrder(driverId) {
  const d = (db.data.drivers || []).find(x => x.id === driverId);
  if (!d) return;
  const newLevelId = calcDriverLevelId(d.total_orders || 0, d.rating || 5);
  if (newLevelId !== d.level_id) {
    d.level_id = newLevelId;
    db.save();
    return true;
  }
  return false;
}

/**
 * 订单完成后：每7日接单计数滚动累加（简化版：直接计数，按天重置需配合cron）
 * 此处实现为直接 +1；在司机端API acceptOrder 时调用 incrementAcceptCount(driverId)
 */
function incrementAcceptCount(driverId) {
  const d = (db.data.drivers || []).find(x => x.id === driverId);
  if (!d) return;
  d.accept_count_7d = (d.accept_count_7d || 0) + 1;
  d.last_order_at = db.now();
  db.save();
}

module.exports = {
  haversineKm,
  calcDriverLevelId,
  rankDriversForOrder,
  updateDriverLevelAfterOrder,
  incrementAcceptCount,
  readWeights
};
