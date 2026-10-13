// pages/mine/mine.js - 个人中心
const api = require('../../utils/api.js');
const app = getApp();

Page({
  data: {
    // 司机信息
    driver: null,
    // 司机状态
    driverStatus: 'offline',
    // 收入统计
    earnings: {
      today: { count: 0, amount: 0 },
      month: { count: 0, amount: 0 },
      total: { count: 0, amount: 0 }
    },
    // 订单历史
    orders: [],
    // 订单历史页码
    orderPage: 1,
    // 是否还有更多
    hasMore: true,
    // 状态栏高度
    statusBarHeight: 20,
    // 导航栏高度
    navBarHeight: 44,
    // 是否正在加载
    loading: false,
    // 是否正在切换状态
    toggling: false,
    // 状态选项
    statusOptions: [
      { value: 'online', label: '在线', desc: '接收新订单' },
      { value: 'busy', label: '忙碌', desc: '服务中' },
      { value: 'offline', label: '离线', desc: '不接收订单' }
    ],
    // 是否显示状态选择
    showStatusPicker: false,
    // 当前tab(收入/订单)
    activeTab: 'earnings'
  },

  onLoad() {
    const statusBarHeight = app.globalData.statusBarHeight || 20;
    const menuButton = app.globalData.menuButton || {};
    const navBarHeight = menuButton.height ?
      (menuButton.top - statusBarHeight) * 2 + menuButton.height : 44;

    this.setData({ statusBarHeight, navBarHeight });
  },

  onShow() {
    if (!app.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }

    const driver = app.globalData.driver || wx.getStorageSync('driver');
    const status = app.globalData.status || wx.getStorageSync('driverStatus') || 'offline';

    this.setData({
      driver,
      driverStatus: status
    });

    // 加载数据
    this.loadDriverInfo();
    this.loadEarnings();
    this.loadOrders(true);
  },

  /**
   * 加载司机信息
   */
  async loadDriverInfo() {
    try {
      const info = await api.getDriverInfo();
      if (info) {
        const driver = info.driver || info;
        this.setData({ driver });
        app.globalData.driver = driver;
        wx.setStorageSync('driver', driver);
      }
    } catch (err) {
      console.error('获取司机信息失败:', err);
    }
  },

  /**
   * 加载收入统计
   */
  async loadEarnings() {
    try {
      const result = await api.getEarnings();
      const earnings = this.formatEarnings(result);
      this.setData({ earnings });
    } catch (err) {
      console.error('获取收入统计失败:', err);
    }
  },

  /**
   * 格式化收入数据
   * 后端返回 { today: { orders, earnings }, month: { orders, earnings }, total: { orders, earnings } }
   */
  formatEarnings(data) {
    const today = data.today || {};
    const month = data.month || {};
    const total = data.total || {};

    return {
      today: {
        count: today.orders != null ? today.orders : (today.count || 0),
        amount: today.earnings != null ? today.earnings : (today.amount || 0)
      },
      month: {
        count: month.orders != null ? month.orders : (month.count || 0),
        amount: month.earnings != null ? month.earnings : (month.amount || 0)
      },
      total: {
        count: total.orders != null ? total.orders : (total.count || 0),
        amount: total.earnings != null ? total.earnings : (total.amount || 0)
      }
    };
  },

  /**
   * 加载订单历史
   */
  async loadOrders(reset) {
    if (this.data.loading) return;

    const page = reset ? 1 : this.data.orderPage;
    if (!reset && !this.data.hasMore) return;

    this.setData({ loading: true });

    try {
      const result = await api.getDriverOrders(page);
      const orderList = Array.isArray(result) ? result :
        (result.list || result.orders || result.data || []);

      const newOrders = orderList.map(order => this.formatOrder(order));

      if (reset) {
        this.setData({
          orders: newOrders,
          orderPage: 1,
          hasMore: orderList.length >= 10,
          loading: false
        });
      } else {
        this.setData({
          orders: [...this.data.orders, ...newOrders],
          orderPage: page + 1,
          hasMore: orderList.length >= 10,
          loading: false
        });
      }
    } catch (err) {
      console.error('加载订单历史失败:', err);
      this.setData({ loading: false });
    }
  },

  /**
   * 格式化订单数据
   */
  formatOrder(order) {
    // 后端返回 total_price，兼容各种字段名
    const rawPrice = order.total_price != null ? order.total_price : (order.price || order.amount || 0);
    const price = typeof rawPrice === 'number' ? rawPrice : (parseFloat(rawPrice) || 0);
    // 后端返回 vehicle_type，映射为中文
    const vehicleTypeMap = {
      'small': '小型车',
      'medium': '中型车(4.2米)',
      'large': '大型车(重卡)'
    };
    // 从全局获取commission_rate，不再硬编码0.8
    const commissionRate = (app.globalData.driver && app.globalData.driver.commission_rate) || 0.2;
    const driverRate = 1 - commissionRate;
    // 如果订单已完成且有driver_income，直接用；否则计算
    const driverIncome = order.driver_income != null
      ? Number(order.driver_income)
      : Math.round(price * driverRate * 100) / 100;
    return {
      ...order,
      vehicleModel: vehicleTypeMap[order.vehicle_type] || order.vehicle_type || '未知车型',
      address: order.pickup_address || order.address || '未知地址',
      price: price,
      driverIncome: driverIncome.toFixed(2),
      statusText: this.getStatusText(order.status),
      statusClass: this.getStatusClass(order.status),
      createTimeText: this.formatTime(order.created_at || order.createTime || order.createdAt)
    };
  },

  getStatusText(status) {
    const map = {
      'pending': '待接单',
      'accepted': '已接单',
      'en_route': '前往中',
      'arrived': '已到达',
      'charging': '充电中',
      'completed': '已完成',
      'cancelled': '已取消'
    };
    return map[status] || '未知';
  },

  getStatusClass(status) {
    return 'tag-' + (status || 'pending').replace('_', '-');
  },

  formatTime(timeStr) {
    if (!timeStr) return '';
    try {
      const date = new Date(timeStr);
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return month + '/' + day + ' ' + hours + ':' + minutes;
    } catch (e) {
      return '';
    }
  },

  /**
   * 切换tab
   */
  onTabChange(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
  },

  /**
   * 显示状态选择
   */
  onShowStatusPicker() {
    this.setData({ showStatusPicker: true });
  },

  /**
   * 关闭状态选择
   */
  onCloseStatusPicker() {
    this.setData({ showStatusPicker: false });
  },

  /**
   * 选择状态
   */
  async onSelectStatus(e) {
    const status = e.currentTarget.dataset.status;
    if (status === this.data.driverStatus || this.data.toggling) {
      this.setData({ showStatusPicker: false });
      return;
    }

    this.setData({ toggling: true });

    try {
      await api.updateDriverStatus(status);
      this.setData({ driverStatus: status, showStatusPicker: false });
      app.updateStatus(status);

      const msg = status === 'online' ? '已上线' : status === 'busy' ? '已切换为忙碌' : '已下线';
      wx.showToast({ title: msg, icon: 'success' });
    } catch (err) {
      console.error('切换状态失败:', err);
    } finally {
      this.setData({ toggling: false });
    }
  },

  /**
   * 上拉加载更多
   */
  onReachBottom() {
    if (this.data.activeTab === 'orders' && this.data.hasMore) {
      this.loadOrders(false);
    }
  },

  /**
   * 下拉刷新
   */
  async onPullDownRefresh() {
    await Promise.all([
      this.loadDriverInfo(),
      this.loadEarnings(),
      this.loadOrders(true)
    ]);
    wx.stopPullDownRefresh();
  },

  /**
   * 跳转订单详情
   */
  onOrderTap(e) {
    const orderId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: '/pages/detail/detail?id=' + orderId
    });
  },

  /**
   * 跳转钱包页面
   */
  onGoWallet() {
    wx.navigateTo({
      url: '/pages/wallet/wallet'
    });
  },

  /**
   * 退出登录
   */
  onLogout() {
    wx.showModal({
      title: '确认退出',
      content: '退出后需要重新登录才能继续接单',
      confirmColor: '#f59e0b',
      success: (res) => {
        if (res.confirm) {
          // 尝试通知后端下线
          api.updateDriverStatus('offline').catch(() => {});
          app.clearLogin();
          wx.reLaunch({ url: '/pages/login/login' });
        }
      }
    });
  },

  /**
   * 预览头像
   */
  onPreviewAvatar() {
    const avatar = this.data.driver?.avatar;
    if (avatar) {
      wx.previewImage({ urls: [avatar] });
    }
  }
});
