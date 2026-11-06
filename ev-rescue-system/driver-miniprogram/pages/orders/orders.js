// pages/orders/orders.js - 订单大厅
const api = require('../../utils/api.js');
const time = require('../../utils/time.js');
const app = getApp();

Page({
  data: {
    // 司机状态 online/offline/busy
    driverStatus: 'offline',
    // 待接单列表
    orders: [],
    // 是否正在加载
    loading: false,
    // 是否正在切换状态
    toggling: false,
    // 状态栏高度
    statusBarHeight: 20,
    // 导航栏高度
    navBarHeight: 44,
    // 司机信息
    driver: null,
    // 是否已登录
    isLoggedIn: false,
    // 是否未审核
    notApproved: false,
    // 当前接单中的orderId(防重复)
    acceptingId: '',
    // 当前正在服务的订单
    activeOrder: null
  },

  // 自动刷新定时器
  refreshTimer: null,

  onLoad() {
    const statusBarHeight = app.globalData.statusBarHeight || 20;
    const menuButton = app.globalData.menuButton || {};
    // 导航栏高度 = (胶囊顶部 - 状态栏高度) * 2 + 胶囊高度
    const navBarHeight = menuButton.height ? 
      (menuButton.top - statusBarHeight) * 2 + menuButton.height : 44;

    this.setData({
      statusBarHeight,
      navBarHeight
    });
  },

  async onShow() {
    // 检查登录状态
    const isLoggedIn = app.isLoggedIn();
    if (!isLoggedIn) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }

    // 先用缓存数据快速渲染
    const cachedDriver = app.globalData.driver || wx.getStorageSync('driver');
    const cachedStatus = app.globalData.status || wx.getStorageSync('driverStatus') || 'offline';
    const cachedApproved = cachedDriver && (cachedDriver.approved === 1 || cachedDriver.approved === true || cachedDriver.approved === '1');

    this.setData({
      isLoggedIn: true,
      driver: cachedDriver,
      driverStatus: cachedStatus,
      notApproved: !cachedApproved
    });

    // 从后端刷新司机信息（获取最新审核状态和在线状态）
    try {
      const info = await api.getDriverInfo();
      const driver = info.driver || info;
      
      // 以后端返回的status为准
      const serverStatus = driver.status || cachedStatus;
      this.setData({ 
        driver,
        driverStatus: serverStatus
      });
      app.globalData.driver = driver;
      app.globalData.status = serverStatus;
      wx.setStorageSync('driver', driver);
      wx.setStorageSync('driverStatus', serverStatus);

      const approved = driver && (driver.approved === 1 || driver.approved === true || driver.approved === '1');
      this.setData({ notApproved: !approved });

      // 如果未审核，不加载订单
      if (!approved) {
        return;
      }

      // 根据后端状态决定行为
      if (serverStatus === 'online') {
        // 在线：加载待接单列表
        this.loadOrders();
        this.startAutoRefresh();
      } else if (serverStatus === 'busy') {
        // 忙碌：查找当前正在服务的订单
        this.loadActiveOrder();
      }
    } catch (err) {
      console.error('获取司机信息失败:', err);
      // 使用缓存数据继续
      if (!cachedApproved) return;
      if (cachedStatus === 'online') {
        this.loadOrders();
        this.startAutoRefresh();
      }
    }
  },

  onHide() {
    this.stopAutoRefresh();
  },

  onUnload() {
    this.stopAutoRefresh();
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
   * 加载当前正在服务的订单（忙碌状态下）
   */
  async loadActiveOrder() {
    try {
      const result = await api.getDriverOrders(1);
      const orders = Array.isArray(result) ? result : (result.list || result.orders || result.data || []);
      // 找到状态为accepted/en_route/arrived/charging的订单
      const active = orders.find(o => 
        ['accepted', 'en_route', 'arrived', 'charging'].includes(o.status)
      );
      if (active) {
        this.setData({ activeOrder: this.formatOrder(active) });
      } else {
        // 没有活跃订单但状态是busy，可能是后台指派后状态未同步
        // 或者订单刚完成，将状态重置为online
        this.setData({ activeOrder: null });
        // 尝试上线
        await api.updateDriverStatus('online');
        this.setData({ driverStatus: 'online' });
        app.updateStatus('online');
        this.loadOrders();
        this.startAutoRefresh();
      }
    } catch (err) {
      console.error('加载活跃订单失败:', err);
    }
  },

  /**
   * 跳转到当前服务中的订单详情
   */
  onGoToActiveOrder() {
    if (this.data.activeOrder) {
      wx.navigateTo({
        url: '/pages/detail/detail?id=' + this.data.activeOrder.id
      });
    }
  },

  /**
   * 加载待接单列表
   */
  async loadOrders() {
    if (this.data.driverStatus !== 'online') return;

    this.setData({ loading: true });

    try {
      const result = await api.getPendingOrders();
      const orders = Array.isArray(result) ? result : (result.list || result.orders || result.data || []);
      
      // 处理订单数据格式
      const processedOrders = orders.map(order => {
        return this.formatOrder(order);
      });

      this.setData({
        orders: processedOrders,
        loading: false
      });
    } catch (err) {
      console.error('加载订单失败:', err);
      this.setData({ loading: false });
    }
  },

  /**
   * 格式化订单数据
   */
  formatOrder(order) {
    // 车型映射
    const vehicleTypeMap = {
      'small': '小型车',
      'medium': '中型车(4.2米)',
      'large': '大型车(重卡)',
      '小型车': '小型车',
      '中型车': '中型车(4.2米)',
      '大型车': '大型车(重卡)'
    };
    const rawType = order.vehicle_type || order.vehicleType || order.vehicle_model || '';
    const vehicleModel = vehicleTypeMap[rawType] || rawType || '未知车型';

    return {
      ...order,
      // 车型显示
      vehicleModel: vehicleModel,
      // 车牌号
      plateNumber: order.vehicle_plate || order.plateNumber || order.plate_number || order.licensePlate || '',
      // 地址
      address: order.pickup_address || order.address || order.location || order.pickupAddress || '未知地址',
      // 距离(km) — 确保是数字
      distance: (function() {
        const d = order.distance_km != null ? order.distance_km : order.distance;
        const n = typeof d === 'number' ? d : (parseFloat(d) || 0);
        return n > 0 ? n + 'km' : '--';
      })(),
      // 价格 — 确保是数字
      price: (function() {
        const p = order.total_price || order.price || order.amount || order.fee || 0;
        return typeof p === 'number' ? p : (parseFloat(p) || 0);
      })(),
      // 充电量
      batteryLevel: order.battery_percent != null ? order.battery_percent : (order.batteryLevel || order.battery_level || order.soc || ''),
      // 充电需求
      chargeAmount: order.chargeAmount || order.charge_amount || order.needCharge || '',
      // 联系电话
      phone: order.user_phone || order.phone || order.userPhone || '',
      // 备注
      remark: order.remark || order.note || order.pickup_description || '',
      // 创建时间
      createTime: order.created_at || order.createTime || order.createdAt || '',
      createTimeText: this.formatTime(order.created_at || order.createTime || order.createdAt)
    };
  },

  /**
   * 格式化时间
   */
  formatTime(timeStr) {
    return time.formatRelative(timeStr);
  },

  /**
   * 启动自动刷新(每10秒)
   */
  startAutoRefresh() {
    this.stopAutoRefresh();
    this.refreshTimer = setInterval(() => {
      if (this.data.driverStatus === 'online' && !this.data.acceptingId) {
        this.loadOrders();
      }
    }, 10000);
  },

  /**
   * 停止自动刷新
   */
  stopAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  },

  /**
   * 切换上线/下线状态
   */
  async onToggleStatus() {
    if (this.data.toggling) return;
    this.setData({ toggling: true });

    const newStatus = this.data.driverStatus === 'online' ? 'offline' : 'online';

    try {
      await api.updateDriverStatus(newStatus);
      
      this.setData({ driverStatus: newStatus });
      app.updateStatus(newStatus);

      if (newStatus === 'online') {
        wx.showToast({ title: '已上线', icon: 'success' });
        this.loadOrders();
        this.startAutoRefresh();
      } else {
        wx.showToast({ title: '已下线', icon: 'none' });
        this.stopAutoRefresh();
        this.setData({ orders: [] });
      }
    } catch (err) {
      console.error('切换状态失败:', err);
    } finally {
      this.setData({ toggling: false });
    }
  },

  /**
   * 下拉刷新
   */
  async onPullDownRefresh() {
    if (this.data.driverStatus === 'online') {
      await this.loadOrders();
    }
    wx.stopPullDownRefresh();
  },

  /**
   * 接单
   */
  async onAcceptOrder(e) {
    const orderId = e.currentTarget.dataset.id;
    if (!orderId || this.data.acceptingId) return;

    this.setData({ acceptingId: orderId });

    try {
      await api.acceptOrder(orderId);
      
      // 停止自动刷新
      this.stopAutoRefresh();
      
      // 设置为忙碌状态
      this.setData({ driverStatus: 'busy' });
      app.updateStatus('busy');

      wx.showToast({ title: '接单成功', icon: 'success' });

      // 跳转到详情页
      setTimeout(() => {
        wx.navigateTo({
          url: '/pages/detail/detail?id=' + orderId
        });
        this.setData({ acceptingId: '' });
      }, 800);
    } catch (err) {
      console.error('接单失败:', err);
      this.setData({ acceptingId: '' });
      // 接单失败可能是被其他司机抢了，刷新列表
      this.loadOrders();
    }
  },

  /**
   * 拨打电话
   */
  onCallPhone(e) {
    const phone = e.currentTarget.dataset.phone;
    if (!phone) {
      wx.showToast({ title: '暂无联系电话', icon: 'none' });
      return;
    }
    wx.makePhoneCall({ phoneNumber: phone });
  },

  /**
   * 预览订单详情(非接单)
   */
  onOrderTap(e) {
    const orderId = e.currentTarget.dataset.id;
    // 仅查看，不接单
    wx.navigateTo({
      url: '/pages/detail/detail?id=' + orderId + '&preview=1'
    });
  }
});
