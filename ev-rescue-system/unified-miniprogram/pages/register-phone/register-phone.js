// pages/register-phone/register-phone.js
// 需求2：新用户注册 —— 必须验证码校验通过 + 资料齐全才会入库（不覆盖老账号）
// 一个手机号可注册 user / driver 两种身份，共用 unified_account
const api = require('../../utils/api.js');

Page({
  data: {
    phone: '',
    role: 'user',
    roleText: '普通车主',
    wxCode: '',
    openOnly: false, // 仅补角色（手机号+openid已存在）

    // 输入
    code: '',
    nickname: '',
    avatar: '',
    name: '',              // 司机姓名
    idCard: '',            // 司机身份证
    licensePlate: '',      // 司机车牌号
    agree: true,

    sending: false, counter: 0, timer: null,
    loading: false
  },

  onLoad(opts) {
    const role = opts.role || 'user';
    this.setData({
      phone: opts.phone || '',
      role,
      roleText: role === 'user' ? '普通车主' : '救援司机',
      wxCode: opts.wx_code || '',
      openOnly: opts.open_only === '1'
    });
    // 若从 auth-entry 过来且没拿到 wx.login 的 code，再取一次
    if (!this.data.wxCode) {
      wx.login({ success: r => r && r.code && this.setData({ wxCode: r.code }) });
    }
  },

  onUnload() { if (this.data.timer) clearInterval(this.data.timer); },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [key]: e.detail.value });
  },

  toggleAgree() { this.setData({ agree: !this.data.agree }); },

  chooseAvatar(e) { this.setData({ avatar: e.detail.avatarUrl || '' }); },

  async onSendSms() {
    const phone = (this.data.phone || '').trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) return wx.showToast({ title: '手机号格式错误', icon: 'none' });
    if (this.data.sending) return;
    this.setData({ sending: true, counter: 60 });
    try {
      await api.sendSms(phone, 'register');
      wx.showToast({ title: '验证码已发送(开发环境固定1234)', icon: 'none' });
      const timer = setInterval(() => {
        const c = this.data.counter - 1;
        if (c <= 0) { clearInterval(this.data.timer); this.setData({ sending:false, counter:0, timer:null }); }
        else this.setData({ counter: c });
      }, 1000);
      this.setData({ timer });
    } catch (e) { this.setData({ sending:false, counter:0 }); }
  },

  async onTapRegister() {
    if (!this.data.agree) return wx.showToast({ title: '请先勾选同意协议', icon: 'none' });
    const { phone, role, code, nickname, avatar, name, idCard, licensePlate, wxCode } = this.data;
    if (!/^1[3-9]\d{9}$/.test(phone)) return wx.showToast({ title: '手机号格式错误', icon: 'none' });
    if (!code || code.length < 4) return wx.showToast({ title: '请输入验证码', icon: 'none' });
    if (role === 'user' && !nickname) return wx.showToast({ title: '请填写昵称', icon: 'none' });
    if (role === 'driver') {
      if (!name) return wx.showToast({ title: '请填写司机姓名', icon: 'none' });
      if (!idCard || idCard.length < 10) return wx.showToast({ title: '请填写身份证号', icon: 'none' });
    }
    this.setData({ loading: true });
    try {
      const body = { phone, code, role, nickname, avatar, wx_code: wxCode };
      if (role === 'driver') Object.assign(body, { name, id_card: idCard, license_plate: licensePlate });
      const login = await api.register(body);
      getApp().saveLogin({ token: login.token, role: login.role, account: login.account, profile: login.profile });
      await getApp().refreshMe();
      wx.showToast({ title: role === 'driver' ? '注册成功，等待后台审核' : '注册成功', icon: 'success' });
      setTimeout(() => {
        wx.reLaunch({ url: role === 'driver' ? '/pages/home-driver/home-driver' : '/pages/home-user/home-user' });
      }, 500);
    } catch (e) {
      // 若 msg 提示角色已存在 → 可跳登录
      if (e.message && /该角色已注册|已开通/.test(e.message)) {
        setTimeout(() => wx.redirectTo({ url: `/pages/login-phone/login-phone?phone=${phone}&role=${role}` }), 800);
      }
    } finally {
      this.setData({ loading: false });
    }
  },

  goLogin() { wx.redirectTo({ url: `/pages/login-phone/login-phone?phone=${this.data.phone}&role=${this.data.role}` }); }
});
