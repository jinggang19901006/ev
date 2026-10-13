const express = require('express');
const db = require('../db');
const helpers = require('../utils/helpers');

module.exports = function(jwt, JWT_SECRET, authMiddleware) {
  const router = express.Router();

  // ================================================================
  // 统一：订单输出前端前的标准化（双写字段对齐 WXML + 中文可读状态）
  // 根因：order-user.wxml 绑 total_amount/vehicle_size_cn/address，但 DB 存的是 total_price/vehicle_type/pickup_address
  // ================================================================
  const VEHICLE_CN = { small:'小型轿车(A级)', medium:'中型轿车/SUV', large:'大型车(MPV)', '*':'通用车型' };
  const STATUS_CN  = { pending:'待派单', accepted:'司机已接单', dispatched:'司机出发中', arrived:'已到达现场', charging:'充电服务中', completed:'服务已完成', cancelled:'订单已取消' };
  const DEPOSIT_CN = { unpaid:'待支付押金', paid:'押金已支付', refunded:'押金已退还', none:'无押金' };
  const PAYMENT_CN = { unpaid:'待支付尾款', paid:'尾款已结清', partial:'部分已支付', refunded:'已退款' };
  function normOrder(o) {
    if (!o) return o;
    const depositStatus = String(o.deposit_status || 'unpaid');
    const paymentStatus = String(o.payment_status || 'unpaid');
    const statusRaw = String(o.status || 'pending');
    const statusLine = [
      STATUS_CN[statusRaw] || statusRaw,
      DEPOSIT_CN[depositStatus] || '',
      PAYMENT_CN[paymentStatus] || ''
    ].filter(Boolean).join(' · ');
    return {
      ...o,
      // 双写：对齐 order-user.wxml / home-user activeOrder 的绑定字段
      total_amount: Number(o.total_price || 0),
      totalPrice: Number(o.total_price || 0),
      vehicle_size_cn: VEHICLE_CN[o.vehicle_type] || o.vehicle_type || '未知车型',
      vehicleType: o.vehicle_type,
      address: o.pickup_address || o.address || '',
      pickup_address: o.pickup_address || o.address || '',
      // 中文可读状态（前端不再需要拼三段 raw 英文）
      status_cn: STATUS_CN[statusRaw] || statusRaw,
      deposit_status_cn: DEPOSIT_CN[depositStatus] || depositStatus,
      payment_status_cn: PAYMENT_CN[paymentStatus] || paymentStatus,
      status_line: statusLine
    };
  }

  // 用户登录/注册（通过openid）
  // 兼容旧版小程序；推荐新版使用 /api/auth/* 系列接口
  router.post('/login', (req, res) => {
    const { openid, phone, nickname, avatar } = req.body;

    if (!openid) {
      return res.json({ code: 1, message: '缺少openid' });
    }

    // 查找或创建用户
    let user = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
    if (!user) {
      db.prepare('INSERT INTO users (openid, phone, nickname, avatar) VALUES (?, ?, ?, ?)')
        .run(openid, phone || '', nickname || '微信用户', avatar || '');
      user = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
      // 保证同时建立 unified_accounts（若手机号存在则关联）
      try {
        const ua = db.data.unified_accounts || [];
        if (!ua.find(a => a.wx_openid === openid)) {
          ua.push({
            id: db.nextId('unified_accounts'),
            phone: user.phone || '',
            nickname: user.nickname,
            avatar: user.avatar,
            wx_openid: openid,
            user_id: user.id,
            driver_id: null,
            status: 'active',
            last_login_role: 'user',
            last_login_at: db.now(),
            created_at: db.now()
          });
          db.save();
        }
      } catch (e) { /* ignore */ }
    } else {
      // 更新信息
      db.prepare('UPDATE users SET phone = ?, nickname = ?, avatar = ? WHERE id = ?')
        .run(phone || user.phone, nickname || user.nickname, avatar || user.avatar, user.id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    }

    const token = jwt.sign({ id: user.id, openid: user.openid, role: 'user' }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ code: 0, data: { token, user, notice: '建议后续使用 /api/auth/* 统一认证接口(支持短信+角色选择)' } });
  });

  // 获取用户信息（扩展：信用积分+可用服务卡数量）
  router.get('/info', authMiddleware, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.json({ code: 1, message: '用户不存在' });
    const score = helpers.getCreditScore(req.user.id);
    const cardsCount = (db.data.service_cards || []).filter(c => Number(c.user_id) === Number(req.user.id) && ['unused', 'active'].includes(c.status)).length;
    const unpaid = (db.data.orders || []).filter(o => o.status === 'completed' && o.user_id === req.user.id && o.payment_status !== 'paid').length;
    res.json({ code: 0, data: { ...user, credit_score: score, service_cards_count: cardsCount, unpaid_orders_count: unpaid } });
  });

  // 获取用户订单列表
  router.get('/orders', authMiddleware, (req, res) => {
    const { page = 1, pageSize = 20 } = req.query;
    const offset = (page - 1) * pageSize;
    const orders = db.prepare(`
      SELECT o.*, d.name as driver_name, d.phone as driver_phone, d.rating as driver_rating
      FROM orders o LEFT JOIN drivers d ON o.driver_id = d.id
      WHERE o.user_id = ?
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
    `).all(req.user.id, pageSize, offset);

    const total = db.prepare('SELECT COUNT(*) as count FROM orders WHERE user_id = ?').get(req.user.id).count;
    const list = (orders || []).map(normOrder);
    res.json({ code: 0, data: { list, total: Number(total), page: Number(page) } });
  });

  // 获取用户的服务卡
  router.get('/cards', authMiddleware, (req, res) => {
    const cards = db.prepare(`
      SELECT * FROM service_cards WHERE user_id = ? ORDER BY created_at DESC
    `).all(req.user.id);
    res.json({ code: 0, data: cards });
  });

  return router;
};
