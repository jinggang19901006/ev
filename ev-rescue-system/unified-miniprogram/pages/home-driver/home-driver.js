// pages/home-driver/home-driver.js - 司机订单大厅（统一端适配版）
const api = require('../../utils/api.js');
const app = getApp();

Page({
  data: {
    driverStatus: 'offline',
    orders: [],
    loading: false,
    toggling: false,
    statusBarHeight: 20,
    navBarHeight: 44,
    driver: null,
    isLoggedIn: false,
    notApproved: false,
    acceptingId: '',
    activeOrder: null
  },

  refreshTimer: null,

  onLoad() {
    try {
      const g = app.globalData || {};
      const statusBarHeight = g.statusBarHeight || 20;
      const menuButton = g.menuButton || wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : {};
      const navBarHeight = menuButton && menuButton.height
        ? (menuButton.top - statusBarHeight) * 2 + menuButton.height
        : 44;
      this.setData({ statusBarHeight, navBarHeight });
    } catch (e) {
      this.setData({ statusBarHeight: 20, navBarHeight: 44 });
    }
  },

  async onShow() {
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

  onHide() { this.stopAutoRefresh(); },
  onUnload() { this.stopAutoRefresh(); },

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
    if (!timeStr) return '';
    try {
      // iOS 兼容：后端 "2026-08-28 10:53:26" 中间空格+短横线 iOS Invalid → 正则 normalize
      let s = String(timeStr)
        .replace(/\.\d+/, '')
        .replace(/Z$/i, '')
        .replace(/T(\d)/i, ' $1')
        .replace(/-/g, '/');
      let date = new Date(s);
      if (isNaN(date.getTime())) {
        const m = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/.exec(String(timeStr));
        if (m) {
          date = new Date(
            parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10),
            parseInt(m[4] || 0, 10), parseInt(m[5] || 0, 10), parseInt(m[6] || 0, 10)
          );
        } else {
          return '';
        }
      }
      const now = new Date();
      const diff = now - date;
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
      if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return month + '月' + day + '日 ' + hours + ':' + minutes;
    } catch (e) { return ''; }
  },

  startAutoRefresh() {
    this.stopAutoRefresh();
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
        this.setData({ orders: [] });
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

  async onAcceptOrder(e) {
    const orderId = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
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
            // fallback: old detail path
            wx.navigateTo({ url: '/pages/detail/detail?id=' + orderId, fail: () => {} });
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

  onOrderTap(e) {
    const orderId = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!orderId) return;
    wx.navigateTo({
      url: '/pages/detail-driver/detail-driver?id=' + orderId + '&preview=1',
      fail: () => {
        wx.navigateTo({ url: '/pages/detail/detail?id=' + orderId + '&preview=1', fail: () => {} });
      }
    });
  }
});
