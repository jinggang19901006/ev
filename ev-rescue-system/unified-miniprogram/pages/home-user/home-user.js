/**
 * pages/home-user/home-user.js - 用户端首页
 * 1:1 回退老 user-miniprogram/pages/home/home.js，仅替换 API 调用和导航路径
 */
const api = require('../../utils/api.js')
const app = getApp()

Page({
  data: {
    serviceInfo: null,
    pricingList: [],
    isNight: false,
    activeOrder: null,
    loading: false,
    statusBarHeight: 20
  },

  onLoad() {
    // 获取状态栏高度用于自定义导航栏适配
    this.setData({ statusBarHeight: app.globalData.statusBarHeight })
    this.checkNightTime()
    this.loadServiceInfo()
    this.loadPricing()
  },

  onShow() {
    app.syncTabBar(this)
    this.checkNightTime()
    // 检查是否有进行中的订单
    if (app.globalData.token) {
      this.checkActiveOrder()
    }
  },

  /**
   * 判断是否夜间时段 (22:00 - 次日06:00)
   */
  checkNightTime() {
    const hour = new Date().getHours()
    this.setData({ isNight: hour >= 22 || hour < 6 })
  },

  /**
   * 加载服务信息
   */
  loadServiceInfo() {
    api.config.serviceInfo().then(data => {
      this.setData({ serviceInfo: data })
    }).catch((err) => {
      console.error('loadServiceInfo error:', err)
      // 使用默认数据
      this.setData({
        serviceInfo: {
          name: '新能源应急充电救援',
          power: '60kW大功率直流移动补电',
          area: '绵阳及周边30公里',
          phone: '15228301555',
          hours: '24小时服务',
          features: [
            '60kW大功率直流快充',
            '30分钟内快速到达',
            '上门救援，无需拖车',
            '专业团队，安全可靠'
          ]
        }
      })
    })
  },

  /**
   * 加载定价配置
   */
  loadPricing() {
    api.config.pricing().then(data => {
      // 新后端返回字段: vehicle_type, vehicle_name, day_price, night_price, base_distance_km, extra_per_km
      const list = Array.isArray(data) ? data : (data.list || data.pricing || [])
      const pricingList = list.map(item => {
        return {
          type: item.vehicle_type || item.type,
          name: item.vehicle_name || item.name,
          dayPrice: item.day_price != null ? item.day_price : item.dayPrice,
          nightPrice: item.night_price != null ? item.night_price : item.nightPrice,
          baseDistance: item.base_distance_km != null ? item.base_distance_km : item.baseDistance,
          extraPerKm: item.extra_per_km != null ? item.extra_per_km : item.extraPerKm,
          currentPrice: this.data.isNight
            ? (item.night_price != null ? item.night_price : item.nightPrice)
            : (item.day_price != null ? item.day_price : item.dayPrice)
        }
      })
      this.setData({ pricingList })
    }).catch((err) => {
      console.error('loadPricing error:', err)
      // 使用内置默认定价
      this.setData({
        pricingList: [
          { type: 'small', name: '小型车', dayPrice: 198, nightPrice: 228, baseDistance: 30, extraPerKm: 5, currentPrice: this.data.isNight ? 228 : 198 },
          { type: 'medium', name: '中型车(4.2米货车)', dayPrice: 238, nightPrice: 268, baseDistance: 30, extraPerKm: 5, currentPrice: this.data.isNight ? 268 : 238 },
          { type: 'large', name: '大型车(重卡)', dayPrice: 408, nightPrice: 438, baseDistance: 30, extraPerKm: 5, currentPrice: this.data.isNight ? 438 : 408 }
        ]
      })
    })
  },

  /**
   * 检查进行中的订单
   */
  checkActiveOrder() {
    api.orders.active().then(data => {
      // 兼容空返回和对象包装
      const active = data && !Array.isArray(data) ? (data.order || data) : null
      this.setData({ activeOrder: active || null })
    }).catch((err) => {
      console.error('checkActiveOrder error:', err)
      this.setData({ activeOrder: null })
    })
  },

  /**
   * 一键呼叫救援 - 跳转到下单页
   */
  onRescue() {
    // 未登录拦截（token 三兜底）
    const token = app.globalData.token || wx.getStorageSync('uni_token') || wx.getStorageSync('token')
    if (!token) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      setTimeout(() => {
        // tabBar 页跳登录必须 reLaunch
        wx.reLaunch({ url: '/pages/auth-entry/auth-entry' })
      }, 600)
      return
    }
    // 检查是否有进行中的订单
    if (this.data.activeOrder) {
      wx.showModal({
        title: '提示',
        content: '您有正在进行中的救援订单，是否查看？',
        confirmText: '查看订单',
        cancelText: '继续下单',
        success: (res) => {
          if (res.confirm) {
            // order-user 是 tabBar 页，必须 switchTab（navigateTo 会静默失败）
            wx.switchTab({
              url: '/pages/order-user/order-user',
              fail: () => wx.reLaunch({ url: '/pages/order-user/order-user' })
            })
          } else {
            wx.navigateTo({ url: '/pages/order/order' })
          }
        }
      })
    } else {
      wx.navigateTo({ url: '/pages/order/order' })
    }
  },

  /**
   * 查看进行中的订单
   */
  onViewActiveOrder() {
    if (this.data.activeOrder) {
      // order-user 是 tabBar 页，必须 switchTab（navigateTo 会静默失败）
      wx.switchTab({
        url: '/pages/order-user/order-user',
        fail: () => wx.reLaunch({ url: '/pages/order-user/order-user' })
      })
    }
  },

  /**
   * 拨打救援电话
   */
  onCallPhone() {
    const phone = this.data.serviceInfo ? this.data.serviceInfo.phone : '15228301555'
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: () => {}
    })
  },

  /**
   * 跳转到订单列表
   */
  goToOrders() {
    wx.switchTab({ url: '/pages/order-user/order-user' })
  }
})
