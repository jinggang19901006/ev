// app.js
// 统一版小程序：用户+司机二合一
// 关键：全局状态中记录当前角色 currentRole，不同角色展示不同首页/功能
const api = require('./utils/api.js');

App({
  globalData: {
    apiUrl: 'http://localhost:3000/api',    // 开发环境
    fileBaseUrl: 'http://localhost:3000',
    servicePhone: '15228301555',
    token: '',
    account: null,           // unified_accounts（手机号+微信+主身份）
    profile: null,           // 当前角色的详细资料（user or driver）
    currentRole: '',         // user / driver / ''（未选）
    roles: [],               // 当前账号已开通的所有角色：[{role, id?}]
    wxOpenid: '',            // 登录后拿到的openid
    statusBarHeight: 0,      // 自定义导航栏用
    navBarHeight: 0,
    levelDict: []            // V1-V7字典（用于展示渐变色徽章）
  },

  onLaunch() {
    // 适配导航栏
    try {
      const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
      this.globalData.statusBarHeight = sys.statusBarHeight || 20;
      this.globalData.navBarHeight = menu ? (menu.top - sys.statusBarHeight) * 2 + menu.height : 44;
    } catch (e) { /* ignore */ }

    // 恢复本地登录
    try {
      const token = wx.getStorageSync('uni_token');
      const account = wx.getStorageSync('uni_account');
      const profile = wx.getStorageSync('uni_profile');
      const role = wx.getStorageSync('uni_role');
      if (token && account && role) {
        this.globalData.token = token;
        this.globalData.account = account;
        this.globalData.profile = profile;
        this.globalData.currentRole = role;
      }
    } catch (e) { /* ignore */ }

    // 预取等级字典（V1-V7 渐变色/发光阴影配置）
    this.loadLevelDict();

    // 登录/未登录跳转：有role进对应首页，否则进 auth-entry 选择身份
    wx.setStorage({ key: 'app_launch_at', data: Date.now() });
  },

  // ========== 登录态存取 ==========
  saveLogin({ token, account, profile, role }) {
    this.globalData.token = token || '';
    this.globalData.account = account || null;
    this.globalData.profile = profile || null;
    this.globalData.currentRole = role || '';
    try {
      wx.setStorageSync('uni_token', token || '');
      wx.setStorageSync('uni_account', account || null);
      wx.setStorageSync('uni_profile', profile || null);
      wx.setStorageSync('uni_role', role || '');
    } catch (e) {}
  },

  clearLogin() {
    this.globalData.token = '';
    this.globalData.account = null;
    this.globalData.profile = null;
    this.globalData.currentRole = '';
    ['uni_token', 'uni_account', 'uni_profile', 'uni_role'].forEach(k => wx.removeStorageSync(k));
  },

  isLoggedIn() {
    return !!this.globalData.token && !!this.globalData.currentRole;
  },

  // 切换角色（调用后端 /api/auth/switch-role）
  async switchRole(role) {
    if (!this.isLoggedIn()) return { ok: false, message: '请先登录' };
    try {
      const data = await api.switchRole(role);
      this.saveLogin({
        token: data.token,
        account: this.globalData.account,
        profile: data.profile,
        role: data.role
      });
      return { ok: true, profile: data.profile, role: data.role };
    } catch (e) {
      return { ok: false, message: e.message || '切换失败' };
    }
  },

  // 拉取当前账号信息（含 roles / credit_score）
  async refreshMe() {
    try {
      const me = await api.authMe();
      this.globalData.roles = me.roles || [];
      return me;
    } catch (e) {
      return null;
    }
  },

  // 获取V等级字典（渐变色+发光徽章）
  async loadLevelDict() {
    try {
      const list = await api.getDriverLevels();
      this.globalData.levelDict = list || [];
    } catch (e) {
      this.globalData.levelDict = [];
    }
  },

  // 根据V等级id返回完整等级信息（含渐变色+发光色）
  getLevelInfo(levelId) {
    return (this.globalData.levelDict || []).find(l => l.id === levelId) || {
      level: 'V1', name: '新晋救援者', badge_color: '#9CA3AF',
      gradient_from: '#F3F4F6', gradient_to: '#E5E7EB',
      glow_color: 'rgba(156,163,175,0.4)'
    };
  }
});
