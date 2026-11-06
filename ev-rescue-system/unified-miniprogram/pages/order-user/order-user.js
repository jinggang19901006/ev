/**
 * pages/order-user/order-user.js - 用户订单列表
 * 1:1 回退老 user-miniprogram/pages/orders/orders.js，仅替换 API 调用 + 导航路径
 * 后端 normOrder 已双写 total_amount/vehicle_size_cn/pickup_address 等字段，老模板可直接渲染
 */
const api = require('../../utils/api.js')
const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    orders: [],
    displayOrders: [],
    loading: true,
    loadingMore: false,
    page: 1,
    pageSize: 20,
    total: 0,
    hasMore: true,
    // 筛选
    activeTab: 'all',
    tabs: [
      { key: 'all', label: '全部' },
      { key: 'active', label: '进行中' },
      { key: 'completed', label: '已完成' }
    ],
    // 登录状态
    isLoggedIn: false,
    // 状态映射（老前端用的英文字段 + 中文 label，后端 *_cn 仅作兼容兜底，不改动老映射）
    statusMap: {
      'pending': { label: '待接单', class: 'tag-pending' },
      'accepted': { label: '已接单', class: 'tag-accepted' },
      'en_route': { label: '前往中', class: 'tag-en_route' },
      'dispatched': { label: '前往中', class: 'tag-en_route' },
      'arrived': { label: '已到达', class: 'tag-arrived' },
      'charging': { label: '充电中', class: 'tag-charging' },
      'completed': { label: '已完成', class: 'tag-completed' },
      'cancelled': { label: '已取消', class: 'tag-cancelled' }
    },
    vehicleMap: {
      'small': '小型车',
      'medium': '中型车',
      'large': '大型车'
    }
  },

  onLoad() {
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      isLoggedIn: !!app.globalData.token
    })
    if (this.data.isLoggedIn) {
      this.loadOrders()
    } else {
      this.setData({ loading: false })
    }
  },

  onShow() {
    app.syncTabBar(this)
    const loggedIn = !!app.globalData.token
    this.setData({ isLoggedIn: loggedIn })
    if (loggedIn) {
      this.refreshOrders()
    } else {
      this.setData({ loading: false })
    }
  },

  /**
   * 加载订单
   */
  loadOrders() {
    if (!app.globalData.token) {
      this.setData({ loading: false, isLoggedIn: false })
      return
    }

    // 新统一 API: user.orders(page, pageSize) -> 返回 {list,total,page}，老代码可直接兼容
    api.user.orders(this.data.page, this.data.pageSize).then(data => {
      const list = Array.isArray(data) ? data : (data.list || [])
      const total = data.total != null ? data.total : list.length

      // 格式化订单数据 —— 兼容后端 normOrder 双写字段（total_amount ↔ total_price, pickup_address ↔ address）
      const formattedOrders = list.map(order => {
        const stat = order.status || 'pending'
        const statInfo = this.data.statusMap[stat] || { label: order.status_cn || stat, class: '' }
        const vehType = order.vehicle_type || order.vehicleSize || ''
        return {
          ...order,
          // 价格字段双兼容: 老模板用 total_price, 后端写 total_amount
          total_price: order.total_price != null ? order.total_price : (order.total_amount != null ? order.total_amount : 0),
          // pickup_address 双兼容
          pickup_address: order.pickup_address || order.address || '暂无地址',
          statusLabel: order.status_cn || statInfo.label,
          statusClass: statInfo.class,
          vehicleLabel: order.vehicle_size_cn || this.data.vehicleMap[vehType] || order.vehicle_type || '未知',
          isActive: !['completed', 'cancelled'].includes(stat),
          canRate: stat === 'completed' && order.payment_status === 'paid' && !order.user_rating
        }
      })

      // 合并数据（分页时追加）
      let allOrders
      if (this.data.page === 1) {
        allOrders = formattedOrders
      } else {
        allOrders = this.data.orders.concat(formattedOrders)
      }

      // 根据tab筛选显示列表
      let displayOrders = allOrders
      if (this.data.activeTab === 'active') {
        displayOrders = allOrders.filter(o => o.isActive)
      } else if (this.data.activeTab === 'completed') {
        displayOrders = allOrders.filter(o => o.status === 'completed')
      }

      this.setData({
        orders: allOrders,
        displayOrders: displayOrders,
        loading: false,
        loadingMore: false,
        total: total,
        hasMore: allOrders.length < total
      })
    }).catch(err => {
      console.error('加载订单失败', err)
      wx.showToast({ title: '加载订单失败', icon: 'none' })
      this.setData({ loading: false, loadingMore: false })
    })
  },

  /**
   * 切换tab
   */
  onTabChange(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.activeTab) return
    this.setData({ activeTab: tab })

    // 客户端筛选现有数据
    let displayOrders = this.data.orders
    if (tab === 'active') {
      displayOrders = this.data.orders.filter(o => o.isActive)
    } else if (tab === 'completed') {
      displayOrders = this.data.orders.filter(o => o.status === 'completed')
    }
    this.setData({ displayOrders })
  },

  /**
   * 刷新订单
   */
  refreshOrders() {
    this.setData({ page: 1, loading: true })
    this.loadOrders()
  },

  /**
   * 下拉刷新
   */
  onPullDownRefresh() {
    this.refreshOrders()
    wx.stopPullDownRefresh()
  },

  /**
   * 上拉加载更多
   */
  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore) return
    this.setData({
      loadingMore: true,
      page: this.data.page + 1
    })
    this.loadOrders()
  },

  /**
   * 点击订单 - 按订单状态跳转：
   * 进行中+押金未付 -> 支付押金页；进行中+押金已付 -> 支付页展示"押金已支付/派单中"态
   * 已完成+尾款未付 -> 尾款支付页；已完成+已结清 -> 支付页展示"已结清"态
   */
  onOrderTap(e) {
    const order = e.currentTarget.dataset.order
    if (!order || !order.id) return
    const stat = order.status || 'pending'
    if (stat === 'completed') {
      wx.navigateTo({ url: '/pages/payment-pay/payment-pay?id=' + order.id + '&stage=final' })
      return
    }
    if (order.isActive) {
      wx.navigateTo({ url: '/pages/payment-pay/payment-pay?id=' + order.id })
      return
    }
    if (stat === 'cancelled') {
      wx.showToast({ title: '该订单已取消', icon: 'none' })
    }
  },

  goRate(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/payment-pay/payment-pay?id=' + id + '&stage=final' })
  },

  /**
   * 前往下单
   */
  goToOrder() {
    wx.navigateTo({ url: '/pages/order/order' })
  },

  /**
   * 前往登录（本页是 tabBar 页，必须 reLaunch）
   */
  goToLogin() {
    wx.reLaunch({ url: '/pages/auth-entry/auth-entry' })
  }
})
