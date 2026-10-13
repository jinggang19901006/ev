// utils/api.js
// 统一版小程序API封装，覆盖：
//   - /api/auth/*       需求1+2：统一认证 + 注册/登录分离 + 角色选择
//   - /api/cards/*      需求4：服务卡闭环（我的/核销/分配记录）
//   - /api/payments/*   需求5：押金+尾款+服务卡抵扣+信用积分
//   - /api/dispatch/*   需求3：推荐司机 + 等级字典 + 权重
//   - 原有接口 /api/user /api/driver /api/orders /api/config

const BASE_URL = 'http://localhost:3000/api';
const FILE_BASE_URL = 'http://localhost:3000';

const request = (path, options = {}) => {
  const app = getApp ? getApp() : null;
  const token = (app && app.globalData && app.globalData.token) || '';
  options.header = Object.assign({
    'content-type': 'application/json',
    Authorization: token ? `Bearer ${token}` : ''
  }, options.header || {});
  options.timeout = options.timeout || 15000;

  return new Promise((resolve, reject) => {
    wx.showLoading && wx.showLoading({ title: '加载中', mask: true });
    wx.request({
      url: BASE_URL + path,
      method: options.method || 'GET',
      data: options.data,
      header: options.header,
      timeout: options.timeout,
      success(res) {
        wx.hideLoading && wx.hideLoading();
        const body = res.data || {};
        if (res.statusCode === 401 || body.code === 401) {
          try { wx.removeStorageSync('uni_token'); } catch (e) {}
          wx.showToast && wx.showToast({ title: '请重新登录', icon: 'none' });
          return reject(new Error(body.message || '登录过期'));
        }
        if (body.code !== 0) {
          wx.showToast && wx.showToast({ title: body.message || '请求失败', icon: 'none' });
          return reject(new Error(body.message || '请求失败'));
        }
        resolve(body.data);
      },
      fail(err) {
        wx.hideLoading && wx.hideLoading();
        wx.showToast && wx.showToast({ title: '网络异常', icon: 'none' });
        reject(err);
      }
    });
  });
};

/** 相对路径图片转完整URL */
function resolveImageUrl(url) {
  if (!url) return '';
  if (String(url).startsWith('http')) return url;
  return FILE_BASE_URL + (url.startsWith('/') ? '' : '/') + url;
}

/** 上传图片到后端 /api/orders/upload */
function uploadImage(filePath) {
  const app = getApp ? getApp() : null;
  // 兼容：storage token 双别名（uni_token / token）
  const token = (app && app.globalData && app.globalData.token)
    || wx.getStorageSync('uni_token')
    || wx.getStorageSync('token')
    || '';
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: BASE_URL + '/orders/upload',
      filePath,
      // ⚠️ 必须与后端 multer upload.single('photo') 的字段名一致！
      // 前值 name='file' 会导致 multer 抛 500「服务器内部错误」req.file=undefined
      name: 'photo',
      header: { Authorization: token ? `Bearer ${token}` : '' },
      success(r) {
        try {
          const body = JSON.parse(r.data);
          if (body.code !== 0) return reject(new Error(body.message));
          resolve(body.data);
        } catch (e) { reject(e); }
      },
      fail: reject
    });
  });
}

// =====================================================
// 1) 统一认证接口（需求1+2）
// =====================================================
const auth = {
  checkAccount: (params) => request('/auth/check-account' + toQuery(params), { method: 'GET' }),
  sendSms: (phone, scene = 'login') => request('/auth/send-sms', { method: 'POST', data: { phone, scene } }),
  // 老用户登录（role=user/driver）
  loginBySms: ({ phone, code, role, wx_code }) => request('/auth/login-by-sms', { method: 'POST', data: { phone, code, role, wx_code } }),
  loginByWx: (code, role) => request('/auth/login-by-wx', { method: 'POST', data: { code, role } }),
  // 新用户注册（先校验验证码→再入库→返回token）
  register: (body) => request('/auth/register', { method: 'POST', data: body }),
  switchRole: (role) => request('/auth/switch-role', { method: 'POST', data: { role } }),
  me: () => request('/auth/me', { method: 'GET' })
};

// =====================================================
// 2) 配置/定价/等级字典
// =====================================================
const config = {
  pricing: () => request('/config/pricing', { method: 'GET' }),
  serviceInfo: () => request('/config/service-info', { method: 'GET' }),
  dispatchWeights: () => request('/dispatch/weights', { method: 'GET' }),
  driverLevels: () => request('/dispatch/levels', { method: 'GET' }),
  dispatchRecommend: (body) => request('/dispatch/recommend', { method: 'POST', data: body })
};

// =====================================================
// 3) 订单 + 价格预估 + 押金/尾款支付
// =====================================================
const orders = {
  estimate: (body) => request('/orders/estimate', { method: 'POST', data: body }),
  create: (body) => request('/orders/create', { method: 'POST', data: body }),
  active: () => request('/orders/active', { method: 'GET' }),
  detail: (id) => request('/orders/' + id, { method: 'GET' }),
  cancel: (id) => request('/orders/cancel/' + id, { method: 'POST' }),
  payOld: (id) => request('/orders/pay/' + id, { method: 'POST' }),  // 兼容旧版本(模拟支付)
  rate: (id, rating, comment) => request('/orders/rate/' + id, { method: 'POST', data: { rating, comment } }),
  upload: uploadImage
};

const user = {
  login: (body) => request('/user/login', { method: 'POST', data: body }), // 兼容旧openid登录
  info: () => request('/user/info', { method: 'GET' }),
  orders: (page = 1, pageSize = 20) => request('/user/orders' + toQuery({ page, pageSize }), { method: 'GET' }),
  cardsOld: () => request('/user/cards', { method: 'GET' })
};

const driver = {
  login: (body) => request('/driver/login', { method: 'POST', data: body }),
  info: () => request('/driver/info', { method: 'GET' }),
  updateStatus: (status) => request('/driver/status', { method: 'POST', data: { status } }),
  pendingOrders: () => request('/driver/pending-orders', { method: 'GET' }),
  activeOrder: () => request('/driver/active-order', { method: 'GET' }),
  accept: (orderId) => request('/driver/accept/' + orderId, { method: 'POST' }),
  updateOrderStatus: (orderId, body) => request('/driver/update-status/' + orderId, { method: 'POST', data: body }),
  orders: (page = 1, pageSize = 20) => request('/driver/orders' + toQuery({ page, pageSize }), { method: 'GET' }),
  earnings: () => request('/driver/earnings', { method: 'GET' }),
  wallet: () => request('/driver/wallet', { method: 'GET' }),
  withdraw: (body) => request('/driver/withdraw', { method: 'POST', data: body })
};

// =====================================================
// 4) 服务卡闭环（需求4）
// =====================================================
const cards = {
  mine: () => request('/cards/mine', { method: 'GET' }),
  checkAvailable: (id, query) => request(`/cards/${id}/check-available` + toQuery(query), { method: 'GET' }),
  redeem: (id, orderId) => request(`/cards/${id}/redeem`, { method: 'POST', data: { order_id: orderId } }),
  usagesMine: () => request('/cards/usages/mine', { method: 'GET' })
};

// =====================================================
// 5) 支付防逃单（需求5）：押金+尾款+退款+信用积分
// =====================================================
const payments = {
  summary: (orderId) => request(`/payments/order/${orderId}/summary`, { method: 'GET' }),
  payDeposit: (orderId, mode = 'mock', pay_type = 'wechat') => request(`/payments/order/${orderId}/deposit`, { method: 'POST', data: { mode, pay_type } }),
  payFinal: (orderId, opts = {}) => request(`/payments/order/${orderId}/final`, { method: 'POST', data: { mode: 'mock', pay_type: 'wechat', ...opts } }),
  refundDeposit: (orderId, reason) => request(`/payments/order/${orderId}/refund`, { method: 'POST', data: { reason } }),
  recordsMine: (page = 1, pageSize = 20) => request('/payments/records/mine' + toQuery({ page, pageSize }), { method: 'GET' }),
  // 管理端：手动跑逃单扫描
  adminRunEscape: () => request('/payments/admin/run-escape-job', { method: 'POST' }),
  adminRecords: (page, pageSize, params) => request('/payments/admin/records' + toQuery({ page, pageSize, ...params }), { method: 'GET' }),
  adminCredit: (userId) => request(`/payments/admin/credit/${userId}`, { method: 'GET' }),
  adminCreditAdjust: (body) => request('/payments/admin/credit/adjust', { method: 'POST', data: body })
};

// =====================================================
// 6) 后台管理 /api/cards/admin 调用（可复用给司机客服H5场景）
// =====================================================
const adminCards = {
  list: (params) => request('/cards/admin/list' + toQuery(params), { method: 'GET' }),
  create: (body) => request('/cards/admin/create', { method: 'POST', data: body }),
  allocate: (id, body) => request(`/cards/admin/${id}/allocate`, { method: 'POST', data: body }),
  batchAllocate: (body) => request('/cards/admin/batch-allocate', { method: 'POST', data: body }),
  usages: () => request('/cards/admin/usages', { method: 'GET' }),
  allocations: () => request('/cards/admin/allocations', { method: 'GET' })
};

// utils
function toQuery(obj) {
  if (!obj) return '';
  const list = [];
  Object.keys(obj).forEach(k => {
    const v = obj[k];
    if (v === undefined || v === null || v === '') return;
    list.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  });
  if (!list.length) return '';
  return '?' + list.join('&');
}

module.exports = {
  BASE_URL, FILE_BASE_URL, request, resolveImageUrl, uploadImage,
  auth, config, orders, user, driver, cards, payments, adminCards,
  // 旧命名兼容
  checkAccount: auth.checkAccount,
  sendSms: auth.sendSms,
  loginBySms: auth.loginBySms,
  loginByWx: auth.loginByWx,
  register: auth.register,
  switchRole: auth.switchRole,
  authMe: auth.me,
  getDriverLevels: config.driverLevels,
  getPricing: config.pricing,
  getServiceInfo: config.serviceInfo
};
