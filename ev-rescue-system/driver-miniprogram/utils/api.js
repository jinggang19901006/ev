/**
 * utils/api.js - API请求封装
 * 新能源车移动充电救援服务 - 司机端
 */

const app = getApp();

// 后端API基础地址
const BASE_URL = 'http://localhost:3000/api';
// 文件资源基础地址（用于图片等静态资源）
const FILE_BASE_URL = 'http://localhost:3000';

/**
 * 处理图片URL - 将相对路径转换为完整URL
 * @param {string} url - 图片URL（可能是相对路径）
 * @returns {string} 完整的图片URL
 */
function resolveImageUrl(url) {
  if (!url) return '';
  // 如果已经是完整URL，直接返回
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url;
  }
  // 相对路径补全
  if (url.startsWith('/')) {
    return FILE_BASE_URL + url;
  }
  return FILE_BASE_URL + '/' + url;
}

/**
 * 通用请求方法
 * @param {string} url - 接口路径(不含/api前缀)
 * @param {string} method - 请求方法 GET/POST
 * @param {object} data - 请求数据
 * @param {boolean} showLoading - 是否显示加载提示
 * @returns {Promise}
 */
function request(url, method, data, showLoading) {
  return new Promise((resolve, reject) => {
    if (showLoading) {
      wx.showLoading({ title: '加载中...', mask: true });
    }

    const token = wx.getStorageSync('token') || '';
    const header = {
      'Content-Type': 'application/json'
    };

    if (token) {
      header['Authorization'] = 'Bearer ' + token;
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
          // 请求成功
          if (res.data.code !== undefined) {
            // 后端统一返回格式 { code, message, data }
            if (res.data.code === 0 || res.data.code === 200 || res.data.success) {
              resolve(res.data.data !== undefined ? res.data.data : res.data);
            } else {
              // 业务错误
              const errMsg = res.data.message || '请求失败';
              if (res.data.code === 401 || res.statusCode === 401) {
                handleUnauthorized();
              } else {
                wx.showToast({ title: errMsg, icon: 'none' });
              }
              reject(new Error(errMsg));
            }
          } else {
            // 直接返回数据
            resolve(res.data);
          }
        } else if (res.statusCode === 401) {
          handleUnauthorized();
          reject(new Error('未授权'));
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
  wx.removeStorageSync('driver');
  wx.removeStorageSync('driverStatus');
  if (app) {
    app.globalData.token = '';
    app.globalData.driver = null;
    app.globalData.status = 'offline';
  }
  wx.showToast({ title: '登录已过期，请重新登录', icon: 'none', duration: 2000 });
  setTimeout(() => {
    wx.reLaunch({ url: '/pages/login/login' });
  }, 1500);
}

/**
 * 上传图片文件
 * @param {string} filePath - 本地文件路径
 * @param {string} url - 上传接口地址(可选，默认使用通用上传)
 * @returns {Promise}
 */
function uploadFile(filePath, url, fieldName) {
  return new Promise((resolve, reject) => {
    wx.showLoading({ title: '上传中...', mask: true });

    const token = wx.getStorageSync('token') || '';
    const header = {};
    if (token) {
      header['Authorization'] = 'Bearer ' + token;
    }

    wx.uploadFile({
      url: BASE_URL + (url || '/orders/upload'),
      filePath: filePath,
      name: fieldName || 'photo',
      header: header,
      success(res) {
        wx.hideLoading();
        try {
          const data = JSON.parse(res.data);
          if (data.code === 0 || data.code === 200 || data.success || data.url) {
            resolve(data.data !== undefined ? data.data : data);
          } else {
            wx.showToast({ title: data.message || '上传失败', icon: 'none' });
            reject(new Error(data.message || '上传失败'));
          }
        } catch (e) {
          // 如果不是JSON，直接返回data
          resolve({ url: res.data });
        }
      },
      fail(err) {
        wx.hideLoading();
        console.error('上传失败:', err);
        wx.showToast({ title: '上传失败', icon: 'none' });
        reject(err);
      }
    });
  });
}

/* ============================================
 * API接口定义
 * ============================================ */

const api = {
  /**
   * 1. 司机登录
   * @param {object} params - { openid, phone, name, avatar }
   * @returns {Promise} { token, driver }
   */
  login(params) {
    return request('/driver/login', 'POST', {
      openid: params.openid,
      phone: params.phone,
      name: params.name,
      avatar: params.avatar || ''
    }, true);
  },

  /**
   * 2. 获取司机信息
   * @returns {Promise} driver info
   */
  getDriverInfo() {
    return request('/driver/info', 'GET', {}, false);
  },

  /**
   * 3. 更新司机状态
   * @param {string} status - online / offline / busy
   * @returns {Promise}
   */
  updateDriverStatus(status) {
    return request('/driver/status', 'POST', { status: status }, false);
  },

  /**
   * 4. 获取待接单列表
   * @returns {Promise} orders array
   */
  getPendingOrders() {
    return request('/driver/pending-orders', 'GET', {}, false);
  },

  /**
   * 4.5 获取订单详情
   * @param {string} orderId - 订单ID或订单号
   * @returns {Promise} order detail
   */
  getOrderDetail(orderId) {
    return request('/orders/' + orderId, 'GET', {}, false);
  },

  /**
   * 5. 接单
   * @param {string} orderId
   * @returns {Promise}
   */
  acceptOrder(orderId) {
    return request('/driver/accept/' + orderId, 'POST', {}, true);
  },

  /**
   * 6. 更新订单状态
   * @param {string} orderId
   * @param {object} params - { status, beforePhoto, afterPhoto, extraFee }
   * @returns {Promise}
   */
  updateOrderStatus(orderId, params) {
    return request('/driver/update-status/' + orderId, 'POST', params, true);
  },

  /**
   * 7. 获取司机订单历史
   * @param {number} page
   * @returns {Promise}
   */
  getDriverOrders(page) {
    return request('/driver/orders?page=' + (page || 1), 'GET', {}, false);
  },

  /**
   * 8. 获取收入统计
   * @returns {Promise} { today, month, total }
   */
  getEarnings() {
    return request('/driver/earnings', 'GET', {}, false);
  },

  /**
   * 9. 获取钱包信息
   */
  getWallet() {
    return request('/driver/wallet', 'GET', {}, false);
  },

  /**
   * 10. 申请提现
   */
  requestWithdraw(amount, type, account) {
    return request('/driver/withdraw', 'POST', { amount, type, account }, false);
  },

  /**
   * 上传图片
   * @param {string} filePath
   * @returns {Promise} { url }
   */
  uploadImage(filePath) {
    // 修复：后端上传路由是 /orders/upload，字段名是 'photo'
    return uploadFile(filePath, '/orders/upload', 'photo');
  },

  /**
   * 处理图片URL - 将相对路径转换为完整URL
   */
  resolveImageUrl: resolveImageUrl
};

module.exports = api;
