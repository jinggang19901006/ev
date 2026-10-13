// pages/auth-entry/auth-entry.js
// 需求1：用户+司机二合一入口，登录时选择身份
// 需求2：根据账号存在性 → 走老用户登录(login-phone) 或 新用户注册(register-phone)
const api = require('../../utils/api.js');

Page({
  data: {
    loading: false,
    // 预填(由 wx.login 回调后写入)
    wxCode: '',
    // 记住上次登录的手机号/角色
    lastPhone: '',
    lastRole: '',
    // 账号探测结果：check-account 返回
    checked: null,   // { exists, roles, suggestNext }
    inputPhone: '',
    roleSelected: '', // 'user' | 'driver' ，UI选中态
    // 状态栏高度（老 driver login WXML 顶部占位使用）
    statusBarHeight: 20,
    // 手机号错误提示（复用老 login.error-text 渲染）
    phoneError: ''
  },

  onLoad() {
    const app = getApp();
    const statusBarHeight = (app.globalData && app.globalData.statusBarHeight) || 20;
    // 取出上次记住的手机号/角色
    try {
      const account = wx.getStorageSync('uni_account') || {};
      const savedPhone = account.phone || '';
      const savedRole = wx.getStorageSync('uni_role') || '';
      this.setData({
        statusBarHeight,
        lastPhone: savedPhone,
        inputPhone: savedPhone,   // 修复：同时赋给 inputPhone，避免显示了 lastPhone 但实际点下一步时取空
        lastRole: savedRole,
        roleSelected: savedRole || '' // 记住上次选的角色（普通车主/救援司机），不用每次重选
      });
    } catch (e) {
      this.setData({ statusBarHeight });
    }
    // 预取 wx.login code
    wx.login({
      success: (r) => r && r.code && this.setData({ wxCode: r.code })
    });
  },

  onInputPhone(e) {
    this.setData({ inputPhone: e.detail.value, checked: null, phoneError: '' });
  },

  pickRole(e) {
    this.setData({ roleSelected: e.currentTarget.dataset.role });
  },

  /**
   * 身份 2 选 1 radio-group change 事件（WXML 新增绑定 pickRoleRadio）
   * 与 pickRole 并存兼容：tap 角色卡可走 bindtap，radio 圆点可走 bindchange；二者效果一致
   */
  pickRoleRadio(e) {
    const role = (e && e.detail && e.detail.value) || '';
    if (role) {
      this.setData({ roleSelected: role });
    }
  },

  // 点击手机号继续：探测账号 → 跳转到登录 or 注册
  async onTapNextPhone() {
    // 双兜底：优先 inputPhone（用户手动输入），其次 lastPhone（Storage 记住的）
    const phone = ((this.data.inputPhone || this.data.lastPhone) || '').trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      this.setData({ phoneError: '请输入正确的手机号' });
      return wx.showToast({ title: '请输入正确的手机号', icon: 'none' });
    }
    if (!this.data.roleSelected) {
      return wx.showToast({ title: '请选择使用身份', icon: 'none' });
    }
    this.setData({ loading: true, phoneError: '' });
    try {
      const result = await api.checkAccount({ phone });
      this.setData({ checked: result });
      // 存在该手机号 + 已选中角色已开通 → 登录页；不存在 or 角色没开通 → 注册页
      const hasRole = (result.roles || []).includes(this.data.roleSelected);
      const target = result.exists && hasRole ? 'login' : 'register';
      const url =
        target === 'login'
          ? `/pages/login-phone/login-phone?phone=${phone}&role=${this.data.roleSelected}`
          : `/pages/register-phone/register-phone?phone=${phone}&role=${this.data.roleSelected}&suggestNext=${result.suggestNext || ''}`;
      wx.navigateTo({ url });
    } catch (e) {
      wx.showToast({ title: e.message || '网络异常', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 微信一键登录：如果该openid已绑定 → 直接进总览；没绑定 → 跳转到注册页(wx_code带上)
  async onTapWxLogin() {
    if (!this.data.roleSelected) {
      return wx.showToast({ title: '请先选择使用身份', icon: 'none' });
    }
    this.setData({ loading: true });
    try {
      const code = this.data.wxCode;
      if (!code) return wx.showToast({ title: '微信登录初始化中，请重试', icon: 'none' });
      const check = await api.checkAccount({ wx_code: code });
      if (!check.exists) {
        // 未注册 → 跳注册，带 wx_code(不用再输验证码？MVP要求还是验证手机号+验证码更真实，所以跳到注册)
        wx.navigateTo({
          url: `/pages/register-phone/register-phone?role=${this.data.roleSelected}&wx_code=${code}`
        });
        return;
      }
      // 已存在
      const hasRole = (check.roles || []).includes(this.data.roleSelected);
      if (!hasRole) {
        // openid已绑手机，但缺少所选角色 → 让用户在注册页开通新角色（复用同一手机号）
        wx.navigateTo({
          url: `/pages/register-phone/register-phone?role=${this.data.roleSelected}&phone=${check.phone || ''}&wx_code=${code}&open_only=1`
        });
        return;
      }
      const login = await api.loginByWx(code, this.data.roleSelected);
      getApp().saveLogin({
        token: login.token,
        role: login.role,
        account: login.account,
        profile: login.profile
      });
      await getApp().refreshMe();
      this._toHome(login.role);
    } catch (e) {
      wx.showToast({ title: e.message || '登录失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 免登"游客体验"：直接进入用户首页（部分功能受限）
  onTapGuest() {
    getApp().globalData.currentRole = 'user';
    this._toHome('user');
  },

  _toHome(role) {
    // 【正确做法：reLaunch 清空栈】登录成功后身份选择页应该被"消耗掉"，
    // 首页（呼叫救援/接单大厅）作为根页，不应该点返回键还能退回到登录页。
    wx.reLaunch({
      url: role === 'driver' ? '/pages/home-driver/home-driver' : '/pages/home-user/home-user'
    });
  }
});
