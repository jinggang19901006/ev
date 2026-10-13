const express = require('express');
const db = require('../db');
const dispatch = require('../utils/order_dispatch');

module.exports = function(jwt, JWT_SECRET, authMiddleware) {
  const router = express.Router();

  // ================================================================
  // 订单标准化（和 orders.js / users.js 对齐 WXML 绑定 + 中文状态）
  // ================================================================
  const VEHICLE_CN = { small:'小型轿车(A级)', medium:'中型轿车/SUV', large:'大型车(MPV)', '*':'通用车型' };
  const STATUS_CN  = { pending:'待派单', accepted:'司机已接单', dispatched:'司机出发中', arrived:'已到达现场', charging:'充电服务中', completed:'服务已完成', cancelled:'订单已取消' };
  const DEPOSIT_CN = { unpaid:'待支付押金', paid:'押金已支付', refunded:'押金已退还', none:'无押金' };
  const PAYMENT_CN = { unpaid:'待支付尾款', paid:'尾款已结清', partial:'部分已支付', refunded:'已退款' };
  function normOrder(o) {
    if (!o) return o;
    const d = String(o.deposit_status || 'unpaid');
    const p = String(o.payment_status || 'unpaid');
    const s = String(o.status || 'pending');
    const statusLine = [STATUS_CN[s]||s, DEPOSIT_CN[d]||'', PAYMENT_CN[p]||''].filter(Boolean).join(' · ');
    return {
      ...o,
      total_amount: Number(o.total_price || 0),
      totalPrice: Number(o.total_price || 0),
      vehicle_size_cn: VEHICLE_CN[o.vehicle_type] || o.vehicle_type || '未知车型',
      vehicleType: o.vehicle_type,
      address: o.pickup_address || o.address || '',
      pickup_address: o.pickup_address || o.address || '',
      time_type: o.is_night ? 'night' : 'day',
      status_cn: STATUS_CN[s] || s,
      deposit_status_cn: DEPOSIT_CN[d] || d,
      payment_status_cn: PAYMENT_CN[p] || p,
      status_line: statusLine
    };
  }

  // 司机登录/注册
  router.post('/login', (req, res) => {
    const { openid, phone, name, avatar } = req.body;

    if (!openid || !phone || !name) {
      return res.json({ code: 1, message: '缺少必要参数' });
    }

    let driver = db.prepare('SELECT * FROM drivers WHERE openid = ?').get(openid);
    if (!driver) {
      db.prepare('INSERT INTO drivers (openid, phone, name, avatar) VALUES (?, ?, ?, ?)')
        .run(openid, phone, name, avatar || '');
      driver = db.prepare('SELECT * FROM drivers WHERE openid = ?').get(openid);
    } else {
      db.prepare('UPDATE drivers SET phone = ?, name = ?, avatar = ? WHERE id = ?')
        .run(phone, name, avatar || driver.avatar, driver.id);
      driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(driver.id);
    }

    const token = jwt.sign({ id: driver.id, openid: driver.openid, role: 'driver' }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ code: 0, data: { token, driver } });
  });

  // 获取司机信息
  router.get('/info', authMiddleware, (req, res) => {
    const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(req.user.id);
    if (!driver) return res.json({ code: 1, message: '司机不存在' });
    const commissionRate = parseFloat(db.getConfig('commission_rate', '0.2'));
    res.json({ code: 0, data: { ...driver, commission_rate: commissionRate } });
  });

  // 更新在线状态
  router.post('/status', authMiddleware, (req, res) => {
    const { status } = req.body; // online/offline/busy
    db.prepare('UPDATE drivers SET status = ? WHERE id = ?').run(status, req.user.id);
    res.json({ code: 0, message: '状态已更新' });
  });

  // 获取待接单列表
  router.get('/pending-orders', authMiddleware, (req, res) => {
    const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(req.user.id);
    if (!driver) return res.json({ code: 1, message: '司机不存在' });
    // D1：approved 宽松判断
    const okApproved = driver.approved === 1 || driver.approved === true || String(driver.approved) === '1';
    if (!okApproved) return res.json({ code: 1, message: '账号未审核通过' });

    // ===== D3 修复：只有 status=pending 且 押金已付 的订单才进派单池（严格按需求5"押金paid 才进派单池"）=====
    const orders = db.prepare(`
      SELECT o.*, u.phone as user_phone, u.nickname as user_name
      FROM orders o LEFT JOIN users u ON o.user_id = u.id
      WHERE o.status = 'pending' AND o.deposit_status = 'paid'
      ORDER BY o.created_at ASC
    `).all();

    const list = (orders || []).map(normOrder);
    // ===== D5 修复：返回包装成 {list, total, page}，对齐前端 pending: list.list || [] 取值（之前直接返回数组 → list.list=undefined → 大厅恒空）=====
    res.json({ code: 0, data: { list, total: list.length, page: 1 } });
  });

  // ===== M3 新增：司机进行中的订单（accepted/dispatched/arrived/charging 任一）→ 首页展示进行中卡片 + 动作按钮 =====
  router.get('/active-order', authMiddleware, (req, res) => {
    const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(req.user.id);
    if (!driver) return res.json({ code: 1, message: '司机不存在' });

    const order = db.prepare(`
      SELECT o.*, u.phone as user_phone, u.nickname as user_name
      FROM orders o LEFT JOIN users u ON o.user_id = u.id
      WHERE o.driver_id = ? AND o.status IN ('accepted','dispatched','arrived','charging')
      ORDER BY o.created_at DESC LIMIT 1
    `).get(req.user.id);

    res.json({ code: 0, data: normOrder(order) || null });
  });

  // 司机接单
  router.post('/accept/:orderId', authMiddleware, (req, res) => {
    const { orderId } = req.params;
    const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(req.user.id);
    if (!driver || !driver.approved) {
      return res.json({ code: 1, message: '账号未审核通过' });
    }
    if (driver.status !== 'online') {
      return res.json({ code: 1, message: '请先切换为上线状态' });
    }

    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND status = ?').get(orderId, 'pending');
    if (!order) {
      return res.json({ code: 1, message: '订单不存在或已被接单' });
    }

    // ===== 需求5：如果用户没付押金，司机接单提示（但不阻止极端场景）=====
    if (order.deposit_status !== 'paid') {
      // 仍允许接单，但在结果中加个warn字段，司机端展示"用户未付押金，可能逃单"
    }
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    db.prepare('UPDATE orders SET driver_id = ?, status = ?, start_time = ? WHERE id = ?')
      .run(req.user.id, 'accepted', now, orderId);
    db.prepare('UPDATE drivers SET status = ? WHERE id = ?').run('busy', req.user.id);
    // ===== 需求3：饥饿式派单计数器，7日接单+1 =====
    dispatch.incrementAcceptCount(req.user.id);

    res.json({
      code: 0, message: '接单成功',
      warn: order.deposit_status !== 'paid' ? '用户尚未支付押金，服务完成后注意提醒用户支付尾款' : undefined
    });
  });

  // 更新订单状态（出发/到达/开始充电/结束充电/完成）
  router.post('/update-status/:orderId', authMiddleware, (req, res) => {
    const { orderId } = req.params;
    // 字段双兼容：前端统一端传 progress + snake_case（before_photo/after_photo/highway_fee...），
    // 旧调用传 status + camelCase（beforePhoto/afterPhoto/extraFee）
    const rawStatus = String(req.body.status || req.body.progress || '').trim();
    const beforePhoto = req.body.beforePhoto || req.body.before_photo;
    const afterPhoto = req.body.afterPhoto || req.body.after_photo;
    let extraFee = req.body.extraFee;
    if (extraFee === undefined) {
      // snake_case 三个加项字段 → 组装成 extraFee 对象
      if (req.body.highway_fee != null || req.body.parking_fee != null || req.body.other_fee != null) {
        extraFee = {
          highway: req.body.highway_fee || 0,
          parking: req.body.parking_fee || 0,
          other: req.body.other_fee || 0
        };
      }
    }
    const feeRemark = req.body.fee_remark || req.body.feeRemark || '';

    // ===== M2：统一状态机（严格对应 STATUS_CN 字典 4 步：accepted→dispatched→arrived→charging→completed）=====
    // 兼容旧 en_route 别名
    let status = rawStatus;
    if (status === 'en_route') status = 'dispatched';
    const ALLOWED_NEXT = {
      accepted: ['dispatched','cancelled'],
      dispatched: ['arrived'],
      arrived: ['charging'],
      charging: ['completed'],
      completed: [],
      cancelled: [],
      pending: []
    };
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND driver_id = ?').get(orderId, req.user.id);
    if (!order) return res.json({ code: 1, message: '订单不存在或无权操作' });
    const currentStatus = String(order.status || 'pending');
    const allowed = ALLOWED_NEXT[currentStatus] || [];
    if (!allowed.includes(status)) {
      return res.json({ code: 409, message: `当前状态「${STATUS_CN[currentStatus]||currentStatus}」不能直接操作「${STATUS_CN[status]||status}」。正确顺序：已接单 → 出发中 → 已到达现场 → 充电中 → 服务完成。` });
    }

    const now = db.now();
    const updates = {};
    if (status) updates.status = status;
    if (beforePhoto) updates.before_photo = beforePhoto;
    if (afterPhoto) updates.after_photo = afterPhoto;
    if (feeRemark) updates.fee_remark = feeRemark;

    switch (status) {
      case 'dispatched':
        updates.dispatch_time = now;
        if (!updates.start_time) updates.start_time = now;
        break;
      case 'arrived':
        updates.arrive_time = now;
        break;
      case 'charging':
        updates.charging_start_time = now;
        break;
      case 'completed':
        updates.charging_end_time = now;
        updates.complete_time = now;
        // 完成后：标记尾款待付（payment_status='unpaid' 本身就是默认，改为明确 pending 亦可，保持不动）
        updates.payment_status = (order.payment_status === 'paid') ? 'paid' : 'unpaid';
        break;
      case 'cancelled':
        updates.cancel_time = now;
        break;
    }

    // 如果有额外费用，更新总价
    if (extraFee !== undefined) {
      let extraFeeNum = 0;
      if (typeof extraFee === 'object' && extraFee !== null) {
        extraFeeNum = Number(extraFee.highway || 0) + Number(extraFee.parking || 0) + Number(extraFee.other || 0);
      } else {
        extraFeeNum = Number(extraFee) || 0;
      }
      updates.extra_fee = extraFeeNum;
      const basePrice = Number(order.base_price) || 0;
      const distanceFee = Number(order.distance_fee) || 0;
      updates.total_price = basePrice + distanceFee + extraFeeNum;
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);
    if (setClauses) db.prepare(`UPDATE orders SET ${setClauses} WHERE id = ?`).run(...values, orderId);

    // 如果订单完成，更新司机统计和钱包
    if (status === 'completed') {
      const finalTotal = updates.total_price !== undefined ? Number(updates.total_price) : Number(order.total_price) || 0;
      const commissionRate = parseFloat(db.getConfig('commission_rate', '0.2'));
      const driverRate = 1 - commissionRate;
      const driverIncome = Math.round(finalTotal * driverRate * 100) / 100;
      const platformIncome = Math.round(finalTotal * commissionRate * 100) / 100;
      db.prepare('UPDATE orders SET driver_income = ?, platform_income = ? WHERE id = ?').run(driverIncome, platformIncome, orderId);
      db.prepare('UPDATE drivers SET total_orders = total_orders + 1, total_earnings = total_earnings + ?, wallet_balance = wallet_balance + ?, status = ? WHERE id = ?').run(driverIncome, driverIncome, 'online', req.user.id);
      try { dispatch.updateDriverLevelAfterOrder(req.user.id); } catch(e) { /* 升级失败不影响流程 */ }
    } else if (status === 'cancelled') {
      // 取消后：司机恢复 online，订单押金状态若已付则保留（由管理员退）
      db.prepare("UPDATE drivers SET status = 'online' WHERE id = ?").run(req.user.id);
    }

    res.json({ code: 0, message: '状态已更新为：' + (STATUS_CN[status] || status), data: { status, status_cn: STATUS_CN[status] || status } });
  });

  // 司机订单历史
  router.get('/orders', authMiddleware, (req, res) => {
    const { page = 1, pageSize = 20 } = req.query;
    const offset = (page - 1) * pageSize;
    const orders = db.prepare(`
      SELECT o.*, u.phone as user_phone, u.nickname as user_name
      FROM orders o LEFT JOIN users u ON o.user_id = u.id
      WHERE o.driver_id = ?
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
    `).all(req.user.id, pageSize, offset);

    const total = db.prepare('SELECT COUNT(*) as count FROM orders WHERE driver_id = ?').get(req.user.id).count;
    const list = (orders || []).map(normOrder);

    res.json({ code: 0, data: { list, total: Number(total), page: Number(page) } });
  });

  // 司机收入统计
  router.get('/earnings', authMiddleware, (req, res) => {
    const today = new Date().toISOString().substring(0, 10);
    const thisMonth = today.substring(0, 7);
    const commissionRate = parseFloat(db.getConfig('commission_rate', '0.2'));
    const driverRate = 1 - commissionRate;

    const todayEarnings = db.prepare(`
      SELECT COUNT(*) as count, SUM(total_price) as total_amount
      FROM orders WHERE driver_id = ? AND status = 'completed' AND DATE(complete_time) = ?
    `).get(req.user.id, today);

    const monthEarnings = db.prepare(`
      SELECT COUNT(*) as count, SUM(total_price) as total_amount
      FROM orders WHERE driver_id = ? AND status = 'completed' AND complete_time LIKE ?
    `).get(req.user.id, thisMonth + '%');

    const driver = db.prepare('SELECT total_orders, total_earnings, wallet_balance FROM drivers WHERE id = ?').get(req.user.id);

    res.json({
      code: 0,
      data: {
        today: { orders: todayEarnings.count || 0, earnings: Math.round((todayEarnings.total_amount || 0) * driverRate * 100) / 100 },
        month: { orders: monthEarnings.count || 0, earnings: Math.round((monthEarnings.total_amount || 0) * driverRate * 100) / 100 },
        total: { orders: driver?.total_orders || 0, earnings: driver?.total_earnings || 0 },
        wallet_balance: driver?.wallet_balance || 0
      }
    });
  });

  // 司机钱包 - 获取余额和提现记录
  router.get('/wallet', authMiddleware, (req, res) => {
    const driver = db.prepare('SELECT wallet_balance, total_earnings FROM drivers WHERE id = ?').get(req.user.id);
    if (!driver) return res.json({ code: 1, message: '司机不存在' });
    
    const withdrawals = (db.data.withdrawals || []).filter(w => w.driver_id === req.user.id);
    
    res.json({
      code: 0,
      data: {
        balance: driver.wallet_balance || 0,
        total_earnings: driver.total_earnings || 0,
        withdrawals: withdrawals.sort((a, b) => b.id - a.id)
      }
    });
  });

  // 司机钱包 - 申请提现
  router.post('/withdraw', authMiddleware, (req, res) => {
    const { amount, type, account } = req.body;
    const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(req.user.id);
    if (!driver) return res.json({ code: 1, message: '司机不存在' });

    const withdrawAmount = Number(amount);
    if (!withdrawAmount || withdrawAmount <= 0) {
      return res.json({ code: 1, message: '提现金额无效' });
    }

    const minWithdraw = parseFloat(db.getConfig('min_withdraw_amount', '10'));
    if (withdrawAmount < minWithdraw) {
      return res.json({ code: 1, message: `最低提现金额${minWithdraw}元` });
    }

    if (withdrawAmount > Number(driver.wallet_balance || 0)) {
      return res.json({ code: 1, message: '余额不足' });
    }

    // 扣减余额
    db.prepare('UPDATE drivers SET wallet_balance = wallet_balance - ? WHERE id = ?')
      .run(withdrawAmount, req.user.id);

    // 创建提现记录
    const withdrawId = db.nextId('withdrawals');
    db.data.withdrawals.push({
      id: withdrawId,
      driver_id: req.user.id,
      driver_name: driver.name,
      driver_phone: driver.phone,
      amount: withdrawAmount,
      type: type || 'wechat',
      account: account || '',
      status: 'pending',
      created_at: db.now()
    });
    db.save();

    res.json({ code: 0, message: '提现申请已提交，请等待审核' });
  });

  return router;
};
