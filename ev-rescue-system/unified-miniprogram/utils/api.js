// utils/api.js
// 统一版小程序API封装，覆盖：
//   - /api/auth/*       需求1+2：统一认证 + 注册/登录分离 + 角色选择
//   - /api/cards/*      需求4：服务卡闭环（我的/核销/分配记录）
//   - /api/payments/*   需求5：押金+尾款+服务卡抵扣+信用积分
//   - /api/dispatch/*   需求3：推荐司机 + 等级字典 + 权重
//   - 原有接口 /api/user /api/driver /api/orders /api/config

const env = require('../config/env.js');
const BASE_URL = env.DEVTOOLS_HOST + '/api';
const FILE_BASE_URL = env.DEVTOOLS_HOST;

function getBaseUrl() {
  const app = getApp ? getApp() : null;
  return (app && app.globalData && app.globalData.apiUrl) || BASE_URL;
}

function getFileBaseUrl() {
  const app = getApp ? getApp() : null;
  return (app && app.globalData && app.globalData.fileBaseUrl) || FILE_BASE_URL;
}

function useCloudContainer(app) {
  return Boolean(
    env.USE_CLOUD_CONTAINER &&
    wx.cloud &&
    app &&
    app.globalData &&
    app.globalData.useCloudContainer
  );
}

const request = (path, options = {}) => {
  const app = getApp ? getApp() : null;
  const token = (app && app.globalData && app.globalData.token) || '';
  options.header = Object.assign({
    'content-type': 'application/json',
    Authorization: token ? `Bearer ${token}` : ''
  }, options.header || {});
  options.timeout = options.timeout || 15000;
  const showLoading = options.showLoading !== false;

  return new Promise((resolve, reject) => {
    if (showLoading) wx.showLoading && wx.showLoading({ title: '加载中', mask: true });
    const requestOptions = {
      method: options.method || 'GET',
      data: options.data,
      header: options.header,
      timeout: options.timeout,
      success(res) {
        if (showLoading) wx.hideLoading && wx.hideLoading();
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
        if (showLoading) wx.hideLoading && wx.hideLoading();
        const isDevtools = !!(app && app.globalData && app.globalData.isDevtools);
        const host = (app && app.globalData && app.globalData.apiHost) || getBaseUrl();
        const message = isDevtools
          ? '无法连接本地服务，请确认后端已启动'
          : '无法连接服务，请确认手机与电脑连接同一WiFi';
        console.error('[network] request failed:', getBaseUrl() + path, err);
        wx.showToast && wx.showToast({ title: message, icon: 'none', duration: 3000 });
        const error = new Error(message);
        error.cause = err;
        error.apiHost = host;
        reject(error);
      }
    };

    if (useCloudContainer(app)) {
      wx.cloud.callContainer(Object.assign({}, requestOptions, {
        config: { env: app.globalData.cloudEnvId },
        path: '/api' + path,
        header: Object.assign({}, requestOptions.header, {
          'X-WX-SERVICE': app.globalData.cloudService
        })
      }));
    } else {
      wx.request(Object.assign({}, requestOptions, {
        url: getBaseUrl() + path
      }));
    }
  });
};

/** 相对路径图片转完整URL */
function resolveImageUrl(url) {
  if (!url) return '';
  if (/^(https?:|cloud:|wxfile:)/.test(String(url))) return url;
  return getFileBaseUrl() + (url.startsWith('/') ? '' : '/') + url;
}

async function resolveImageUrlForDisplay(url) {
  const resolved = resolveImageUrl(url);
  if (!String(resolved).startsWith('cloud://') || !wx.cloud) return resolved;
  const result = await wx.cloud.getTempFileURL({ fileList: [resolved] });
  const file = result && result.fileList && result.fileList[0];
  return (file && file.tempFileURL) || resolved;
}

/** 上传图片到后端 /api/orders/upload */
function uploadImage(filePath) {
  const app = getApp ? getApp() : null;
  // 兼容：storage token 双别名（uni_token / token）
  const token = (app && app.globalData && app.globalData.token)
    || wx.getStorageSync('uni_token')
    || wx.getStorageSync('token')
    || '';
  if (useCloudContainer(app)) {
    const extensionMatch = String(filePath).match(/\.(jpe?g|png|webp)(?:\?.*)?$/i);
    const ext = extensionMatch ? `.${extensionMatch[1].toLowerCase()}` : '.jpg';
    return new Promise((resolve, reject) => {
      wx.getFileSystemManager().readFile({
        filePath,
        encoding: 'base64',
        success(result) {
          request('/orders/upload-base64', {
            method: 'POST',
            data: { base64: result.data, ext }
          }).then(resolve).catch(reject);
        },
        fail(error) {
          wx.showToast && wx.showToast({ title: '读取图片失败', icon: 'none' });
          reject(error);
        }
      });
    });
  }

  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: getBaseUrl() + '/orders/upload',
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
      fail(err) {
        const app = getApp ? getApp() : null;
        const isDevtools = !!(app && app.globalData && app.globalData.isDevtools);
        const message = isDevtools
          ? '上传失败，请确认后端已启动'
          : '上传失败，请确认手机与电脑连接同一WiFi';
        console.error('[network] upload failed:', getBaseUrl() + '/orders/upload', err);
        wx.showToast && wx.showToast({ title: message, icon: 'none', duration: 3000 });
        reject(new Error(message));
      }
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
  updateLocation: (body) => request('/driver/location', { method: 'POST', data: body, showLoading: false }),
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
  BASE_URL, FILE_BASE_URL, request, resolveImageUrl, resolveImageUrlForDisplay, uploadImage,
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
