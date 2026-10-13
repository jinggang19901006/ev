/**
 * pages/orders/orders.js - 订单列表页
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
    // 状态映射
    statusMap: {
      'pending': { label: '待接单', class: 'tag-pending' },
      'accepted': { label: '已接单', class: 'tag-accepted' },
      'en_route': { label: '前往中', class: 'tag-en_route' },
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

    api.getUserOrders(this.data.page, this.data.pageSize).then(data => {
      const list = data.list || []
      const total = data.total || 0

      // 格式化订单数据
      const formattedOrders = list.map(order => {
        return {
          ...order,
          statusLabel: this.data.statusMap[order.status] ? this.data.statusMap[order.status].label : order.status,
          statusClass: this.data.statusMap[order.status] ? this.data.statusMap[order.status].class : '',
          vehicleLabel: this.data.vehicleMap[order.vehicle_type] || order.vehicle_type,
          isActive: !['completed', 'cancelled'].includes(order.status)
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
   * 点击订单 - 跳转到追踪页
   */
  onOrderTap(e) {
    const order = e.currentTarget.dataset.order
    wx.navigateTo({
      url: '/pages/tracking/tracking?id=' + (order.id || order.order_no)
    })
  },

  /**
   * 前往下单
   */
  goToOrder() {
    wx.navigateTo({ url: '/pages/order/order' })
  },

  /**
   * 前往登录
   */
  goToLogin() {
    wx.switchTab({ url: '/pages/mine/mine' })
  }
})
