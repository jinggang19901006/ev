/**
 * pages/home/home.js - 首页
 * 展示服务信息、一键呼叫救援按钮、定价展示
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
    api.getServiceInfo().then(data => {
      this.setData({ serviceInfo: data })
    }).catch(() => {
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
    api.getPricing().then(data => {
      // data是数组，每项包含 vehicle_type, vehicle_name, day_price, night_price, base_distance_km, extra_per_km
      const pricingList = (data || []).map(item => {
        return {
          type: item.vehicle_type,
          name: item.vehicle_name,
          dayPrice: item.day_price,
          nightPrice: item.night_price,
          baseDistance: item.base_distance_km,
          extraPerKm: item.extra_per_km,
          currentPrice: this.data.isNight ? item.night_price : item.day_price
        }
      })
      this.setData({ pricingList })
    }).catch(() => {
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
    api.getActiveOrder().then(data => {
      this.setData({ activeOrder: data })
    }).catch(() => {
      this.setData({ activeOrder: null })
    })
  },

  /**
   * 一键呼叫救援 - 跳转到下单页
   */
  onRescue() {
    // 检查是否有进行中的订单
    if (this.data.activeOrder) {
      wx.showModal({
        title: '提示',
        content: '您有正在进行中的救援订单，是否查看？',
        confirmText: '查看订单',
        cancelText: '继续下单',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({
              url: '/pages/tracking/tracking?id=' + (this.data.activeOrder.id || this.data.activeOrder.order_no)
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
      wx.navigateTo({
        url: '/pages/tracking/tracking?id=' + (this.data.activeOrder.id || this.data.activeOrder.order_no)
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
    wx.switchTab({ url: '/pages/orders/orders' })
  }
})
