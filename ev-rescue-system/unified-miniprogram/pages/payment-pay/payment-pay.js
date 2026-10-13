// pages/payment-pay/payment-pay.js
// 需求5：押金/尾款支付页 + 需求4：服务卡抵扣 + 防逃单提示
const api = require('../../utils/api.js');
Page({
  data: {
    orderId: '',
    stage: 'deposit',        // 'deposit' | 'final'（押金 / 尾款）
    summary: null,           // 后端 /summary 返回
    cardList: [],            // 可选服务卡（来自 summary.available_cards）
    selectedCardId: 0,       // 选中的卡
    useCoupon: true,
    loading: false,
    paying: false,
    escapeHint: ''
  },

  async onLoad(opts) {
    opts = opts || {};
    const stage = opts.stage === 'final' ? 'final' : 'deposit';
    // 双兜底：新入口会同时传 id + orderId，其他老入口可能只传其中一个；
    // 禁止 setData({ orderId: undefined }) 引发"Setting data field orderId to undefined invalid"黄色警告
    const oid = (opts.orderId != null && opts.orderId !== '') ? opts.orderId
      : ((opts.id != null && opts.id !== '') ? opts.id : '');
    if (!oid) {
      wx.showToast({ title: '缺少订单号', icon: 'none' });
      this.setData({ stage, orderId: '' });
      setTimeout(() => {
        wx.navigateBack({
          fail: () => {
            wx.switchTab({
              url: '/pages/order-user/order-user',
              fail: () => wx.reLaunch({ url: '/pages/home-user/home-user' })
            });
          }
        });
      }, 1200);
      return;
    }
    this.setData({ orderId: String(oid), stage });
    await this._reload();
  },

  async _reload() {
    if (!this.data.orderId) {
      wx.showToast({ title: '缺少订单号', icon: 'none' });
      return;
    }
    this.setData({ loading: true });
    try {
      const s = await api.payments.summary(this.data.orderId);
      // 兜底：后端旧结构没有 order 对象时，用顶层字段合成（防止渲染空）
      const order = s.order || {
        id: s.order_id, order_no: s.order_no, status: s.status,
        distance_km: s.distance_km || 0,
        time_type: Number(s.is_night)===1 ? 'night' : 'day',
        total_amount: s.total_price || 0, total_price: s.total_price || 0,
        deposit_status: s.deposit_status || 'unpaid',
        payment_status: s.payment_status || 'unpaid',
        escape_flagged: !!s.escape_flagged
      };
      if (!s.order) s.order = order;
      if (s.deposit && s.deposit_ratio == null) {
        s.deposit_ratio = Number(s.deposit.ratio) || 0;
        s.deposit_min = Number(s.deposit.min) || 0;
        s.deposit_amount = Number(s.deposit.should_pay) || Number(s.deposit_amount) || 0;
      }
      if (s.vehicle_size_cn == null && s.order) {
        const map = { small: '小型轿车(A级)', medium: '中型轿车/SUV', large: '大型车(MPV)', '*': '通用车型' };
        s.vehicle_size_cn = map[s.order.vehicle_type] || (s.order.vehicle_type || '未知车型');
      }
      // 兼容旧卡字段
      const cardList = ((s.available_cards || s.cards || [])).map(c => ({
        ...c,
        code: c.code || c.card_no || '',
        name: c.name || (c.price ? `¥${c.price}服务卡` : '服务卡'),
        discount_amount: Number(c.discount_amount != null ? c.discount_amount : c.price) || 0,
        expires_at: c.expires_at || c.expired_at || '长期有效'
      }));
      this.setData({
        summary: s,
        cardList,
        selectedCardId: (cardList.length) ? cardList[0].id : 0
      });
      const hx = (s.order && s.order.escape_flagged) ? 1 : 0;
      const score = s.credit_score;
      if (hx || (score && score < 70)) {
        this.setData({ escapeHint: '您的信用分较低或存在历史未付记录，本次需先完成押金支付后才能进入派单；尾款超时未支付会再次扣减积分' });
      }
    } catch (e) {
      console.error('pay-summary load failed:', e && e.message, e);
      wx.showToast({ title: (e && e.message) || '加载订单失败', icon: 'none' });
    } finally { this.setData({ loading: false }); }
  },

  pickCard(e) { this.setData({ selectedCardId: Number(e.currentTarget.dataset.id) }); },
  toggleCoupon() { this.setData({ useCoupon: !this.data.useCoupon }); },

  // 查看我的订单（order-user 是 tabBar 页，必须 switchTab）
  goOrders() {
    wx.switchTab({
      url: '/pages/order-user/order-user',
      fail: () => wx.reLaunch({ url: '/pages/home-user/home-user' })
    });
  },

  // 押金支付（未付押金不进入派单，防逃单第一道防线）
  async payDeposit() {
    if (this.data.paying) return;
    // 前置幂等：押金已付直接提示，不发请求
    const o = this.data.summary && this.data.summary.order;
    if (o && o.deposit_status === 'paid') {
      wx.showToast({ title: '押金已支付，无需重复支付', icon: 'none' });
      return;
    }
    this.setData({ paying: true });
    try {
      const r = await api.payments.payDeposit(this.data.orderId, 'mock');
      if (r && r.already_paid) {
        wx.showToast({ title: '押金已支付，无需重复支付', icon: 'none' });
      } else {
        wx.showToast({ title: '押金支付成功，进入派单', icon: 'success' });
      }
      // 刷新摘要：页面切换为"押金已支付"态，杜绝重复支付入口
      await this._reload();
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 1200);
    } catch (e) {
      // 若提示信用不足 跳信用页
      if (e.message && /信用|积分|低于/.test(e.message)) {
        setTimeout(() => wx.navigateTo({ url: '/pages/credit/credit' }), 700);
      }
    } finally { this.setData({ paying: false }); }
  },

  // 尾款支付（完成服务后24h内支付；超时会被扣信用分）
  async payFinal() {
    if (this.data.paying) return;
    // 前置幂等：尾款已结清直接提示
    const o = this.data.summary && this.data.summary.order;
    if (o && o.payment_status === 'paid') {
      wx.showToast({ title: '订单已结清，无需重复支付', icon: 'none' });
      return;
    }
    this.setData({ paying: true });
    try {
      const body = {
        card_id: this.data.stage === 'final' && this.data.useCoupon ? this.data.selectedCardId || null : null
      };
      const r = await api.payments.payFinal(this.data.orderId, body);
      if (r && r.already_paid) {
        wx.showToast({ title: '订单已结清，无需重复支付', icon: 'none' });
      } else {
        wx.showToast({ title: (r && r.message) || '支付成功', icon: 'success' });
      }
      await this._reload();
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 1200);
    } catch (e) {} finally { this.setData({ paying: false }); }
  }
});
