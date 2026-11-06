const express = require('express');
const db = require('../db');
const dispatch = require('../utils/order_dispatch');

const CONFIG_NUMBER_RANGES = {
  commission_rate: [0, 1],
  min_withdraw_amount: [1, 100000],
  deposit_ratio: [0, 1],
  deposit_min_amount: [0, 10000],
  escape_penalty_score: [0, 100],
  bad_rating_penalty_score: [0, 100],
  pay_on_time_bonus_score: [0, 20],
  credit_min_to_order: [0, 100],
  unpaid_pay_timeout_hours: [1, 168],
  dispatch_distance_weight: [0, 1],
  dispatch_rating_weight: [0, 1],
  dispatch_level_weight: [0, 1],
  dispatch_order_weight: [0, 1],
  dispatch_max_candidates: [1, 50],
  dispatch_max_distance_km: [1, 300]
};
const CONFIG_ENUMS = {
  sms_mode: ['dev', 'prod'],
  dispatch_enabled: ['0', '1'],
  dispatch_strategy: ['auto_assign', 'recommend_only', 'manual'],
  dispatch_require_deposit: ['0', '1'],
  dispatch_allow_busy: ['0', '1'],
  tencent_map_driving_policy: ['SHORT_DISTANCE', 'LEAST_TIME']
};
const CONFIG_INTEGER_KEYS = new Set([
  'escape_penalty_score',
  'bad_rating_penalty_score',
  'pay_on_time_bonus_score',
  'credit_min_to_order',
  'unpaid_pay_timeout_hours',
  'dispatch_max_candidates',
  'dispatch_max_distance_km'
]);
const CONFIG_MAX_LENGTHS = {
  wx_appid: 128,
  wx_appsecret: 256,
  wx_merchant_id: 64,
  wx_pay_key: 256,
  tencent_map_key: 128
};
const SENSITIVE_CONFIG_KEYS = new Set([
  'wx_appsecret',
  'wx_pay_key',
  'tencent_map_key'
]);

module.exports = function(jwt, JWT_SECRET, adminAuthMiddleware, upload) {
  const router = express.Router();

  // 管理员登录
  router.post('/login', (req, res) => {
    const { username, password } = req.body;
    const admin = db.prepare('SELECT * FROM admins WHERE username = ? AND password = ?').get(username, password);
    if (!admin) {
      return res.json({ code: 1, message: '用户名或密码错误' });
    }
    const token = jwt.sign({ id: admin.id, username: admin.username, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ code: 0, data: { token, admin: { id: admin.id, name: admin.name, username: admin.username } } });
  });

  // 数据看板
  router.get('/dashboard', adminAuthMiddleware, (req, res) => {
    const today = new Date().toISOString().substring(0, 10);
    const thisMonth = today.substring(0, 7);
    const commissionRate = parseFloat(db.getConfig('commission_rate', '0.2'));

    const todayStats = db.prepare(`
      SELECT COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
        SUM(CASE WHEN status NOT IN ('completed','cancelled') THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'completed' THEN total_price ELSE 0 END) as revenue
      FROM orders WHERE DATE(created_at) = ?
    `).get(today);

    const monthStats = db.prepare(`
      SELECT COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'completed' THEN total_price ELSE 0 END) as revenue
      FROM orders WHERE created_at LIKE ?
    `).get(thisMonth + '%');

    // JS层计算平台收入
    const todayRevenue = Number(todayStats.revenue) || 0;
    const monthRevenue = Number(monthStats.revenue) || 0;
    todayStats.profit = Math.round(todayRevenue * commissionRate * 100) / 100;
    monthStats.profit = Math.round(monthRevenue * commissionRate * 100) / 100;

    const onlineDrivers = db.prepare('SELECT COUNT(*) as count FROM drivers WHERE status = ?').get('online');
    const pendingDrivers = db.prepare('SELECT COUNT(*) as count FROM drivers WHERE approved = 0').get();
    const pendingWithdrawals = (db.data.withdrawals || []).filter(w => w.status === 'pending').length;

    const vehicleBreakdown = db.prepare(`
      SELECT vehicle_type,
        COUNT(*) as count,
        SUM(CASE WHEN status = 'completed' THEN total_price ELSE 0 END) as revenue
      FROM orders WHERE DATE(created_at) = ?
      GROUP BY vehicle_type
    `).all(today);

    res.json({
      code: 0,
      data: {
        today: todayStats,
        month: monthStats,
        onlineDrivers: onlineDrivers.count,
        pendingDrivers: pendingDrivers.count,
        pendingWithdrawals,
        commissionRate,
        vehicleBreakdown
      }
    });
  });

  // 订单列表
  router.get('/orders', adminAuthMiddleware, (req, res) => {
    const { page = 1, pageSize = 20, status, vehicleType, keyword } = req.query;
    const offset = (page - 1) * pageSize;

    let sql = `
      SELECT o.*, d.name as driver_name, d.phone as driver_phone, u.phone as user_phone, u.nickname as user_name
      FROM orders o
      LEFT JOIN drivers d ON o.driver_id = d.id
      LEFT JOIN users u ON o.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'all') {
      sql += ' AND o.status = ?';
      params.push(status);
    }
    if (vehicleType && vehicleType !== 'all') {
      sql += ' AND o.vehicle_type = ?';
      params.push(vehicleType);
    }
    if (keyword) {
      sql += ' AND (o.order_no LIKE ? OR o.vehicle_plate LIKE ? OR o.pickup_address LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    sql += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
    params.push(pageSize, offset);

    const orders = db.prepare(sql).all(...params);

    // 获取总数
    let countSql = 'SELECT COUNT(*) as count FROM orders o WHERE 1=1';
    const countParams = [];
    if (status && status !== 'all') {
      countSql += ' AND o.status = ?';
      countParams.push(status);
    }
    if (vehicleType && vehicleType !== 'all') {
      countSql += ' AND o.vehicle_type = ?';
      countParams.push(vehicleType);
    }
    if (keyword) {
      countSql += ' AND (o.order_no LIKE ? OR o.vehicle_plate LIKE ? OR o.pickup_address LIKE ?)';
      countParams.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    const total = db.prepare(countSql).get(...countParams).count;

    res.json({ code: 0, data: { list: orders, total, page: Number(page) } });
  });

  // 司机管理列表（enrich：服务等级V1-V7 / 饥饿度7日接单 / 钱包余额 / 累计收入）
  router.get('/drivers', adminAuthMiddleware, (req, res) => {
    const { page = 1, pageSize = 20 } = req.query;
    const offset = (page - 1) * pageSize;
    const drivers = db.prepare(`
      SELECT * FROM drivers ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(pageSize, offset);
    const levels = db.data.driver_levels || [];
    const list = drivers.map(d => {
      const lv = levels.find(l => l.id === Number(d.level_id)) || levels[0] || {};
      return {
        ...d,
        level_id: d.level_id || lv.id || 1,
        level_code: lv.level || 'V1',
        level_name: lv.name || '新晋救援者',
        level_coefficient: lv.coefficient != null ? lv.coefficient : 1,
        accept_count_7d: Number(d.accept_count_7d) || 0,
        wallet_balance: Number(d.wallet_balance) || 0,
        total_earnings: Number(d.total_earnings) || 0,
        total_orders: Number(d.total_orders) || 0
      };
    });
    const total = db.prepare('SELECT COUNT(*) as count FROM drivers').get().count;
    res.json({ code: 0, data: { list, total, page: Number(page) } });
  });

  // 审核司机
  router.post('/drivers/:id/approve', adminAuthMiddleware, (req, res) => {
    db.prepare('UPDATE drivers SET approved = 1 WHERE id = ?').run(req.params.id);
    res.json({ code: 0, message: '已通过审核' });
  });

  // 拒绝司机
  router.post('/drivers/:id/reject', adminAuthMiddleware, (req, res) => {
    db.prepare('UPDATE drivers SET approved = 0 WHERE id = ?').run(req.params.id);
    res.json({ code: 0, message: '已拒绝' });
  });

  // 定价配置列表
  router.get('/pricing', adminAuthMiddleware, (req, res) => {
    const configs = db.prepare('SELECT * FROM pricing_config ORDER BY id').all();
    res.json({ code: 0, data: configs });
  });

  // 更新定价
  router.post('/pricing/:id', adminAuthMiddleware, (req, res) => {
    const { dayPrice, nightPrice, baseDistanceKm, extraPerKm, isActive } = req.body;
    db.prepare(`
      UPDATE pricing_config
      SET day_price = ?, night_price = ?, base_distance_km = ?, extra_per_km = ?, is_active = ?
      WHERE id = ?
    `).run(dayPrice, nightPrice, baseDistanceKm, extraPerKm, isActive ? 1 : 0, req.params.id);
    res.json({ code: 0, message: '定价已更新' });
  });

  // 订单详情
  router.get('/orders/:id', adminAuthMiddleware, (req, res) => {
    const order = db.prepare(`
      SELECT o.*, d.name as driver_name, d.phone as driver_phone,
        u.phone as user_phone, u.nickname as user_name
      FROM orders o
      LEFT JOIN drivers d ON o.driver_id = d.id
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = ?
    `).get(req.params.id);
    res.json({ code: 0, data: order });
  });

  // 手动改价
  router.post('/orders/:id/price', adminAuthMiddleware, (req, res) => {
    const { basePrice, distanceFee, extraFee } = req.body;
    const total = (basePrice || 0) + (distanceFee || 0) + (extraFee || 0);
    db.prepare('UPDATE orders SET base_price = ?, distance_fee = ?, extra_fee = ?, total_price = ? WHERE id = ?')
      .run(basePrice, distanceFee, extraFee, total, req.params.id);
    res.json({ code: 0, message: '价格已修改' });
  });

  // 服务卡管理
  router.get('/cards', adminAuthMiddleware, (req, res) => {
    const cards = db.prepare(`
      SELECT sc.*, u.nickname as user_name FROM service_cards sc
      LEFT JOIN users u ON sc.user_id = u.id
      ORDER BY sc.created_at DESC
    `).all();
    res.json({ code: 0, data: cards });
  });

  // 生成服务卡
  router.post('/cards', adminAuthMiddleware, (req, res) => {
    const { vehicleType, price } = req.body;
    const cardNo = `CARD${Date.now()}${Math.floor(Math.random() * 1000)}`;
    db.prepare('INSERT INTO service_cards (card_no, vehicle_type, price) VALUES (?, ?, ?)')
      .run(cardNo, vehicleType || 'small', price || 0);
    res.json({ code: 0, data: { cardNo }, message: '服务卡已生成' });
  });

  // 删除服务卡
  router.delete('/cards/:id', adminAuthMiddleware, (req, res) => {
    db.prepare('DELETE FROM service_cards WHERE id = ?').run(req.params.id);
    res.json({ code: 0, message: '服务卡已删除' });
  });

  /* ================ 用户管理 ================ */

  // 用户列表
  router.get('/users', adminAuthMiddleware, (req, res) => {
    const { page = 1, pageSize = 20, keyword } = req.query;
    const offset = (page - 1) * pageSize;
    // 不使用子查询（JSON DB不支持），改为JS层计算统计
    let sql = `
      SELECT u.id, u.openid, u.phone, u.nickname, u.avatar, u.created_at
      FROM users u WHERE 1=1
    `;
    let countSql = 'SELECT COUNT(*) as count FROM users u WHERE 1=1';
    const params = [];
    const countParams = [];

    if (keyword) {
      sql += ' AND (u.phone LIKE ? OR u.nickname LIKE ? OR u.openid LIKE ?)';
      countSql += ' AND (u.phone LIKE ? OR u.nickname LIKE ? OR u.openid LIKE ?)';
      const kw = `%${keyword}%`;
      params.push(kw, kw, kw);
      countParams.push(kw, kw, kw);
    }

    sql += ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?';
    params.push(pageSize, offset);

    const users = db.prepare(sql).all(...params);
    const total = db.prepare(countSql).get(...countParams).count;

    // JS层计算每个用户的订单统计 + 信用积分 + 未付订单数
    const allOrders = db.prepare('SELECT user_id, status, total_price, payment_status FROM orders').all();
    const creditRows = db.data.credit_scores || [];
    users.forEach(user => {
      const userOrders = allOrders.filter(o => String(o.user_id) === String(user.id));
      user.total_orders = userOrders.length;
      user.total_spent = userOrders
        .filter(o => o.status === 'completed')
        .reduce((sum, o) => sum + (Number(o.total_price) || 0), 0);
      // 未付订单数：已完成但尾款未付清（逃单扫描判定依据）
      user.unpaid_orders_count = userOrders.filter(o => o.status === 'completed' && o.payment_status !== 'paid').length;
      // 信用积分：取该用户最近一条 credit_scores 的 balance_after，无记录默认 100
      const scores = creditRows.filter(c => String(c.user_id) === String(user.id)).sort((a, b) => b.id - a.id);
      user.credit_score = scores.length ? Number(scores[0].balance_after) : 100;
    });

    res.json({ code: 0, data: { list: users, total, page: Number(page) } });
  });

  // 用户详情
  router.get('/users/:id', adminAuthMiddleware, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) {
      return res.json({ code: 1, message: '用户不存在' });
    }
    const orders = db.prepare(`
      SELECT o.*, d.name as driver_name
      FROM orders o LEFT JOIN drivers d ON o.driver_id = d.id
      WHERE o.user_id = ?
      ORDER BY o.created_at DESC LIMIT 10
    `).all(req.params.id);
    res.json({ code: 0, data: { user, orders } });
  });

  // 删除用户
  router.delete('/users/:id', adminAuthMiddleware, (req, res) => {
    const userId = req.params.id;
    // 检查是否有进行中的订单
    const activeOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE user_id = ? AND status NOT IN ('completed', 'cancelled')").get(userId);
    if (activeOrders.count > 0) {
      return res.json({ code: 1, message: '该用户有进行中的订单，无法删除' });
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    res.json({ code: 0, message: '用户已删除' });
  });

  /* ================ 订单管理增强 ================ */

  // 取消订单
  router.post('/orders/:id/cancel', adminAuthMiddleware, (req, res) => {
    const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(req.params.id);
    if (!order) {
      return res.json({ code: 1, message: '订单不存在' });
    }
    if (order.status === 'completed') {
      return res.json({ code: 1, message: '已完成的订单无法取消' });
    }
    db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(req.params.id);
    res.json({ code: 0, message: '订单已取消' });
  });

  // 删除订单
  router.delete('/orders/:id', adminAuthMiddleware, (req, res) => {
    db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
    res.json({ code: 0, message: '订单已删除' });
  });

  // 指派司机
  router.post('/orders/:id/assign', adminAuthMiddleware, async (req, res) => {
    const { driverId } = req.body;
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    let result;
    try {
      const candidates = order
        ? await dispatch.rankDriversForOrder(order, { manualDriverId: Number(driverId) })
        : [];
      result = await dispatch.assignDriver(order, driverId, {
        manual: true,
        candidates,
        reason: String(req.body.reason || '管理员在调度台人工指派')
      });
    } catch (error) {
      return res.json({ code: 1, message: error.message || '腾讯地图路线计算失败' });
    }
    if (!result.ok) return res.json({ code: 1, message: result.message });
    res.json({
      code: 0,
      message: '已指派司机：' + result.driver.name,
      data: { order: result.order, driver: result.driver }
    });
  });

  /* ================ 司机管理增强 ================ */

  // 编辑司机信息
  router.post('/drivers/:id/edit', adminAuthMiddleware, (req, res) => {
    const { name, phone } = req.body;
    if (!name || !phone) {
      return res.json({ code: 1, message: '请填写姓名和电话' });
    }
    db.prepare('UPDATE drivers SET name = ?, phone = ? WHERE id = ?').run(name, phone, req.params.id);
    res.json({ code: 0, message: '司机信息已更新' });
  });

  // 删除司机
  router.delete('/drivers/:id', adminAuthMiddleware, (req, res) => {
    const activeOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE driver_id = ? AND status NOT IN ('completed', 'cancelled')").get(req.params.id);
    if (activeOrders.count > 0) {
      return res.json({ code: 1, message: '该司机有进行中的订单，无法删除' });
    }
    db.prepare('DELETE FROM drivers WHERE id = ?').run(req.params.id);
    res.json({ code: 0, message: '司机已删除' });
  });

  // 获取可用司机列表(已审核且在线)
  router.get('/drivers/available', adminAuthMiddleware, (req, res) => {
    const drivers = db.prepare("SELECT id, name, phone, status FROM drivers WHERE approved = 1 AND status = 'online' ORDER BY created_at DESC").all();
    res.json({ code: 0, data: drivers });
  });

  /* ================ 系统配置管理 ================ */

  // 获取系统配置
  router.get('/config', adminAuthMiddleware, (req, res) => {
    const configs = (db.data.system_config || []).map(item => ({
      ...item,
      value: SENSITIVE_CONFIG_KEYS.has(item.key) && item.value ? '********' : item.value,
      configured: SENSITIVE_CONFIG_KEYS.has(item.key) ? Boolean(item.value) : undefined
    }));
    res.json({ code: 0, data: configs });
  });

  // 更新系统配置
  router.post('/config', adminAuthMiddleware, (req, res) => {
    const { key, value, description } = req.body;
    if (!key || value === undefined) {
      return res.json({ code: 1, message: '缺少参数' });
    }
    if (!(db.data.system_config || []).some(item => item.key === key)) {
      return res.json({ code: 1, message: '不允许创建未知配置项' });
    }
    const stringValue = String(value).trim();
    if (CONFIG_NUMBER_RANGES[key]) {
      const numberValue = Number(stringValue);
      const [min, max] = CONFIG_NUMBER_RANGES[key];
      if (!Number.isFinite(numberValue) || numberValue < min || numberValue > max) {
        return res.json({ code: 1, message: `配置值必须在 ${min} 到 ${max} 之间` });
      }
      if (CONFIG_INTEGER_KEYS.has(key) && !Number.isInteger(numberValue)) {
        return res.json({ code: 1, message: '该配置必须填写整数' });
      }
    }
    if (CONFIG_ENUMS[key] && !CONFIG_ENUMS[key].includes(stringValue)) {
      return res.json({ code: 1, message: `配置值无效，可选值：${CONFIG_ENUMS[key].join(' / ')}` });
    }
    if (CONFIG_MAX_LENGTHS[key] && stringValue.length > CONFIG_MAX_LENGTHS[key]) {
      return res.json({ code: 1, message: `配置内容不能超过 ${CONFIG_MAX_LENGTHS[key]} 个字符` });
    }
    db.setConfig(key, stringValue, description);
    res.json({ code: 0, message: '配置已更新' });
  });

  /* ================ 提现管理 ================ */

  // 提现申请列表
  router.get('/withdrawals', adminAuthMiddleware, (req, res) => {
    const { status, page = 1, pageSize = 20 } = req.query;
    let withdrawals = [...(db.data.withdrawals || [])];
    
    if (status && status !== 'all') {
      withdrawals = withdrawals.filter(w => w.status === status);
    }
    
    withdrawals.sort((a, b) => b.id - a.id);
    const total = withdrawals.length;
    const offset = (page - 1) * pageSize;
    const list = withdrawals.slice(offset, offset + Number(pageSize));
    
    res.json({ code: 0, data: { list, total, page: Number(page) } });
  });

  // 审批通过提现
  router.post('/withdrawals/:id/approve', adminAuthMiddleware, (req, res) => {
    const withdrawal = (db.data.withdrawals || []).find(w => w.id === Number(req.params.id));
    if (!withdrawal) {
      return res.json({ code: 1, message: '提现记录不存在' });
    }
    if (withdrawal.status !== 'pending') {
      return res.json({ code: 1, message: '该提现已处理' });
    }
    const paymentReference = String(req.body.payment_reference || '').trim();
    if (paymentReference.length < 4 || paymentReference.length > 80) {
      return res.json({ code: 1, message: '请填写有效的打款流水号' });
    }
    withdrawal.status = 'paid';
    withdrawal.payment_reference = paymentReference;
    withdrawal.review_remark = String(req.body.remark || '').trim().slice(0, 200);
    withdrawal.processed_by = req.admin.username || req.admin.id;
    withdrawal.processed_at = db.now();
    db.save();
    res.json({ code: 0, message: '提现已确认打款', data: withdrawal });
  });

  // 拒绝提现（退回余额）
  router.post('/withdrawals/:id/reject', adminAuthMiddleware, (req, res) => {
    const withdrawal = (db.data.withdrawals || []).find(w => w.id === Number(req.params.id));
    if (!withdrawal) {
      return res.json({ code: 1, message: '提现记录不存在' });
    }
    if (withdrawal.status !== 'pending') {
      return res.json({ code: 1, message: '该提现已处理' });
    }
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 2 || reason.length > 200) {
      return res.json({ code: 1, message: '请填写拒绝原因' });
    }
    withdrawal.status = 'rejected';
    withdrawal.review_remark = reason;
    withdrawal.processed_by = req.admin.username || req.admin.id;
    withdrawal.processed_at = db.now();
    // 退回余额
    const driver = db.data.drivers.find(d => d.id === withdrawal.driver_id);
    if (driver) {
      driver.wallet_balance = Math.round((Number(driver.wallet_balance || 0) + Number(withdrawal.amount || 0)) * 100) / 100;
    }
    db.save();
    res.json({ code: 0, message: '提现已拒绝，金额退回司机钱包', data: withdrawal });
  });

  // 司机钱包列表（所有司机余额一览）
  router.get('/wallets', adminAuthMiddleware, (req, res) => {
    const drivers = db.prepare('SELECT id, name, phone, wallet_balance, total_earnings, status FROM drivers ORDER BY wallet_balance DESC').all();
    res.json({ code: 0, data: drivers });
  });

  return router;
};
