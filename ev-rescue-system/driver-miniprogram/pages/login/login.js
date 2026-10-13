// pages/login/login.js - 司机登录页
const api = require('../../utils/api.js');
const app = getApp();

Page({
  data: {
    // 手机号
    phone: '',
    // 姓名
    name: '',
    // 微信头像
    avatar: '',
    // openid
    openid: '',
    // 是否已同意协议
    agreed: false,
    // 手机号输入错误提示
    phoneError: '',
    // 姓名输入错误提示
    nameError: '',
    // 状态栏高度
    statusBarHeight: 20,
    // 是否正在登录
    logging: false
  },

  onLoad() {
    const statusBarHeight = app.globalData.statusBarHeight || 20;
    this.setData({ statusBarHeight });

    // 如果已经登录，直接跳转
    if (app.isLoggedIn()) {
      wx.switchTab({ url: '/pages/orders/orders' });
      return;
    }

    // 获取openid
    this.getLoginCode();
    // 获取用户头像
    this.getUserProfile();
  },

  /**
   * 获取微信登录code(用于后端换取openid)
   */
  getLoginCode() {
    wx.login({
      success: (res) => {
        if (res.code) {
          // 将code暂存，后端可通过code换取openid
          // 此处直接用code作为临时openid标识，实际由后端处理
          this.setData({ openid: res.code });
          console.log('获取登录code成功');
        }
      },
      fail: (err) => {
        console.error('获取登录code失败:', err);
      }
    });
  },

  /**
   * 获取用户头像和昵称
   */
  getUserProfile() {
    // 尝试获取用户信息(基础库2.21.2以上支持)
    if (wx.getUserProfile) {
      // 不主动调用，等待用户点击按钮时获取
      return;
    }
  },

  /**
   * 手机号输入
   */
  onPhoneInput(e) {
    let value = e.detail.value;
    // 只允许数字
    value = value.replace(/\D/g, '');
    // 限制11位
    if (value.length > 11) {
      value = value.substring(0, 11);
    }
    this.setData({
      phone: value,
      phoneError: ''
    });
  },

  /**
   * 姓名输入
   */
  onNameInput(e) {
    const value = e.detail.value.trim();
    this.setData({
      name: value,
      nameError: ''
    });
  },

  /**
   * 手机号失焦校验
   */
  onPhoneBlur() {
    const phone = this.data.phone;
    if (!phone) {
      this.setData({ phoneError: '请输入手机号' });
      return false;
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      this.setData({ phoneError: '请输入正确的手机号' });
      return false;
    }
    return true;
  },

  /**
   * 姓名失焦校验
   */
  onNameBlur() {
    const name = this.data.name;
    if (!name) {
      this.setData({ nameError: '请输入姓名' });
      return false;
    }
    if (name.length < 2) {
      this.setData({ nameError: '姓名至少2个字符' });
      return false;
    }
    return true;
  },

  /**
   * 同意协议切换
   */
  onAgreementChange(e) {
    this.setData({ agreed: e.detail.value.length > 0 });
  },

  /**
   * 选择头像
   */
  onChooseAvatar(e) {
    const avatarUrl = e.detail.avatarUrl;
    this.setData({ avatar: avatarUrl });
  },

  /**
   * 点击登录
   */
  async onLogin() {
    // 表单校验
    if (!this.onPhoneBlur() || !this.onNameBlur()) {
      return;
    }

    if (!this.data.agreed) {
      wx.showToast({ title: '请先同意服务协议', icon: 'none' });
      return;
    }

    if (this.data.logging) return;
    this.setData({ logging: true });

    try {
      // 确保openid已获取
      let openid = this.data.openid;
      if (!openid) {
        const codeRes = await new Promise((resolve, reject) => {
          wx.login({ success: resolve, fail: reject });
        });
        openid = codeRes.code;
        this.setData({ openid: openid });
      }

      // 调用登录接口
      const result = await api.login({
        openid: openid,
        phone: this.data.phone,
        name: this.data.name,
        avatar: this.data.avatar
      });

      // 保存登录信息
      const token = result.token || result.data?.token;
      const driver = result.driver || result.data?.driver || result;

      app.saveLogin(token, driver);
      app.updateStatus('online');

      // 同步上线状态到后端
      api.updateDriverStatus('online').catch(() => {});

      // 检查审核状态
      const isApproved = driver && (driver.approved === 1 || driver.approved === true || driver.approved === '1');
      if (!isApproved) {
        wx.showToast({ title: '登录成功，等待审核', icon: 'none', duration: 2000 });
      } else {
        wx.showToast({ title: '登录成功', icon: 'success' });
      }

      setTimeout(() => {
        wx.switchTab({ url: '/pages/orders/orders' });
      }, 1000);
    } catch (err) {
      console.error('登录失败:', err);
      this.setData({ logging: false });
    }
  }
});
