const express = require('express');
const db = require('../db');
const { generateOrderNo, calculatePrice } = require('../utils/pricing');
const helpers = require('../utils/helpers');
const dispatch = require('../utils/order_dispatch');
const pricing = require('../utils/pricing');

module.exports = function(authMiddleware, upload) {
  const router = express.Router();

  // ================================================================
  // 订单输出前端前的标准化（双写字段对齐 WXML + 中文可读状态）
  // 根因：order-user.wxml 绑 total_amount/vehicle_size_cn/address；DB 存 total_price/vehicle_type/pickup_address
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
      // 订单号 6 字段别名全覆盖（后端 id/order_no 真值 + order_id/orderNo/orderId 驼峰）
      // 根因：前端 payment-pay.onLoad 原取 opts.orderId，跳转传 ?id= → 双错引发"缺少订单号"警告
      order_id: o.id != null ? o.id : (o.order_id || o.order_no || ''),
      orderId: o.id != null ? o.id : (o.orderId || o.order_no || ''),
      orderNo: o.order_no || o.orderNo || '',
      total_amount: Number(o.total_price || 0),
      totalPrice: Number(o.total_price || 0),
      vehicle_size_cn: VEHICLE_CN[o.vehicle_type] || o.vehicle_type || '未知车型',
      vehicleType: o.vehicle_type,
      address: o.pickup_address || o.address || '',
      pickup_address: o.pickup_address || o.address || '',
      status_cn: STATUS_CN[statusRaw] || statusRaw,
      deposit_status_cn: DEPOSIT_CN[depositStatus] || depositStatus,
      payment_status_cn: PAYMENT_CN[paymentStatus] || paymentStatus,
      status_line: statusLine
    };
  }

  // snake_case → camelCase 字段双写兼容（旧双端 + 新 unified 小程序都支持）
  function normalizeOrderBody(body) {
    const b = Object.assign({}, body || {});
    const map = {
      vehicle_size: 'vehicleType', vehicle_type: 'vehicleType',
      vehicle_plate: 'vehiclePlate',
      battery_percent: 'batteryPercent',
      dashboard_off: 'dashboardOff',
      pickup_lat: 'pickupLat', lat: 'pickupLat',
      pickup_lng: 'pickupLng', lng: 'pickupLng',
      pickup_address: 'pickupAddress', address: 'pickupAddress',
      pickup_description: 'pickupDescription',
      distance_km: 'distanceKm', distance: 'distanceKm',
      extra_fee: 'extraFee',
      contact_name: 'contactName', contact_phone: 'contactPhone'
    };
    for (const k in map) if (b[k] != null && b[map[k]] == null) b[map[k]] = b[k];
    return b;
  }

  // 用户创建订单
  router.post('/create', authMiddleware, (req, res) => {
    req.body = normalizeOrderBody(req.body);
    const {
      vehicleType,     // small/medium/large
      vehiclePlate,
      batteryPercent,
      dashboardOff,    // 仪表盘是否不亮
      pickupLat,
      pickupLng,
      pickupAddress,
      pickupDescription,
      distanceKm,
      extraFee         // 预估额外费用
    } = req.body;

    if (!vehicleType || !pickupAddress) {
      return res.json({ code: 1, message: '请选择车型并填写救援地址' });
    }

    // ===== 需求5：信用积分拦截 + 逃单记录拦截（不满足不能下单）=====
    const uChk = helpers.canUserPlaceOrder(req.user.id);
    if (!uChk.ok) {
      return res.json({ code: 4025, message: uChk.reason, data: { credit_score: uChk.score } });
    }

    // 计算价格
    let priceResult;
    try {
      priceResult = calculatePrice(vehicleType, distanceKm || 0, new Date(), extraFee || 0);
    } catch (e) {
      return res.json({ code: 1, message: e.message });
    }

    // ===== 需求5：押金计算（入库为deposit_amount, deposit_status=unpaid）=====
    const dep = helpers.calcDeposit(priceResult.totalPrice);

    const orderNo = generateOrderNo();

    db.prepare(`
      INSERT INTO orders (
        order_no, user_id, vehicle_type, vehicle_plate, battery_percent, dashboard_off,
        pickup_lat, pickup_lng, pickup_address, pickup_description,
        distance_km, base_price, distance_fee, extra_fee, total_price, is_night,
        deposit_amount, deposit_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      orderNo, req.user.id, vehicleType, vehiclePlate || '', batteryPercent || 0, dashboardOff ? 1 : 0,
      pickupLat || 0, pickupLng || 0, pickupAddress, pickupDescription || '',
      distanceKm || 0, priceResult.basePrice, priceResult.distanceFee,
      priceResult.extraFee, priceResult.totalPrice, priceResult.isNight,
      dep.deposit, 'unpaid'
    );

    const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);

    // ===== 需求3：智能派单，生成候选司机列表（存入order字段，同时返回前端）=====
    const candidates = dispatch.rankDriversForOrder(order);
    if (candidates && candidates.length) {
      order.dispatch_mode = 'auto';
      order.dispatch_candidates = JSON.stringify(candidates.slice(0, 10));
      db.prepare(`UPDATE orders SET dispatch_mode=?, dispatch_candidates=? WHERE id=?`).run('auto', order.dispatch_candidates, order.id);
    }

    res.json({
      code: 0, data: {
        ...normOrder(order),
        deposit_info: dep,
        credit_score: uChk.score,
        recommended_drivers: candidates.slice(0, 10)
      }, message: '下单成功，请立即支付押金后订单进入派单池（押金' + dep.deposit + '元）'
    });
  });

  // 价格预估（必须在 /:id 之前定义）
  router.post('/estimate', authMiddleware, (req, res) => {
    req.body = normalizeOrderBody(req.body);
    const { vehicleType, distanceKm, extraFee } = req.body;

    try {
      const price = calculatePrice(vehicleType, distanceKm || 0, new Date(), extraFee || 0);
      const dep = helpers.calcDeposit(price.totalPrice);
      // 双写：保留旧 calculatePrice 字段 + 新增小程序 WXML 绑定必需字段（price-fix-B）
      const result = {
        // 旧字段（保留，避免破坏已有调用方）
        ...price,
        // 新字段（对齐 home-user.wxml L48-55 绑定变量）
        rescue_price: Number(price.basePrice || 0),
        kwh_price: Number(price.distanceFee || 0),
        total: Number(price.totalPrice || 0),
        deposit: Number(dep.deposit || 0),
        time_type: price.isNight ? 'night' : 'day',
        is_night: price.isNight,
        deposit_ratio: dep.ratio,
        deposit_min: dep.min,
        distance_km: Number(distanceKm || 0),
        vehicle_type: price.vehicleType || vehicleType,
        vehicle_name: price.vehicleName || ''
      };
      res.json({ code: 0, data: result });
    } catch (e) {
      console.error('[orders/estimate] error:', e);
      res.json({ code: 1, message: e.message || '价格计算失败' });
    }
  });

  // 获取当前进行中的订单（必须在 /:id 之前定义，否则会被 :id 匹配）
  router.get('/active', authMiddleware, (req, res) => {
    const order = db.prepare(`
      SELECT o.*, d.name as driver_name, d.phone as driver_phone
      FROM orders o LEFT JOIN drivers d ON o.driver_id = d.id
      WHERE o.user_id = ? AND o.status NOT IN ('completed', 'cancelled')
      ORDER BY o.created_at DESC LIMIT 1
    `).get(req.user.id);

    res.json({ code: 0, data: normOrder(order) });
  });

  // 获取订单详情
  router.get('/:id', authMiddleware, (req, res) => {
    const order = db.prepare(`
      SELECT o.*, d.name as driver_name, d.phone as driver_phone, d.rating as driver_rating, d.avatar as driver_avatar
      FROM orders o LEFT JOIN drivers d ON o.driver_id = d.id
      WHERE (o.id = ? OR o.order_no = ?)
    `).get(req.params.id, req.params.id);

    if (!order) {
      return res.json({ code: 1, message: '订单不存在' });
    }

    res.json({ code: 0, data: normOrder(order) });
  });

  // 用户取消订单
  router.post('/cancel/:id', authMiddleware, (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!order) {
      return res.json({ code: 1, message: '订单不存在' });
    }

    // 只有pending或accepted状态可以取消
    if (!['pending', 'accepted'].includes(order.status)) {
      return res.json({ code: 1, message: '当前状态无法取消' });
    }

    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('cancelled', req.params.id);

    // 如果已接单，释放司机
    if (order.driver_id) {
      db.prepare('UPDATE drivers SET status = ? WHERE id = ?').run('online', order.driver_id);
    }

    // ===== 需求5补：取消订单自动退押金（写入payment_records + 改deposit_status=refunded）=====
    let refundInfo = null;
    if (order.deposit_status === 'paid' && (order.deposit_amount || 0) > 0) {
      const refundNo = 'RF' + Date.now() + Math.floor(Math.random() * 1000);
      db.prepare(`
        INSERT INTO payment_records (
          pay_no, order_id, user_id, pay_type, pay_stage, amount, currency,
          status, third_party_no, remark, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        refundNo, order.id, req.user.id, 'system', 'refund',
        order.deposit_amount, 'CNY', 'success', '',
        '订单取消押金自动退还',
        helpers.nowStr(), helpers.nowStr()
      );
      db.prepare('UPDATE orders SET deposit_status = ? WHERE id = ?').run('refunded', order.id);
      refundInfo = { refund_no: refundNo, refund_amount: order.deposit_amount };
    }

    res.json({ code: 0, message: '订单已取消', data: { refund: refundInfo } });
  });

  // 用户支付
  router.post('/pay/:id', authMiddleware, (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!order) {
      return res.json({ code: 1, message: '订单不存在' });
    }
    if (order.payment_status === 'paid') {
      return res.json({ code: 1, message: '订单已支付' });
    }

    db.prepare('UPDATE orders SET payment_status = ? WHERE id = ?').run('paid', req.params.id);
    res.json({ code: 0, message: '支付成功' });
  });

  // 用户评价
  router.post('/rate/:id', authMiddleware, (req, res) => {
    const { rating, comment } = req.body;
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!order) {
      return res.json({ code: 1, message: '订单不存在' });
    }
    if (order.status !== 'completed') {
      return res.json({ code: 1, message: '订单未完成，无法评价' });
    }

    db.prepare('UPDATE orders SET user_rating = ?, user_comment = ? WHERE id = ?')
      .run(rating, comment || '', req.params.id);

    // 更新司机评分
    if (order.driver_id) {
      const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(order.driver_id);
      const newRating = ((driver.rating * driver.total_orders) + rating) / (driver.total_orders + 1);
      db.prepare('UPDATE drivers SET rating = ? WHERE id = ?').run(
        Math.round(newRating * 100) / 100, order.driver_id
      );
    }

    res.json({ code: 0, message: '评价成功' });
  });

  // 司机上传照片
  router.post('/upload', authMiddleware, upload.single('photo'), (req, res) => {
    if (!req.file) {
      return res.json({ code: 1, message: '请选择图片' });
    }
    const url = `/uploads/${req.file.filename}`;
    res.json({ code: 0, data: { url } });
  });

  return router;
};
