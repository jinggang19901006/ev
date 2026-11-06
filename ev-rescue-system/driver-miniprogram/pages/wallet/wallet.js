// pages/wallet/wallet.js - 钱包提现页
const api = require('../../utils/api.js');
const time = require('../../utils/time.js');
const app = getApp();

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    balance: 0,
    totalEarnings: 0,
    withdrawals: [],
    loading: true,
    showWithdraw: false,
    withdrawAmount: '',
    withdrawType: 'wechat',
    processing: false
  },

  onLoad() {
    const statusBarHeight = app.globalData.statusBarHeight || 20;
    const menuButton = app.globalData.menuButton || {};
    const navBarHeight = menuButton.height ?
      (menuButton.top - statusBarHeight) * 2 + menuButton.height : 44;
    this.setData({ statusBarHeight, navBarHeight });
  },

  onShow() {
    this.loadWallet();
  },

  async loadWallet() {
    this.setData({ loading: true });
    try {
      const data = await api.getWallet();
      this.setData({
        balance: Number(data.balance) || 0,
        totalEarnings: Number(data.total_earnings) || 0,
        withdrawals: data.withdrawals || [],
        loading: false
      });
    } catch (err) {
      console.error('加载钱包失败:', err);
      this.setData({ loading: false });
    }
  },

  onShowWithdraw() {
    this.setData({ showWithdraw: true, withdrawAmount: '' });
  },

  onCloseWithdraw() {
    this.setData({ showWithdraw: false });
  },

  onAmountInput(e) {
    let value = e.detail.value;
    value = value.replace(/[^\d.]/g, '');
    // 只允许一个小数点
    const parts = value.split('.');
    if (parts.length > 2) {
      value = parts[0] + '.' + parts.slice(1).join('');
    }
    this.setData({ withdrawAmount: value });
  },

  onTypeChange(e) {
    this.setData({ withdrawType: e.currentTarget.dataset.type });
  },

  onAllWithdraw() {
    this.setData({ withdrawAmount: String(this.data.balance) });
  },

  stopPropagation() {},

  async onConfirmWithdraw() {
    const amount = parseFloat(this.data.withdrawAmount);
    if (!amount || amount <= 0) {
      wx.showToast({ title: '请输入有效金额', icon: 'none' });
      return;
    }
    if (amount > this.data.balance) {
      wx.showToast({ title: '余额不足', icon: 'none' });
      return;
    }

    this.setData({ processing: true });
    try {
      await api.requestWithdraw(amount, this.data.withdrawType, '');
      wx.showToast({ title: '提现申请已提交', icon: 'success' });
      this.setData({ showWithdraw: false, processing: false });
      this.loadWallet();
    } catch (err) {
      console.error('提现失败:', err);
      wx.showToast({ title: err.message || '提现失败', icon: 'none' });
      this.setData({ processing: false });
    }
  },

  onBack() {
    wx.navigateBack();
  },

  formatStatus(status) {
    const map = { pending: '审核中', approved: '已通过', rejected: '已退回' };
    return map[status] || status;
  },

  formatTime(timeStr) {
    return time.formatMonthDayTime(timeStr);
  }
});
