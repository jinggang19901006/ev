/**
 * pages/mine/mine.js - 个人中心（统一端·角色感知）
 *  - user 角色：还原老 user-miniprogram 个人中心（订单/服务卡/客服/关于）
 *  - driver 角色：司机中心（接单状态切换/今日·本月·累计收入/订单大厅入口/身份切换）
 */
const api = require('../../utils/api.js')
const time = require('../../utils/time.js')
const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    role: 'user',           // user / driver
    userInfo: null,         // 用户资料
    driver: null,           // 司机资料
    driverStatus: 'offline',
    driverLevel: {
      code: 'V1',
      name: '新晋救援者',
      coefficient: '0.80',
      badgeColor: '#0F766E',
      gradientFrom: '#CCFBF1',
      gradientTo: '#99F6E4',
      totalOrders: 0,
      rating: '5.00',
      acceptCount7d: 0,
      progress: 0,
      nextText: '完成首单后开始等级成长'
    },
    earnings: {
      today: { count: 0, amount: 0 },
      month: { count: 0, amount: 0 },
      total: { count: 0, amount: 0 },
      pendingAmount: '0.00'
    },
    hasPendingEarnings: false,
    wallet: {
      balance: 0,
      frozenAmount: 0,
      totalEarnings: 0,
      minWithdrawAmount: 10,
      withdrawals: []
    },
    showWithdrawModal: false,
    withdrawTypes: [
      { value: 'wechat', label: '微信零钱' },
      { value: 'alipay', label: '支付宝' },
      { value: 'bank', label: '银行卡' }
    ],
    withdrawTypeIndex: 0,
    withdrawAmount: '',
    withdrawAccountName: '',
    withdrawAccount: '',
    withdrawing: false,
    isLoggedIn: false,
    // 登录表单（保留data结构，弹窗UI不变，提交逻辑改为跳auth-entry）
    showLoginModal: false,
    tempAvatar: '',
    tempNickname: '',
    tempPhone: '',
    canLogin: false,
    logging: false,
    // 菜单（onShow 时按角色生成）
    menuList: []
  },

  onLoad() {
    try {
      this.setData({
        statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20
      })
    } catch (e) {}
  },

  onShow() {
    app.syncTabBar(this)
    this.checkLoginStatus()
  },

  /**
   * 检查登录状态（token 三兜底：globalData / uni_token / 旧 token）
   */
  checkLoginStatus() {
    const token = (app.globalData && app.globalData.token)
      || wx.getStorageSync('uni_token')
      || wx.getStorageSync('token')
      || ''
    const role = (app.globalData && app.globalData.currentRole) || wx.getStorageSync('uni_role') || 'user'
    if (token) {
      const menuList = this.buildMenu(role)
      this.setData({ isLoggedIn: true, role, menuList })
      if (role === 'driver') {
        this.loadDriverInfo()
        this.loadEarnings()
        this.loadWallet()
      } else {
        this.loadUserInfo()
      }
    } else {
      this.setData({
        isLoggedIn: false, role: 'user',
        userInfo: null, driver: null,
        menuList: this.buildMenu('user')
      })
    }
  },

  buildMenu(role) {
    if (role === 'driver') {
      return [
        { icon: 'order', name: '订单大厅', desc: '查看可接订单', path: 'hall' },
        { icon: 'card', name: '切换身份', desc: '切换为普通车主', path: 'switch' },
        { icon: 'phone', name: '联系客服', desc: '15228301555', path: 'phone' },
        { icon: 'about', name: '关于我们', desc: '绵阳24小时应急充电救援', path: 'about' }
      ]
    }
    return [
      { icon: 'order', name: '我的订单', desc: '查看全部订单', path: 'orders' },
      { icon: 'card', name: '服务卡', desc: '查看服务卡/次卡', path: 'cards' },
      { icon: 'phone', name: '联系客服', desc: '15228301555', path: 'phone' },
      { icon: 'about', name: '关于我们', desc: '绵阳24小时应急充电救援', path: 'about' }
    ]
  },

  /**
   * 加载用户信息
   */
  loadUserInfo() {
    api.user.info().then(data => {
      this.setData({ userInfo: data || null })
      if (app.globalData) app.globalData.userInfo = data
    }).catch(err => {
      console.error('loadUserInfo fail', err)
      if (err && /登录过期|401|请重新登录/.test(err.message || '')) {
        this.goToLogin()
      }
    })
  },

  /**
   * 加载司机信息
   */
  loadDriverInfo() {
    // 先用本地缓存即时渲染，再拉网络
    const cached = (app.globalData && app.globalData.profile) || wx.getStorageSync('uni_profile')
    if (cached) {
      this.setData({
        driver: cached,
        driverStatus: cached.status || cached.work_status || 'offline',
        driverLevel: this.buildDriverLevel(cached)
      })
    }
    api.driver.info().then(data => {
      const driver = (data && (data.driver || data)) || cached || null
      if (driver) {
        this.setData({
          driver,
          driverStatus: driver.status || driver.work_status || this.data.driverStatus,
          driverLevel: this.buildDriverLevel(driver)
        })
        if (app.globalData) app.globalData.profile = driver
      }
    }).catch(err => {
      console.error('loadDriverInfo fail', err)
      if (err && /登录过期|401|请重新登录/.test(err.message || '')) this.goToLogin()
    })
  },

  buildDriverLevel(driver) {
    const level = driver.level_info || app.getLevelInfo(Number(driver.level_id || 1)) || {}
    const next = driver.next_level || null
    const totalOrders = Number(driver.total_orders || 0)
    const rating = Number(driver.rating || 5)
    let progress = 100
    let nextText = '已达到最高服务等级'
    if (next) {
      const currentMin = Number(level.min_orders || 0)
      const nextMin = Number(next.min_orders || 0)
      const span = Math.max(1, nextMin - currentMin)
      progress = Math.max(0, Math.min(100, Math.round((totalOrders - currentMin) / span * 100)))
      const remain = Math.max(0, nextMin - totalOrders)
      const ratingGap = Math.max(0, Number(next.min_rating || 0) - rating)
      nextText = `距离 ${next.level} 还需 ${remain} 单`
      if (ratingGap > 0) nextText += `，评分需提升 ${ratingGap.toFixed(2)}`
    }
    return {
      code: level.level || 'V1',
      name: level.name || '新晋救援者',
      coefficient: Number(level.coefficient || 0.8).toFixed(2),
      badgeColor: level.badge_color || '#0F766E',
      gradientFrom: level.gradient_from || '#CCFBF1',
      gradientTo: level.gradient_to || '#99F6E4',
      totalOrders,
      rating: rating.toFixed(2),
      acceptCount7d: Number(driver.accept_count_7d || 0),
      progress,
      nextText
    }
  },

  /**
   * 加载司机收入统计
   */
  loadEarnings() {
    api.driver.earnings().then(data => {
      if (!data) return
      const pick = (n) => ({
        count: n.orders != null ? n.orders : (n.count || 0),
        amount: Number(n.earnings != null ? n.earnings : (n.amount || 0)).toFixed(2)
      })
      this.setData({
        earnings: {
          today: pick(data.today || {}),
          month: pick(data.month || {}),
          total: pick(data.total || {}),
          pendingAmount: Number(data.pending_earnings || 0).toFixed(2)
        },
        hasPendingEarnings: Number(data.pending_earnings || 0) > 0
      })
    }).catch(err => {
      console.error('loadEarnings fail', err)
    })
  },

  loadWallet() {
    api.driver.wallet().then(data => {
      if (!data) return
      const typeMap = { wechat: '微信零钱', alipay: '支付宝', bank: '银行卡' }
      const statusMap = {
        pending: { label: '审核中', className: 'pending' },
        paid: { label: '已打款', className: 'paid' },
        approved: { label: '已打款', className: 'paid' },
        rejected: { label: '已拒绝', className: 'rejected' }
      }
      const withdrawals = (data.withdrawals || []).map(item => {
        const status = statusMap[item.status] || { label: item.status || '未知', className: 'pending' }
        return {
          ...item,
          typeLabel: typeMap[item.type] || item.type || '其他',
          statusLabel: status.label,
          statusClass: status.className,
          createdAtText: this.formatWalletTime(item.created_at)
        }
      })
      this.setData({
        wallet: {
          balance: Number(data.balance || 0).toFixed(2),
          frozenAmount: Number(data.frozen_amount || 0).toFixed(2),
          totalEarnings: Number(data.total_earnings || 0).toFixed(2),
          minWithdrawAmount: Number(data.min_withdraw_amount || 10),
          withdrawals
        }
      })
    }).catch(err => {
      console.error('loadWallet fail', err)
    })
  },

  formatWalletTime(value) {
    return time.formatDateTime(value)
  },

  onOpenWithdraw() {
    const balance = Number(this.data.wallet.balance || 0)
    const minAmount = Number(this.data.wallet.minWithdrawAmount || 10)
    if (balance < minAmount) {
      wx.showToast({ title: `余额满${minAmount}元后可提现`, icon: 'none' })
      return
    }
    const driver = this.data.driver || {}
    this.setData({
      showWithdrawModal: true,
      withdrawTypeIndex: 0,
      withdrawAmount: '',
      withdrawAccountName: driver.name || '',
      withdrawAccount: driver.phone || ''
    })
  },

  onCloseWithdraw() {
    if (!this.data.withdrawing) this.setData({ showWithdrawModal: false })
  },

  onWithdrawTypeChange(e) {
    this.setData({ withdrawTypeIndex: Number(e.detail.value || 0), withdrawAccount: '' })
  },

  onWithdrawAmountInput(e) {
    this.setData({ withdrawAmount: e.detail.value || '' })
  },

  onWithdrawNameInput(e) {
    this.setData({ withdrawAccountName: e.detail.value || '' })
  },

  onWithdrawAccountInput(e) {
    this.setData({ withdrawAccount: e.detail.value || '' })
  },

  onWithdrawAll() {
    this.setData({ withdrawAmount: String(this.data.wallet.balance || '') })
  },

  async onSubmitWithdraw() {
    if (this.data.withdrawing) return
    const amount = Number(this.data.withdrawAmount)
    const minAmount = Number(this.data.wallet.minWithdrawAmount || 10)
    const balance = Number(this.data.wallet.balance || 0)
    const accountName = String(this.data.withdrawAccountName || '').trim()
    const account = String(this.data.withdrawAccount || '').trim()
    if (!amount || amount < minAmount) {
      wx.showToast({ title: `最低提现${minAmount}元`, icon: 'none' })
      return
    }
    if (amount > balance) {
      wx.showToast({ title: '提现金额超过可用余额', icon: 'none' })
      return
    }
    if (accountName.length < 2) {
      wx.showToast({ title: '请填写收款人姓名', icon: 'none' })
      return
    }
    if (account.length < 4) {
      wx.showToast({ title: '请填写正确的收款账号', icon: 'none' })
      return
    }
    const type = this.data.withdrawTypes[this.data.withdrawTypeIndex].value
    this.setData({ withdrawing: true })
    try {
      await api.driver.withdraw({
        amount,
        type,
        account,
        account_name: accountName
      })
      this.setData({ showWithdrawModal: false })
      wx.showToast({ title: '提现申请已提交', icon: 'success' })
      this.loadWallet()
    } catch (err) {
      console.error('withdraw fail', err)
    } finally {
      this.setData({ withdrawing: false })
    }
  },

  /**
   * 显示登录弹窗 → 直接跳 auth-entry（统一端统一入口）
   */
  onShowLogin() {
    this.goToLogin()
  },

  onCloseLogin() {
    this.setData({ showLoginModal: false })
  },

  goToLogin() {
    wx.reLaunch({ url: '/pages/auth-entry/auth-entry' })
  },

  stopPropagation() {},

  // —— 旧弹窗form事件保留壳，避免WXML bind事件缺失报错 ——
  onChooseAvatar(e) {
    try { this.setData({ tempAvatar: (e.detail && e.detail.avatarUrl) || '' }) } catch(e) {}
  },
  onNicknameInput(e) {
    try { this.setData({ tempNickname: e.detail.value || '' }) } catch(e) {}
  },
  onPhoneInput(e) {
    try {
      let v = ((e.detail && e.detail.value) || '').replace(/\D/g, '')
      if (v.length > 11) v = v.substring(0, 11)
      this.setData({ tempPhone: v })
    } catch(e) {}
  },
  onGetPhoneNumber(e) {
    if (!e || !e.detail || e.detail.errMsg !== 'getPhoneNumber:ok') return
    try {
      const pc = (e.detail.code || '')
      this.setData({ tempPhone: pc || ('wx_phone_' + Date.now()) })
    } catch(e) {}
  },
  onConfirmLogin() {
    this.goToLogin()
  },

  /**
   * 退出登录（统一走 app.clearLogin 清全量 uni_* 存储）
   */
  onLogout() {
    wx.showModal({
      title: '提示',
      content: '确定退出登录吗？',
      success: (res) => {
        if (res && res.confirm) {
          if (this.data.role === 'driver') {
            api.driver.updateStatus('offline').catch(() => {})
          }
          try { app.clearLogin() } catch (e) {}
          this.setData({ isLoggedIn: false, userInfo: null, driver: null })
          wx.showToast({ title: '已退出登录', icon: 'success' })
          setTimeout(() => this.goToLogin(), 600)
        }
      }
    })
  },

  /**
   * 快捷入口：去订单大厅（司机）
   */
  goHall() {
    wx.switchTab({
      url: '/pages/home-driver/home-driver',
      fail: () => wx.reLaunch({ url: '/pages/home-driver/home-driver' })
    })
  },

  /**
   * 快捷入口：切换接单状态（司机）
   */
  onChangeWorkStatus() {
    const itemList = ['在线（接收新订单）', '忙碌（服务中）', '离线（不接收订单）']
    wx.showActionSheet({
      itemList,
      success: (r) => {
        const map = ['online', 'busy', 'offline']
        const status = map[r.tapIndex]
        if (!status || status === this.data.driverStatus) return
        api.driver.updateStatus(status).then(() => {
          this.setData({ driverStatus: status })
          const msg = status === 'online' ? '已上线接单' : status === 'busy' ? '已切换为忙碌' : '已下线'
          wx.showToast({ title: msg, icon: 'success' })
        }).catch(() => {})
      }
    })
  },

  /**
   * 菜单点击
   */
  onMenuTap(e) {
    const path = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.path
    switch (path) {
      case 'orders':
        // 用户订单页（tabBar 页）
        wx.switchTab({
          url: '/pages/order-user/order-user',
          fail: () => wx.reLaunch({ url: '/pages/order-user/order-user' })
        })
        break
      case 'hall':
        // 司机订单大厅（tabBar 页）
        wx.switchTab({
          url: '/pages/home-driver/home-driver',
          fail: () => wx.reLaunch({ url: '/pages/home-driver/home-driver' })
        })
        break
      case 'cards':
        if (!this.data.isLoggedIn) { this.goToLogin(); return }
        wx.navigateTo({
          url: '/pages/cards/cards',
          fail: () => wx.showToast({ title: '页面打开失败', icon: 'none' })
        })
        break
      case 'switch':
        wx.navigateTo({ url: '/pages/role-switch/role-switch' })
        break
      case 'phone':
        try { wx.makePhoneCall({ phoneNumber: '15228301555', fail: () => {} }) } catch(e) {}
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
    wx.navigateTo({
      url: '/pages/order/order',
      fail: () => wx.showToast({ title: '请稍后重试', icon: 'none' })
    })
  }
})
