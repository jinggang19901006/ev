// pages/login-phone/login-phone.js
// 需求2：老用户登录（不注册，验证码/微信登录）
const api = require('../../utils/api.js');

Page({
  data: {
    phone: '',
    role: 'user',            // 'user' | 'driver'
    code: '',
    sending: false,
    counter: 0,
    loading: false,
    wxCode: '',
    roleText: '',
    timer: null
  },

  onLoad(opts) {
    const role = opts.role || 'user';
    this.setData({ phone: opts.phone || '', role, roleText: role === 'user' ? '普通车主' : '救援司机' });
    wx.login({ success: r => r && r.code && this.setData({ wxCode: r.code }) });
  },

  onUnload() {
    if (this.data.timer) clearInterval(this.data.timer);
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [key]: e.detail.value });
  },

  // 点击发送验证码（MVP短信mode=dev，后端固定返回1234，所有手机号通用）
  async onSendSms() {
    const phone = (this.data.phone || '').trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) return wx.showToast({ title: '手机号格式错误', icon: 'none' });
    if (this.data.sending) return;
    this.setData({ sending: true, counter: 60 });
    try {
      await api.sendSms(phone, 'login');
      wx.showToast({ title: '验证码已发送(开发环境固定1234)', icon: 'none' });
      const timer = setInterval(() => {
        const c = this.data.counter - 1;
        if (c <= 0) {
          clearInterval(this.data.timer);
          this.setData({ sending: false, counter: 0, timer: null });
        } else {
          this.setData({ counter: c });
        }
      }, 1000);
      this.setData({ timer });
    } catch (e) {
      this.setData({ sending: false, counter: 0 });
    }
  },

  async onTapLogin() {
    const { phone, code, role, wxCode } = this.data;
    if (!/^1[3-9]\d{9}$/.test(phone)) return wx.showToast({ title: '手机号格式错误', icon: 'none' });
    if (!code || code.length < 4) return wx.showToast({ title: '请输入验证码', icon: 'none' });
    this.setData({ loading: true });
    try {
      const login = await api.loginBySms({ phone, code, role, wx_code: wxCode });
      getApp().saveLogin({ token: login.token, role: login.role, account: login.account, profile: login.profile });
      await getApp().refreshMe();
      wx.showToast({ title: '登录成功', icon: 'success' });
      setTimeout(() => {
        wx.reLaunch({ url: role === 'driver' ? '/pages/home-driver/home-driver' : '/pages/home-user/home-user' });
      }, 400);
    } catch (e) {
      // 若后端返回 suggestNext=register 就跳到注册页
      if (e.message && /suggestNext/i.test(e.message) === false && /未注册/.test(e.message) === true) {
        wx.navigateTo({ url: `/pages/register-phone/register-phone?phone=${phone}&role=${role}` });
      }
    } finally {
      this.setData({ loading: false });
    }
  },

  onTapWxLogin() {
    const role = this.data.role;
    if (!this.data.wxCode) return wx.showToast({ title: '微信登录初始化中', icon: 'none' });
    // 跳到 auth-entry 上的微信登录逻辑太复杂，直接调一下同接口
    wx.navigateTo({ url: `/pages/auth-entry/auth-entry?role=${role}&_method=wx` });
  },

  goRegister() {
    wx.redirectTo({ url: `/pages/register-phone/register-phone?phone=${this.data.phone}&role=${this.data.role}` });
  }
});
