/**
 * pages/order/order.js - 下单页
 * 选车型、填地址、电量、仪表盘是否不亮、价格预估、确认下单
 */
const api = require('../../utils/api.js')
const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    // 车型选择
    vehicleTypes: [
      { type: 'small', name: '小型车', desc: '轿车/SUV', dayPrice: 198, nightPrice: 228 },
      { type: 'medium', name: '中型车', desc: '4.2米货车', dayPrice: 238, nightPrice: 268 },
      { type: 'large', name: '大型车', desc: '重卡/大巴', dayPrice: 408, nightPrice: 438 }
    ],
    selectedType: '',
    selectedTypeIndex: -1,
    // 表单数据
    vehiclePlate: '',
    batteryPercent: 10,
    dashboardOff: false,
    pickupAddress: '',
    pickupLat: 0,
    pickupLng: 0,
    pickupDescription: '',
    distanceKm: 0,
    extraFee: 0,
    // 价格预估
    estimate: null,
    isNight: false,
    submitting: false,
    // 登录状态
    isLoggedIn: false
  },

  onLoad() {
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      isLoggedIn: !!app.globalData.token
    })
    this.checkNightTime()
    // 默认选中第一个车型
    this.selectVehicleType(0)
  },

  onShow() {
    this.setData({ isLoggedIn: !!app.globalData.token })
  },

  /**
   * 判断是否夜间时段
   */
  checkNightTime() {
    const hour = new Date().getHours()
    const isNight = hour >= 22 || hour < 6
    this.setData({ isNight })

    // 更新车型价格显示
    const vehicleTypes = this.data.vehicleTypes.map(item => {
      item.currentPrice = isNight ? item.nightPrice : item.dayPrice
      return item
    })
    this.setData({ vehicleTypes })
  },

  /**
   * 选择车型
   */
  selectVehicleType(e) {
    const index = typeof e === 'number' ? e : e.currentTarget.dataset.index
    const vehicle = this.data.vehicleTypes[index]
    this.setData({
      selectedType: vehicle.type,
      selectedTypeIndex: index
    })
    // 选完车型立即预估价格
    this.estimatePrice()
  },

  /**
   * 输入车牌号
   */
  onPlateInput(e) {
    this.setData({ vehiclePlate: e.detail.value.toUpperCase() })
  },

  /**
   * 电量滑块变化
   */
  onBatteryChange(e) {
    this.setData({ batteryPercent: e.detail.value })
  },

  /**
   * 仪表盘开关变化
   */
  onDashboardOffChange(e) {
    this.setData({ dashboardOff: e.detail.value })
  },

  /**
   * 选择地址（调用微信地址选择）
   */
  chooseLocation() {
    wx.chooseLocation({
      success: (res) => {
        this.setData({
          pickupAddress: res.address || res.name,
          pickupLat: res.latitude,
          pickupLng: res.longitude
        })
        // 选择地址后自动预估距离（简单估算，实际应由后端计算）
        this.estimateDistance()
      },
      fail: (err) => {
        console.log('取消选择地址或获取失败', err)
      }
    })
  },

  /**
   * 手动输入地址
   */
  onAddressInput(e) {
    this.setData({ pickupAddress: e.detail.value })
  },

  /**
   * 地址描述输入
   */
  onDescriptionInput(e) {
    this.setData({ pickupDescription: e.detail.value })
  },

  /**
   * 距离输入
   */
  onDistanceInput(e) {
    let val = parseFloat(e.detail.value) || 0
    // 距离校验：0-200km合理范围
    if (val > 200) {
      wx.showToast({ title: '距离不能超过200km', icon: 'none' })
      val = 200
    }
    this.setData({ distanceKm: val })
    this.estimatePrice()
  },

  /**
   * 额外费用输入
   */
  onExtraFeeInput(e) {
    const val = parseFloat(e.detail.value) || 0
    this.setData({ extraFee: val })
    this.estimatePrice()
  },

  /**
   * 简单估算距离（基于经纬度与绵阳市中心的距离）
   */
  estimateDistance() {
    if (!this.data.pickupLat || !this.data.pickupLng) return
    // 绵阳市中心坐标
    const mianyangLat = 31.4677
    const mianyangLng = 104.6796
    let dist = this.calcDistance(mianyangLat, mianyangLng, this.data.pickupLat, this.data.pickupLng)
    // 距离校验：直线距离乘1.3作为道路距离估算，限制在200km内
    dist = Math.round(dist * 1.3)
    if (dist > 200) {
      wx.showToast({ title: '距离超出服务范围(200km)', icon: 'none' })
      dist = 200
    }
    this.setData({ distanceKm: dist })
    this.estimatePrice()
  },

  /**
   * 计算两点间距离（km）
   */
  calcDistance(lat1, lng1, lat2, lng2) {
    const R = 6371
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLng = (lng2 - lng1) * Math.PI / 180
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  },

  /**
   * 价格预估
   */
  estimatePrice() {
    if (!this.data.selectedType) return

    const data = {
      vehicleType: this.data.selectedType,
      distanceKm: this.data.distanceKm,
      extraFee: this.data.extraFee
    }

    api.estimatePrice(data).then(result => {
      this.setData({ estimate: result })
    }).catch(err => {
      // 后端预估失败，前端计算
      const vehicle = this.data.vehicleTypes[this.data.selectedTypeIndex]
      if (vehicle) {
        const basePrice = this.data.isNight ? vehicle.nightPrice : vehicle.dayPrice
        let distanceFee = 0
        if (this.data.distanceKm > 30) {
          distanceFee = (this.data.distanceKm - 30) * 5
        }
        const totalPrice = basePrice + distanceFee + (this.data.extraFee || 0)
        this.setData({
          estimate: {
            basePrice,
            distanceFee: Math.round(distanceFee * 100) / 100,
            extraFee: this.data.extraFee || 0,
            totalPrice: Math.round(totalPrice * 100) / 100,
            isNight: this.data.isNight ? 1 : 0,
            baseDistance: 30,
            extraPerKm: 5
          }
        })
      }
    })
  },

  /**
   * 自动静默登录（复用app.js缓存的loginCode，避免创建多个用户）
   */
  autoLogin() {
    return new Promise((resolve) => {
      const doLogin = (code) => {
        const openid = code || ('wx_user_' + Date.now())
        api.login({
          openid: openid,
          phone: '',
          nickname: '微信用户',
          avatar: ''
        }).then(data => {
          const token = data.token || (data.data && data.data.token) || ''
          const user = data.user || (data.data && data.data.user) || {}
          wx.setStorageSync('token', token)
          app.globalData.token = token
          app.globalData.userInfo = user
          this.setData({ isLoggedIn: true })
          resolve(true)
        }).catch(() => {
          resolve(false)
        })
      }

      // 优先使用app.js已缓存的loginCode
      if (app.globalData.loginCode) {
        doLogin(app.globalData.loginCode)
      } else {
        wx.login({
          success: (res) => {
            app.globalData.loginCode = res.code
            doLogin(res.code)
          },
          fail: () => {
            resolve(false)
          }
        })
      }
    })
  },

  /**
   * 确认下单
   */
  async onSubmitOrder() {
    // 未登录时自动静默登录
    if (!app.globalData.token) {
      const loginOk = await this.autoLogin()
      if (!loginOk) {
        wx.showToast({ title: '登录失败，请重试', icon: 'none' })
        return
      }
    }

    // 表单验证
    if (!this.data.selectedType) {
      wx.showToast({ title: '请选择车型', icon: 'none' })
      return
    }
    if (!this.data.pickupAddress) {
      wx.showToast({ title: '请填写救援地址', icon: 'none' })
      return
    }

    this.setData({ submitting: true })

    const orderData = {
      vehicleType: this.data.selectedType,
      vehiclePlate: this.data.vehiclePlate,
      batteryPercent: this.data.batteryPercent,
      dashboardOff: this.data.dashboardOff,
      pickupLat: this.data.pickupLat,
      pickupLng: this.data.pickupLng,
      pickupAddress: this.data.pickupAddress,
      pickupDescription: this.data.pickupDescription,
      distanceKm: this.data.distanceKm,
      extraFee: this.data.extraFee
    }

    api.createOrder(orderData).then(order => {
      wx.showToast({ title: '下单成功', icon: 'success' })
      // 跳转到追踪页
      setTimeout(() => {
        wx.redirectTo({
          url: '/pages/tracking/tracking?id=' + (order.id || order.order_no)
        })
      }, 1000)
    }).catch(err => {
      console.error('下单失败', err)
    }).finally(() => {
      this.setData({ submitting: false })
    })
  },

  /**
   * 返回上一页
   */
  onBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) })
  }
})
