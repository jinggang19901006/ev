/**
 * utils/api.js - API请求封装
 * 绵阳24小时新能源应急充电救援 - 用户端
 */

// 后端API基础地址
const BASE_URL = 'http://localhost:3000/api';

/**
 * 通用请求方法
 * @param {string} url - 接口路径(不含/api前缀，以/开头)
 * @param {string} method - 请求方法 GET/POST
 * @param {object} data - 请求数据
 * @param {boolean} needAuth - 是否需要登录验证
 * @param {boolean} showLoading - 是否显示加载提示
 * @returns {Promise}
 */
function request(url, method, data, needAuth, showLoading) {
  return new Promise((resolve, reject) => {
    if (showLoading) {
      wx.showLoading({ title: '加载中...', mask: true });
    }

    const header = {
      'Content-Type': 'application/json'
    };

    if (needAuth) {
      const token = wx.getStorageSync('token') || '';
      if (token) {
        header['Authorization'] = 'Bearer ' + token;
      } else {
        if (showLoading) wx.hideLoading();
        wx.showToast({ title: '请先登录', icon: 'none' });
        reject(new Error('未登录'));
        return;
      }
    }

    wx.request({
      url: BASE_URL + url,
      method: method || 'GET',
      data: data || {},
      header: header,
      timeout: 15000,
      success(res) {
        if (showLoading) {
          wx.hideLoading();
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          // 后端统一返回格式 { code, message, data }
          if (res.data.code !== undefined) {
            if (res.data.code === 0) {
              resolve(res.data.data !== undefined ? res.data.data : res.data);
            } else if (res.data.code === 401) {
              handleUnauthorized();
              reject(new Error(res.data.message || '登录已过期'));
            } else {
              const errMsg = res.data.message || '请求失败';
              wx.showToast({ title: errMsg, icon: 'none' });
              reject(new Error(errMsg));
            }
          } else {
            resolve(res.data);
          }
        } else if (res.statusCode === 401) {
          handleUnauthorized();
          reject(new Error('登录已过期'));
        } else {
          const errMsg = (res.data && res.data.message) || '网络请求失败(' + res.statusCode + ')';
          wx.showToast({ title: errMsg, icon: 'none' });
          reject(new Error(errMsg));
        }
      },
      fail(err) {
        if (showLoading) {
          wx.hideLoading();
        }
        console.error('请求失败:', url, err);
        wx.showToast({ title: '网络连接失败，请检查网络', icon: 'none' });
        reject(err);
      }
    });
  });
}

/**
 * 处理未授权(401)情况
 */
function handleUnauthorized() {
  wx.removeStorageSync('token');
  const app = getApp();
  if (app) {
    app.globalData.token = null;
    app.globalData.userInfo = null;
  }
  wx.showToast({ title: '登录已过期，请重新登录', icon: 'none', duration: 2000 });
}

/* ============================================
 * API接口定义
 * ============================================ */

const api = {
  /**
   * 1. 用户登录
   * @param {object} params - { openid, phone, nickname, avatar }
   * @returns {Promise} { token, user }
   */
  login(params) {
    return request('/user/login', 'POST', {
      openid: params.openid,
      phone: params.phone || '',
      nickname: params.nickname || '微信用户',
      avatar: params.avatar || ''
    }, false, true);
  },

  /**
   * 2. 获取用户信息
   * @returns {Promise} user info
   */
  getUserInfo() {
    return request('/user/info', 'GET', null, true, false);
  },

  /**
   * 3. 获取用户订单列表
   * @param {number} page - 页码
   * @param {number} pageSize - 每页条数
   * @returns {Promise} { list, total, page }
   */
  getUserOrders(page, pageSize) {
    return request('/user/orders?page=' + (page || 1) + '&pageSize=' + (pageSize || 20), 'GET', null, true, false);
  },

  /**
   * 4. 获取用户服务卡
   * @returns {Promise} cards array
   */
  getUserCards() {
    return request('/user/cards', 'GET', null, true, false);
  },

  /**
   * 5. 获取定价配置（公开接口）
   * @returns {Promise} pricing configs
   */
  getPricing() {
    return request('/config/pricing', 'GET', null, false, false);
  },

  /**
   * 6. 获取服务信息（公开接口）
   * @returns {Promise} service info
   */
  getServiceInfo() {
    return request('/config/service-info', 'GET', null, false, false);
  },

  /**
   * 7. 创建订单
   * @param {object} data - { vehicleType, vehiclePlate, batteryPercent, dashboardOff, pickupLat, pickupLng, pickupAddress, pickupDescription, distanceKm, extraFee }
   * @returns {Promise} order
   */
  createOrder(data) {
    return request('/orders/create', 'POST', data, true, true);
  },

  /**
   * 8. 获取订单详情
   * @param {string} orderId - 订单ID或订单号
   * @returns {Promise} order detail
   */
  getOrderDetail(orderId) {
    return request('/orders/' + orderId, 'GET', null, true, false);
  },

  /**
   * 9. 价格预估
   * @param {object} data - { vehicleType, distanceKm, extraFee }
   * @returns {Promise} price estimate
   */
  estimatePrice(data) {
    return request('/orders/estimate', 'POST', data, true, false);
  },

  /**
   * 10. 取消订单
   * @param {string} orderId
   * @returns {Promise}
   */
  cancelOrder(orderId) {
    return request('/orders/cancel/' + orderId, 'POST', null, true, true);
  },

  /**
   * 11. 支付订单
   * @param {string} orderId
   * @returns {Promise}
   */
  payOrder(orderId) {
    return request('/orders/pay/' + orderId, 'POST', null, true, true);
  },

  /**
   * 12. 评价订单
   * @param {string} orderId
   * @param {number} rating - 1-5
   * @param {string} comment
   * @returns {Promise}
   */
  rateOrder(orderId, rating, comment) {
    return request('/orders/rate/' + orderId, 'POST', { rating, comment }, true, true);
  },

  /**
   * 13. 获取当前进行中的订单
   * @returns {Promise} active order or null
   */
  getActiveOrder() {
    return request('/orders/active', 'GET', null, true, false);
  }
};

module.exports = api;
