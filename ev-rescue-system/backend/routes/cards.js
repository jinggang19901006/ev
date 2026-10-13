/**
 * 服务卡全闭环路由
 *
 *  普通用户接口（role=user JWT）：GET /mine, GET /:id/check-available, POST /:id/redeem, GET /usages
 *  管理后台接口（admin JWT）：POST /admin/create(支持批量), POST /admin/:id/allocate, GET /admin/list,
 *                               DELETE /admin/:id, GET /admin/usages, GET /admin/allocations
 */
const helpers = require('../utils/helpers');

module.exports = function (authMiddleware, adminAuthMiddleware) {
  const router = require('express').Router();
  const db = require('../db');
  const generateCardNo = () => 'CARD' + Date.now().toString().slice(-8) + Math.floor(1000 + Math.random() * 9000);

  // 车型中文映射（与后台/小程序展示口径一致）
  const VEHICLE_CN = { small: '小型轿车(A级)', medium: '中型轿车/SUV', large: '大型车(MPV)', '*': '通用车型' };
  // 状态中文映射（小程序卡列表/详情读 status_cn）
  const STATUS_CN = { unused: '未使用', active: '可使用', used: '已核销', redeemed: '已核销', expired: '已过期' };

  /**
   * 服务卡标准化：后台前端读取 code/name/discount_amount/vehicle_size_cn/expires_at 等字段，
   * 这里集中双写别名，一处修复全端对齐（原始字段全部保留）
   */
  function normCard(c) {
    const remainingUses = Math.max(0, (c.total_uses || 1) - (c.used_count || 0));
    const price = Number(c.price || 0);
    let name = (c.remark && String(c.remark).trim()) ? String(c.remark).split('|')[0].trim() : '';
    if (!name) name = `¥${price}${c.vehicle_type === '*' ? '通用' : (VEHICLE_CN[c.vehicle_type] || '')}救援卡(${remainingUses}次)`;
    // 过期判定（本地时区安全解析，仅用于展示/筛选）
    let isExpired = false;
    if (c.expired_at) {
      const t = Date.parse(String(c.expired_at).replace(/-/g, '/'));
      if (!isNaN(t) && t < Date.now()) isExpired = true;
    }
    let displayStatus = c.status;
    if (isExpired && c.status !== 'used') displayStatus = 'expired';
    return {
      ...c,
      code: c.card_no,           // 后台 renderCardsAssign 读 c.code
      card_code: c.card_no,      // 追踪表读 a.card_code / u.card_code
      name,                      // 后台读 c.name
      discount_amount: price,    // 后台读 c.discount_amount
      price,
      vehicle_size_cn: VEHICLE_CN[c.vehicle_type] || c.vehicle_type || '通用车型',
      expires_at: c.expired_at || '长期有效',  // 后台读 c.expires_at
      expired_at: c.expired_at || null,
      remaining_uses: remainingUses,
      is_expired: isExpired,
      raw_status: c.status,
      status: displayStatus,
      status_cn: STATUS_CN[displayStatus] || STATUS_CN[c.status] || '未使用'
    };
  }

  // ============== 用户侧接口 ==============
  const ensureUser = (req, res, next) => {
    if (req.user?.role !== 'user') return res.status(403).json({ code: 403, message: '仅普通用户可操作' });
    next();
  };

  /**
   * 1. 我的服务卡列表（含状态、剩余次数、面额）
   */
  router.get('/mine', authMiddleware, ensureUser, (req, res) => {
    const userId = req.user.id;
    // normCard 双写字段：code/name/discount_amount/vehicle_size_cn/expires_at/status_cn，
    // 小程序 cards 列表/详情页直接读取这些别名
    const list = (db.data.service_cards || [])
      .filter(c => Number(c.user_id) === Number(userId))
      .map(c => {
        const n = normCard(c);
        n.per_use_value = (c.price || 0) / Math.max(1, c.total_uses || 1);
        return n;
      })
      .sort((a, b) => {
        // 可用的排前面，其余按 id 倒序
        const usable = s => (s === 'unused' || s === 'active') ? 0 : 1;
        const diff = usable(a.status) - usable(b.status);
        return diff !== 0 ? diff : b.id - a.id;
      });
    res.json({ code: 0, message: 'ok', data: { total: list.length, list } });
  });

  /**
   * 2. 查询单张卡对即将支付订单的可用性 + 可抵扣金额
   * GET /:id/check-available?order_id=xxx 或传入 vehicle_type + total_price
   */
  router.get('/:id/check-available', authMiddleware, ensureUser, (req, res) => {
    const card = (db.data.service_cards || []).find(c => c.id === Number(req.params.id));
    if (!card) return res.json({ code: 404, message: '服务卡不存在' });
    let order;
    if (req.query.order_id) {
      order = (db.data.orders || []).find(o => o.id === Number(req.query.order_id));
      if (!order) return res.json({ code: 404, message: '订单不存在' });
    } else {
      order = { vehicle_type: req.query.vehicle_type, total_price: Number(req.query.total_price) || 0 };
    }
    const chk = helpers.canUseCard(card, order, req.user.id);
    if (!chk.ok) return res.json({ code: 400, message: chk.reason });
    const usesLeft = (card.total_uses || 1) - (card.used_count || 0);
    const perUse = (card.price || 0) / Math.max(1, card.total_uses || 1);
    const valueLeft = +(perUse * usesLeft).toFixed(2);
    const discount = Math.min(valueLeft, +(order.total_price || 0).toFixed(2));
    res.json({
      code: 0, message: 'ok',
      data: {
        card: { id: card.id, card_no: card.card_no, vehicle_type: card.vehicle_type, price: card.price, status: card.status },
        order_total: order.total_price,
        can_discount: discount,
        remaining_value: valueLeft,
        remaining_uses: usesLeft
      }
    });
  });

  /**
   * 3. 核销服务卡（抵扣订单尾款）
   * POST /:id/redeem { order_id }
   */
  router.post('/:id/redeem', authMiddleware, ensureUser, (req, res) => {
    const cardId = Number(req.params.id);
    const orderId = Number(req.body?.order_id);
    const order = (db.data.orders || []).find(o => o.id === orderId && o.user_id === req.user.id);
    if (!order) return res.json({ code: 404, message: '订单不存在' });
    const result = helpers.redeemCard(cardId, order, req.user.id);
    if (!result.ok) return res.json({ code: 400, message: result.message });
    order.use_card_id = cardId;
    order.card_discount_amount = result.card_discount_amount;
    order.final_pay_amount = Math.max(0, +(order.total_price - (result.card_discount_amount || 0) - (order.deposit_amount || 0)).toFixed(2));
    db.save();
    res.json({ code: 0, message: '核销成功', data: result });
  });

  /**
   * 4. 我的核销记录（倒序）
   */
  router.get('/usages/mine', authMiddleware, ensureUser, (req, res) => {
    const list = (db.data.card_usages || [])
      .filter(u => Number(u.user_id) === Number(req.user.id))
      .sort((a, b) => b.id - a.id)
      .map(u => {
        const card = (db.data.service_cards || []).find(c => c.id === u.card_id) || {};
        const order = (db.data.orders || []).find(o => o.id === u.order_id) || {};
        return {
          ...u,
          order_no: order.order_no || u.order_no || '',
          // 卡详情页读取别名
          card_code: u.card_no || card.card_no,
          discount_amount: u.used_amount || 0,
          redeemed_at: u.used_at,
          admin_note: u.remark || ''
        };
      });
    res.json({ code: 0, message: 'ok', data: { total: list.length, list } });
  });

  // ============== 后台管理侧接口 ==============
  /**
   * 5. 批量创建服务卡
   * POST /admin/create
   *  body: { count:number=1, vehicle_type:'small'|'medium'|'large'|'*', price:number, total_uses:number=1, remark?:string, expired_at?:string }
   */
  router.post('/admin/create', adminAuthMiddleware, (req, res) => {
    const body = req.body || {};
    const count = Math.max(1, Math.min(10000, Number(body.count) || 1));
    // 字段双写兼容：discount_amount→price, name→remark, vehicle_size/vehicleType→vehicle_type
    let vehicle_type = body.vehicle_type || body.vehicleType || 'small';
    const vs = body.vehicle_size || body.vehicleSize;
    if (vs) {
      if (String(vs) === 'all' || String(vs) === '*' || vs === true) vehicle_type = '*';
      else vehicle_type = String(vs).toLowerCase();
    }
    if (String(vehicle_type) === 'all') vehicle_type = '*';
    let price = Number(body.price);
    if (!price && body.discount_amount != null) price = Number(body.discount_amount);
    if (!price) price = 0;
    const total_uses = Math.max(1, Number(body.total_uses) || 1);
    const adminId = req.admin?.id || 1;
    // valid_days → 自动算 expired_at（本地时区）
    let expired_at = body.expired_at || null;
    if (!expired_at && body.valid_days != null) {
      const days = Math.max(1, Number(body.valid_days) || 0);
      if (days > 0) {
        const d = new Date(Date.now() + days * 86400 * 1000);
        const pad = n => String(n).padStart(2, '0');
        expired_at = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      }
    }
    // name → 附加到 remark 最前
    let remark = body.remark || '';
    if (body.name) remark = body.name + (remark ? ' | ' + remark : '');
    const created = [];
    for (let i = 0; i < count; i++) {
      const c = {
        id: db.nextId('service_cards'),
        card_no: generateCardNo(),
        vehicle_type,
        price,
        total_uses,
        used_count: 0,
        status: 'unused',
        user_id: null,
        allocated_by: null,
        allocated_at: null,
        expired_at,
        remark,
        created_admin_id: adminId,
        created_at: db.now()
      };
      db.data.service_cards.push(c);
      created.push(c);
    }
    db.save();
    res.json({ code: 0, message: `成功生成${count}张服务卡`, data: { count, cards: created.slice(0, 10) } });
  });

  /**
   * 6. 后台服务卡列表（分页+筛选+分配状态）
   */
  router.get('/admin/list', adminAuthMiddleware, (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const ps = Math.min(200, Math.max(1, Number(req.query.pageSize) || 20));
    const status = req.query.status || '';
    const vehicle = req.query.vehicle_type || '';
    const allocated = req.query.allocated;  // 1=已分配,0=未分配
    const keyword = (req.query.keyword || '').trim().toLowerCase();
    // 先标准化（补 code/name/discount_amount/vehicle_size_cn/expires_at/过期态），再筛选
    let rows = (db.data.service_cards || []).map(c => {
      const normed = normCard(c);
      const user = (db.data.users || []).find(u => u.id === c.user_id);
      normed.user_phone = user?.phone || '';
      normed.user_nickname = user?.nickname || '';
      normed.user_name = user?.nickname || user?.phone || '';  // 老卡管理视图读 user_name
      return normed;
    });
    // status：'' / 'all' / 'undefined' 不过滤；'used' 兼容 'redeemed'；'expired' 按 normed 展示态
    if (status && status !== 'all' && status !== 'undefined') {
      if (status === 'used') rows = rows.filter(r => r.status === 'used' || r.status === 'redeemed' || r.raw_status === 'used');
      else rows = rows.filter(r => r.status === status);
    }
    if (vehicle && vehicle !== 'all' && vehicle !== '*') {
      rows = rows.filter(r => r.vehicle_type === vehicle);
    }
    if (allocated !== undefined && allocated !== '') {
      if (allocated === '1') rows = rows.filter(r => r.user_id);
      else rows = rows.filter(r => !r.user_id);
    }
    if (keyword) {
      rows = rows.filter(r =>
        (r.card_no || '').toLowerCase().includes(keyword) ||
        (r.name || '').toLowerCase().includes(keyword) ||
        (r.remark || '').toLowerCase().includes(keyword)
      );
    }
    rows.sort((a, b) => b.id - a.id);
    const total = rows.length;
    const list = rows.slice((page - 1) * ps, page * ps);
    res.json({ code: 0, message: 'ok', data: { total, page, pageSize: ps, list } });
  });

  /**
   * 7. 分配/发放一张服务卡给某用户
   * POST /admin/:id/allocate { user_id, remark? }  user_id 可用手机号/用户ID/卡号 三种入口，这里统一user_id
   */
  router.post('/admin/:id/allocate', adminAuthMiddleware, (req, res) => {
    const cardId = Number(req.params.id);
    const userId = Number(req.body?.user_id);
    const remark = req.body?.remark || '';
    if (!userId) return res.json({ code: 400, message: 'user_id必填' });
    const user = (db.data.users || []).find(u => u.id === userId);
    if (!user) return res.json({ code: 404, message: '用户不存在，请先注册用户' });
    const r = helpers.allocateCardToUser(cardId, userId, req.admin?.id || 1, remark);
    if (!r.ok) return res.json({ code: 400, message: r.message });
    res.json({ code: 0, message: '分配成功', data: { allocation_id: r.allocation_id, card_id: r.card_id, card_no: r.card_no, user_id: r.to_user_id } });
  });

  /**
   * 8. 后台：批量分配（按手机号搜索用户，或者按card_no批量）
   * POST /admin/batch-allocate { card_ids:[], phone } 按手机号找到用户，分配多个卡
   */
  router.post('/admin/batch-allocate', adminAuthMiddleware, (req, res) => {
    const { card_ids = [], phone } = req.body || {};
    if (!/^1[3-9]\d{9}$/.test(phone)) return res.json({ code: 400, message: '手机号不正确' });
    const user = (db.data.users || []).find(u => u.phone === phone);
    if (!user) return res.json({ code: 404, message: '该手机号未注册用户，请先让用户通过小程序注册' });
    let ok = 0, fail = 0;
    for (const id of card_ids) {
      const r = helpers.allocateCardToUser(Number(id), user.id, req.admin?.id || 1, `批量分配共${card_ids.length}张`);
      if (r.ok) ok++; else fail++;
    }
    res.json({ code: 0, message: '完成', data: { ok, fail, to_user_id: user.id, phone } });
  });

  /**
   * 9. 删除一张未使用未分配的服务卡
   */
  router.delete('/admin/:id', adminAuthMiddleware, (req, res) => {
    const id = Number(req.params.id);
    const idx = (db.data.service_cards || []).findIndex(c => c.id === id);
    if (idx < 0) return res.json({ code: 404, message: '服务卡不存在' });
    const c = db.data.service_cards[idx];
    if ((c.used_count || 0) > 0) return res.json({ code: 400, message: '已使用过的服务卡无法删除' });
    if (c.user_id) return res.json({ code: 400, message: '已分配的服务卡无法删除（可回收为未分配后删除）' });
    db.data.service_cards.splice(idx, 1);
    db.save();
    res.json({ code: 0, message: '删除成功' });
  });

  /**
   * 10. 核销记录（全平台）
   */
  router.get('/admin/usages', adminAuthMiddleware, (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const ps = Math.min(200, Math.max(1, Number(req.query.pageSize) || 20));
    const rows = (db.data.card_usages || []).slice().sort((a, b) => b.id - a.id);
    const total = rows.length;
    const list = rows.slice((page - 1) * ps, page * ps).map(u => {
      const user = (db.data.users || []).find(x => x.id === u.user_id) || {};
      const order = (db.data.orders || []).find(x => x.id === u.order_id) || {};
      const card = (db.data.service_cards || []).find(x => x.id === u.card_id) || {};
      return {
        ...u,
        user_phone: user.phone,
        user_nickname: user.nickname,
        order_no: order.order_no || u.order_no,
        card_price: card.price,
        // —— 后台追踪表字段别名 ——
        card_code: u.card_no || card.card_no,   // 追踪表读 u.card_code
        discount_amount: u.used_amount || 0,     // 追踪表读 u.discount_amount
        redeemed_at: u.used_at,                  // 追踪表读 u.redeemed_at
        admin_note: u.remark || ''
      };
    });
    res.json({ code: 0, message: 'ok', data: { total, list } });
  });

  /**
   * 11. 分配记录（全平台）
   */
  router.get('/admin/allocations', adminAuthMiddleware, (req, res) => {
    const rows = (db.data.card_allocations || []).slice().sort((a, b) => b.id - a.id);
    const list = rows.map(a => {
      const user = (db.data.users || []).find(u => u.id === a.to_user_id) || {};
      const admin = (db.data.admins || []).find(u => u.id === a.allocated_by) || {};
      const card = (db.data.service_cards || []).find(c => c.id === a.card_id) || {};
      return {
        ...a,
        to_phone: user.phone,
        to_nickname: user.nickname,
        by_name: admin.name,
        // —— 后台追踪表字段别名 ——
        card_code: a.card_no || card.card_no,   // 追踪表读 a.card_code
        allocated_at: a.created_at,             // 追踪表读 a.allocated_at
        user_id: a.to_user_id                   // 追踪表读 a.user_id
      };
    });
    res.json({ code: 0, message: 'ok', data: { total: list.length, list } });
  });

  return router;
};
