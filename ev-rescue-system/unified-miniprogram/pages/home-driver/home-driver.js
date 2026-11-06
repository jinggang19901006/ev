// pages/home-driver/home-driver.js - 司机订单大厅（统一端适配版）
const api = require('../../utils/api.js');
const time = require('../../utils/time.js');
const app = getApp();

Page({
  data: {
    driverStatus: 'offline',
    orders: [],
    loading: false,
    toggling: false,
    statusBarHeight: 20,
    navBarHeight: 44,
    navRightPadding: 16,
    driver: null,
    isLoggedIn: false,
    notApproved: false,
    acceptingId: '',
    confirmingId: '',
    activeOrder: null,
    locationState: 'unknown',
    locationMessage: '',
    locationUpdating: false
  },

  refreshTimer: null,
  locationTimer: null,

  onLoad() {
    try {
      const g = app.globalData || {};
      const statusBarHeight = g.statusBarHeight || 20;
      const menuButton = wx.getMenuButtonBoundingClientRect
        ? wx.getMenuButtonBoundingClientRect()
        : {};
      const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const navBarHeight = menuButton && menuButton.height
        ? (menuButton.top - statusBarHeight) * 2 + menuButton.height
        : 44;
      const navRightPadding = menuButton && menuButton.left
        ? Math.max(16, windowInfo.windowWidth - menuButton.left + 10)
        : 16;
      this.setData({ statusBarHeight, navBarHeight, navRightPadding });
    } catch (e) {
      this.setData({ statusBarHeight: 20, navBarHeight: 44, navRightPadding: 16 });
    }
  },

  async onShow() {
    app.syncTabBar(this);
    const token = (app.globalData && app.globalData.token)
      || wx.getStorageSync('uni_token')
      || wx.getStorageSync('token') || '';
    if (!token) {
      // tabBar 页跳登录页必须用 reLaunch（redirectTo/navigateTo 在 tab 页会静默失败）
      wx.reLaunch({ url: '/pages/auth-entry/auth-entry' });
      return;
    }
    const role = (app.globalData && app.globalData.currentRole)
      || wx.getStorageSync('uni_role')
      || wx.getStorageSync('role') || '';
    if (role && role !== 'driver') {
      // 非司机提示（保留逻辑，不阻断）
    }

    // 缓存快显（统一端存 uni_profile/globalData.profile）
    const cachedDriver = (app.globalData && (app.globalData.profile || app.globalData.driver))
      || wx.getStorageSync('uni_profile')
      || wx.getStorageSync('driver');
    const cachedStatus = (app.globalData && app.globalData.status) || wx.getStorageSync('driverStatus') || 'offline';
    const cachedApproved = cachedDriver && (
      cachedDriver.approved === 1 || cachedDriver.approved === true || cachedDriver.approved === '1'
    );
    this.setData({
      isLoggedIn: true,
      driver: cachedDriver,
      driverStatus: cachedStatus,
      notApproved: !cachedApproved
    });

    try {
      const info = await api.driver.info();
      const driver = info && (info.driver || info);
      const serverStatus = (driver && driver.status) || cachedStatus;
      this.setData({ driver, driverStatus: serverStatus });
      try {
        app.globalData.driver = driver;
        app.globalData.profile = driver;   // 统一端 mine 页读 globalData.profile
        app.globalData.status = serverStatus;
        wx.setStorageSync('driver', driver);
        wx.setStorageSync('uni_profile', driver);
        wx.setStorageSync('driverStatus', serverStatus);
      } catch (e) {}
      const approved = driver && (
        driver.approved === 1 || driver.approved === true || driver.approved === '1'
      );
      this.setData({ notApproved: !approved });
      if (!approved) return;

      if (serverStatus === 'online') {
        const locationReady = await this.reportCurrentLocation(false);
        if (!locationReady) {
          wx.showToast({ title: '定位刷新失败，仍保持在线', icon: 'none' });
        }
        this.loadOrders();
        this.startAutoRefresh();
      } else if (serverStatus === 'busy') {
        this.loadActiveOrder();
      }
    } catch (err) {
      console.error('driver.info fail', err);
      if (err && /登录过期|401|请重新登录/.test(err.message || '')) {
        wx.reLaunch({ url: '/pages/auth-entry/auth-entry' });
        return;
      }
      if (!cachedApproved) return;
      if (cachedStatus === 'online') {
        this.loadOrders();
        this.startAutoRefresh();
      }
    }
  },

  onHide() {
    this.stopAutoRefresh();
    this.stopLocationRefresh();
  },
  onUnload() {
    this.stopAutoRefresh();
    this.stopLocationRefresh();
  },

  async loadActiveOrder() {
    try {
      // 优先用新后端 /driver/active-order
      let active = null;
      try {
        active = await api.driver.activeOrder();
      } catch (e) {
        console.warn('driver.activeOrder fail, fallback to driver.orders:', e && e.message);
      }
      if (!active) {
        const r = await api.driver.orders(1, 20);
        const arr = Array.isArray(r) ? r : (r && r.list) ? r.list : [];
        active = arr.find(o =>
          ['accepted', 'dispatched', 'en_route', 'arrived', 'charging'].indexOf(o.status) >= 0
        );
      }
      if (active) {
        this.setData({ activeOrder: this.formatOrder(active) });
      } else {
        this.setData({ activeOrder: null });
        try {
          await api.driver.updateStatus('online');
          this.setData({ driverStatus: 'online' });
          this.updateAppStatus('online');
        } catch (e) {}
        this.loadOrders();
        this.startAutoRefresh();
      }
    } catch (err) {
      console.error('loadActiveOrder fail', err);
    }
  },

  onGoToActiveOrder() {
    if (this.data.activeOrder && this.data.activeOrder.id) {
      wx.navigateTo({
        url: '/pages/detail-driver/detail-driver?id=' + this.data.activeOrder.id
      });
    }
  },

  async loadOrders() {
    if (this.data.driverStatus !== 'online') return;
    this.setData({ loading: true });
    try {
      const r = await api.driver.pendingOrders();
      const arr = Array.isArray(r) ? r : (r && r.list) ? r.list : [];
      const processedOrders = arr.map(o => this.formatOrder(o));
      this.setData({ orders: processedOrders, loading: false });
    } catch (err) {
      console.error('loadOrders fail', err);
      this.setData({ loading: false, orders: [] });
      if (err && /登录过期|401|请重新登录/.test(err.message || '')) {
        wx.reLaunch({ url: '/pages/auth-entry/auth-entry' });
      }
    }
  },

  formatOrder(order) {
    if (!order) return order || {};
    const vehicleTypeMap = {
      'small': '小型车',
      'medium': '中型车(4.2米)',
      'large': '大型车(重卡)',
      '小型车': '小型车',
      '中型车': '中型车(4.2米)',
      '大型车': '大型车(重卡)'
    };
    const vehicle_size_cn = order.vehicle_size_cn || order.vehicleSizeCn || '';
    const rawType = order.vehicle_type || order.vehicleType || order.vehicle_model || vehicle_size_cn || '';
    const vehicleModel = vehicleTypeMap[rawType] || vehicle_size_cn || rawType || '未知车型';

    const total_price = order.total_price != null ? order.total_price : order.total_amount;
    const d = order.distance_km != null ? order.distance_km : order.distance;
    const dn = typeof d === 'number' ? d : (parseFloat(d) || 0);
    const p = total_price || order.price || order.amount || order.fee || 0;
    const pn = typeof p === 'number' ? p : (parseFloat(p) || 0);

    return {
      ...order,
      vehicleModel,
      plateNumber: order.vehicle_plate || order.plateNumber || order.plate_number || order.licensePlate || '',
      address: order.pickup_address || order.address || order.location || order.pickupAddress || '未知地址',
      latitude: Number(order.pickup_lat != null ? order.pickup_lat : (order.latitude != null ? order.latitude : order.lat)) || 0,
      longitude: Number(order.pickup_lng != null ? order.pickup_lng : (order.longitude != null ? order.longitude : order.lng)) || 0,
      distance: dn > 0 ? dn + 'km' : '--',
      price: pn,
      batteryLevel: order.battery_percent != null ? order.battery_percent : (order.batteryLevel || order.battery_level || order.soc || ''),
      chargeAmount: order.chargeAmount || order.charge_amount || order.needCharge || order.charge_amount_kwh || '',
      phone: order.user_phone || order.phone || order.userPhone || '',
      remark: order.remark || order.note || order.pickup_description || '',
      createTime: order.created_at || order.createTime || order.createdAt || '',
      createTimeText: this.formatTime(order.created_at || order.createTime || order.createdAt)
    };
  },

  formatTime(timeStr) {
    return time.formatRelative(timeStr);
  },

  startAutoRefresh() {
    this.stopAutoRefresh();
    this.startLocationRefresh();
    this.refreshTimer = setInterval(() => {
      if (this.data.driverStatus === 'online' && !this.data.acceptingId) {
        this.loadOrders();
      }
    }, 10000);
  },

  stopAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  },

  startLocationRefresh() {
    this.stopLocationRefresh();
    this.locationTimer = setInterval(() => {
      if (this.data.driverStatus === 'online') this.reportCurrentLocation(false);
    }, 60000);
  },

  stopLocationRefresh() {
    if (this.locationTimer) {
      clearInterval(this.locationTimer);
      this.locationTimer = null;
    }
  },

  getCurrentLocation() {
    return new Promise((resolve, reject) => {
      wx.getLocation({
        type: 'gcj02',
        isHighAccuracy: true,
        highAccuracyExpireTime: 5000,
        success: resolve,
        fail: reject
      });
    });
  },

  async reportCurrentLocation(showError = true) {
    if (this.data.locationUpdating) return this.data.locationState === 'ready';
    this.setData({
      locationUpdating: true,
      locationState: 'locating',
      locationMessage: '正在更新当前位置'
    });
    try {
      const location = await this.getCurrentLocation();
      await api.driver.updateLocation({
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy
      });
      this.setData({
        locationState: 'ready',
        locationMessage: ''
      });
      return true;
    } catch (error) {
      console.error('report location fail', error);
      const message = this.getLocationErrorMessage(error);
      this.setData({
        locationState: message.state,
        locationMessage: message.text
      });
      if (showError) {
        wx.showToast({ title: message.text, icon: 'none' });
      }
      return false;
    } finally {
      this.setData({ locationUpdating: false });
    }
  },

  getLocationErrorMessage(error) {
    const detail = String((error && (error.errMsg || error.message)) || '').toLowerCase();
    if (/auth deny|authorize:fail|permission|unauthorized|scope\.userlocation/.test(detail)) {
      return { state: 'denied', text: '定位权限未开启，点击此处授权' };
    }
    if (/system permission|location service|gps|定位服务/.test(detail)) {
      return { state: 'disabled', text: '手机定位服务未开启，请开启后重试' };
    }
    if (/timeout|network|request:fail/.test(detail)) {
      return { state: 'unavailable', text: '定位更新失败，请检查网络后重试' };
    }
    return { state: 'unavailable', text: '暂时无法获取定位，点击重试' };
  },

  getLocationSetting() {
    return new Promise(resolve => {
      wx.getSetting({
        success: resolve,
        fail: () => resolve({ authSetting: {} })
      });
    });
  },

  openLocationSetting() {
    return new Promise(resolve => {
      wx.openSetting({
        success: resolve,
        fail: () => resolve(null)
      });
    });
  },

  async onRetryLocation() {
    if (this.data.locationUpdating) return;
    const setting = await this.getLocationSetting();
    if (setting && setting.authSetting && setting.authSetting['scope.userLocation'] === false) {
      await this.openLocationSetting();
    }
    const ready = await this.reportCurrentLocation(true);
    if (ready) wx.showToast({ title: '定位已更新', icon: 'success' });
  },

  updateAppStatus(s) {
    try {
      app.globalData.status = s;
      wx.setStorageSync('driverStatus', s);
    } catch (e) {}
  },

  async onToggleStatus() {
    if (this.data.toggling) return;
    this.setData({ toggling: true });
    const newStatus = this.data.driverStatus === 'online' ? 'offline' : 'online';
    try {
      if (newStatus === 'online') {
        const locationReady = await this.reportCurrentLocation(true);
        if (!locationReady) return;
      }
      await api.driver.updateStatus(newStatus);
      this.setData({ driverStatus: newStatus });
      this.updateAppStatus(newStatus);
      if (newStatus === 'online') {
        wx.showToast({ title: '已上线', icon: 'success' });
        this.loadOrders();
        this.startAutoRefresh();
      } else {
        wx.showToast({ title: '已下线', icon: 'none' });
        this.stopAutoRefresh();
        this.stopLocationRefresh();
        this.setData({
          orders: [],
          locationState: 'unknown',
          locationMessage: ''
        });
      }
    } catch (err) {
      console.error('toggle status fail', err);
      wx.showToast({ title: (err && err.message) || '切换失败', icon: 'none' });
    } finally {
      this.setData({ toggling: false });
    }
  },

  async onPullDownRefresh() {
    try {
      if (this.data.driverStatus === 'online') await this.loadOrders();
      if (this.data.driverStatus === 'busy') await this.loadActiveOrder();
    } catch (e) {}
    wx.stopPullDownRefresh();
  },

  onAcceptOrder(e) {
    const orderId = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!orderId || this.data.acceptingId || this.data.confirmingId) return;
    const order = this.data.orders.find(item => String(item.id) === String(orderId));
    this.setData({ confirmingId: orderId });
    wx.showModal({
      title: '确认接单',
      content: order
        ? `确认接取${order.vehicleModel}的救援订单？\n救援地址：${order.address}`
        : '确认接取该救援订单？',
      confirmText: '确认接单',
      confirmColor: '#f59e0b',
      success: (res) => {
        if (res.confirm) this.acceptOrder(orderId);
      },
      complete: () => this.setData({ confirmingId: '' })
    });
  },

  async acceptOrder(orderId) {
    if (!orderId || this.data.acceptingId) return;
    this.setData({ acceptingId: orderId });
    try {
      await api.driver.accept(orderId);
      this.stopAutoRefresh();
      this.setData({ driverStatus: 'busy' });
      this.updateAppStatus('busy');
      wx.showToast({ title: '接单成功', icon: 'success' });
      setTimeout(() => {
        wx.navigateTo({
          url: '/pages/detail-driver/detail-driver?id=' + orderId,
          fail: () => {
            wx.switchTab({
              url: '/pages/home-driver/home-driver',
              fail: () => wx.reLaunch({ url: '/pages/home-driver/home-driver' })
            });
          }
        });
        this.setData({ acceptingId: '' });
      }, 800);
    } catch (err) {
      console.error('accept fail', err);
      this.setData({ acceptingId: '' });
      wx.showToast({ title: (err && err.message) || '接单失败', icon: 'none' });
      this.loadOrders();
    }
  },

  onCallPhone(e) {
    const phone = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.phone;
    if (!phone) { wx.showToast({ title: '暂无联系电话', icon: 'none' }); return; }
    try { wx.makePhoneCall({ phoneNumber: phone, fail: () => {} }); } catch (e) {}
  },

  onViewOrder(e) {
    const orderId = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!orderId) return;
    wx.navigateTo({
      url: '/pages/detail-driver/detail-driver?id=' + orderId + '&preview=1'
    });
  },

  onNavigate(e) {
    const orderId = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    const order = this.data.orders.find(item => String(item.id) === String(orderId));
    if (!order) return;
    if (!order.latitude || !order.longitude) {
      wx.showToast({ title: '该订单缺少定位坐标', icon: 'none' });
      return;
    }
    wx.openLocation({
      latitude: order.latitude,
      longitude: order.longitude,
      name: '救援地点',
      address: order.address,
      scale: 16,
      fail: () => wx.showToast({ title: '地图打开失败，请检查定位权限', icon: 'none' })
    });
  }
});
