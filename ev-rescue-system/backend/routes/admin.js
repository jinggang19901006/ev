const express = require('express');
const db = require('../db');

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
  router.post('/orders/:id/assign', adminAuthMiddleware, (req, res) => {
    const { driverId } = req.body;
    const order = db.prepare('SELECT id, status, driver_id FROM orders WHERE id = ?').get(req.params.id);
    if (!order) {
      return res.json({ code: 1, message: '订单不存在' });
    }
    const driver = db.prepare('SELECT id, name, approved, status FROM drivers WHERE id = ?').get(driverId);
    if (!driver) {
      return res.json({ code: 1, message: '司机不存在' });
    }
    if (!driver.approved) {
      return res.json({ code: 1, message: '该司机未通过审核' });
    }

    const now = db.now();
    // 如果订单已经有司机，先释放原司机
    if (order.driver_id) {
      db.prepare("UPDATE drivers SET status = 'online' WHERE id = ?").run(order.driver_id);
    }
    // 指派新司机
    db.prepare("UPDATE orders SET driver_id = ?, status = 'accepted', start_time = ? WHERE id = ?")
      .run(driverId, now, req.params.id);
    // 将新司机设为忙碌
    db.prepare("UPDATE drivers SET status = 'busy' WHERE id = ?").run(driverId);
    res.json({ code: 0, message: '已指派司机：' + driver.name });
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
    const drivers = db.prepare("SELECT id, name, phone, status FROM drivers WHERE approved = 1 ORDER BY status DESC, created_at DESC").all();
    res.json({ code: 0, data: drivers });
  });

  /* ================ 系统配置管理 ================ */

  // 获取系统配置
  router.get('/config', adminAuthMiddleware, (req, res) => {
    const configs = db.data.system_config || [];
    res.json({ code: 0, data: configs });
  });

  // 更新系统配置
  router.post('/config', adminAuthMiddleware, (req, res) => {
    const { key, value, description } = req.body;
    if (!key || value === undefined) {
      return res.json({ code: 1, message: '缺少参数' });
    }
    db.setConfig(key, value, description);
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
    withdrawal.status = 'approved';
    withdrawal.processed_at = db.now();
    db.save();
    res.json({ code: 0, message: '提现已通过' });
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
    withdrawal.status = 'rejected';
    withdrawal.processed_at = db.now();
    // 退回余额
    db.prepare('UPDATE drivers SET wallet_balance = wallet_balance + ? WHERE id = ?')
      .run(withdrawal.amount, withdrawal.driver_id);
    db.save();
    res.json({ code: 0, message: '提现已拒绝，金额退回司机钱包' });
  });

  // 司机钱包列表（所有司机余额一览）
  router.get('/wallets', adminAuthMiddleware, (req, res) => {
    const drivers = db.prepare('SELECT id, name, phone, wallet_balance, total_earnings, status FROM drivers ORDER BY wallet_balance DESC').all();
    res.json({ code: 0, data: drivers });
  });

  return router;
};
