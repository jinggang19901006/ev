// pages/detail/detail.js - 订单详情页
const api = require('../../utils/api.js');
const time = require('../../utils/time.js');
const app = getApp();

Page({
  data: {
    // 订单ID
    orderId: '',
    // 是否预览模式(未接单查看)
    isPreview: false,
    // 订单信息
    order: null,
    // 当前操作状态
    currentStatus: '',
    // 状态栏高度
    statusBarHeight: 20,
    // 导航栏高度
    navBarHeight: 44,
    // 是否正在加载
    loading: true,
    // 是否正在操作
    processing: false,
    // 状态流程
    statusSteps: [
      { key: 'accepted', label: '已接单', icon: '✓' },
      { key: 'en_route', label: '前往中', icon: '🚗' },
      { key: 'arrived', label: '已到达', icon: '📍' },
      { key: 'charging', label: '充电中', icon: '⚡' },
      { key: 'completed', label: '已完成', icon: '✓' }
    ],
    // 当前步骤索引
    currentStepIndex: 0,
    // 充电前照片
    beforePhoto: '',
    // 充电后照片
    afterPhoto: '',
    // 额外费用弹窗
    showExtraFee: false,
    // 高速费
    highwayFee: '',
    // 停车费
    parkingFee: '',
    // 其他费用
    otherFee: '',
    // 其他费用备注
    otherFeeRemark: '',
    // 司机收入预估
    driverIncome: 0,
    // 额外费用合计
    extraFeeTotal: 0
  },

  onLoad(options) {
    const statusBarHeight = app.globalData.statusBarHeight || 20;
    const menuButton = app.globalData.menuButton || {};
    const navBarHeight = menuButton.height ? 
      (menuButton.top - statusBarHeight) * 2 + menuButton.height : 44;

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
    // 页面显示时刷新数据
    if (this.data.orderId && !this.data.loading) {
      this.loadOrderDetail();
    }
  },

  /**
   * 加载订单详情
   */
  async loadOrderDetail() {
    this.setData({ loading: true });

    try {
      // 直接调用后端API获取订单详情
      const orderData = await api.getOrderDetail(this.data.orderId);
      
      if (orderData) {
        const formatted = this.formatOrder(orderData);
        // 解析并设置前后照片URL
        const beforePhoto = api.resolveImageUrl(orderData.before_photo || orderData.beforePhoto || '');
        const afterPhoto = api.resolveImageUrl(orderData.after_photo || orderData.afterPhoto || '');
        this.setData({
          order: formatted,
          currentStatus: orderData.status || 'accepted',
          beforePhoto: beforePhoto,
          afterPhoto: afterPhoto,
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
    }
  },

  /**
   * 格式化订单数据
   */
  formatOrder(order) {
    const status = order.status || 'accepted';
    const vehicleTypeMap = {
      'small': '小型车',
      'medium': '中型车(4.2米)',
      'large': '大型车(重卡)',
      '小型车': '小型车',
      '中型车': '中型车(4.2米)',
      '大型车': '大型车(重卡)'
    };
    const rawType = order.vehicle_type || order.vehicleType || order.vehicle_model || '';
    // 确保price是数字
    const rawPrice = order.total_price || order.price || order.amount || order.fee || 0;
    const price = typeof rawPrice === 'number' ? rawPrice : (parseFloat(rawPrice) || 0);
    // 确保distance是数字
    const rawDistance = order.distance_km != null ? order.distance_km : order.distance;
    const distance = typeof rawDistance === 'number' ? rawDistance : (parseFloat(rawDistance) || 0);

    // 从全局获取commission_rate
    const commissionRate = (app.globalData.driver && app.globalData.driver.commission_rate) || 0.2;
    const driverRate = 1 - commissionRate;
    // 如果订单已完成且有driver_income，直接用；否则计算
    const driverIncome = order.driver_income != null ? Number(order.driver_income) : Math.round(price * driverRate * 100) / 100;

    return {
      ...order,
      vehicleModel: vehicleTypeMap[rawType] || rawType || '未知车型',
      plateNumber: order.vehicle_plate || order.plateNumber || order.plate_number || order.licensePlate || '',
      address: order.pickup_address || order.address || order.location || order.pickupAddress || '未知地址',
      price: price,
      driverIncome: driverIncome.toFixed(2),
      batteryLevel: order.battery_percent != null ? order.battery_percent : (order.batteryLevel || order.battery_level || order.soc || ''),
      chargeAmount: order.chargeAmount || order.charge_amount || order.needCharge || '',
      phone: order.user_phone || order.phone || order.userPhone || '',
      remark: order.remark || order.note || order.pickup_description || '',
      userName: order.userName || order.user_name || order.nickname || '用户',
      createTime: order.created_at || order.createTime || order.createdAt || '',
      createTimeText: this.formatTime(order.created_at || order.createTime || order.createdAt),
      distance: distance > 0 ? distance + 'km' : '--',
      status: status
    };
  },

  /**
   * 格式化时间
   */
  formatTime(timeStr) {
    return time.formatMonthDayTime(timeStr);
  },

  /**
   * 更新当前步骤索引
   */
  updateStepIndex() {
    const statusMap = {
      'pending': -1,
      'accepted': 0,
      'en_route': 1,
      'arrived': 2,
      'charging': 3,
      'completed': 4,
      'cancelled': -1
    };
    const index = statusMap[this.data.currentStatus] !== undefined ? statusMap[this.data.currentStatus] : 0;
    this.setData({ currentStepIndex: index });
  },

  /**
   * 获取状态文本
   */
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

  /**
   * 拨打电话
   */
  onCallPhone() {
    const phone = this.data.order?.phone;
    if (!phone) {
      wx.showToast({ title: '暂无联系电话', icon: 'none' });
      return;
    }
    wx.makePhoneCall({ phoneNumber: phone });
  },

  /**
   * 操作 - 出发
   */
  async onActionStart() {
    await this.updateStatus('en_route', '已出发，正在前往救援地点');
  },

  /**
   * 操作 - 到达(拍照)
   */
  async onActionArrive() {
    // 先拍照
    const photo = await this.takePhoto('before');
    if (!photo) return;

    // 上传照片
    let photoUrl = '';
    try {
      const uploadResult = await api.uploadImage(photo);
      photoUrl = uploadResult.url || uploadResult;
      photoUrl = api.resolveImageUrl(photoUrl);
    } catch (err) {
      console.error('上传照片失败:', err);
      wx.showToast({ title: '照片上传失败，请重试', icon: 'none' });
      return;
    }

    this.setData({ beforePhoto: photoUrl });
    await this.updateStatus('arrived', '已到达救援地点', { beforePhoto: photoUrl });
  },

  /**
   * 操作 - 开始充电
   */
  async onActionStartCharge() {
    await this.updateStatus('charging', '充电已开始');
  },

  /**
   * 操作 - 结束充电(拍照)
   */
  async onActionEndCharge() {
    // 先拍照
    const photo = await this.takePhoto('after');
    if (!photo) return;

    // 上传照片
    let photoUrl = '';
    try {
      const uploadResult = await api.uploadImage(photo);
      photoUrl = uploadResult.url || uploadResult;
      photoUrl = api.resolveImageUrl(photoUrl);
    } catch (err) {
      console.error('上传照片失败:', err);
      wx.showToast({ title: '照片上传失败，请重试', icon: 'none' });
      return;
    }

    this.setData({ afterPhoto: photoUrl });
    // 显示额外费用输入
    this.setData({ showExtraFee: true });
  },

  /**
   * 拍照
   */
  takePhoto(type) {
    return new Promise((resolve, reject) => {
      const sourceType = ['camera', 'album'];
      wx.showActionSheet({
        itemList: ['拍照', '从相册选择'],
        success: (res) => {
          const chosenSource = res.tapIndex === 0 ? ['camera'] : ['album'];
          this.chooseMedia(chosenSource, resolve, reject);
        },
        fail: () => {
          resolve(null);
        }
      });
    });
  },

  /**
   * 选择媒体文件
   */
  chooseMedia(sourceType, resolve, reject) {
    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: sourceType,
        sizeType: ['compressed'],
        camera: 'back',
        success: (res) => {
          if (res.tempFiles && res.tempFiles.length > 0) {
            resolve(res.tempFiles[0].tempFilePath);
          } else {
            resolve(null);
          }
        },
        fail: (err) => {
          console.error('选择图片失败:', err);
          resolve(null);
        }
      });
    } else {
      wx.chooseImage({
        count: 1,
        sourceType: sourceType,
        sizeType: ['compressed'],
        success: (res) => {
          if (res.tempFilePaths && res.tempFilePaths.length > 0) {
            resolve(res.tempFilePaths[0]);
          } else {
            resolve(null);
          }
        },
        fail: (err) => {
          console.error('选择图片失败:', err);
          resolve(null);
        }
      });
    }
  },

  /**
   * 更新订单状态
   */
  async updateStatus(status, successMsg, extraData) {
    if (this.data.processing) return;
    this.setData({ processing: true });

    try {
      const params = {
        status: status,
        ...extraData
      };

      await api.updateOrderStatus(this.data.orderId, params);

      this.setData({
        currentStatus: status,
        processing: false
      });
      this.updateStepIndex();

      // 更新order状态
      if (this.data.order) {
        this.setData({
          'order.status': status
        });
      }

      wx.showToast({ title: successMsg, icon: 'success' });

      // 如果完成，延迟返回
      if (status === 'completed') {
        setTimeout(() => {
          wx.navigateBack();
        }, 1500);
      }
    } catch (err) {
      console.error('更新状态失败:', err);
      this.setData({ processing: false });
    }
  },

  /**
   * 计算额外费用总额并更新显示
   */
  updateExtraFeeTotal() {
    const highway = parseFloat(this.data.highwayFee) || 0;
    const parking = parseFloat(this.data.parkingFee) || 0;
    const other = parseFloat(this.data.otherFee) || 0;
    this.setData({ extraFeeTotal: (highway + parking + other).toFixed(2) });
  },

  /**
   * 输入高速费
   */
  onHighwayFeeInput(e) {
    let value = e.detail.value;
    value = value.replace(/[^\d.]/g, '');
    this.setData({ highwayFee: value });
    this.updateExtraFeeTotal();
  },

  /**
   * 输入停车费
   */
  onParkingFeeInput(e) {
    let value = e.detail.value;
    value = value.replace(/[^\d.]/g, '');
    this.setData({ parkingFee: value });
    this.updateExtraFeeTotal();
  },

  /**
   * 输入其他费用
   */
  onOtherFeeInput(e) {
    let value = e.detail.value;
    value = value.replace(/[^\d.]/g, '');
    this.setData({ otherFee: value });
    this.updateExtraFeeTotal();
  },

  /**
   * 输入其他费用备注
   */
  onOtherFeeRemarkInput(e) {
    this.setData({ otherFeeRemark: e.detail.value });
  },

  /**
   * 计算额外费用总额
   */
  getExtraFeeTotal() {
    const highway = parseFloat(this.data.highwayFee) || 0;
    const parking = parseFloat(this.data.parkingFee) || 0;
    const other = parseFloat(this.data.otherFee) || 0;
    return highway + parking + other;
  },

  /**
   * 确认完成订单
   */
  async onConfirmComplete() {
    if (this.data.processing) return;

    const extraFee = {
      highway: parseFloat(this.data.highwayFee) || 0,
      parking: parseFloat(this.data.parkingFee) || 0,
      other: parseFloat(this.data.otherFee) || 0,
      otherRemark: this.data.otherFeeRemark
    };

    this.setData({ processing: true });

    try {
      await api.updateOrderStatus(this.data.orderId, {
        status: 'completed',
        afterPhoto: this.data.afterPhoto,
        extraFee: extraFee
      });

      this.setData({
        currentStatus: 'completed',
        processing: false,
        showExtraFee: false
      });
      this.updateStepIndex();

      if (this.data.order) {
        this.setData({ 'order.status': 'completed' });
      }

      wx.showToast({ title: '订单已完成', icon: 'success' });

      // 设置司机状态为在线
      app.updateStatus('online');

      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    } catch (err) {
      console.error('完成订单失败:', err);
      this.setData({ processing: false });
    }
  },

  /**
   * 跳过额外费用
   */
  onSkipExtraFee() {
    this.onConfirmComplete();
  },

  /**
   * 阻止事件冒泡（用于弹窗内部点击不关闭弹窗）
   */
  stopPropagation() {},

  /**
   * 关闭额外费用弹窗
   */
  onCloseExtraFee() {
    this.setData({ showExtraFee: false });
  },

  /**
   * 返回
   */
  onBack() {
    wx.navigateBack();
  },

  /**
   * 预览图片
   */
  onPreviewImage(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.previewImage({
      current: url,
      urls: [url]
    });
  }
});
