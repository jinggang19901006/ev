/**
 * pages/mine/mine.js - 个人中心
 * 用户信息、订单记录、服务卡、联系客服
 */
const api = require('../../utils/api.js')
const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    userInfo: null,
    isLoggedIn: false,
    // 登录表单
    showLoginModal: false,
    tempAvatar: '',
    tempNickname: '',
    tempPhone: '',
    canLogin: false,
    logging: false,
    // 服务卡
    cards: [],
    // 菜单
    menuList: [
      { icon: 'order', name: '我的订单', desc: '查看全部订单', path: 'orders' },
      { icon: 'card', name: '服务卡', desc: '查看服务卡/次卡', path: 'cards' },
      { icon: 'phone', name: '联系客服', desc: '15228301555', path: 'phone' },
      { icon: 'about', name: '关于我们', desc: '绵阳24小时应急充电救援', path: 'about' }
    ]
  },

  onLoad() {
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight
    })
  },

  onShow() {
    this.checkLoginStatus()
  },

  /**
   * 检查登录状态
   */
  checkLoginStatus() {
    const token = app.globalData.token
    if (token) {
      this.setData({ isLoggedIn: true })
      this.loadUserInfo()
      this.loadCards()
    } else {
      this.setData({ isLoggedIn: false, userInfo: null, cards: [] })
    }
  },

  /**
   * 加载用户信息
   */
  loadUserInfo() {
    api.getUserInfo().then(data => {
      this.setData({ userInfo: data })
      app.globalData.userInfo = data
    }).catch(() => {})
  },

  /**
   * 加载服务卡
   */
  loadCards() {
    api.getUserCards().then(data => {
      this.setData({ cards: data || [] })
    }).catch(() => {})
  },

  /**
   * 显示登录弹窗
   */
  onShowLogin() {
    this.setData({
      showLoginModal: true,
      tempAvatar: '',
      tempNickname: '',
      tempPhone: '',
      canLogin: false
    })
    // 刷新登录code
    app.getLoginCode()
  },

  /**
   * 关闭登录弹窗
   */
  onCloseLogin() {
    this.setData({ showLoginModal: false })
  },

  /**
   * 选择头像
   */
  onChooseAvatar(e) {
    const avatarUrl = e.detail.avatarUrl
    this.setData({ tempAvatar: avatarUrl })
    this.checkCanLogin()
  },

  /**
   * 输入昵称
   */
  onNicknameInput(e) {
    this.setData({ tempNickname: e.detail.value })
    this.checkCanLogin()
  },

  /**
   * 手动输入手机号
   */
  onPhoneInput(e) {
    let value = e.detail.value.replace(/\D/g, '')
    if (value.length > 11) value = value.substring(0, 11)
    this.setData({ tempPhone: value })
    this.checkCanLogin()
  },

  /**
   * 获取手机号(微信授权)
   */
  onGetPhoneNumber(e) {
    if (e.detail.errMsg !== 'getPhoneNumber:ok') {
      return
    }
    const phoneCode = e.detail.code || ''
    this.setData({ tempPhone: phoneCode || 'wx_phone_' + Date.now() })
    this.checkCanLogin()
  },

  /**
   * 检查是否可以登录（只需昵称即可，手机号可选）
   */
  checkCanLogin() {
    const canLogin = this.data.tempNickname.length > 0
    this.setData({ canLogin })
  },

  /**
   * 确认登录
   */
  onConfirmLogin() {
    if (!this.data.tempNickname) {
      wx.showToast({ title: '请输入昵称', icon: 'none' })
      return
    }

    this.setData({ logging: true })

    // 获取微信登录code作为openid
    wx.login({
      success: (res) => {
        const openid = res.code || ('wx_user_' + Date.now())
        const loginData = {
          openid: openid,
          phone: this.data.tempPhone || '',
          nickname: this.data.tempNickname,
          avatar: this.data.tempAvatar || ''
        }

        api.login(loginData).then(data => {
          // 保存token
          wx.setStorageSync('token', data.token)
          app.globalData.token = data.token
          app.globalData.userInfo = data.user
          this.setData({
            isLoggedIn: true,
            userInfo: data.user,
            showLoginModal: false,
            logging: false
          })
          wx.showToast({ title: '登录成功', icon: 'success' })
          this.loadCards()
        }).catch(err => {
          console.error('登录失败', err)
          this.setData({ logging: false })
        })
      },
      fail: () => {
        // 如果wx.login失败，使用时间戳作为openid
        const openid = 'wx_user_' + Date.now()
        const loginData = {
          openid: openid,
          phone: this.data.tempPhone || '',
          nickname: this.data.tempNickname,
          avatar: this.data.tempAvatar || ''
        }

        api.login(loginData).then(data => {
          wx.setStorageSync('token', data.token)
          app.globalData.token = data.token
          app.globalData.userInfo = data.user
          this.setData({
            isLoggedIn: true,
            userInfo: data.user,
            showLoginModal: false,
            logging: false
          })
          wx.showToast({ title: '登录成功', icon: 'success' })
          this.loadCards()
        }).catch(err => {
          console.error('登录失败', err)
          this.setData({ logging: false })
        })
      }
    })
  },

  /**
   * 退出登录
   */
  onLogout() {
    wx.showModal({
      title: '提示',
      content: '确定退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync('token')
          app.globalData.token = null
          app.globalData.userInfo = null
          this.setData({
            isLoggedIn: false,
            userInfo: null,
            cards: []
          })
          wx.showToast({ title: '已退出登录', icon: 'success' })
        }
      }
    })
  },

  /**
   * 菜单点击
   */
  onMenuTap(e) {
    const path = e.currentTarget.dataset.path
    switch (path) {
      case 'orders':
        wx.switchTab({ url: '/pages/orders/orders' })
        break
      case 'cards':
        if (!this.data.isLoggedIn) {
          this.onShowLogin()
          return
        }
        // 服务卡已在页面显示，滚动到服务卡区域
        wx.pageScrollTo({ scrollTop: 600, duration: 300 })
        break
      case 'phone':
        wx.makePhoneCall({
          phoneNumber: '15228301555',
          fail: () => {}
        })
        break
      case 'about':
        wx.showModal({
          title: '关于我们',
          content: '绵阳24小时新能源应急充电救援\n\n60kW大功率直流移动补电\n服务区域：绵阳及周边30公里\n服务时间：7x24小时全年无休\n\n救援电话：15228301555',
          showCancel: false,
          confirmText: '知道了'
        })
        break
    }
  },

  /**
   * 前往下单
   */
  goToOrder() {
    wx.navigateTo({ url: '/pages/order/order' })
  },

  /**
   * 阻止冒泡
   */
  stopPropagation() {}
})
