// pages/role-switch/role-switch.js
// 需求1：一个账号可切换 user / driver（只要该账号开通了两个身份）
const api = require('../../utils/api.js');
Page({
  data: { roles: [], currentRole: '', loading: false },
  onLoad() {
    const app = getApp();
    this.setData({
      roles: app.globalData.roles && app.globalData.roles.length ? app.globalData.roles : [],
      currentRole: app.globalData.currentRole || ''
    });
    if (!this.data.roles.length) {
      app.refreshMe().then(me => {
        if (me) this.setData({ roles: me.roles || [] });
      });
    }
  },
  async switchTo(e) {
    const role = e.currentTarget.dataset.role;
    if (role === this.data.currentRole) return;
    if (!this.data.roles.includes(role)) {
      return wx.showModal({
        title: '该身份未开通',
        content: `您尚未开通「${role === 'user' ? '普通车主' : '救援司机'}」身份，要去注册开通吗？`,
        success: (r) => { if (r.confirm) wx.navigateTo({ url: `/pages/register-phone/register-phone?role=${role}` }); }
      });
    }
    this.setData({ loading: true });
    try {
      const res = await getApp().switchRole(role);
      if (res.ok) {
        wx.showToast({ title: '切换成功', icon: 'success' });
        setTimeout(() => {
          wx.reLaunch({ url: role === 'driver' ? '/pages/home-driver/home-driver' : '/pages/home-user/home-user' });
        }, 400);
      } else {
        wx.showToast({ title: res.message || '切换失败', icon: 'none' });
      }
    } catch (e) {} finally { this.setData({ loading: false }); }
  },
  addRole(e) {
    wx.navigateTo({ url: `/pages/register-phone/register-phone?role=${e.currentTarget.dataset.role}&open_only=1` });
  }
});
