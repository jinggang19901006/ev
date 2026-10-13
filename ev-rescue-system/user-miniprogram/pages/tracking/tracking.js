/**
 * pages/tracking/tracking.js - 订单追踪页
 * 显示救援车位置、订单状态流转、充电进度
 */
const api = require('../../utils/api.js')
const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    orderId: '',
    order: null,
    loading: true,
    // 状态步骤
    statusSteps: [
      { key: 'pending', label: '待接单' },
      { key: 'accepted', label: '已接单' },
      { key: 'en_route', label: '前往中' },
      { key: 'arrived', label: '已到达' },
      { key: 'charging', label: '充电中' },
      { key: 'completed', label: '已完成' }
    ],
    currentStep: 0,
    // 评价
    showRateModal: false,
    rating: 5,
    comment: '',
    // 地图
    hasLocation: false,
    markers: [],
    // 轮询
    pollTimer: null
  },

  onLoad(options) {
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      orderId: options.id || ''
    })
    if (options.id) {
      this.loadOrder(options.id)
    }
  },

  onShow() {
    // 恢复轮询
    if (this.data.order && this.isOrderActive(this.data.order.status)) {
      this.startPolling()
    }
  },

  onHide() {
    this.stopPolling()
  },

  onUnload() {
    this.stopPolling()
  },

  /**
   * 加载订单详情
   */
  loadOrder(orderId) {
    api.getOrderDetail(orderId).then(data => {
      this.setData({ order: data, loading: false })
      this.updateStatusStep(data.status)
      this.updateMapData(data)

      // 如果订单活跃，启动轮询
      if (this.isOrderActive(data.status)) {
        this.startPolling()
      } else {
        this.stopPolling()
      }
    }).catch(err => {
      console.error('加载订单失败', err)
      this.setData({ loading: false })
    })
  },

  /**
   * 判断订单是否活跃
   */
  isOrderActive(status) {
    return !['completed', 'cancelled'].includes(status)
  },

  /**
   * 更新状态步骤
   */
  updateStatusStep(status) {
    const statusMap = {
      'pending': 0,
      'accepted': 1,
      'en_route': 2,
      'arrived': 3,
      'charging': 4,
      'completed': 5
    }
    this.setData({ currentStep: statusMap[status] !== undefined ? statusMap[status] : 0 })
  },

  /**
   * 更新地图数据
   */
  updateMapData(order) {
    if (order.pickup_lat && order.pickup_lng) {
      this.setData({
        hasLocation: true,
        markers: [{
          id: 1,
          latitude: order.pickup_lat,
          longitude: order.pickup_lng,
          iconPath: '',
          width: 32,
          height: 32,
          callout: {
            content: '救援地点',
            color: '#e8eef5',
            fontSize: 12,
            borderRadius: 8,
            bgColor: '#0a1628',
            padding: 6,
            display: 'ALWAYS'
          }
        }]
      })
    }
  },

  /**
   * 启动轮询
   */
  startPolling() {
    this.stopPolling()
    this.data.pollTimer = setInterval(() => {
      this.loadOrder(this.data.orderId)
    }, 5000)
  },

  /**
   * 停止轮询
   */
  stopPolling() {
    if (this.data.pollTimer) {
      clearInterval(this.data.pollTimer)
      this.data.pollTimer = null
    }
  },

  /**
   * 下拉刷新
   */
  onPullDownRefresh() {
    if (this.data.orderId) {
      this.loadOrder(this.data.orderId)
    }
    wx.stopPullDownRefresh()
  },

  /**
   * 取消订单
   */
  onCancelOrder() {
    wx.showModal({
      title: '确认取消',
      content: '确定要取消此救援订单吗？',
      confirmText: '确定取消',
      cancelText: '再想想',
      confirmColor: '#ef4444',
      success: (res) => {
        if (res.confirm) {
          api.cancelOrder(this.data.order.id || this.data.order.order_no).then(() => {
            wx.showToast({ title: '订单已取消', icon: 'success' })
            this.loadOrder(this.data.orderId)
          }).catch(err => {
            console.error('取消失败', err)
          })
        }
      }
    })
  },

  /**
   * 支付订单
   */
  onPayOrder() {
    wx.showModal({
      title: '确认支付',
      content: '确认支付救援费用' + this.data.order.total_price + '元？',
      confirmText: '立即支付',
      success: (res) => {
        if (res.confirm) {
          api.payOrder(this.data.order.id || this.data.order.order_no).then(() => {
            wx.showToast({ title: '支付成功', icon: 'success' })
            this.loadOrder(this.data.orderId)
          }).catch(err => {
            console.error('支付失败', err)
          })
        }
      }
    })
  },

  /**
   * 显示评价弹窗
   */
  onShowRateModal() {
    this.setData({ showRateModal: true, rating: 5, comment: '' })
  },

  /**
   * 关闭评价弹窗
   */
  onCloseRateModal() {
    this.setData({ showRateModal: false })
  },

  /**
   * 选择评分
   */
  onChooseRating(e) {
    this.setData({ rating: e.currentTarget.dataset.rating })
  },

  /**
   * 输入评价内容
   */
  onCommentInput(e) {
    this.setData({ comment: e.detail.value })
  },

  /**
   * 提交评价
   */
  onSubmitRating() {
    api.rateOrder(
      this.data.order.id || this.data.order.order_no,
      this.data.rating,
      this.data.comment
    ).then(() => {
      wx.showToast({ title: '评价成功', icon: 'success' })
      this.setData({ showRateModal: false })
      this.loadOrder(this.data.orderId)
    }).catch(err => {
      console.error('评价失败', err)
    })
  },

  /**
   * 拨打司机电话
   */
  onCallDriver() {
    if (this.data.order && this.data.order.driver_phone) {
      wx.makePhoneCall({
        phoneNumber: this.data.order.driver_phone,
        fail: () => {}
      })
    } else {
      wx.showToast({ title: '司机信息暂无', icon: 'none' })
    }
  },

  /**
   * 拨打救援电话
   */
  onCallService() {
    wx.makePhoneCall({
      phoneNumber: app.globalData.servicePhone || '15228301555',
      fail: () => {}
    })
  },

  /**
   * 返回上一页
   */
  onBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) })
  },

  /**
   * 阻止冒泡
   */
  stopPropagation() {}
})
