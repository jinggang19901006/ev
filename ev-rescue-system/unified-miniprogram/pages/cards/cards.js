// pages/cards/cards.js  需求4：我的服务卡闭环
const api = require('../../utils/api.js');
Page({
  data: { tab: 'unused', list: [], unused: [], used: [], expired: [], loading: false },
  onShow() { this._load(); },
  async _load() {
    this.setData({ loading: true });
    try {
      const all = (await api.cards.mine()).list || [];
      const unused = all.filter(c => c.status === 'unused' || c.status === 'active');
      const used = all.filter(c => c.status === 'used' || c.status === 'redeemed');
      const expired = all.filter(c => c.status === 'expired');
      this.setData({
        unused, used, expired,
        list: this.data.tab === 'unused' ? unused : this.data.tab === 'used' ? used : expired
      });
    } catch (e) {} finally { this.setData({ loading: false }); }
  },
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ tab, list: this.data[tab] || [] });
  },
  openDetail(e) {
    wx.navigateTo({ url: `/pages/cards-detail/cards-detail?id=${e.currentTarget.dataset.id}` });
  }
});
