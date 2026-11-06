// pages/detail-driver/detail-driver.js - 司机订单详情页（适配 unified API）
const api = require('../../utils/api.js');
const app = getApp();

Page({
  data: {
    orderId: '',
    isPreview: false,
    order: null,
    currentStatus: '',
    statusBarHeight: 20,
    navBarHeight: 44,
    loading: true,
    processing: false,
    statusSteps: [
      { key: 'accepted', label: '已接单', icon: '✓' },
      { key: 'en_route', label: '前往中', icon: '🚗' },
      { key: 'arrived', label: '已到达', icon: '📍' },
      { key: 'charging', label: '充电中', icon: '⚡' },
      { key: 'completed', label: '已完成', icon: '✓' }
    ],
    currentStepIndex: 0,
    beforePhoto: '',
    afterPhoto: '',
    afterPhotoFileId: '',
    showExtraFee: false,
    highwayFee: '',
    parkingFee: '',
    otherFee: '',
    otherFeeRemark: '',
    driverIncome: 0,
    extraFeeTotal: '0.00'
  },

  onLoad(options) {
    const statusBarHeight = (app.globalData && app.globalData.statusBarHeight) || 20;
    const menuButton = (app.globalData && app.globalData.menuButton) || {};
    const navBarHeight = menuButton.height
      ? (menuButton.top - statusBarHeight) * 2 + menuButton.height
      : 44;

    this.setData({
      orderId: options.id,
      isPreview: options.preview === '1',
      statusBarHeight,
      navBarHeight
    });

    if (options.id) {
      this.loadOrderDetail();
    }
  },

  onShow() {
    if (this.data.orderId && !this.data.loading) {
      this.loadOrderDetail();
    }
  },

  async loadOrderDetail() {
    this.setData({ loading: true });
    try {
      // 适配：老 api.getOrderDetail -> 新 api.orders.detail(id)
      const raw = await api.orders.detail(this.data.orderId);
      const orderData = raw && raw.data ? raw.data : raw;
      if (orderData) {
        const formatted = this.formatOrder(orderData);
        const beforePhotoFileId = orderData.before_photo || orderData.beforePhoto || '';
        const afterPhotoFileId = orderData.after_photo || orderData.afterPhoto || '';
        const [beforePhoto, afterPhoto] = await Promise.all([
          api.resolveImageUrlForDisplay(beforePhotoFileId),
          api.resolveImageUrlForDisplay(afterPhotoFileId)
        ]);
        // 状态归一：后端 dispatched 对应 UI 上 en_route（老 UI 按 en_route 条件渲染）
        const rawStatus = orderData.status || 'accepted';
        const currentStatus = rawStatus === 'dispatched' ? 'en_route' : rawStatus;
        this.setData({
          order: formatted,
          currentStatus,
          beforePhoto,
          afterPhoto,
          afterPhotoFileId,
          loading: false
        });
        this.updateStepIndex();
      } else {
        this.setData({
          order: { id: this.data.orderId, status: 'unknown' },
          currentStatus: 'unknown',
          loading: false
        });
        this.updateStepIndex();
      }
    } catch (err) {
      console.error('加载订单详情失败:', err);
      this.setData({ loading: false });
      if (err && (err.statusCode === 401 || /unauth|登录/i.test(err.errMsg || ''))) {
        wx.showToast({ title: '请先登录', icon: 'none' });
        setTimeout(() => {
          wx.redirectTo({ url: '/pages/auth-entry/auth-entry' });
        }, 800);
      }
    }
  },

  formatOrder(order) {
    const status = order.status || 'accepted';
    const vehicleTypeMap = {
      small: '小型车', medium: '中型车(4.2米)', large: '大型车(重卡)',
      '小型车': '小型车', '中型车': '中型车(4.2米)', '大型车': '大型车(重卡)'
    };
    const rawType = order.vehicle_type || order.vehicleSize || order.vehicleType || order.vehicle_model || '';
    const rawPrice = order.total_amount != null ? order.total_amount
      : (order.total_price || order.price || order.amount || order.fee || 0);
    const price = typeof rawPrice === 'number' ? rawPrice : (parseFloat(rawPrice) || 0);
    const rawDistance = order.distance_km != null ? order.distance_km : order.distance;
    const distance = typeof rawDistance === 'number' ? rawDistance : (parseFloat(rawDistance) || 0);

    const commissionRate = 0.2;
    const driverRate = 1 - commissionRate;
    const driverIncome = order.driver_income != null
      ? Number(order.driver_income)
      : Math.round(price * driverRate * 100) / 100;

    return {
      ...order,
      vehicleModel: vehicleTypeMap[rawType] || rawType || '未知车型',
      plateNumber: order.vehicle_plate || order.plateNumber || order.plate_number || order.licensePlate || '',
      address: order.pickup_address || order.address || order.location || order.pickupAddress || '未知地址',
      latitude: Number(order.pickup_lat != null ? order.pickup_lat : (order.latitude != null ? order.latitude : order.lat)) || 0,
      longitude: Number(order.pickup_lng != null ? order.pickup_lng : (order.longitude != null ? order.longitude : order.lng)) || 0,
      price: price,
      driverIncome: driverIncome.toFixed(2),
      batteryLevel: order.battery_percent != null
        ? order.battery_percent
        : (order.batteryLevel || order.battery_level || order.soc || ''),
      chargeAmount: order.chargeAmount || order.charge_amount || order.needCharge || '',
      phone: order.user_phone || order.phone || order.userPhone || '',
      remark: order.remark || order.note || order.pickup_description || '',
      userName: order.userName || order.user_name || order.nickname || '用户',
      createTime: order.created_at || order.createTime || order.createdAt || '',
      createTimeText: this.formatTime(order.created_at || order.createTime || order.createdAt),
      distance: distance > 0 ? distance : '--',
      status
    };
  },

  formatTime(timeStr) {
    if (!timeStr) return '';
    try {
      // iOS 只支持 yyyy/MM/dd HH:mm:ss / yyyy-MM-dd / yyyy-MM-ddTHH:mm:ss 等标准格式，
      // 后端返回 "2026-08-28 10:53:26" 这种 中间空格+短横线 在 iOS 上是 Invalid Date。
      // 先做正则 normalize：替换短横线为 /；把 T 分隔符转空格；去毫秒和 Z；最后 new Date()
      let s = String(timeStr)
        .replace(/\.\d+/, '')
        .replace(/Z$/i, '')
        .replace(/T(\d)/i, ' $1')
        .replace(/-/g, '/');
      let date = new Date(s);
      if (isNaN(date.getTime())) {
        // 最终兜底：手动拆 yyyy/MM/dd HH:mm:ss
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
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return month + '月' + day + '日 ' + hours + ':' + minutes;
    } catch (e) {
      return '';
    }
  },

  updateStepIndex() {
    const statusMap = {
      pending: -1, accepted: 0, en_route: 1, dispatched: 1,
      arrived: 2, charging: 3, completed: 4, cancelled: -1
    };
    const index = statusMap[this.data.currentStatus] !== undefined
      ? statusMap[this.data.currentStatus] : 0;
    this.setData({ currentStepIndex: index });
  },

  onCallPhone() {
    const phone = this.data.order && this.data.order.phone;
    if (!phone) {
      wx.showToast({ title: '暂无联系电话', icon: 'none' });
      return;
    }
    wx.makePhoneCall({ phoneNumber: String(phone) });
  },

  onNavigate() {
    const order = this.data.order;
    if (!order || !order.latitude || !order.longitude) {
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
  },

  async onActionStart() {
    await this.updateStatus('en_route', '已出发，正在前往救援地点');
  },

  async onActionArrive() {
    const photo = await this.takePhoto('before');
    if (!photo) return;
    let photoFileId = '';
    let photoUrl = '';
    try {
      const uploadResult = await api.uploadImage(photo);
      photoFileId = uploadResult && uploadResult.url ? uploadResult.url : (uploadResult || '');
      photoUrl = await api.resolveImageUrlForDisplay(photoFileId);
    } catch (err) {
      console.error('上传照片失败:', err);
      wx.showToast({ title: '照片上传失败，请重试', icon: 'none' });
      return;
    }
    this.setData({ beforePhoto: photoUrl });
    await this.updateStatus('arrived', '已到达救援地点', { before_photo: photoFileId });
  },

  async onActionStartCharge() {
    await this.updateStatus('charging', '充电已开始');
  },

  async onActionEndCharge() {
    const photo = await this.takePhoto('after');
    if (!photo) return;
    let photoFileId = '';
    let photoUrl = '';
    try {
      const uploadResult = await api.uploadImage(photo);
      photoFileId = uploadResult && uploadResult.url ? uploadResult.url : (uploadResult || '');
      photoUrl = await api.resolveImageUrlForDisplay(photoFileId);
    } catch (err) {
      console.error('上传照片失败:', err);
      wx.showToast({ title: '照片上传失败，请重试', icon: 'none' });
      return;
    }
    this.setData({ afterPhoto: photoUrl, afterPhotoFileId: photoFileId, showExtraFee: true });
  },

  takePhoto(type) {
    return new Promise((resolve) => {
      const sourceType = ['camera', 'album'];
      wx.showActionSheet({
        itemList: ['拍照', '从相册选择'],
        success: (res) => {
          const chosenSource = res.tapIndex === 0 ? ['camera'] : ['album'];
          this.chooseMedia(chosenSource, resolve);
        },
        fail: () => resolve(null)
      });
    });
  },

  chooseMedia(sourceType, resolve) {
    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType,
        sizeType: ['compressed'],
        camera: 'back',
        success: (res) => {
          resolve(res && res.tempFiles && res.tempFiles[0] ? res.tempFiles[0].tempFilePath : null);
        },
        fail: () => resolve(null)
      });
    } else {
      wx.chooseImage({
        count: 1,
        sourceType,
        sizeType: ['compressed'],
        success: (res) => {
          resolve(res && res.tempFilePaths && res.tempFilePaths[0] ? res.tempFilePaths[0] : null);
        },
        fail: () => resolve(null)
      });
    }
  },

  /**
   * 适配：老 api.updateOrderStatus(id,{status,extraData})
   * -> 新 api.driver.updateOrderStatus(id, { progress, ...payload })
   * 后端 ALLOWED_NEXT 做 409 状态机拦截，此处只传进度+字段
   */
  async updateStatus(status, successMsg, extraData) {
    if (this.data.processing) return;
    this.setData({ processing: true });
    try {
      const payload = { progress: status, ...(extraData || {}) };
      await api.driver.updateOrderStatus(this.data.orderId, payload);
      this.setData({ currentStatus: status, processing: false });
      this.updateStepIndex();
      if (this.data.order) {
        this.setData({ 'order.status': status });
      }
      wx.showToast({ title: successMsg, icon: 'success' });
      if (status === 'completed') {
        setTimeout(() => { wx.navigateBack({ fail: () => {} }); }, 1500);
      }
    } catch (err) {
      console.error('更新状态失败:', err);
      this.setData({ processing: false });
      const msg = (err && err.data && (err.data.message || err.data.msg))
        || (err && err.errMsg)
        || '操作失败，请重试';
      wx.showToast({ title: String(msg).slice(0, 20), icon: 'none' });
      if (err && (err.statusCode === 401 || /unauth|登录/i.test(String(msg)))) {
        setTimeout(() => wx.redirectTo({ url: '/pages/auth-entry/auth-entry' }), 800);
      }
    }
  },

  updateExtraFeeTotal() {
    const highway = parseFloat(this.data.highwayFee) || 0;
    const parking = parseFloat(this.data.parkingFee) || 0;
    const other = parseFloat(this.data.otherFee) || 0;
    this.setData({ extraFeeTotal: (highway + parking + other).toFixed(2) });
  },

  onHighwayFeeInput(e) {
    let value = (e.detail.value || '').replace(/[^\d.]/g, '');
    this.setData({ highwayFee: value });
    this.updateExtraFeeTotal();
  },

  onParkingFeeInput(e) {
    let value = (e.detail.value || '').replace(/[^\d.]/g, '');
    this.setData({ parkingFee: value });
    this.updateExtraFeeTotal();
  },

  onOtherFeeInput(e) {
    let value = (e.detail.value || '').replace(/[^\d.]/g, '');
    this.setData({ otherFee: value });
    this.updateExtraFeeTotal();
  },

  onOtherFeeRemarkInput(e) {
    this.setData({ otherFeeRemark: e.detail.value });
  },

  async onConfirmComplete() {
    if (this.data.processing) return;
    this.setData({ processing: true });
    try {
      const highway_fee = parseFloat(this.data.highwayFee) || 0;
      const parking_fee = parseFloat(this.data.parkingFee) || 0;
      const other_fee = parseFloat(this.data.otherFee) || 0;
      const payload = {
        progress: 'completed',
        after_photo: this.data.afterPhotoFileId || this.data.afterPhoto,
        highway_fee,
        parking_fee,
        other_fee,
        fee_remark: this.data.otherFeeRemark || ''
      };
      await api.driver.updateOrderStatus(this.data.orderId, payload);
      this.setData({
        currentStatus: 'completed',
        processing: false,
        showExtraFee: false
      });
      this.updateStepIndex();
      if (this.data.order) {
        this.setData({
          'order.status': 'completed',
          'order.settlement_status': 'pending'
        });
      }
      wx.showToast({ title: '已提交，等待用户支付', icon: 'none' });
      // 恢复司机在线
      try {
        const token = wx.getStorageSync('uni_token') || wx.getStorageSync('token') || '';
        if (token && api.driver && api.driver.updateStatus) {
          await api.driver.updateStatus('online');
        }
        if (app && app.globalData) {
          app.globalData.driverStatus = 'online';
        }
        wx.removeStorageSync('driverStatus');
        wx.setStorageSync('driverStatus', 'online');
      } catch (e) { /* ignore */ }

      setTimeout(() => { wx.navigateBack({ fail: () => {} }); }, 1500);
    } catch (err) {
      console.error('完成订单失败:', err);
      this.setData({ processing: false });
      const msg = (err && err.data && (err.data.message || err.data.msg))
        || (err && err.errMsg)
        || '完成失败，请重试';
      wx.showToast({ title: String(msg).slice(0, 20), icon: 'none' });
    }
  },

  onSkipExtraFee() {
    this.onConfirmComplete();
  },

  stopPropagation() {},

  onCloseExtraFee() {
    this.setData({ showExtraFee: false });
  },

  onBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({
      url: '/pages/home-driver/home-driver',
      fail: () => wx.reLaunch({ url: '/pages/home-driver/home-driver' })
    });
  },

  onPreviewImage(e) {
    const url = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.url;
    if (!url) return;
    wx.previewImage({ current: url, urls: [url] });
  }
});
