/**
 * 通用业务辅助工具
 * - 信用积分：初始100分，按时支付加分，逃单/差评扣分
 * - 短信验证码：dev模式固定1234，prod模式可接阿里云
 * - 微信code换openid：生产模式调微信官方jscode2session，MVP模式按code生成稳定openid
 * - 服务卡核销：校验可用次数、余额、绑定关系，写入card_usages
 * - 押金计算：根据订单total_price + 系统KV算押金金额
 */

const crypto = require('crypto');
const db = require('../db');

// ===========================================================
// 1. 信用积分
// ===========================================================
/**
 * 取得用户当前信用积分（从credit_scores流水取最近一条的balance_after；
 * 没有流水返回默认100）
 */
function getCreditScore(userId) {
  const list = (db.data.credit_scores || []).filter(c => c.user_id === userId).sort((a, b) => b.id - a.id);
  return list[0] ? (list[0].balance_after ?? 100) : 100;
}

/**
 * 增加一条信用积分变更流水（返回新余额）
 */
function changeCreditScore(userId, amount, reason) {
  const prev = getCreditScore(userId);
  const newScore = Math.max(0, Math.min(100, prev + (parseInt(amount, 10) || 0)));
  const row = {
    id: db.nextId('credit_scores'),
    user_id: userId,
    score: prev,
    change_amount: parseInt(amount, 10) || 0,
    balance_after: newScore,
    change_reason: reason || '',
    created_at: db.now()
  };
  (db.data.credit_scores = db.data.credit_scores || []).push(row);
  db.save();
  return { previous: prev, delta: amount, current: newScore };
}

/**
 * 下单前信用校验：信用分太低 or 有超期未支付 → 拒绝下单
 * 返回 { ok:boolean, reason:string, score:number }
 */
function canUserPlaceOrder(userId) {
  const score = getCreditScore(userId);
  const min = parseInt(db.getConfig('credit_min_to_order', '60'), 10) || 60;
  if (score < min) return { ok: false, reason: `您的信用积分${score}低于${min}，请联系客服恢复后再下单`, score };
  const unpaidCount = (db.data.orders || []).filter(
    o => o.user_id === userId && o.status === 'completed' && o.payment_status !== 'paid'
  ).length;
  if (unpaidCount > 0) return { ok: false, reason: `您有${unpaidCount}笔已完成的订单未支付，请先支付后再下单`, score };
  return { ok: true, score };
}

// ===========================================================
// 2. 短信验证码
// ===========================================================
/**
 * 生成6位短信验证码并保存，dev模式返回固定1234且5分钟过期
 */
// helpers: 本地时区时间工具（避免 UTC↔local 解析错位导致的"验证码已过期"）
function _localStr(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
// 解析 rescue.json 中 YYYY-MM-DD HH:mm:ss 格式（本地时区）为 Date
function _parseLocal(str) {
  if (!str) return new Date(NaN);
  // 兼容：若带 Z/T 就按原生解析；否则用本地语义
  if (/Z$/i.test(String(str)) || /T/.test(String(str))) return new Date(str);
  const m = String(str).match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (!m) return new Date(str);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6]||0));
}

function sendSmsCaptcha(phone, scene = 'login') {
  if (!/^1[3-9]\d{9}$/.test(phone)) return { ok: false, message: '手机号格式不正确' };
  const mode = db.getConfig('sms_mode', 'dev');
  const code = mode === 'dev' ? '1234' : String(Math.floor(100000 + Math.random() * 900000));
  // 清理同手机号+场景旧验证码
  db.data.sms_captchas = (db.data.sms_captchas || []).filter(
    c => !(c.phone === phone && c.scene === scene)
  );
  const expiredAt = _localStr(new Date(Date.now() + 5 * 60 * 1000));
  db.data.sms_captchas.push({
    id: db.nextId('sms_captchas'),
    phone, scene, code, expired_at: expiredAt,
    used: 0, used_at: null,
    created_at: db.now()
  });
  db.save();
  return {
    ok: true,
    mode,
    message: mode === 'dev' ? `开发模式：验证码固定为1234（5分钟内有效）` : `验证码已发送至${phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}`,
    devCode: mode === 'dev' ? code : undefined
  };
}

function verifySmsCaptcha(phone, code, scene = 'login') {
  const mode = db.getConfig('sms_mode', 'dev');
  // 1) 严格匹配：同手机号 + 同 scene
  let list = (db.data.sms_captchas || []).filter(c => c.phone === phone && c.scene === scene);
  // 2) dev 模式兜底：严格匹配不到就放宽 scene（防止前端传错别名 scene 导致固定 1234 验证码也"请先获取验证码"）
  if (!list.length && mode === 'dev' && String(code) === '1234') {
    list = (db.data.sms_captchas || []).filter(c => c.phone === phone);
  }
  if (!list.length) return { ok: false, message: '请先获取验证码' };
  const captcha = list.sort((a, b) => b.id - a.id)[0];
  if (captcha.used) return { ok: false, message: '验证码已使用' };
  if (_parseLocal(captcha.expired_at).getTime() < Date.now()) return { ok: false, message: '验证码已过期' };
  if (captcha.code !== String(code)) return { ok: false, message: '验证码错误' };
  captcha.used = 1;
  captcha.used_at = db.now();
  db.save();
  return { ok: true };
}

// ===========================================================
// 3. 微信 code -> openid + session_key
// ===========================================================
async function wxCode2Session(code) {
  const appid = db.getConfig('wx_appid', '');
  const secret = db.getConfig('wx_appsecret', '');
  if (!appid || !secret) {
    // MVP：没有配置时生成稳定 openid（基于code hash），保证同一设备code不登录也能稳定
    const hash = crypto.createHash('md5').update('mock-wx-' + (code || 'default-mock')).digest('hex');
    return { openid: 'mock_' + hash.substring(0, 20), session_key: 'mock_sk_' + hash.substring(0, 16), unionid: null, mock: true };
  }
  // 生产：真实请求微信服务器
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}&js_code=${code}&grant_type=authorization_code`;
  try {
    const res = await (require('node-fetch') || global.fetch)(url);
    const json = await res.json();
    if (!json.openid) return { error: json.errmsg || '微信登录失败' };
    return json;
  } catch (e) {
    return { error: e.message };
  }
}

// ===========================================================
// 4. 服务卡 校验与核销
// ===========================================================
/**
 * 判断某张服务卡对订单是否可用
 * - 必须已绑定当前用户(user_id)
 * - 状态 in (unused/active) && used_count < total_uses
 * - 车型匹配（卡vehicle_type=* 则通吃，否则一致）
 */
function canUseCard(card, order, userId) {
  if (!card) return { ok: false, reason: '服务卡不存在' };
  if (card.user_id && Number(card.user_id) !== Number(userId)) return { ok: false, reason: '该服务卡不属于您' };
  if (!['unused', 'active'].includes(card.status)) return { ok: false, reason: '服务卡状态不可用' };
  if ((card.used_count || 0) >= (card.total_uses || 1)) return { ok: false, reason: '服务卡已用完' };
  if (card.vehicle_type && card.vehicle_type !== '*' && card.vehicle_type !== order.vehicle_type) return { ok: false, reason: '服务卡车型与当前订单不符' };
  // 过期时间（本地时区安全解析）
  if (card.expired_at && _parseLocal(card.expired_at).getTime() < Date.now()) return { ok: false, reason: '服务卡已过期' };
  return { ok: true };
}

/**
 * 核销服务卡（支付尾款时调用）
 * 可抵扣 = min(卡剩余价值(price * 剩余次数/总次数), 应付尾款)
 * 返回 { ok, amount_discounted, new_used_count, new_status }
 */
function redeemCard(cardId, order, userId) {
  const card = (db.data.service_cards || []).find(c => c.id === cardId);
  const chk = canUseCard(card, order, userId);
  if (!chk.ok) return { ok: false, message: chk.reason };
  const usesLeft = (card.total_uses || 1) - (card.used_count || 0);
  const valuePerUse = (card.price || 0) / (card.total_uses || 1);
  const discount = Math.min(+(valuePerUse * usesLeft).toFixed(2), +(order.total_price || 0).toFixed(2));
  card.used_count = (card.used_count || 0) + 1;
  card.status = card.used_count >= (card.total_uses || 1) ? 'used' : 'active';
  // 写使用记录
  const usage = {
    id: db.nextId('card_usages'),
    card_id: card.id,
    card_no: card.card_no,
    user_id: userId,
    order_id: order.id,
    order_no: order.order_no,
    used_amount: discount,
    vehicle_type: order.vehicle_type,
    used_at: db.now()
  };
  (db.data.card_usages = db.data.card_usages || []).push(usage);
  db.save();
  return {
    ok: true,
    card_discount_amount: discount,
    used_count: card.used_count,
    left_count: usesLeft - 1,
    new_status: card.status
  };
}

/**
 * 为用户分配一张服务卡（后台下发/用户购买）
 */
function allocateCardToUser(cardId, userId, adminId, remark) {
  const card = (db.data.service_cards || []).find(c => c.id === cardId);
  if (!card) return { ok: false, message: '服务卡不存在' };
  if (card.user_id) return { ok: false, message: '该服务卡已绑定其他用户' };
  card.user_id = userId;
  card.allocated_at = db.now();
  card.allocated_by = adminId || null;
  card.remark = remark || card.remark || '';
  card.status = 'active';
  const alloc = {
    id: db.nextId('card_allocations'),
    card_id: card.id, card_no: card.card_no,
    from_user_id: adminId ? null : null, // 预留：用户间转赠
    to_user_id: userId,
    allocated_by: adminId || null,
    remark: remark || '',
    created_at: db.now()
  };
  (db.data.card_allocations = db.data.card_allocations || []).push(alloc);
  db.save();
  return { ok: true, allocation_id: alloc.id, card_id: card.id, card_no: card.card_no, to_user_id: userId };
}

// ===========================================================
// 5. 押金/尾款 金额计算
// ===========================================================
function calcDeposit(totalPrice) {
  const ratio = parseFloat(db.getConfig('deposit_ratio', '0.3')) || 0;
  const min = parseFloat(db.getConfig('deposit_min_amount', '50')) || 0;
  const raw = +(totalPrice * ratio).toFixed(2);
  return { deposit: Math.max(min, raw), ratio, min };
}

module.exports = {
  getCreditScore, changeCreditScore, canUserPlaceOrder,
  sendSmsCaptcha, verifySmsCaptcha,
  wxCode2Session,
  canUseCard, redeemCard, allocateCardToUser,
  calcDeposit,
  nowStr: _localStr, formatLocalStr: _localStr, parseLocalStr: _parseLocal
};
