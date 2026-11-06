/**
 * 订单调度服务
 *
 * 候选排名、自动派单、人工指派、参数读取和审计日志统一在此处理，
 * 避免管理后台的“推荐结果”和真实订单分配使用不同规则。
 */
const db = require('../db');
const locationPricing = require('./location_pricing');
const time = require('./time');

const ACTIVE_ORDER_STATUSES = ['accepted', 'dispatched', 'arrived', 'charging'];
const DISPATCH_CONFIG_KEYS = [
  'dispatch_enabled',
  'dispatch_strategy',
  'dispatch_require_deposit',
  'dispatch_allow_busy',
  'dispatch_distance_weight',
  'dispatch_rating_weight',
  'dispatch_level_weight',
  'dispatch_order_weight',
  'dispatch_max_candidates',
  'dispatch_max_distance_km'
];

function asBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 1 || String(value).toLowerCase() === 'true' || String(value) === '1';
}

function haversineKm(lat1, lng1, lat2, lng2) {
  return locationPricing.haversineKm(lat1, lng1, lat2, lng2);
}

function readSettings() {
  const number = (key, fallback) => {
    const value = Number(db.getConfig(key, fallback));
    return Number.isFinite(value) ? value : Number(fallback);
  };
  const rawWeights = {
    distance: Math.max(0, number('dispatch_distance_weight', 0.4)),
    rating: Math.max(0, number('dispatch_rating_weight', 0.25)),
    level: Math.max(0, number('dispatch_level_weight', 0.2)),
    order: Math.max(0, number('dispatch_order_weight', 0.15))
  };
  const weightTotal = Object.values(rawWeights).reduce((sum, value) => sum + value, 0) || 1;
  const strategyRaw = db.getConfig('dispatch_strategy', 'auto_assign');
  const strategy = ['auto_assign', 'recommend_only', 'manual'].includes(strategyRaw)
    ? strategyRaw
    : 'auto_assign';

  return {
    enabled: asBool(db.getConfig('dispatch_enabled', '1'), true),
    strategy,
    requireDeposit: asBool(db.getConfig('dispatch_require_deposit', '1'), true),
    allowBusy: asBool(db.getConfig('dispatch_allow_busy', '0'), false),
    distance: rawWeights.distance / weightTotal,
    rating: rawWeights.rating / weightTotal,
    level: rawWeights.level / weightTotal,
    order: rawWeights.order / weightTotal,
    weightTotal,
    maxDistanceKm: Math.max(1, number('dispatch_max_distance_km', 30)),
    maxCandidates: Math.min(50, Math.max(1, Math.round(number('dispatch_max_candidates', 10))))
  };
}

function readWeights() {
  const settings = readSettings();
  return {
    distW: settings.distance,
    ratingW: settings.rating,
    levelW: settings.level,
    orderW: settings.order,
    maxKm: settings.maxDistanceKm,
    maxCandidates: settings.maxCandidates
  };
}

function validateSettings(input) {
  const strategy = String(input.strategy || '');
  if (!['auto_assign', 'recommend_only', 'manual'].includes(strategy)) {
    return { ok: false, message: '派单策略不合法' };
  }
  const weightKeys = ['distance', 'rating', 'level', 'order'];
  const weights = weightKeys.map(key => Number(input[key]));
  if (weights.some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
    return { ok: false, message: '各项权重必须是0到1之间的数字' };
  }
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > 0.001) {
    return { ok: false, message: '距离、评分、等级、均衡四项权重之和必须等于1' };
  }
  const maxDistanceKm = Number(input.maxDistanceKm);
  const maxCandidates = Number(input.maxCandidates);
  if (!Number.isFinite(maxDistanceKm) || maxDistanceKm < 1 || maxDistanceKm > 300) {
    return { ok: false, message: '搜索半径必须在1到300公里之间' };
  }
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 50) {
    return { ok: false, message: '候选人数必须是1到50之间的整数' };
  }
  return { ok: true };
}

function saveSettings(input) {
  const normalized = {
    enabled: asBool(input.enabled, true),
    strategy: String(input.strategy || 'auto_assign'),
    requireDeposit: asBool(input.requireDeposit, true),
    allowBusy: asBool(input.allowBusy, false),
    distance: Number(input.distance),
    rating: Number(input.rating),
    level: Number(input.level),
    order: Number(input.order),
    maxDistanceKm: Number(input.maxDistanceKm),
    maxCandidates: Number(input.maxCandidates)
  };
  const validation = validateSettings(normalized);
  if (!validation.ok) return validation;

  const configMap = {
    dispatch_enabled: normalized.enabled ? '1' : '0',
    dispatch_strategy: normalized.strategy,
    dispatch_require_deposit: normalized.requireDeposit ? '1' : '0',
    dispatch_allow_busy: normalized.allowBusy ? '1' : '0',
    dispatch_distance_weight: normalized.distance,
    dispatch_rating_weight: normalized.rating,
    dispatch_level_weight: normalized.level,
    dispatch_order_weight: normalized.order,
    dispatch_max_distance_km: normalized.maxDistanceKm,
    dispatch_max_candidates: normalized.maxCandidates
  };
  Object.entries(configMap).forEach(([key, value]) => db.setConfig(key, value));
  return { ok: true, settings: readSettings() };
}

function calcDriverLevelId(totalOrders, rating) {
  const levels = [...(db.data.driver_levels || [])].sort((a, b) => Number(a.id) - Number(b.id));
  let best = levels[0]?.id || 1;
  levels.forEach(level => {
    if (Number(totalOrders || 0) >= Number(level.min_orders || 0) && Number(rating || 0) >= Number(level.min_rating || 0)) {
      best = level.id;
    }
  });
  return best;
}

function getAcceptCount7d(driverId) {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return (db.data.orders || []).filter(order => {
    if (Number(order.driver_id) !== Number(driverId) || order.status === 'cancelled') return false;
    const acceptedAt = time.parse(order.assigned_at || order.start_time || order.created_at || 0).getTime();
    return Number.isFinite(acceptedAt) && acceptedAt >= since;
  }).length;
}

function driverHasActiveOrder(driverId, exceptOrderId) {
  return (db.data.orders || []).some(order =>
    Number(order.driver_id) === Number(driverId) &&
    Number(order.id) !== Number(exceptOrderId) &&
    ACTIVE_ORDER_STATUSES.includes(order.status)
  );
}

function isApproved(driver) {
  return driver && (driver.approved === 1 || driver.approved === true || String(driver.approved) === '1');
}

async function rankDriversForOrder(order, opts = {}) {
  const settings = readSettings();
  const levelsById = new Map((db.data.driver_levels || []).map(level => [Number(level.id), level]));
  const allowedStatuses = settings.allowBusy ? ['online', 'busy'] : ['online'];
  const drivers = (db.data.drivers || []).filter(driver =>
    isApproved(driver) &&
    allowedStatuses.includes(driver.status) &&
    locationPricing.hasFreshDriverLocation(driver) &&
    !driverHasActiveOrder(driver.id, order.id)
  );

  const orderHasLocation = !!locationPricing.normalizeLocation(order.pickup_lat, order.pickup_lng);
  if (!orderHasLocation) return [];
  const preliminary = drivers.map(driver => {
    const straightLineKm = locationPricing.haversineKm(
      driver.lat, driver.lng, order.pickup_lat, order.pickup_lng
    );
    const acceptCount7d = getAcceptCount7d(driver.id);
    driver.accept_count_7d = acceptCount7d;
    return { driver, straightLineKm, acceptCount7d };
  }).filter(candidate =>
    candidate.straightLineKm !== null &&
    candidate.straightLineKm <= settings.maxDistanceKm
  ).sort((a, b) => a.straightLineKm - b.straightLineKm)
    .slice(0, Math.min(20, settings.maxCandidates * 2));

  if (!preliminary.length) return [];
  const settled = await Promise.allSettled(preliminary.map(async candidate => ({
    ...candidate,
    route: await locationPricing.getTencentDrivingRoute(
      candidate.driver.lat,
      candidate.driver.lng,
      order.pickup_lat,
      order.pickup_lng,
      { accuracy: candidate.driver.location_accuracy }
    )
  })));
  const candidates = settled
    .filter(item => item.status === 'fulfilled')
    .map(item => item.value)
    .filter(candidate => candidate.route.distanceKm <= settings.maxDistanceKm)
    .map(candidate => ({ ...candidate, distance: candidate.route.distanceKm }));

  if (!candidates.length) {
    const failure = settled.find(item => item.status === 'rejected');
    if (failure) throw failure.reason;
    return [];
  }

  const finiteDistances = candidates.map(item => item.distance).filter(Number.isFinite);
  const maxDistance = finiteDistances.length ? Math.max(...finiteDistances) : settings.maxDistanceKm;
  const minDistance = finiteDistances.length ? Math.min(...finiteDistances) : 0;
  const ratings = candidates.map(item => Number(item.driver.rating || 5));
  const coefficients = candidates.map(item => Number(levelsById.get(Number(item.driver.level_id || 1))?.coefficient || 0.8));
  const orderCounts = candidates.map(item => item.acceptCount7d);
  const range = values => ({ min: Math.min(...values), max: Math.max(...values) });
  const ratingRange = range(ratings);
  const coefficientRange = range(coefficients);
  const orderRange = range(orderCounts);
  const scale = (value, min, max) => max === min ? 0.5 : Math.max(0, Math.min(1, (value - min) / (max - min)));

  const result = candidates.map(item => {
    const driver = item.driver;
    const level = levelsById.get(Number(driver.level_id || 1)) || {};
    const distanceScore = item.distance === null ? 0 : 1 - scale(item.distance, minDistance, maxDistance);
    const ratingScore = scale(Number(driver.rating || 5), ratingRange.min, ratingRange.max);
    const levelScore = scale(Number(level.coefficient || 0.8), coefficientRange.min, coefficientRange.max);
    const balanceScore = 1 - scale(item.acceptCount7d, orderRange.min, orderRange.max);
    const score =
      settings.distance * distanceScore +
      settings.rating * ratingScore +
      settings.level * levelScore +
      settings.order * balanceScore;
    const distanceText = item.distance === null ? '位置未知' : `距离${item.distance.toFixed(1)}km`;

    return {
      driver_id: driver.id,
      openid: driver.openid,
      name: driver.name,
      phone: driver.phone,
      avatar: driver.avatar || '',
      status: driver.status,
      distance_km: item.distance === null ? null : Number(item.distance.toFixed(2)),
      route_duration_minutes: item.route.durationMinutes,
      route_policy: item.route.policy,
      score: Number(score.toFixed(4)),
      level_id: driver.level_id || 1,
      level_code: level.level || 'V1',
      level_name: level.name || '新晋救援者',
      level_coefficient: Number(level.coefficient || 0.8),
      rating: Number(Number(driver.rating || 5).toFixed(2)),
      accept_count_7d: item.acceptCount7d,
      total_orders: Number(driver.total_orders || 0),
      reason: [
        `${distanceText}(权重${settings.distance.toFixed(2)})`,
        `评分${Number(driver.rating || 5).toFixed(2)}(权重${settings.rating.toFixed(2)})`,
        `${level.level || 'V1'}(权重${settings.level.toFixed(2)})`,
        `近7日${item.acceptCount7d}单(均衡权重${settings.order.toFixed(2)})`
      ].join(' + ')
    };
  });

  result.sort((a, b) => {
    if (Number(opts.manualDriverId) === Number(a.driver_id)) return -1;
    if (Number(opts.manualDriverId) === Number(b.driver_id)) return 1;
    return b.score - a.score || (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity);
  });
  return result.slice(0, settings.maxCandidates);
}

function addLog(order, data = {}) {
  const log = {
    id: db.nextId('dispatch_logs'),
    order_id: order?.id || null,
    order_no: order?.order_no || '',
    mode: data.mode || 'recommend',
    result: data.result || 'success',
    candidates_json: JSON.stringify((data.candidates || []).map(item => ({
      id: item.driver_id,
      name: item.name,
      score: item.score,
      distance_km: item.distance_km
    }))),
    selected_driver_id: data.selectedDriverId || null,
    is_manual_override: data.manual ? 1 : 0,
    remark: data.remark || '',
    created_at: db.now()
  };
  (db.data.dispatch_logs = db.data.dispatch_logs || []).push(log);
  db.save();
  return log;
}

function checkOrderDispatchable(order, settings, manual) {
  if (!order) return { ok: false, message: '订单不存在' };
  const allowed = manual ? ['pending', 'accepted'] : ['pending'];
  if (!allowed.includes(order.status)) return { ok: false, message: '只有待派单或尚未出发的订单可以调度' };
  if (settings.requireDeposit && order.deposit_status !== 'paid') {
    return { ok: false, message: '用户尚未支付押金，订单未进入派单池' };
  }
  return { ok: true };
}

async function assignDriver(order, driverId, opts = {}) {
  const settings = readSettings();
  const manual = opts.manual === true;
  const orderCheck = checkOrderDispatchable(order, settings, manual);
  if (!orderCheck.ok) return orderCheck;

  const driver = (db.data.drivers || []).find(item => Number(item.id) === Number(driverId));
  if (!driver) return { ok: false, message: '司机不存在' };
  if (!isApproved(driver)) return { ok: false, message: '该司机未通过审核' };
  if (driver.status !== 'online' && Number(order.driver_id) !== Number(driver.id)) {
    return { ok: false, message: '该司机当前不在线或正在执行其他订单' };
  }
  if (driverHasActiveOrder(driver.id, order.id)) {
    return { ok: false, message: '该司机已有进行中的订单' };
  }
  const pricingResult = await locationPricing.applyAssignedDriverPricing(order, driver);
  if (!pricingResult.ok) return pricingResult;

  const oldDriverId = order.driver_id;
  if (oldDriverId && Number(oldDriverId) !== Number(driver.id)) {
    const oldDriver = (db.data.drivers || []).find(item => Number(item.id) === Number(oldDriverId));
    if (oldDriver) oldDriver.status = 'online';
  }

  const now = db.now();
  order.driver_id = driver.id;
  order.status = 'accepted';
  order.start_time = order.start_time || now;
  order.assigned_at = now;
  order.dispatch_mode = manual ? 'manual' : 'auto';
  order.dispatch_status = 'assigned';
  order.dispatch_reason = opts.reason || (manual ? '管理员人工指派' : '系统按综合评分自动指派');
  driver.status = 'busy';
  driver.last_order_at = now;
  driver.accept_count_7d = getAcceptCount7d(driver.id);

  const candidates = opts.candidates || await rankDriversForOrder(order, { manualDriverId: driver.id });
  order.dispatch_candidates = JSON.stringify(candidates);
  addLog(order, {
    mode: manual ? 'manual_assign' : 'auto_assign',
    candidates,
    selectedDriverId: driver.id,
    manual,
    remark: order.dispatch_reason
  });
  return { ok: true, order, driver, candidates };
}

async function dispatchOrder(orderOrId, opts = {}) {
  const order = typeof orderOrId === 'object'
    ? orderOrId
    : (db.data.orders || []).find(item => Number(item.id) === Number(orderOrId));
  const settings = readSettings();
  if (!settings.enabled) return { ok: false, skipped: true, message: '自动调度已关闭' };
  const check = checkOrderDispatchable(order, settings, false);
  if (!check.ok) return { ...check, skipped: true };
  if (settings.strategy === 'manual') return { ok: false, skipped: true, message: '当前策略为仅人工调度' };

  const candidates = await rankDriversForOrder(order);
  order.dispatch_candidates = JSON.stringify(candidates);
  order.dispatch_mode = settings.strategy === 'auto_assign' ? 'auto' : 'recommend';
  order.dispatch_status = candidates.length ? 'recommended' : 'no_candidate';
  db.save();

  if (!candidates.length) {
    addLog(order, {
      mode: 'auto_dispatch',
      result: 'no_candidate',
      remark: `半径${settings.maxDistanceKm}km内暂无通过审核且空闲的在线司机`
    });
    return { ok: false, message: '当前调度范围内暂无可用司机', candidates: [] };
  }
  if (settings.strategy === 'recommend_only') {
    addLog(order, {
      mode: 'recommend',
      candidates,
      remark: '已生成候选列表，等待司机抢单或管理员指派'
    });
    return { ok: true, assigned: false, candidates, message: '已生成推荐列表' };
  }
  return { ...await assignDriver(order, candidates[0].driver_id, { candidates }), assigned: true };
}

function updateDriverLevelAfterOrder(driverId) {
  const driver = (db.data.drivers || []).find(item => Number(item.id) === Number(driverId));
  if (!driver) return false;
  const newLevelId = calcDriverLevelId(driver.total_orders || 0, driver.rating || 5);
  if (Number(newLevelId) === Number(driver.level_id)) return false;
  driver.level_id = newLevelId;
  db.save();
  return true;
}

function incrementAcceptCount(driverId) {
  const driver = (db.data.drivers || []).find(item => Number(item.id) === Number(driverId));
  if (!driver) return;
  driver.accept_count_7d = getAcceptCount7d(driverId);
  driver.last_order_at = db.now();
  db.save();
}

function getPendingOrders() {
  const settings = readSettings();
  return (db.data.orders || [])
    .filter(order =>
      order.status === 'pending' &&
      (!settings.requireDeposit || order.deposit_status === 'paid')
    )
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
    .map(order => ({
      ...order,
      candidate_count: (() => {
        try { return JSON.parse(order.dispatch_candidates || '[]').length; } catch (e) { return 0; }
      })()
    }));
}

function getLogs(limit = 30) {
  return [...(db.data.dispatch_logs || [])]
    .sort((a, b) => Number(b.id) - Number(a.id))
    .slice(0, Math.min(100, Math.max(1, Number(limit) || 30)))
    .map(log => {
      const driver = (db.data.drivers || []).find(item => Number(item.id) === Number(log.selected_driver_id));
      return { ...log, driver_name: driver?.name || '' };
    });
}

module.exports = {
  ACTIVE_ORDER_STATUSES,
  DISPATCH_CONFIG_KEYS,
  haversineKm,
  readSettings,
  readWeights,
  validateSettings,
  saveSettings,
  calcDriverLevelId,
  getAcceptCount7d,
  rankDriversForOrder,
  assignDriver,
  dispatchOrder,
  updateDriverLevelAfterOrder,
  incrementAcceptCount,
  getPendingOrders,
  getLogs
};
