/**
 * API 请求封装
 * 新能源车移动充电救援系统 - 管理后台
 */
const API_BASE = 'http://localhost:3000/api';

/* ---------------- Token 管理 ---------------- */
const TokenManager = {
  get() {
    return localStorage.getItem('admin_token');
  },
  set(token) {
    localStorage.setItem('admin_token', token);
  },
  remove() {
    localStorage.removeItem('admin_token');
  },
  getAdmin() {
    const info = localStorage.getItem('admin_info');
    return info ? JSON.parse(info) : null;
  },
  setAdmin(admin) {
    localStorage.setItem('admin_info', JSON.stringify(admin));
  },
  clear() {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_info');
  }
};

/* ---------------- 通用请求函数 ---------------- */
async function request(path, options = {}) {
  const token = TokenManager.get();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;

  let response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (e) {
    throw new Error('网络连接失败，请检查网络或确认后端服务已启动');
  }

  let result;
  try {
    result = await response.json();
  } catch (e) {
    throw new Error('服务器响应格式错误');
  }

  // 未授权：token 过期或未登录
  if (response.status === 401 || result.code === 401) {
    TokenManager.clear();
    if (typeof App !== 'undefined' && App.showLogin) {
      App.showLogin();
    }
    throw new Error(result.message || '登录已过期，请重新登录');
  }

  // 无权限
  if (response.status === 403 || result.code === 403) {
    throw new Error(result.message || '无操作权限');
  }

  // 成功
  if (result.code === 0) {
    return result.data;
  }

  // 其它业务错误
  throw new Error(result.message || '请求失败');
}

/* ---------------- API 接口集合 ---------------- */
const API = {
  /* ===== 认证 ===== */
  login(username, password) {
    return request('/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
  },

  /* ===== 数据看板 ===== */
  getDashboard() {
    return request('/admin/dashboard');
  },

  /* ===== 订单管理 ===== */
  getOrders(params = {}) {
    const query = new URLSearchParams();
    if (params.page) query.append('page', params.page);
    if (params.pageSize) query.append('pageSize', params.pageSize);
    if (params.status) query.append('status', params.status);
    if (params.vehicleType) query.append('vehicleType', params.vehicleType);
    if (params.keyword) query.append('keyword', params.keyword);
    const qs = query.toString();
    return request(`/admin/orders${qs ? '?' + qs : ''}`);
  },

  getOrderDetail(id) {
    return request(`/admin/orders/${id}`);
  },

  updateOrderPrice(id, data) {
    return request(`/admin/orders/${id}/price`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  /* ===== 司机管理 ===== */
  getDrivers(params = {}) {
    const query = new URLSearchParams();
    if (params.page) query.append('page', params.page);
    if (params.pageSize) query.append('pageSize', params.pageSize);
    const qs = query.toString();
    return request(`/admin/drivers${qs ? '?' + qs : ''}`);
  },

  approveDriver(id) {
    return request(`/admin/drivers/${id}/approve`, { method: 'POST' });
  },

  rejectDriver(id) {
    return request(`/admin/drivers/${id}/reject`, { method: 'POST' });
  },

  /* ===== 定价配置 ===== */
  getPricing() {
    return request('/admin/pricing');
  },

  updatePricing(id, data) {
    return request(`/admin/pricing/${id}`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  /* ===== 服务卡管理（旧视图：统一改走 /cards/admin/* 全闭环端点）===== */
  async getCards() {
    // 老视图期望直接返回数组；新端点返回 {total,list}
    const data = await request('/cards/admin/list?page=1&pageSize=200&status=all');
    return (data && data.list) || [];
  },

  createCard(data) {
    // 兼容老入参 {vehicleType, price}，统一映射新端点字段
    const body = {
      count: 1,
      price: data.price,
      discount_amount: data.price,
      vehicle_type: data.vehicleType || data.vehicle_type || data.vehicle_size || 'small',
      name: data.name || '',
      remark: data.remark || '',
      total_uses: data.total_uses || 1
    };
    return request('/cards/admin/create', {
      method: 'POST',
      body: JSON.stringify(body)
    }).then(res => ({
      cardNo: (res && res.cards && res.cards[0] && res.cards[0].card_no) || '',
      ...res
    }));
  },

  deleteCard(id) {
    return request(`/cards/admin/${id}`, { method: 'DELETE' });
  },

  /* ===== 用户管理 ===== */
  getUsers(params = {}) {
    const query = new URLSearchParams();
    if (params.page) query.append('page', params.page);
    if (params.pageSize) query.append('pageSize', params.pageSize);
    if (params.keyword) query.append('keyword', params.keyword);
    const qs = query.toString();
    return request(`/admin/users${qs ? '?' + qs : ''}`);
  },

  getUserDetail(id) {
    return request(`/admin/users/${id}`);
  },

  deleteUser(id) {
    return request(`/admin/users/${id}`, { method: 'DELETE' });
  },

  /* ===== 订单管理增强 ===== */
  cancelOrder(id) {
    return request(`/admin/orders/${id}/cancel`, { method: 'POST' });
  },

  deleteOrder(id) {
    return request(`/admin/orders/${id}`, { method: 'DELETE' });
  },

  assignDriver(orderId, driverId) {
    return request(`/admin/orders/${orderId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ driverId })
    });
  },

  /* ===== 司机管理增强 ===== */
  editDriver(id, data) {
    return request(`/admin/drivers/${id}/edit`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  deleteDriver(id) {
    return request(`/admin/drivers/${id}`, { method: 'DELETE' });
  },

  getAvailableDrivers() {
    return request('/admin/drivers/available');
  },

  /* ===== 系统配置管理 ===== */
  getConfig() {
    return request('/admin/config');
  },

  updateConfig(data) {
    return request('/admin/config', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  /* ===== 提现管理 ===== */
  getWithdrawals(params = {}) {
    const query = new URLSearchParams();
    if (params.page) query.append('page', params.page);
    if (params.pageSize) query.append('pageSize', params.pageSize);
    if (params.status) query.append('status', params.status);
    const qs = query.toString();
    return request(`/admin/withdrawals${qs ? '?' + qs : ''}`);
  },

  approveWithdrawal(id) {
    return request(`/admin/withdrawals/${id}/approve`, { method: 'POST' });
  },

  rejectWithdrawal(id) {
    return request(`/admin/withdrawals/${id}/reject`, { method: 'POST' });
  },

  /* ===== 司机钱包一览 ===== */
  getWallets() {
    return request('/admin/wallets');
  },

  /* ===== 服务卡闭环：管理端（/api/cards/admin/*）===== */
  cardList(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/cards/admin/list${qs ? '?' + qs : ''}`);
  },
  cardCreate(data) {
    return request('/cards/admin/create', { method: 'POST', body: JSON.stringify(data) });
  },
  cardAllocate(id, data) {
    return request(`/cards/admin/${id}/allocate`, { method: 'POST', body: JSON.stringify(data) });
  },
  cardBatchAllocate(data) {
    return request('/cards/admin/batch-allocate', { method: 'POST', body: JSON.stringify(data) });
  },
  cardDelete(id) {
    return request(`/cards/admin/${id}`, { method: 'DELETE' });
  },
  cardUsages() {
    return request('/cards/admin/usages');
  },
  cardAllocations() {
    return request('/cards/admin/allocations');
  },

  /* ===== 订单调度（/api/dispatch/*）===== */
  dispatchRecommend(orderId) {
    return request('/dispatch/recommend', {
      method: 'POST',
      body: JSON.stringify({ order_id: orderId })
    });
  },
  dispatchWeights() {
    return request('/dispatch/weights');
  },
  dispatchLevels() {
    return request('/dispatch/levels');
  },

  /* ===== 支付与防逃单 /api/payments/admin ===== */
  paymentRecords(params = {}) {
    // 注意：URLSearchParams 会把 undefined 序列化成字面量 "biz_type=undefined"，
    // 后端会把它当成真实过滤值导致列表被滤空。这里手动跳过 undefined/null/'' 参数。
    const pairs = [];
    Object.keys(params || {}).forEach(k => {
      const v = params[k];
      if (v === undefined || v === null || v === '' || v === 'all') return;
      pairs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    const qs = pairs.join('&');
    return request(`/payments/admin/records${qs ? '?' + qs : ''}`);
  },
  paymentRunEscapeJob() {
    return request('/payments/admin/run-escape-job', { method: 'POST' });
  },
  paymentGetCredit(userId) {
    return request(`/payments/admin/credit/${userId}`);
  },
  paymentAdjustCredit(data) {
    return request('/payments/admin/credit/adjust', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }
};
