// app.js - 司机端全局逻辑
App({
  globalData: {
    // 后端API基础地址
    baseUrl: 'http://localhost:3000/api',
    // 用户登录token
    token: '',
    // 司机信息
    driver: null,
    // 司机当前状态: online / offline / busy
    status: 'offline',
    // 系统信息
    systemInfo: null,
    // 状态栏高度
    statusBarHeight: 20,
    // 胶囊按钮位置信息
    menuButton: null
  },

  onLaunch() {
    // 获取系统信息
    const sysInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.globalData.systemInfo = sysInfo;
    this.globalData.statusBarHeight = sysInfo.statusBarHeight || 20;

    // 获取胶囊按钮信息(用于自定义导航栏)
    try {
      this.globalData.menuButton = wx.getMenuButtonBoundingClientRect();
    } catch (e) {
      this.globalData.menuButton = { top: 26, height: 32, right: 187, width: 87 };
    }

    // 检查登录状态
    this.checkLogin();
  },

  /**
   * 检查登录状态
   */
  checkLogin() {
    const token = wx.getStorageSync('token');
    const driver = wx.getStorageSync('driver');
    const status = wx.getStorageSync('driverStatus') || 'offline';

    if (token) {
      this.globalData.token = token;
      this.globalData.driver = driver;
      this.globalData.status = status;
    }
  },

  /**
   * 保存登录信息
   */
  saveLogin(token, driver) {
    this.globalData.token = token;
    this.globalData.driver = driver;
    wx.setStorageSync('token', token);
    wx.setStorageSync('driver', driver);
  },

  /**
   * 清除登录信息
   */
  clearLogin() {
    this.globalData.token = '';
    this.globalData.driver = null;
    this.globalData.status = 'offline';
    wx.removeStorageSync('token');
    wx.removeStorageSync('driver');
    wx.removeStorageSync('driverStatus');
  },

  /**
   * 检查是否已登录
   */
  isLoggedIn() {
    return !!this.globalData.token;
  },

  /**
   * 更新司机状态
   */
  updateStatus(status) {
    this.globalData.status = status;
    wx.setStorageSync('driverStatus', status);
  },

  /**
   * 获取token
   */
  getToken() {
    if (!this.globalData.token) {
      this.globalData.token = wx.getStorageSync('token') || '';
    }
    return this.globalData.token;
  }
});
