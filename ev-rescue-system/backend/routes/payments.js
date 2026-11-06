/**
 * 支付防逃单模块
 * 核心机制 = 押金（前置约束） + 尾款（后付） + 信用积分（长效约束）
 *
 * 接口一览：
 *  - GET  /api/payments/order/:id/summary  用户下单页/追踪页：查看押金/尾款/可用服务卡
 *  - POST /api/payments/order/:id/deposit  预支付押金（调微信统一支付/MVP模拟）
 *  - POST /api/payments/wechat/notify       微信支付回调（生产）
 *  - POST /api/payments/order/:id/final    服务完成后支付尾款（可选服务卡抵扣）
 *  - POST /api/payments/order/:id/refund   取消订单后退还押金（MVP模拟，生产调微信退款API）
 *  - GET  /api/payments/records/mine        我的支付流水
 *  - POST /api/payments/admin/run-escape-job  管理员/定时：扫超时未支付单，扣信用分=逃单
 *  - GET  /api/payments/admin/records       后台支付流水
 *  - GET  /api/payments/admin/credit/:userId  用户信用积分历史
 *  - POST /api/payments/admin/credit/adjust  手动调整信用积分（客服处理申诉）
 */

const helpers = require('../utils/helpers');
const crypto = require('crypto');
const dispatch = require('../utils/order_dispatch');
const settlement = require('../utils/order_settlement');

module.exports = function (authMiddleware, adminAuthMiddleware) {
  const router = require('express').Router();
  const db = require('../db');

  /** 生成系统内部流水号：PAY + 时间戳 + 4位随机 */
  const genTxn = () => 'PAY' + Date.now().toString() + Math.floor(1000 + Math.random() * 9000);

  const runDispatchSafely = async order => {
    try {
      return await dispatch.dispatchOrder(order);
    } catch (error) {
      return { ok: false, assigned: false, message: error.message || '腾讯地图路线计算失败' };
    }
  };

  /** 写入支付记录 */
  const insertPayment = (row) => {
    const rec = {
      id: db.nextId('payment_records'),
      transaction_id: row.transaction_id || genTxn(),
      order_id: row.order_id,
      user_id: row.user_id,
      driver_id: row.driver_id || null,
      biz_type: row.biz_type,   // deposit / final_pay / refund / card_redeem
      pay_type: row.pay_type || 'wechat',       // wechat / alipay / balance / mock
      pay_channel: row.pay_channel || 'mnp',    // mnp / h5 / app / admin
      amount: row.amount,
      status: row.status || 'pending',
      third_party_no: row.third_party_no || '',
      refund_amount: row.refund_amount || 0,
      refund_at: row.refund_at || null,
      remark: row.remark || '',
      raw_callback: row.raw_callback || null,
      created_at: db.now(),
      paid_at: row.paid_at || null
    };
    (db.data.payment_records = db.data.payment_records || []).push(rec);
    return rec;
  };

  /** 查订单+权限校验：必须是该订单的用户或管理员 */
  const loadOrderAndAuth = (id, req) => {
    const order = (db.data.orders || []).find(o => o.id === Number(id));
    if (!order) return { error: '订单不存在' };
    const isUser = req.user?.role === 'user' && Number(req.user.id) === Number(order.user_id);
    const isAdmin = req.admin?.id;
    if (!isUser && !isAdmin) return { error: '无权访问该订单' };
    return { order, isUser, isAdmin };
  };

  // -----------------------------------------------------------
  // 1. 订单支付摘要（押金多少？已付多少？服务卡抵扣预估？应付尾款？）
  // -----------------------------------------------------------
  router.get('/order/:id/summary', authMiddleware, (req, res) => {
    const { order, error } = loadOrderAndAuth(req.params.id, req);
    if (error) return res.json({ code: 400, message: error });
    const driver = (db.data.drivers || []).find(item => Number(item.id) === Number(order.driver_id));
    const total = +(order.total_price || 0).toFixed(2);
    const dep = helpers.calcDeposit(total);
    const depositAmount = order.deposit_status === 'paid'
      ? Number(order.deposit_amount || 0)
      : Number(dep.deposit || 0);
    const depositPaid = order.deposit_status === 'paid' ? depositAmount : 0;
    const cardDiscount = +(order.card_discount_amount || 0).toFixed(2);
    const finalPayBeforeCard = Math.max(0, +(total - depositPaid).toFixed(2));
    const finalPay = Math.max(0, +(finalPayBeforeCard - cardDiscount).toFixed(2));

    // 车型中文映射（与小程序 home-user 的 vehicleSizes 文案一致）
    const VEHICLE_CN = {
      small: '小型轿车(A级)',
      medium: '中型轿车/SUV',
      large: '大型车(MPV)',
      '*': '通用车型'
    };
    const vehicleCn = VEHICLE_CN[order.vehicle_type] || (order.vehicle_type || '未知车型');
    const timeType = Number(order.is_night) === 1 ? 'night' : 'day';
    const escapeFlagged = Number(order.escape_flagged || 0) === 1;

    // 该用户对该车型的可用服务卡
    let myCards = [];
    if (req.user?.role === 'user') {
      myCards = (db.data.service_cards || [])
        .filter(c => Number(c.user_id) === Number(req.user.id) && ['unused', 'active'].includes(c.status))
        .map(c => {
          const chk = helpers.canUseCard(c, { vehicle_type: order.vehicle_type }, req.user.id);
          const remainingUses = Math.max(0, (c.total_uses || 1) - (c.used_count || 0));
          const price = Number(c.price || 0);
          // name 优先用 remark，否则用"¥xx 通用救援卡（x次）"
          let name = c.remark && String(c.remark).trim() ? String(c.remark).split('|')[0].trim() : '';
          if (!name) name = `¥${price}${c.vehicle_type === '*' ? '通用' : VEHICLE_CN[c.vehicle_type] || ''}救援卡(${remainingUses}次)`;
          return {
            id: c.id,
            code: c.card_no,                        // WXML: item.code
            card_no: c.card_no,                     // 兼容旧字段
            name,                                   // WXML: item.name
            discount_amount: price,                 // WXML: item.discount_amount
            price,
            expires_at: c.expired_at || '长期有效', // WXML: item.expires_at（显示用）
            expired_at: c.expired_at,               // 兼容旧字段
            vehicle_type: c.vehicle_type,
            remaining_uses: remainingUses,
            applicable: chk.ok,
            status: c.status
          };
        });
    }

    res.json({
      code: 0, message: 'ok',
      data: {
        // ============== 旧字段兼容（保留） ==============
        order_id: order.id,
        order_no: order.order_no,
        status: order.status,
        total_price: total,
        deposit: { ratio: dep.ratio, min: dep.min, should_pay: depositAmount },
        deposit_status: order.deposit_status,
        deposit_paid: depositPaid,
        card_discount_amount: cardDiscount,
        final_pay_before_card: finalPayBeforeCard,
        final_pay_amount: finalPay,
        payment_status: order.payment_status,
        settlement_status: order.settlement_status || 'unsettled',
        available_cards: myCards,
        overdue_hours: Number(db.getConfig('unpaid_pay_timeout_hours', '24')),
        credit_score: helpers.getCreditScore(order.user_id),
        escape_flagged: escapeFlagged,

        // ============== 新字段：对齐 payment-pay.wxml 绑定（渲染空的根因） ==============
        vehicle_size_cn: vehicleCn,
        deposit_ratio: dep.ratio,
        deposit_min: dep.min,
        deposit_amount: depositAmount,
        order: {
          id: order.id,
          order_no: order.order_no,
          vehicle_type: order.vehicle_type,
          distance_km: Number(order.distance_km || 0),
          distance_source: order.distance_source || 'unavailable',
          distance_is_estimate: Number(order.distance_is_estimate || 0),
          distance_calculated_at: order.distance_calculated_at || null,
          route_duration_minutes: order.route_duration_minutes,
          route_policy: order.route_policy || null,
          time_type: timeType,
          is_night: Number(order.is_night || 0),
          total_amount: total,
          total_price: total,
          deposit_status: order.deposit_status || 'unpaid',
          payment_status: order.payment_status || 'unpaid',
          settlement_status: order.settlement_status || 'unsettled',
          status: order.status,
          driver_name: driver?.name || '',
          driver_rating: Number(driver?.rating || 5),
          user_rating: order.user_rating,
          user_comment: order.user_comment || '',
          escape_flagged: escapeFlagged,
          address: order.pickup_address || ''
        }
      }
    });
  });

  // -----------------------------------------------------------
  // 2. 押金支付（下单后必须立即支付，否则订单不会进入派单池 pending → accepted）
  //    MVP：mode=mock 直接成功；生产 mode=wechat 调用微信统一下单返回 prepay_id + paySign
  // -----------------------------------------------------------
  router.post('/order/:id/deposit', authMiddleware, async (req, res) => {
    const { order, error } = loadOrderAndAuth(req.params.id, req);
    if (error) return res.json({ code: 400, message: error });
    if (order.status === 'cancelled') return res.json({ code: 400, message: '订单已取消' });
    // 幂等：押金已支付时返回 code:0（非错误码），前端不误弹错、不可重复扣款
    if (order.deposit_status === 'paid') {
      const dispatchResult = order.status === 'pending' ? await runDispatchSafely(order) : null;
      return res.json({
        code: 0,
        message: '押金已支付，无需重复支付',
        data: {
          mode: 'idempotent',
          already_paid: true,
          amount: order.deposit_amount || 0,
          deposit_status: 'paid',
          payment_status: order.payment_status,
          dispatch: dispatchResult
        }
      });
    }

    const total = +(order.total_price || 0).toFixed(2);
    const dep = helpers.calcDeposit(total);
    order.deposit_amount = dep.deposit;
    order.deposit_status = 'unpaid';

    const { mode = 'mock', pay_type = 'wechat' } = req.body || {};
    const rec = insertPayment({
      order_id: order.id, user_id: order.user_id, driver_id: order.driver_id,
      biz_type: 'deposit', pay_type, amount: dep.deposit, status: 'pending',
      remark: `押金，比例${dep.ratio},最低${dep.min},总额${total}`
    });

    if (mode === 'mock' || pay_type === 'mock') {
      // MVP 模拟支付成功
      rec.status = 'paid';
      rec.paid_at = db.now();
      rec.third_party_no = 'MOCK_' + rec.transaction_id;
      order.deposit_status = 'paid';
      order.payment_status = order.payment_status === 'unpaid' ? 'deposit_paid' : order.payment_status;
      db.save();
      const dispatchResult = await runDispatchSafely(order);
      return res.json({
        code: 0, message: '【模拟】押金支付成功',
        data: {
          mode: 'mock',
          amount: dep.deposit,
          transaction_id: rec.transaction_id,
          deposit_status: order.deposit_status,
          dispatch: dispatchResult
        }
      });
    }

    // 生产：微信支付小程序下单（如果配置了商户号/密钥）
    const mchid = db.getConfig('wx_merchant_id', '');
    const payKey = db.getConfig('wx_pay_key', '');
    const appid = db.getConfig('wx_appid', '');
    if (!mchid || !payKey || !appid) {
      return res.json({ code: 400, message: '系统未配置微信支付商户信息，请先联系管理员或使用mode=mock模式' });
    }
    // 调用真实统一下单API(v3 jsapi)... 此处返回框架结构，真实环境需要接入 wechatpay-node-v3
    const prepay_id = 'wx_prepay_' + Date.now();
    const timestamp = Math.floor(Date.now() / 1000);
    const nonceStr = crypto.randomBytes(16).toString('hex');
    const paySign = crypto.createHmac('sha256', payKey).update(`${appid}\n${timestamp}\n${nonceStr}\nprepay_id=${prepay_id}\n`).digest('hex');
    db.save();
    res.json({
      code: 0, message: '已发起微信支付',
      data: {
        mode: 'wechat', amount: dep.deposit,
        payment_params: { appid, timeStamp: String(timestamp), nonceStr, package: `prepay_id=${prepay_id}`, signType: 'RSA', paySign },
        transaction_id: rec.transaction_id
      }
    });
  });

  // -----------------------------------------------------------
  // 3. 微信支付回调（生产）
  // -----------------------------------------------------------
  router.post('/wechat/notify', async (req, res) => {
    const body = req.body || {};
    const txn = (db.data.payment_records || []).find(r => r.transaction_id === body.out_trade_no);
    if (txn) {
      txn.status = 'paid';
      txn.paid_at = db.now();
      txn.raw_callback = JSON.stringify(body);
      txn.third_party_no = body.transaction_id || '';
      const order = (db.data.orders || []).find(o => o.id === txn.order_id);
      if (order) {
        if (txn.biz_type === 'deposit') {
          order.deposit_status = 'paid';
          if (order.payment_status === 'unpaid') order.payment_status = 'deposit_paid';
        } else if (txn.biz_type === 'final_pay') {
          order.payment_status = 'paid';
          order.user_confirmed_at = order.user_confirmed_at || db.now();
          settlement.settleOrder(order, { settledAt: txn.paid_at || db.now() });
        }
      }
      db.save();
      if (order && txn.biz_type === 'deposit' && order.status === 'pending') {
        await runDispatchSafely(order);
      }
    }
    res.json({ code: 'SUCCESS', message: 'OK' });
  });

  // -----------------------------------------------------------
  // 4. 订单完成后，支付尾款（支持 微信/MVP模拟 + 优先扣服务卡 + 押金转尾款）
  // -----------------------------------------------------------
  router.post('/order/:id/final', authMiddleware, async (req, res) => {
    try {
      const { order, error } = loadOrderAndAuth(req.params.id, req);
      if (error) return res.json({ code: 400, message: error });
      if (order.status !== 'completed') return res.json({ code: 400, message: '订单未完成，暂时不能支付尾款' });
      // 幂等：尾款已结清返回 code:0，避免重复扣款/误弹错误
      if (order.payment_status === 'paid') {
        const settlementResult = settlement.settleOrder(order);
        return res.json({
          code: 0, message: '订单已支付，无需重复支付',
          data: {
            already_paid: true,
            need_pay: false,
            payment_status: 'paid',
            final_pay_amount: order.final_pay_amount || 0,
            settlement_status: order.settlement_status,
            driver_income: settlementResult.driverIncome || Number(order.driver_income || 0)
          }
        });
      }

      const { mode = 'mock', pay_type = 'wechat', card_id } = req.body || {};

      // 4.1 先用服务卡抵扣（可选）
      let discount = 0;
      if (card_id) {
        const r = helpers.redeemCard(Number(card_id), order, order.user_id);
        if (!r.ok) return res.json({ code: 400, message: '服务卡抵扣失败：' + r.message });
        discount = r.card_discount_amount;
        order.use_card_id = card_id;
        order.card_discount_amount = discount;
      }
      const total = +(order.total_price || 0).toFixed(2);
      const deposit = +(order.deposit_status === 'paid' ? (order.deposit_amount || 0) : 0).toFixed(2);
      const finalPay = Math.max(0, +(total - deposit - discount).toFixed(2));
      order.final_pay_amount = finalPay;

      // 4.2 若抵扣后为0 → 直接成功
      let needPay = finalPay > 0.001;
      let rec;
      if (needPay) {
        rec = insertPayment({
          order_id: order.id, user_id: order.user_id, driver_id: order.driver_id,
          biz_type: 'final_pay', pay_type, amount: finalPay, status: 'pending',
          remark: `尾款，总${total}押金${deposit}卡抵${discount}`
        });
        if (mode === 'mock' || pay_type === 'mock') {
          rec.status = 'paid';
          rec.paid_at = db.now();
          rec.third_party_no = 'MOCK_' + rec.transaction_id;
          needPay = false;
        } else {
          const mchid = db.getConfig('wx_merchant_id', '');
          if (!mchid) {
            rec.status = 'paid';
            rec.paid_at = db.now();
            rec.remark += '(无商户号降级为mock)';
            needPay = false;
          }
        }
      } else {
        // 尾款为0的记录（0元支付）
        rec = insertPayment({
          order_id: order.id, user_id: order.user_id, driver_id: order.driver_id,
          biz_type: 'final_pay', pay_type: 'free', amount: 0, status: 'paid',
          paid_at: db.now(), remark: `押金+服务卡覆盖100%，无需支付`
        });
      }

      let creditAfter = helpers.getCreditScore(order.user_id);
      let settlementResult = null;
      if (!needPay) {
        order.payment_status = 'paid';
        order.user_confirmed_at = order.user_confirmed_at || db.now();
        settlementResult = settlement.settleOrder(order);
        // 更新用户累计消费
        const user = (db.data.users || []).find(u => u.id === order.user_id);
        if (user) {
          user.total_orders = (user.total_orders || 0) + 1;
          user.total_spent = +((user.total_spent || 0) + (total - (order.refund_amount || 0))).toFixed(2);
        }
        // 按时支付奖励：完成后24h内支付加信用积分
        if (order.complete_time) {
          const ct = order.complete_time || '';
          const ctMs = (helpers.parseLocalStr ? helpers.parseLocalStr(ct) : new Date(ct.replace(' ', 'T'))).getTime();
          const h = ctMs ? (Date.now() - ctMs) / 3600000 : 0;
          const timeout = Number(db.getConfig('unpaid_pay_timeout_hours', '24'));
          const bonus = Number(db.getConfig('pay_on_time_bonus_score', '2'));
          if (h <= timeout) {
            helpers.changeCreditScore(order.user_id, bonus, `按时支付订单${order.order_no}奖励${bonus}分`);
            creditAfter = helpers.getCreditScore(order.user_id);
          }
        }
      }

      db.save();
      res.json({
        code: 0, message: needPay ? '已发起微信支付，完成后请回调' : '支付成功',
        data: {
          need_pay: needPay,
          total_price: total,
          deposit_used: deposit,
          card_discount: discount,
          card_discount_amount: discount,
          final_pay_amount: finalPay,
          payment_status: order.payment_status,
          settlement_status: order.settlement_status,
          driver_income: settlementResult ? settlementResult.driverIncome : 0,
          transaction_id: rec.transaction_id,
          credit_score_after: creditAfter,
          credit_score: creditAfter
        }
      });
    } catch (e) { res.status(500).json({ code: 500, message: e.message }); }
  });

  // -----------------------------------------------------------
  // 5. 押金退回（订单取消时调用，退还押金的 payment_records + order.deposit_status=refunded）
  // -----------------------------------------------------------
  router.post('/order/:id/refund', authMiddleware, (req, res) => {
    const { order, error } = loadOrderAndAuth(req.params.id, req);
    if (error) return res.json({ code: 400, message: error });
    if (order.deposit_status !== 'paid') return res.json({ code: 400, message: '无可退押金' });
    const { reason = '订单取消' } = req.body || {};
    const lastDeposit = (db.data.payment_records || [])
      .filter(r => r.order_id === order.id && r.biz_type === 'deposit' && r.status === 'paid')
      .sort((a, b) => b.id - a.id)[0];
    if (!lastDeposit) return res.json({ code: 400, message: '未找到押金支付记录' });
    const refundAmount = +(lastDeposit.amount || 0).toFixed(2);
    lastDeposit.status = 'refunded';
    lastDeposit.refund_amount = refundAmount;
    lastDeposit.refund_at = db.now();
    lastDeposit.remark = (lastDeposit.remark || '') + '；退款原因：' + reason;
    order.deposit_status = 'refunded';
    order.refund_amount = +((order.refund_amount || 0) + refundAmount).toFixed(2);
    // 退款流水
    insertPayment({
      order_id: order.id, user_id: order.user_id, driver_id: order.driver_id,
      biz_type: 'refund', pay_type: lastDeposit.pay_type, amount: -refundAmount,
      status: 'paid', paid_at: db.now(), remark: `押金退款：${reason},关联流水${lastDeposit.transaction_id}`,
      third_party_no: lastDeposit.third_party_no
    });
    db.save();
    res.json({ code: 0, message: '退款成功（mock：未真实调退款API，生产请接入微信退款）', data: { refund_amount: refundAmount } });
  });

  // -----------------------------------------------------------
  // 6. 我的支付流水（分页）
  // -----------------------------------------------------------
  router.get('/records/mine', authMiddleware, (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const ps = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    let rows = (db.data.payment_records || []).slice();
    if (req.user?.role === 'user') rows = rows.filter(r => Number(r.user_id) === Number(req.user.id));
    else rows = rows.filter(r => Number(r.driver_id) === Number(req.user.id));
    rows.sort((a, b) => b.id - a.id);
    const total = rows.length;
    const list = rows.slice((page - 1) * ps, page * ps);
    res.json({ code: 0, message: 'ok', data: { total, list } });
  });

  // ================ 管理后台接口 ================
  /**
   * 7. 扫订单：完成后超过 unpaid_pay_timeout_hours 且 payment_status !== paid
   *    → 标为逃单，扣信用积分（可定时任务/管理员手动触发）
   */
  router.post('/admin/run-escape-job', adminAuthMiddleware, (req, res) => {
    const timeout = Number(db.getConfig('unpaid_pay_timeout_hours', '24'));
    const penalty = Number(db.getConfig('escape_penalty_score', '30'));
    const completed = (db.data.orders || []).filter(o =>
      o.status === 'completed' && o.payment_status !== 'paid' && !!o.complete_time
    );
    let escapeCount = 0;
    for (const o of completed) {
      const h = (Date.now() - new Date(o.complete_time.replace(' ', 'T')).getTime()) / 3600000;
      if (h >= timeout && o.escape_flagged !== 1) {
        o.escape_flagged = 1;
        o.escape_at = db.now();
        helpers.changeCreditScore(o.user_id, -Math.abs(penalty), `订单${o.order_no}超过${timeout}h未支付，判定逃单，扣${penalty}分`);
        escapeCount++;
      }
    }
    db.save();
    res.json({ code: 0, message: `扫描完成：共检查${completed.length}单，新判定逃单${escapeCount}单`, data: { scanned: completed.length, escape_count: escapeCount, scanned_count: completed.length, penalized_count: escapeCount, timeout_hours: timeout, penalty } });
  });

  /** 8. 后台：支付流水查询 */
  router.get('/admin/records', adminAuthMiddleware, (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const ps = Math.min(500, Math.max(1, Number(req.query.pageSize) || 30));
    let rows = (db.data.payment_records || []).slice();
    // 防御：'all'/'undefined'/空 均视为不过滤（旧版前端可能把 undefined 序列化为字符串）
    const bizType = String(req.query.biz_type || '');
    const stStatus = String(req.query.status || '');
    if (bizType && bizType !== 'all' && bizType !== 'undefined') rows = rows.filter(r => r.biz_type === bizType);
    if (stStatus && stStatus !== 'all' && stStatus !== 'undefined') rows = rows.filter(r => r.status === stStatus);
    rows.sort((a, b) => b.id - a.id);
    const total = rows.length;
    const list = rows.slice((page - 1) * ps, page * ps).map(r => {
      const u = (db.data.users || []).find(x => x.id === r.user_id) || {};
      const d = (db.data.drivers || []).find(x => x.id === r.driver_id) || {};
      const o = (db.data.orders || []).find(x => x.id === r.order_id) || {};
      return { ...r, txn_id: r.transaction_id, user_phone: u.phone, user_nickname: u.nickname, driver_name: d.name, order_no: o.order_no };
    });
    res.json({ code: 0, message: 'ok', data: { total, list } });
  });

  /** 9. 信用积分查询：某用户历史流水 */
  router.get('/admin/credit/:userId', adminAuthMiddleware, (req, res) => {
    const uid = Number(req.params.userId);
    const list = (db.data.credit_scores || []).filter(c => c.user_id === uid).sort((a, b) => b.id - a.id);
    const user = (db.data.users || []).find(u => u.id === uid);
    const current = list[0]?.balance_after ?? 100;
    res.json({ code: 0, message: 'ok', data: { user: user && { id: user.id, phone: user.phone, nickname: user.nickname }, current_score: current, list } });
  });

  /** 10. 手动调整信用积分（客服申诉/恢复） */
  router.post('/admin/credit/adjust', adminAuthMiddleware, (req, res) => {
    // 字段兼容：amount / delta / change_amount 同义；user_id / userId 同义
    const user_id = req.body?.user_id || req.body?.userId;
    const amount = req.body?.amount ?? req.body?.delta ?? req.body?.change_amount;
    const reason = req.body?.reason || req.body?.remark || '';
    if (!user_id || !amount || Number(amount) === 0) return res.json({ code: 400, message: 'user_id和变动分数(amount)必填且不能为0' });
    const r = helpers.changeCreditScore(Number(user_id), Number(amount), `[管理员${req.admin?.username || 'admin'}手动调整] ${reason || ''}`);
    res.json({ code: 0, message: '积分调整成功', data: r });
  });

  return router;
};
