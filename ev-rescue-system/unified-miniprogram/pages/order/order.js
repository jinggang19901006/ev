/**
 * pages/order/order.js - 下单页（适配 unified API）
 * 选车型、填地址、电量、仪表盘是否不亮、价格预估、确认下单
 */
const api = require('../../utils/api.js')
const time = require('../../utils/time.js')
const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    vehicleTypes: [
      { type: 'small', name: '小型车', desc: '轿车/SUV', dayPrice: 198, nightPrice: 228 },
      { type: 'medium', name: '中型车', desc: '4.2米货车', dayPrice: 238, nightPrice: 268 },
      { type: 'large', name: '大型车', desc: '重卡/大巴', dayPrice: 408, nightPrice: 438 }
    ],
    selectedType: '',
    selectedTypeIndex: -1,
    vehiclePlate: '',
    batteryPercent: 10,
    dashboardOff: false,
    pickupAddress: '',
    pickupLat: 0,
    pickupLng: 0,
    pickupDescription: '',
    distanceKm: 0,
    distanceAvailable: false,
    distanceMessage: '选择救援位置后自动计算',
    extraFee: 0,
    estimate: null,
    isNight: false,
    submitting: false,
    isLoggedIn: false
  },

  onLoad() {
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20,
      isLoggedIn: !!(app.globalData && app.globalData.token) ||
        !!(wx.getStorageSync('uni_token') || wx.getStorageSync('token'))
    })
    this.checkNightTime()
    this.selectVehicleType(0)
  },

  onShow() {
    const token = (app.globalData && app.globalData.token) ||
      wx.getStorageSync('uni_token') || wx.getStorageSync('token')
    this.setData({ isLoggedIn: !!token })
  },

  checkNightTime() {
    const hour = time.getBeijingHour()
    const isNight = hour >= 22 || hour < 6
    this.setData({ isNight })
    const vehicleTypes = this.data.vehicleTypes.map(item => {
      return { ...item, currentPrice: isNight ? item.nightPrice : item.dayPrice }
    })
    this.setData({ vehicleTypes })
  },

  selectVehicleType(e) {
    const index = typeof e === 'number' ? e : e.currentTarget.dataset.index
    const vehicle = this.data.vehicleTypes[index]
    if (!vehicle) return
    this.setData({
      selectedType: vehicle.type,
      selectedTypeIndex: index
    })
    this.estimatePrice()
  },

  onPlateInput(e) {
    this.setData({ vehiclePlate: (e.detail.value || '').toUpperCase() })
  },

  onBatteryChange(e) {
    this.setData({ batteryPercent: e.detail.value })
  },

  onDashboardOffChange(e) {
    this.setData({ dashboardOff: !!e.detail.value })
  },

  chooseLocation() {
    if (!wx.chooseLocation) {
      wx.showToast({ title: '当前环境不支持选择地址，请手动输入', icon: 'none' })
      return
    }
    wx.chooseLocation({
      success: (res) => {
        this.setData({
          pickupAddress: res.address || res.name,
          pickupLat: res.latitude,
          pickupLng: res.longitude
        })
        this.estimatePrice()
      },
      fail: (err) => {
        console.log('取消选择地址或获取失败', err)
      }
    })
  },

  onAddressInput(e) {
    this.setData({ pickupAddress: e.detail.value })
  },

  onDescriptionInput(e) {
    this.setData({ pickupDescription: e.detail.value })
  },

  onExtraFeeInput(e) {
    const val = parseFloat(e.detail.value) || 0
    this.setData({ extraFee: val })
    this.estimatePrice()
  },

  /**
   * 价格预估：优先 api.config.pricing（老新后端已双写 rescue_price），
   * 失败兜底本地按 5km 一口价+超出里程模型，字段结构匹配原 estimate-card。
   */
  async estimatePrice() {
    if (!this.data.selectedType) return

    const data = {
      vehicle_type: this.data.selectedType,
      vehicleType: this.data.selectedType,
      pickup_lat: this.data.pickupLat,
      pickupLat: this.data.pickupLat,
      pickup_lng: this.data.pickupLng,
      pickupLng: this.data.pickupLng,
      extra_fee: this.data.extraFee || 0,
      extraFee: this.data.extraFee || 0,
      is_night: this.data.isNight ? 1 : 0
    }

    try {
      let result = null
      let routeError = null
      // 优先走 orders.estimate（POST，带距离/额外费字段 → 真实超出里程费+押金）
      if (api.orders && typeof api.orders.estimate === 'function') {
        try {
          result = await api.orders.estimate(data)
        } catch (e) {
          routeError = e
          result = null
        }
      }
      if (!result && this.data.pickupLat && this.data.pickupLng && routeError) throw routeError
      // 兜底：config.pricing（GET，返回系统定价基准，不含距离/额外费信息）
      if (!result && api.config && typeof api.config.pricing === 'function') {
        try {
          result = await api.config.pricing()
        } catch (e) { result = null }
      }
      // api.js request 成功时已 resolve(body.data)，此处不再二次剥层 result.data（避免把订单对象剥空）

      if (result && (result.total_price != null || result.totalPrice != null || result.rescue_price != null)) {
        const total = result.total_price != null ? Number(result.total_price)
          : (result.totalPrice != null ? Number(result.totalPrice)
          : (result.rescue_price != null ? Number(result.rescue_price) : 0))
        const base = result.base_price != null ? Number(result.base_price) : total
        const distFee = result.distance_fee != null ? Number(result.distance_fee) : 0
        const extraF = result.extra_fee_total != null
          ? Number(result.extra_fee_total)
          : (result.extraFee != null ? Number(result.extraFee) : (this.data.extraFee || 0))
        const baseDist = result.base_distance_km != null ? Number(result.base_distance_km) : 5
        const extraPer = result.extra_per_km != null ? Number(result.extra_per_km) : 10

        this.setData({
          distanceKm: Number(result.distance_km || 0),
          distanceAvailable: !!result.distance_available,
          distanceMessage: result.distance_message || '',
          estimate: {
            basePrice: Math.round(base * 100) / 100,
            distanceFee: Math.round(distFee * 100) / 100,
            extraFee: Math.round(extraF * 100) / 100,
            totalPrice: Math.round(total * 100) / 100,
            isNight: this.data.isNight ? 1 : 0,
            baseDistance: baseDist,
            extraPerKm: extraPer
          }
        })
        return
      }
      throw new Error('no pricing data')
    } catch (err) {
      if (this.data.pickupLat && this.data.pickupLng) {
        this.setData({
          estimate: null,
          distanceKm: 0,
          distanceAvailable: false,
          distanceMessage: (err && err.message) || '腾讯地图路线计算失败，请稍后重试'
        })
        return
      }
      // 本地兜底：5km 一口价基准 + 超出 10/km + 夜间+30
      const vehicle = this.data.vehicleTypes[this.data.selectedTypeIndex]
      if (!vehicle) return
      let basePrice = this.data.isNight ? vehicle.nightPrice : vehicle.dayPrice
      const baseDistance = 5
      const extraPerKm = 10
      let distanceFee = 0
      if (this.data.distanceKm > baseDistance) {
        distanceFee = (this.data.distanceKm - baseDistance) * extraPerKm
      }
      const extraFeeNum = this.data.extraFee || 0
      const totalPrice = basePrice + distanceFee + extraFeeNum
      this.setData({
        distanceAvailable: false,
        distanceMessage: '暂时无法获取司机位置，提交订单时将重新校验',
        estimate: {
          basePrice: Math.round(basePrice * 100) / 100,
          distanceFee: Math.round(distanceFee * 100) / 100,
          extraFee: Math.round(extraFeeNum * 100) / 100,
          totalPrice: Math.round(totalPrice * 100) / 100,
          isNight: this.data.isNight ? 1 : 0,
          baseDistance,
          extraPerKm
        }
      })
    }
  },

  async onSubmitOrder() {
    // 未登录跳 auth-entry（不再静默登录，统一账号要求走 auth-entry 显式注册）
    const token = (app.globalData && app.globalData.token) ||
      wx.getStorageSync('uni_token') || wx.getStorageSync('token')
    if (!token) {
      wx.showToast({ title: '请先登录再下单', icon: 'none' })
      setTimeout(() => {
        wx.redirectTo({ url: '/pages/auth-entry/auth-entry' })
      }, 800)
      return
    }

    if (!this.data.selectedType) {
      wx.showToast({ title: '请选择车型', icon: 'none' })
      return
    }
    if (!this.data.pickupAddress || !this.data.pickupLat || !this.data.pickupLng) {
      wx.showToast({ title: '请通过地图选择救援位置', icon: 'none' })
      return
    }

    this.setData({ submitting: true })

    const orderData = {
      vehicle_type: this.data.selectedType,
      vehicleType: this.data.selectedType,
      vehicle_plate: this.data.vehiclePlate,
      vehiclePlate: this.data.vehiclePlate,
      battery_percent: this.data.batteryPercent,
      batteryPercent: this.data.batteryPercent,
      dashboard_off: this.data.dashboardOff ? 1 : 0,
      dashboardOff: !!this.data.dashboardOff,
      pickup_lat: this.data.pickupLat,
      pickupLat: this.data.pickupLat,
      pickup_lng: this.data.pickupLng,
      pickupLng: this.data.pickupLng,
      pickup_address: this.data.pickupAddress,
      pickupAddress: this.data.pickupAddress,
      pickup_description: this.data.pickupDescription,
      pickupDescription: this.data.pickupDescription,
      extra_fee: this.data.extraFee || 0,
      extraFee: this.data.extraFee || 0,
      is_night: this.data.isNight ? 1 : 0
    }

    try {
      let order = (api.orders && typeof api.orders.create === 'function')
        ? await api.orders.create(orderData)
        : await (api.createOrder ? api.createOrder(orderData) : Promise.reject(new Error('no create api')))
      // api.js request 成功时已 resolve(body.data) = normOrder(order) 对象；
      // 严禁再二次剥 order.data（否则 body.data.data=undefined → 订单号提取空）
      const orderId = order && (
        order.id != null ? order.id :
          (order.order_no || order.order_id || order.orderId || order.orderNo || '')
      )
      if (!orderId) {
        console.error('[orders.create] 返回体结构异常：', JSON.stringify(order).slice(0, 400))
        throw new Error('订单创建异常：未返回订单号（返回体无 id/order_no 等字段）')
      }

      wx.showToast({ title: '下单成功，请支付押金', icon: 'success' })
      // 跳转支付押金页：同时传 id + orderId 双参数，兼容其他入口的取值习惯
      // （后端 /:id/detail 是 WHERE o.id=? OR o.order_no=?，两值都能查）
      setTimeout(() => {
        wx.redirectTo({
          url: '/pages/payment-pay/payment-pay?id=' + orderId + '&orderId=' + orderId
        })
      }, 1000)
    } catch (err) {
      console.error('下单失败', err)
      const msg = (err && err.data && (err.data.message || err.data.msg))
        || (err && err.errMsg)
        || (err && err.message)
        || '下单失败，请重试'
      wx.showToast({ title: String(msg).slice(0, 24), icon: 'none' })
      if (err && (err.statusCode === 401 || /unauth|登录|信用/i.test(String(msg)))) {
        setTimeout(() => wx.redirectTo({ url: '/pages/auth-entry/auth-entry' }), 800)
      }
    } finally {
      this.setData({ submitting: false })
    }
  },

  onBack() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({
          url: '/pages/home-user/home-user',
          fail: () => wx.reLaunch({ url: '/pages/home-user/home-user' })
        })
      }
    })
  }
})
