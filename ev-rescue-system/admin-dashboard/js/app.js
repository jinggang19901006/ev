/**
 * 新能源车移动充电救援系统 - 管理后台主逻辑
 */
(function () {
  'use strict';

  /* ============================================================
     常量映射
     ============================================================ */
  const STATUS_MAP = {
    pending:   { label: '待接单', class: 'badge-pending' },
    accepted:  { label: '已接单', class: 'badge-accepted' },
    dispatched:{ label: '前往中', class: 'badge-en_route' },
    en_route:  { label: '前往中', class: 'badge-en_route' },
    arrived:   { label: '已到达', class: 'badge-arrived' },
    charging:  { label: '充电中', class: 'badge-charging' },
    completed: { label: '已完成', class: 'badge-completed' },
    cancelled: { label: '已取消', class: 'badge-cancelled' }
  };

  const VEHICLE_MAP = {
    small:  { label: '小型车',           tag: 'vehicle-small' },
    medium: { label: '中型车(4.2米货车)', tag: 'vehicle-medium' },
    large:  { label: '大型车(重卡)',     tag: 'vehicle-large' },
    '*':    { label: '通用车型',         tag: 'vehicle-small' }
  };

  const DRIVER_STATUS_MAP = {
    online:  { label: '在线', class: 'badge-online' },
    offline: { label: '离线', class: 'badge-offline' },
    busy:    { label: '忙碌', class: 'badge-busy' }
  };

  const CARD_STATUS_MAP = {
    unused:   { label: '未使用', class: 'badge-unused' },
    active:   { label: '已分配·可用', class: 'badge-online' },
    used:     { label: '已使用', class: 'badge-used' },
    redeemed: { label: '已核销', class: 'badge-used' },
    expired:  { label: '已过期', class: 'badge-expired' }
  };

  const VIEW_TITLES = {
    dashboard: '数据看板',
    orders: '订单管理',
    drivers: '司机管理',
    users: '用户管理',
    pricing: '定价配置',
    cards: '服务卡管理',
    cardsAssign: '服务卡分配',
    dispatch: '订单调度',
    payments: '支付流水',
    credit: '信用积分',
    config: '系统配置',
    withdrawals: '提现管理'
  };

  /* ============================================================
     应用状态
     ============================================================ */
  const state = {
    currentView: 'dashboard',
    orders: { page: 1, pageSize: 20, total: 0, list: [], status: 'all', vehicleType: 'all', keyword: '' },
    drivers: { page: 1, pageSize: 20, total: 0, list: [], statusFilter: 'all' },
    users: { page: 1, pageSize: 20, total: 0, list: [], keyword: '' },
    pricing: [],
    cards: [],
    // 新增视图状态
    cardsAssign: { tab: 'unallocated', list: [], filter: '', allocations: [], usages: [] },
    dispatch: { orderId: '', recommend: null, levels: [], weights: null, queue: [], logs: [] },
    payments: { page: 1, pageSize: 20, total: 0, list: [], filterType: 'all', status: 'all' },
    credit: { users: [], history: {}, selectedUserId: null, adjustForm: { userId: null, delta: '', reason: '' } },
    withdrawals: { page: 1, pageSize: 50, total: 0, list: [], status: 'all', processingId: null, action: '' },
    currentOrderId: null,
    currentDriver: null,
    currentUserId: null,
    confirmCallback: null,
    commissionRate: 0.2
  };

  /* ============================================================
     工具函数
     ============================================================ */
  function $(selector) { return document.querySelector(selector); }
  function $$(selector) { return document.querySelectorAll(selector); }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatMoney(amount) {
    const num = Number(amount);
    if (isNaN(num)) return '¥0.00';
    return '¥' + num.toFixed(2);
  }

  function formatNumber(num) {
    const n = Number(num);
    if (isNaN(n)) return '0';
    return n.toLocaleString('zh-CN');
  }

  const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

  function parseBeijingDate(value) {
    if (value instanceof Date) return new Date(value.getTime());
    if (typeof value === 'number') return new Date(value);
    const text = String(value || '').trim();
    const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    if (match && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
      return new Date(Date.UTC(
        Number(match[1]), Number(match[2]) - 1, Number(match[3]),
        Number(match[4]), Number(match[5]), Number(match[6] || 0)
      ) - BEIJING_OFFSET_MS);
    }
    const dateMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (dateMatch) {
      return new Date(Date.UTC(
        Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])
      ) - BEIJING_OFFSET_MS);
    }
    return new Date(text);
  }

  function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = parseBeijingDate(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const shifted = new Date(d.getTime() + BEIJING_OFFSET_MS);
    const Y = shifted.getUTCFullYear();
    const M = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const D = String(shifted.getUTCDate()).padStart(2, '0');
    const h = String(shifted.getUTCHours()).padStart(2, '0');
    const m = String(shifted.getUTCMinutes()).padStart(2, '0');
    return `${Y}-${M}-${D} ${h}:${m}`;
  }

  function getStatusBadge(status) {
    const s = STATUS_MAP[status] || { label: status, class: 'badge-cancelled' };
    return `<span class="badge ${s.class}">${escapeHtml(s.label)}</span>`;
  }

  function getVehicleTag(type) {
    const v = VEHICLE_MAP[type] || { label: type, tag: 'vehicle-small' };
    return `<span class="vehicle-tag ${v.tag}">${escapeHtml(v.label)}</span>`;
  }

  function getDriverStatusBadge(status) {
    const s = DRIVER_STATUS_MAP[status] || { label: status, class: 'badge-offline' };
    return `<span class="badge ${s.class}">${escapeHtml(s.label)}</span>`;
  }

  function getCardStatusBadge(status) {
    const s = CARD_STATUS_MAP[status] || { label: status, class: 'badge-unused' };
    return `<span class="badge ${s.class}">${escapeHtml(s.label)}</span>`;
  }

  function getInitial(name) {
    if (!name) return 'A';
    return name.charAt(0).toUpperCase();
  }

  function debounce(fn, delay) {
    let timer = null;
    return function () {
      const ctx = this, args = arguments;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(ctx, args), delay);
    };
  }

  /* ============================================================
     Toast 提示
     ============================================================ */
  function showToast(message, type) {
    type = type || 'info';
    const container = $('#toastContainer');
    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span class="toast-msg">${escapeHtml(message)}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.transition = 'opacity 0.3s, transform 0.3s';
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /* ============================================================
     模态框
     ============================================================ */
  function openModal(id) {
    $('#' + id).classList.add('show');
  }

  function closeModal(id) {
    $('#' + id).classList.remove('show');
  }

  function showConfirm(options) {
    $('#confirmTitle').textContent = options.title || '确认操作';
    $('#confirmMessage').textContent = options.message || '确定执行此操作吗？';
    $('#confirmDesc').textContent = options.desc || '';
    const body = $('#confirmBody');
    body.classList.toggle('confirm-danger', options.danger === true);
    const iconEl = body.querySelector('.confirm-icon');
    iconEl.textContent = options.danger ? '🗑' : '⚠️';
    const okBtn = $('#confirmOkBtn');
    okBtn.textContent = options.confirmText || '确定';
    okBtn.className = 'btn ' + (options.danger ? 'btn-danger' : 'btn-primary');
    state.confirmCallback = options.onConfirm || null;
    openModal('confirmModal');
  }

  /* ============================================================
     登录 / 登出
     ============================================================ */
  function showLogin() {
    $('#loginPage').style.display = 'flex';
    $('#appLayout').classList.remove('show');
  }

  function showApp() {
    $('#loginPage').style.display = 'none';
    $('#appLayout').classList.add('show');
    const admin = TokenManager.getAdmin();
    if (admin) {
      const name = admin.name || admin.username || '管理员';
      $('#topbarAdminName').textContent = name;
      $('#sidebarAdminName').textContent = name;
      const initial = getInitial(name);
      $('#topbarAvatar').textContent = initial;
      $('#sidebarAvatar').textContent = initial;
    }
  }

  function checkAuth() {
    const token = TokenManager.get();
    if (token) {
      showApp();
      switchView('dashboard');
    } else {
      showLogin();
    }
  }

  async function handleLogin(e) {
    if (e) e.preventDefault();
    const username = $('#loginUsername').value.trim();
    const password = $('#loginPassword').value.trim();
    const errorEl = $('#loginError');
    const btn = $('#loginBtn');

    if (!username || !password) {
      errorEl.textContent = '请输入用户名和密码';
      errorEl.classList.add('show');
      return;
    }

    errorEl.classList.remove('show');
    btn.disabled = true;
    btn.textContent = '登录中...';

    try {
      const data = await API.login(username, password);
      TokenManager.set(data.token);
      TokenManager.setAdmin(data.admin);
      showToast('登录成功', 'success');
      showApp();
      switchView('dashboard');
    } catch (err) {
      errorEl.textContent = err.message || '登录失败';
      errorEl.classList.add('show');
    } finally {
      btn.disabled = false;
      btn.textContent = '登 录';
    }
  }

  function handleLogout() {
    showConfirm({
      title: '退出登录',
      message: '确定要退出登录吗？',
      confirmText: '退出',
      danger: true,
      onConfirm: function () {
        TokenManager.clear();
        $('#loginPassword').value = '';
        showLogin();
        showToast('已退出登录', 'info');
      }
    });
  }

  /* ============================================================
     视图切换
     ============================================================ */
  function switchView(viewName) {
    state.currentView = viewName;

    // 导航高亮
    $$('.sidebar-nav .nav-item').forEach(function (item) {
      item.classList.toggle('active', item.dataset.view === viewName);
    });

    // 视图显示
    $$('.view').forEach(function (v) {
      v.classList.remove('active');
    });
    const viewEl = $('#view-' + viewName);
    if (viewEl) viewEl.classList.add('active');

    // 标题
    $('#pageTitle').textContent = VIEW_TITLES[viewName] || '';

    // 关闭移动端侧边栏
    $('#sidebar').classList.remove('open');
    $('#sidebarBackdrop').classList.remove('show');

    // 加载数据
    if (viewName === 'dashboard') loadDashboard();
    else if (viewName === 'orders') loadOrders();
    else if (viewName === 'drivers') loadDrivers();
    else if (viewName === 'users') loadUsers();
    else if (viewName === 'pricing') loadPricing();
    else if (viewName === 'cards') loadCards();
    else if (viewName === 'cardsAssign') loadCardsAssign();
    else if (viewName === 'dispatch') loadDispatch();
    else if (viewName === 'payments') loadPayments();
    else if (viewName === 'credit') loadCredit();
    else if (viewName === 'config') loadConfig();
    else if (viewName === 'withdrawals') loadWithdrawals();
  }

  function refreshCurrentView() {
    if (state.currentView === 'dashboard') loadDashboard();
    else if (state.currentView === 'orders') loadOrders();
    else if (state.currentView === 'drivers') loadDrivers();
    else if (state.currentView === 'users') loadUsers();
    else if (state.currentView === 'pricing') loadPricing();
    else if (state.currentView === 'cards') loadCards();
    else if (state.currentView === 'cardsAssign') loadCardsAssign();
    else if (state.currentView === 'dispatch') loadDispatch();
    else if (state.currentView === 'payments') loadPayments();
    else if (state.currentView === 'credit') loadCredit();
    else if (state.currentView === 'config') loadConfig();
    else if (state.currentView === 'withdrawals') loadWithdrawals();
  }

  /* ============================================================
     数据看板
     ============================================================ */
  async function loadDashboard() {
    const container = $('#dashboardContent');
    container.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>正在加载看板数据...</p>
      </div>`;

    // 日期显示
    $('#dashboardDate').textContent = '数据更新时间：' + formatDate(new Date()) + '（北京时间）';

    try {
      const data = await API.getDashboard();
      renderDashboard(data);
    } catch (err) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <p>${escapeHtml(err.message || '加载失败')}</p>
          <button class="btn btn-outline" style="margin-top:16px;" onclick="App.loadDashboard()">重试</button>
        </div>`;
    }
  }

  function renderDashboard(data) {
    const today = data.today || {};
    const month = data.month || {};
    const onlineDrivers = data.onlineDrivers || 0;
    const pendingDrivers = data.pendingDrivers || 0;
    const breakdown = data.vehicleBreakdown || [];

    const tTotal = Number(today.total_orders) || 0;
    const tCompleted = Number(today.completed) || 0;
    const tCancelled = Number(today.cancelled) || 0;
    const tActive = Number(today.active) || 0;
    const tRevenue = Number(today.revenue) || 0;
    const tProfit = Number(today.profit) || 0;

    const mTotal = Number(month.total_orders) || 0;
    const mCompleted = Number(month.completed) || 0;
    const mRevenue = Number(month.revenue) || 0;
    const mProfit = Number(month.profit) || 0;

    let html = '';

    // 今日数据
    html += '<div class="dashboard-section-title">今日数据</div>';
    html += '<div class="stat-grid">';
    html += renderStatCard('今日订单数', formatNumber(tTotal), 'bg-blue', '📋', '今日所有救援订单');
    html += renderStatCard('已完成', formatNumber(tCompleted), 'bg-green', '✓', '今日已完成订单');
    html += renderStatCard('已取消', formatNumber(tCancelled), 'bg-red', '✕', '今日已取消订单');
    html += renderStatCard('进行中', formatNumber(tActive), 'bg-yellow', '🔄', '待接单/前往/充电中等');
    html += '</div>';

    // 营收
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px;">';
    html += renderRevenueCard('今日营收', formatMoney(tRevenue), '营收', '已完成订单总收入');
    html += renderProfitCard('今日利润', formatMoney(tProfit), '利润', '平台抽成20%');
    html += '</div>';

    // 本月 & 司机
    html += '<div class="dashboard-row">';
    // 本月数据卡片
    html += '<div class="card"><div class="card-header"><h3>本月数据</h3></div><div class="card-body">';
    html += '<div class="info-grid">';
    html += renderInfoItem('本月订单数', formatNumber(mTotal));
    html += renderInfoItem('本月已完成', formatNumber(mCompleted));
    html += renderInfoItem('本月营收', formatMoney(mRevenue));
    html += renderInfoItem('本月利润', formatMoney(mProfit));
    html += '</div></div></div>';
    // 司机概况卡片
    html += '<div class="card"><div class="card-header"><h3>司机概况</h3></div><div class="card-body">';
    html += '<div class="info-grid">';
    html += renderInfoItem('在线司机', formatNumber(onlineDrivers) + ' 人');
    html += renderInfoItem('待审核司机', formatNumber(pendingDrivers) + ' 人');
    html += '</div>';
    if (pendingDrivers > 0) {
      html += `<div style="margin-top:16px;"><button class="btn btn-primary btn-sm" onclick="App.goDrivers()">前往审核 →</button></div>`;
    }
    html += '</div></div>';
    html += '</div>';

    // 车型分布
    html += '<div class="dashboard-section-title">今日车型分布</div>';
    if (breakdown.length === 0) {
      html += `<div class="card"><div class="card-body"><div class="empty-state"><div class="empty-icon">📊</div><p>今日暂无订单数据</p></div></div></div>`;
    } else {
      html += '<div class="breakdown-grid">';
      breakdown.forEach(function (item) {
        const v = VEHICLE_MAP[item.vehicle_type] || { label: item.vehicle_type };
        const count = Number(item.count) || 0;
        const revenue = Number(item.revenue) || 0;
        const iconMap = { small: '🚗', medium: '🚚', large: '🚛' };
        html += `
          <div class="breakdown-card">
            <div class="bd-header">
              <span class="bd-name">${iconMap[item.vehicle_type] || '🚗'} ${escapeHtml(v.label)}</span>
              ${getVehicleTag(item.vehicle_type)}
            </div>
            <div class="bd-row">
              <span class="bd-label">订单数</span>
              <span class="bd-value">${formatNumber(count)}</span>
            </div>
            <div class="bd-row">
              <span class="bd-label">收入</span>
              <span class="bd-value">${formatMoney(revenue)}</span>
            </div>
          </div>`;
      });
      html += '</div>';
    }

    $('#dashboardContent').innerHTML = html;
  }

  function renderStatCard(label, value, iconClass, icon, footer) {
    return `
      <div class="stat-card">
        <div class="stat-icon ${iconClass}">${icon}</div>
        <div class="stat-label">${escapeHtml(label)}</div>
        <div class="stat-value">${escapeHtml(String(value))}</div>
        <div class="stat-footer">${escapeHtml(footer || '')}</div>
      </div>`;
  }

  function renderRevenueCard(label, value, sub, footer) {
    return `
      <div class="stat-card revenue-card">
        <div class="stat-icon">💰</div>
        <div class="stat-label">${escapeHtml(label)}</div>
        <div class="stat-value">${escapeHtml(String(value))}</div>
        <div class="stat-footer">${escapeHtml(footer || '')}</div>
      </div>`;
  }

  function renderProfitCard(label, value, sub, footer) {
    return `
      <div class="stat-card profit-card">
        <div class="stat-icon">📈</div>
        <div class="stat-label">${escapeHtml(label)}</div>
        <div class="stat-value">${escapeHtml(String(value))}</div>
        <div class="stat-footer">${escapeHtml(footer || '')}</div>
      </div>`;
  }

  function renderInfoItem(label, value) {
    return `
      <div class="info-item">
        <span class="info-label">${escapeHtml(label)}</span>
        <span class="info-value">${escapeHtml(String(value))}</span>
      </div>`;
  }

  /* ============================================================
     订单管理
     ============================================================ */
  async function loadOrders() {
    const tbody = $('#ordersTableBody');
    tbody.innerHTML = `<tr><td colspan="9"><div class="loading-state"><div class="spinner"></div><p>正在加载订单...</p></div></td></tr>`;

    try {
      const params = {
        page: state.orders.page,
        pageSize: state.orders.pageSize
      };
      if (state.orders.status && state.orders.status !== 'all') params.status = state.orders.status;
      if (state.orders.vehicleType && state.orders.vehicleType !== 'all') params.vehicleType = state.orders.vehicleType;
      if (state.orders.keyword) params.keyword = state.orders.keyword;

      const data = await API.getOrders(params);
      state.orders.list = data.list || [];
      state.orders.total = data.total || 0;
      renderOrdersTable();
      renderOrdersPagination();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">⚠️</div><p>${escapeHtml(err.message || '加载失败')}</p></div></td></tr>`;
      $('#ordersPagination').innerHTML = '';
    }
  }

  function renderOrdersTable() {
    const tbody = $('#ordersTableBody');
    const list = state.orders.list;

    if (!list || list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">📋</div><p>暂无订单数据</p></div></td></tr>`;
      return;
    }

    let html = '';
    list.forEach(function (order) {
      const vehicle = VEHICLE_MAP[order.vehicle_type] || { label: order.vehicle_type };
      const canCancel = !['completed', 'cancelled'].includes(order.status);
      const canAssign = !['completed', 'cancelled'].includes(order.status);
      html += `
        <tr>
          <td class="table-cell-mono">${escapeHtml(order.order_no || '-')}</td>
          <td>${getVehicleTag(order.vehicle_type)}</td>
          <td>${escapeHtml(order.vehicle_plate || '-')}</td>
          <td>${getStatusBadge(order.status)}</td>
          <td class="table-cell-amount">${formatMoney(order.total_price)}</td>
          <td>${order.driver_name ? escapeHtml(order.driver_name) : '<span style="color:#94a3b8">未分配</span>'}</td>
          <td>${escapeHtml(order.user_name || order.user_phone || '-')}</td>
          <td>${formatDate(order.created_at)}</td>
          <td>
            <div class="table-actions">
              <button class="btn btn-ghost btn-sm" onclick="App.viewOrderDetail(${order.id})">详情</button>
              <button class="btn btn-outline btn-sm" onclick="App.openPriceModal(${order.id})">改价</button>
              ${canAssign ? `<button class="btn btn-outline btn-sm" onclick="App.openAssignModal(${order.id})">指派</button>` : ''}
              ${canCancel ? `<button class="btn btn-warning btn-sm" onclick="App.cancelOrder(${order.id})">取消</button>` : ''}
              <button class="btn btn-danger btn-sm" onclick="App.deleteOrder(${order.id})">删除</button>
            </div>
          </td>
        </tr>`;
    });
    tbody.innerHTML = html;
  }

  function renderOrdersPagination() {
    const total = state.orders.total;
    const page = state.orders.page;
    const pageSize = state.orders.pageSize;
    const totalPages = Math.ceil(total / pageSize) || 1;
    const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);

    let html = `<div class="pagination-info">共 ${formatNumber(total)} 条，当前 ${start}-${end}</div>`;
    html += '<div class="pagination-controls">';

    // 上一页
    html += `<button class="page-btn" ${page <= 1 ? 'disabled' : ''} onclick="App.goOrderPage(${page - 1})">‹</button>`;

    // 页码
    const pages = getPageNumbers(page, totalPages);
    pages.forEach(function (p) {
      if (p === '...') {
        html += '<span style="padding:0 4px;color:#94a3b8;">...</span>';
      } else {
        html += `<button class="page-btn ${p === page ? 'active' : ''}" onclick="App.goOrderPage(${p})">${p}</button>`;
      }
    });

    // 下一页
    html += `<button class="page-btn" ${page >= totalPages ? 'disabled' : ''} onclick="App.goOrderPage(${page + 1})">›</button>`;
    html += '</div>';

    $('#ordersPagination').innerHTML = html;
  }

  function goOrderPage(page) {
    const totalPages = Math.ceil(state.orders.total / state.orders.pageSize) || 1;
    if (page < 1 || page > totalPages) return;
    state.orders.page = page;
    loadOrders();
  }

  async function viewOrderDetail(id) {
    const body = $('#orderDetailBody');
    body.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>正在加载...</p></div>`;
    openModal('orderDetailModal');
    state.currentOrderId = id;

    try {
      // 并行获取订单详情和系统配置
      const [order, configs] = await Promise.all([
        API.getOrderDetail(id),
        API.getConfig().catch(function () { return []; })
      ]);
      // 更新抽佣比例
      if (configs && configs.length > 0) {
        const commissionConfig = configs.find(function (c) { return c.key === 'commission_rate'; });
        if (commissionConfig) {
          state.commissionRate = parseFloat(commissionConfig.value) || 0.2;
        }
      }
      renderOrderDetail(order);
    } catch (err) {
      body.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${escapeHtml(err.message || '加载失败')}</p></div>`;
    }
  }

  function renderOrderDetail(order) {
    if (!order) {
      $('#orderDetailBody').innerHTML = '<div class="empty-state"><p>订单不存在</p></div>';
      return;
    }

    const v = VEHICLE_MAP[order.vehicle_type] || { label: order.vehicle_type };
    let html = '';

    // 订单基本信息
    html += '<div class="detail-section">';
    html += '<div class="detail-section-title">订单信息</div>';
    html += '<div class="detail-list">';
    html += renderDetailItem('订单号', order.order_no, true, 'table-cell-mono');
    html += renderDetailItem('订单状态', getStatusBadge(order.status));
    html += renderDetailItem('车型', getVehicleTag(order.vehicle_type));
    html += renderDetailItem('车牌号', order.vehicle_plate || '-');
    html += renderDetailItem('电池电量', order.battery_percent != null ? order.battery_percent + '%' : '-');
    html += renderDetailItem('仪表盘不亮', order.dashboard_off ? '是' : '否');
    html += renderDetailItem('是否夜间', order.is_night ? '是（夜间价）' : '否（白天价）');
    html += renderDetailItem('支付状态', order.payment_status === 'paid'
      ? '<span class="badge badge-paid">已支付</span>'
      : '<span class="badge badge-unpaid">未支付</span>');
    html += '</div></div>';

    // 位置信息
    html += '<div class="detail-section">';
    html += '<div class="detail-section-title">位置信息</div>';
    html += '<div class="detail-list">';
    html += renderDetailItem('救援地址', order.pickup_address || '-', true);
    html += renderDetailItem('补充描述', order.pickup_description || '-', true);
    const distanceSourceMap = {
      nearest_available_driver: '下单时按最近可用司机预估',
      assigned_driver_location: '按实际指派司机位置计算',
      tencent_driving_route_estimate: '腾讯地图驾车路线（下单预估）',
      tencent_driving_route: '腾讯地图驾车路线（实际司机）',
      legacy_client_value: '历史客户端数据',
      unavailable: '尚未计算'
    };
    html += renderDetailItem('计价距离', order.distance_km != null ? Number(order.distance_km).toFixed(2) + ' km' : '-');
    html += renderDetailItem('距离依据', distanceSourceMap[order.distance_source] || order.distance_source || '-');
    html += renderDetailItem('预计驾车时间', order.route_duration_minutes != null ? Number(order.route_duration_minutes) + ' 分钟' : '-');
    html += renderDetailItem('路线策略', order.route_policy || '-');
    html += renderDetailItem('腾讯请求ID', order.route_request_id || '-', true, 'table-cell-mono');
    html += renderDetailItem('计算时间', order.distance_calculated_at ? formatDate(order.distance_calculated_at) : '-');
    html += '</div></div>';

    // 费用信息
    html += '<div class="detail-section">';
    html += '<div class="detail-section-title">费用信息</div>';
    html += '<div class="detail-list">';
    html += renderDetailItem('基础费用', formatMoney(order.base_price));
    html += renderDetailItem('距离费用', formatMoney(order.distance_fee));
    html += renderDetailItem('附加费用', formatMoney(order.extra_fee));
    html += renderDetailItem('合计金额', '<strong style="font-size:18px;color:#3b82f6;">' + formatMoney(order.total_price) + '</strong>');
    html += '</div></div>';

    // 金额分解（用户支付/司机收入/平台收入）
    if (order.status === 'completed' || order.driver_id) {
      const totalAmount = Number(order.total_price) || 0;
      const driverIncome = order.driver_income != null ? Number(order.driver_income) : Math.round(totalAmount * (1 - state.commissionRate) * 100) / 100;
      const platformIncome = order.platform_income != null ? Number(order.platform_income) : Math.round(totalAmount - driverIncome, 2);
      html += '<div class="detail-section">';
      html += '<div class="detail-section-title">金额分解</div>';
      html += '<div class="detail-list">';
      html += renderDetailItem('用户支付', '<strong style="color:#3b82f6;">' + formatMoney(totalAmount) + '</strong>');
      html += renderDetailItem('司机收入', '<strong style="color:#22c55e;">' + formatMoney(driverIncome) + '</strong>');
      html += renderDetailItem('平台收入', '<strong style="color:#f59e0b;">' + formatMoney(platformIncome) + '</strong>');
      html += '</div></div>';
    }

    // 时间线
    html += '<div class="detail-section">';
    html += '<div class="detail-section-title">时间线</div>';
    html += '<div class="detail-list">';
    html += renderDetailItem('下单时间', formatDate(order.created_at));
    html += renderDetailItem('接单时间', formatDate(order.start_time));
    html += renderDetailItem('到达时间', formatDate(order.arrive_time));
    html += renderDetailItem('充电开始', formatDate(order.charging_start_time));
    html += renderDetailItem('充电结束', formatDate(order.charging_end_time));
    html += renderDetailItem('完成时间', formatDate(order.complete_time));
    html += '</div></div>';

    // 司机 & 用户
    html += '<div class="detail-section">';
    html += '<div class="detail-section-title">参与方</div>';
    html += '<div class="detail-list">';
    html += renderDetailItem('司机姓名', order.driver_name || '<span style="color:#94a3b8">未分配</span>');
    html += renderDetailItem('司机电话', order.driver_phone || '-');
    html += renderDetailItem('用户昵称', order.user_name || '-');
    html += renderDetailItem('用户电话', order.user_phone || '-');
    html += '</div></div>';

    // 评价
    if (order.user_rating || order.user_comment) {
      html += '<div class="detail-section">';
      html += '<div class="detail-section-title">用户评价</div>';
      html += '<div class="detail-list">';
      const stars = order.user_rating
        ? '★'.repeat(order.user_rating) + '☆'.repeat(5 - order.user_rating) + ' (' + order.user_rating + '星)'
        : '-';
      html += renderDetailItem('评分', stars);
      html += renderDetailItem('评价内容', order.user_comment || '-', true);
      html += '</div></div>';
    }

    $('#orderDetailBody').innerHTML = html;
  }

  function renderDetailItem(label, value, full, valueClass) {
    var display;
    if (value == null || value === '') {
      display = '-';
    } else if (typeof value === 'string' && (value.indexOf('<span') === 0 || value.indexOf('<strong') === 0)) {
      // HTML 内容（徽章、标签等）原样输出
      display = value;
    } else {
      display = escapeHtml(value);
    }
    return `
      <div class="detail-item${full ? ' full' : ''}">
        <span class="detail-label">${escapeHtml(label)}</span>
        <span class="detail-value ${valueClass || ''}">${display}</span>
      </div>`;
  }

  function openPriceModal(orderId) {
    state.currentOrderId = orderId;

    // 尝试获取当前订单价格
    API.getOrderDetail(orderId).then(function (order) {
      $('#priceBase').value = order.base_price != null ? Number(order.base_price).toFixed(2) : '';
      $('#priceDistance').value = order.distance_fee != null ? Number(order.distance_fee).toFixed(2) : '';
      $('#priceExtra').value = order.extra_fee != null ? Number(order.extra_fee).toFixed(2) : '';
      updatePriceTotal();
      openModal('priceModal');
    }).catch(function (err) {
      // 如果获取失败，用空值打开
      $('#priceBase').value = '';
      $('#priceDistance').value = '';
      $('#priceExtra').value = '';
      updatePriceTotal();
      openModal('priceModal');
    });
  }

  function updatePriceTotal() {
    const base = parseFloat($('#priceBase').value) || 0;
    const distance = parseFloat($('#priceDistance').value) || 0;
    const extra = parseFloat($('#priceExtra').value) || 0;
    const total = base + distance + extra;
    $('#priceTotal').textContent = formatMoney(total);
  }

  async function submitPriceChange() {
    const id = state.currentOrderId;
    if (!id) return;

    const basePrice = parseFloat($('#priceBase').value) || 0;
    const distanceFee = parseFloat($('#priceDistance').value) || 0;
    const extraFee = parseFloat($('#priceExtra').value) || 0;
    const total = basePrice + distanceFee + extraFee;

    const btn = $('#priceSubmitBtn');
    btn.disabled = true;
    btn.textContent = '提交中...';

    try {
      await API.updateOrderPrice(id, { basePrice: basePrice, distanceFee: distanceFee, extraFee: extraFee });
      showToast('价格修改成功，合计 ' + formatMoney(total), 'success');
      closeModal('priceModal');
      loadOrders();
    } catch (err) {
      showToast(err.message || '改价失败', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '确认改价';
    }
  }

  /* ============================================================
     订单操作（取消、删除、指派）
     ============================================================ */
  function cancelOrder(id) {
    showConfirm({
      title: '取消订单',
      message: '确定取消此订单吗？',
      desc: '取消后订单状态将变为"已取消"',
      confirmText: '确认取消',
      danger: true,
      onConfirm: function () { doCancelOrder(id); }
    });
  }

  async function doCancelOrder(id) {
    try {
      await API.cancelOrder(id);
      showToast('订单已取消', 'success');
      loadOrders();
    } catch (err) {
      showToast(err.message || '操作失败', 'error');
    }
  }

  function deleteOrder(id) {
    showConfirm({
      title: '删除订单',
      message: '确定删除此订单吗？',
      desc: '删除后不可恢复',
      confirmText: '确认删除',
      danger: true,
      onConfirm: function () { doDeleteOrder(id); }
    });
  }

  async function doDeleteOrder(id) {
    try {
      await API.deleteOrder(id);
      showToast('订单已删除', 'success');
      loadOrders();
    } catch (err) {
      showToast(err.message || '操作失败', 'error');
    }
  }

  async function openAssignModal(orderId) {
    state.currentOrderId = orderId;
    const listEl = $('#assignDriverList');
    listEl.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>加载中...</p></div>';
    openModal('assignDriverModal');

    try {
      const drivers = await API.getAvailableDrivers();
      if (!drivers || drivers.length === 0) {
        listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">🚗</div><p>暂无可用司机</p></div>';
        return;
      }
      let html = '';
      drivers.forEach(function (d) {
        const statusLabel = d.status === 'online' ? '<span class="badge badge-online">在线</span>' :
          d.status === 'busy' ? '<span class="badge badge-busy">忙碌</span>' :
          '<span class="badge badge-offline">离线</span>';
        html += `
          <div class="assign-driver-item" onclick="App.doAssignDriver(${d.id}, '${escapeHtml(d.name)}')">
            <div class="assign-driver-info">
              <strong>${escapeHtml(d.name)}</strong>
              <span class="assign-driver-phone">${escapeHtml(d.phone || '-')}</span>
            </div>
            ${statusLabel}
          </div>`;
      });
      listEl.innerHTML = html;
    } catch (err) {
      listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>' + escapeHtml(err.message || '加载失败') + '</p></div>';
    }
  }

  function doAssignDriver(driverId, driverName) {
    showConfirm({
      title: '确认指派司机',
      message: '确定将此订单指派给司机「' + driverName + '」吗？',
      desc: '指派后该司机状态将变为忙碌，请确保已与司机沟通确认',
      confirmText: '确认指派',
      onConfirm: function () { doAssignDriverConfirm(driverId, driverName); }
    });
  }

  async function doAssignDriverConfirm(driverId, driverName) {
    try {
      await API.assignDriver(state.currentOrderId, driverId);
      showToast('已指派司机：' + driverName, 'success');
      closeModal('assignDriverModal');
      loadOrders();
    } catch (err) {
      showToast(err.message || '指派失败', 'error');
    }
  }

  /* ============================================================
     司机管理
     ============================================================ */
  async function loadDrivers() {
    const tbody = $('#driversTableBody');
    tbody.innerHTML = `<tr><td colspan="10"><div class="loading-state"><div class="spinner"></div><p>正在加载司机列表...</p></div></td></tr>`;

    try {
      const data = await API.getDrivers({ page: state.drivers.page, pageSize: state.drivers.pageSize });
      state.drivers.list = data.list || [];
      state.drivers.total = data.total || 0;
      renderDriversTable();
      renderDriversPagination();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="13"><div class="empty-state"><div class="empty-icon">⚠️</div><p>${escapeHtml(err.message || '加载失败')}</p></div></td></tr>`;
      $('#driversPagination').innerHTML = '';
    }
  }

  function renderDriversTable() {
    const tbody = $('#driversTableBody');
    let list = state.drivers.list || [];

    // 客户端筛选
    if (state.drivers.statusFilter === 'pending') {
      list = list.filter(function (d) { return !d.approved; });
    } else if (state.drivers.statusFilter === 'approved') {
      list = list.filter(function (d) { return !!d.approved; });
    }

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="13"><div class="empty-state"><div class="empty-icon">🚗</div><p>暂无司机数据</p></div></td></tr>`;
      return;
    }

    let html = '';
    list.forEach(function (driver) {
      const approved = !!driver.approved;
      const rating = Number(driver.rating) || 0;
      const stars = '★'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating));
      const accept7d = Number(driver.accept_count_7d) || 0;
      const wallet = Number(driver.wallet_balance) || 0;
      html += `
        <tr>
          <td class="table-cell-mono">${driver.id != null ? '#' + driver.id : '-'}</td>
          <td><strong>${escapeHtml(driver.name || '-')}</strong></td>
          <td class="table-cell-mono">${escapeHtml(driver.phone || '-')}</td>
          <td>${getDriverStatusBadge(driver.status)}</td>
          <td>${approved
            ? '<span class="badge badge-approved">已通过</span>'
            : '<span class="badge badge-pending-review">待审核</span>'}</td>
          <td><span class="driver-stat-mini"><span class="star">${stars}</span> ${rating.toFixed(1)}</span></td>
          <td>
            <span class="badge badge-online">${escapeHtml(driver.level_code || 'V1')}</span>
            <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${escapeHtml(driver.level_name || '')}${driver.level_coefficient != null ? ' · ×' + driver.level_coefficient : ''}</div>
          </td>
          <td>${formatNumber(driver.total_orders)}</td>
          <td><span style="color:#d97706;font-weight:600;">${accept7d}</span> <span style="color:#94a3b8;font-size:11px;">单/7日</span></td>
          <td class="table-cell-amount">${formatMoney(driver.total_earnings)}</td>
          <td class="table-cell-amount" style="color:#059669;font-weight:600;">${formatMoney(wallet)}</td>
          <td>${formatDate(driver.created_at)}</td>
          <td>
            <div class="table-actions">
              <button class="btn btn-ghost btn-sm" onclick="App.viewDriverDetail(${driver.id})">详情</button>
              <button class="btn btn-outline btn-sm" onclick="App.openEditDriverModal(${driver.id})">编辑</button>
              ${!approved
                ? `<button class="btn btn-success btn-sm" onclick="App.approveDriver(${driver.id})">通过</button>
                   <button class="btn btn-danger btn-sm" onclick="App.rejectDriver(${driver.id})">拒绝</button>`
                : `<button class="btn btn-warning btn-sm" onclick="App.rejectDriver(${driver.id})">取消资格</button>`}
              <button class="btn btn-danger btn-sm" onclick="App.deleteDriver(${driver.id})">删除</button>
            </div>
          </td>
        </tr>`;
    });
    tbody.innerHTML = html;
  }

  function renderDriversPagination() {
    const total = state.drivers.total;
    const page = state.drivers.page;
    const pageSize = state.drivers.pageSize;
    const totalPages = Math.ceil(total / pageSize) || 1;
    const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);

    let html = `<div class="pagination-info">共 ${formatNumber(total)} 条，当前 ${start}-${end}</div>`;
    html += '<div class="pagination-controls">';
    html += `<button class="page-btn" ${page <= 1 ? 'disabled' : ''} onclick="App.goDriverPage(${page - 1})">‹</button>`;
    const pages = getPageNumbers(page, totalPages);
    pages.forEach(function (p) {
      if (p === '...') {
        html += '<span style="padding:0 4px;color:#94a3b8;">...</span>';
      } else {
        html += `<button class="page-btn ${p === page ? 'active' : ''}" onclick="App.goDriverPage(${p})">${p}</button>`;
      }
    });
    html += `<button class="page-btn" ${page >= totalPages ? 'disabled' : ''} onclick="App.goDriverPage(${page + 1})">›</button>`;
    html += '</div>';
    $('#driversPagination').innerHTML = html;
  }

  function goDriverPage(page) {
    const totalPages = Math.ceil(state.drivers.total / state.drivers.pageSize) || 1;
    if (page < 1 || page > totalPages) return;
    state.drivers.page = page;
    loadDrivers();
  }

  function viewDriverDetail(id) {
    const driver = state.drivers.list.find(function (d) { return d.id === id; });
    if (!driver) {
      showToast('未找到司机信息', 'error');
      return;
    }
    state.currentDriver = driver;
    const rating = Number(driver.rating) || 0;
    const stars = '★'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating));

    let html = '';
    html += '<div class="detail-section">';
    html += '<div class="detail-section-title">基本信息</div>';
    html += '<div class="detail-list">';
    html += renderDetailItem('姓名', '<strong>' + escapeHtml(driver.name) + '</strong>');
    html += renderDetailItem('电话', escapeHtml(driver.phone || '-'));
    html += renderDetailItem('在线状态', getDriverStatusBadge(driver.status));
    html += renderDetailItem('审核状态', driver.approved
      ? '<span class="badge badge-approved">已通过</span>'
      : '<span class="badge badge-pending-review">待审核</span>');
    html += '</div></div>';

    html += '<div class="detail-section">';
    html += '<div class="detail-section-title">运营统计</div>';
    html += '<div class="detail-list">';
    html += renderDetailItem('评分', stars + ' ' + rating.toFixed(1));
    html += renderDetailItem('完成订单数', formatNumber(driver.total_orders) + ' 单');
    html += renderDetailItem('累计收入', formatMoney(driver.total_earnings));
    html += renderDetailItem('注册时间', formatDate(driver.created_at));
    html += '</div></div>';

    $('#driverDetailBody').innerHTML = html;
    openModal('driverDetailModal');
  }

  function approveDriver(id) {
    const driver = state.drivers.list.find(function (d) { return d.id === id; });
    const name = driver ? driver.name : '';
    showConfirm({
      title: '审核通过',
      message: '确定通过司机「' + (name || id) + '」的审核吗？',
      desc: '通过后该司机可正常接单',
      confirmText: '确认通过',
      onConfirm: function () {
        doApproveDriver(id);
      }
    });
  }

  async function doApproveDriver(id) {
    try {
      await API.approveDriver(id);
      showToast('已通过审核', 'success');
      loadDrivers();
    } catch (err) {
      showToast(err.message || '操作失败', 'error');
    }
  }

  function rejectDriver(id) {
    const driver = state.drivers.list.find(function (d) { return d.id === id; });
    const name = driver ? driver.name : '';
    const approved = driver ? driver.approved : false;
    showConfirm({
      title: approved ? '取消资格' : '拒绝审核',
      message: approved
        ? '确定取消司机「' + (name || id) + '」的接单资格吗？'
        : '确定拒绝司机「' + (name || id) + '」的审核吗？',
      desc: approved ? '取消后该司机将无法接单' : '拒绝后该司机将无法接单',
      confirmText: approved ? '取消资格' : '确认拒绝',
      danger: true,
      onConfirm: function () {
        doRejectDriver(id);
      }
    });
  }

  async function doRejectDriver(id) {
    try {
      await API.rejectDriver(id);
      showToast('操作成功', 'success');
      loadDrivers();
    } catch (err) {
      showToast(err.message || '操作失败', 'error');
    }
  }

  function openEditDriverModal(id) {
    const driver = state.drivers.list.find(function (d) { return d.id === id; });
    if (!driver) {
      showToast('未找到司机信息', 'error');
      return;
    }
    state.currentDriver = driver;
    $('#editDriverName').value = driver.name || '';
    $('#editDriverPhone').value = driver.phone || '';
    openModal('editDriverModal');
  }

  async function submitEditDriver() {
    const id = state.currentDriver ? state.currentDriver.id : null;
    if (!id) return;
    const name = $('#editDriverName').value.trim();
    const phone = $('#editDriverPhone').value.trim();
    if (!name || !phone) {
      showToast('请填写姓名和电话', 'error');
      return;
    }
    const btn = $('#editDriverSubmitBtn');
    btn.disabled = true;
    btn.textContent = '保存中...';
    try {
      await API.editDriver(id, { name: name, phone: phone });
      showToast('司机信息已更新', 'success');
      closeModal('editDriverModal');
      loadDrivers();
    } catch (err) {
      showToast(err.message || '保存失败', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '保存';
    }
  }

  function deleteDriver(id) {
    const driver = state.drivers.list.find(function (d) { return d.id === id; });
    const name = driver ? driver.name : '';
    showConfirm({
      title: '删除司机',
      message: '确定删除司机「' + (name || id) + '」吗？',
      desc: '如有进行中订单则无法删除',
      confirmText: '确认删除',
      danger: true,
      onConfirm: function () { doDeleteDriver(id); }
    });
  }

  async function doDeleteDriver(id) {
    try {
      await API.deleteDriver(id);
      showToast('司机已删除', 'success');
      loadDrivers();
    } catch (err) {
      showToast(err.message || '删除失败', 'error');
    }
  }

  /* ============================================================
     用户管理
     ============================================================ */
  async function loadUsers() {
    const tbody = $('#usersTableBody');
    tbody.innerHTML = '<tr><td colspan="6"><div class="loading-state"><div class="spinner"></div><p>正在加载用户列表...</p></div></td></tr>';

    try {
      const params = {
        page: state.users.page,
        pageSize: state.users.pageSize
      };
      if (state.users.keyword) params.keyword = state.users.keyword;

      const data = await API.getUsers(params);
      state.users.list = data.list || [];
      state.users.total = data.total || 0;
      renderUsersTable();
      renderUsersPagination();
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">⚠️</div><p>' + escapeHtml(err.message || '加载失败') + '</p></div></td></tr>';
      $('#usersPagination').innerHTML = '';
    }
  }

  function renderUsersTable() {
    const tbody = $('#usersTableBody');
    const list = state.users.list;

    if (!list || list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">👥</div><p>暂无用户数据</p></div></td></tr>';
      return;
    }

    let html = '';
    list.forEach(function (user) {
      html += `
        <tr>
          <td><strong>${escapeHtml(user.nickname || '微信用户')}</strong></td>
          <td class="table-cell-mono">${escapeHtml(user.phone || '<span style="color:#94a3b8">未绑定</span>')}</td>
          <td>${formatNumber(user.total_orders)}</td>
          <td class="table-cell-amount">${formatMoney(user.total_spent)}</td>
          <td>${formatDate(user.created_at)}</td>
          <td>
            <div class="table-actions">
              <button class="btn btn-ghost btn-sm" onclick="App.viewUserDetail(${user.id})">详情</button>
              <button class="btn btn-danger btn-sm" onclick="App.deleteUser(${user.id})">删除</button>
            </div>
          </td>
        </tr>`;
    });
    tbody.innerHTML = html;
  }

  function renderUsersPagination() {
    const total = state.users.total;
    const page = state.users.page;
    const pageSize = state.users.pageSize;
    const totalPages = Math.ceil(total / pageSize) || 1;
    const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);

    let html = '<div class="pagination-info">共 ' + formatNumber(total) + ' 条，当前 ' + start + '-' + end + '</div>';
    html += '<div class="pagination-controls">';
    html += '<button class="page-btn" ' + (page <= 1 ? 'disabled' : '') + ' onclick="App.goUserPage(' + (page - 1) + ')">‹</button>';
    const pages = getPageNumbers(page, totalPages);
    pages.forEach(function (p) {
      if (p === '...') {
        html += '<span style="padding:0 4px;color:#94a3b8;">...</span>';
      } else {
        html += '<button class="page-btn ' + (p === page ? 'active' : '') + '" onclick="App.goUserPage(' + p + ')">' + p + '</button>';
      }
    });
    html += '<button class="page-btn" ' + (page >= totalPages ? 'disabled' : '') + ' onclick="App.goUserPage(' + (page + 1) + ')">›</button>';
    html += '</div>';
    $('#usersPagination').innerHTML = html;
  }

  function goUserPage(page) {
    const totalPages = Math.ceil(state.users.total / state.users.pageSize) || 1;
    if (page < 1 || page > totalPages) return;
    state.users.page = page;
    loadUsers();
  }

  async function viewUserDetail(id) {
    state.currentUserId = id;
    const body = $('#userDetailBody');
    body.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>正在加载...</p></div>';
    openModal('userDetailModal');

    try {
      const data = await API.getUserDetail(id);
      renderUserDetail(data);
    } catch (err) {
      body.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>' + escapeHtml(err.message || '加载失败') + '</p></div>';
    }
  }

  function renderUserDetail(data) {
    const user = data.user || {};
    const orders = data.orders || [];

    let html = '';
    html += '<div class="detail-section">';
    html += '<div class="detail-section-title">用户信息</div>';
    html += '<div class="detail-list">';
    html += renderDetailItem('昵称', '<strong>' + escapeHtml(user.nickname || '微信用户') + '</strong>');
    html += renderDetailItem('手机号', escapeHtml(user.phone || '未绑定'));
    html += renderDetailItem('OpenID', escapeHtml(user.openid || '-'), true, 'table-cell-mono');
    html += renderDetailItem('注册时间', formatDate(user.created_at));
    html += '</div></div>';

    html += '<div class="detail-section">';
    html += '<div class="detail-section-title">最近订单 (最多10条)</div>';
    if (orders.length === 0) {
      html += '<div class="empty-state"><div class="empty-icon">📋</div><p>暂无订单</p></div>';
    } else {
      html += '<div class="detail-list">';
      orders.forEach(function (order) {
        html += '<div class="detail-item full">';
        html += '<span class="detail-label">' + escapeHtml(order.order_no || '') + '</span>';
        html += '<span class="detail-value">' + getStatusBadge(order.status) + ' ' + formatMoney(order.total_price) + (order.driver_name ? ' · ' + escapeHtml(order.driver_name) : '') + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    $('#userDetailBody').innerHTML = html;
  }

  function deleteUser(id) {
    const user = state.users.list.find(function (u) { return u.id === id; });
    const name = user ? user.nickname : '';
    showConfirm({
      title: '删除用户',
      message: '确定删除用户「' + (name || id) + '」吗？',
      desc: '如有进行中订单则无法删除',
      confirmText: '确认删除',
      danger: true,
      onConfirm: function () { doDeleteUser(id); }
    });
  }

  async function doDeleteUser(id) {
    try {
      await API.deleteUser(id);
      showToast('用户已删除', 'success');
      loadUsers();
    } catch (err) {
      showToast(err.message || '删除失败', 'error');
    }
  }

  /* ============================================================
     定价配置
     ============================================================ */
  async function loadPricing() {
    const grid = $('#pricingGrid');
    grid.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>正在加载定价配置...</p></div>`;

    try {
      const data = await API.getPricing();
      state.pricing = Array.isArray(data) ? data : [];
      renderPricingCards();
    } catch (err) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${escapeHtml(err.message || '加载失败')}</p></div>`;
    }
  }

  function renderPricingCards() {
    const grid = $('#pricingGrid');
    if (state.pricing.length === 0) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-icon">💰</div><p>暂无定价配置</p></div>`;
      return;
    }

    const iconMap = { small: '🚗', medium: '🚚', large: '🚛' };
    const colorMap = { small: 'vehicle-small', medium: 'vehicle-medium', large: 'vehicle-large' };

    let html = '';
    state.pricing.forEach(function (config) {
      const v = VEHICLE_MAP[config.vehicle_type] || { label: config.vehicle_name || config.vehicle_type };
      html += `
        <div class="pricing-card" data-id="${config.id}">
          <div class="pricing-card-header">
            <div class="pc-title">
              <div class="pc-icon"><span class="vehicle-tag ${colorMap[config.vehicle_type] || 'vehicle-small'}">${iconMap[config.vehicle_type] || '🚗'}</span></div>
              <span class="pc-name">${escapeHtml(config.vehicle_name || v.label)}</span>
            </div>
            ${config.is_active
              ? '<span class="badge badge-active">启用中</span>'
              : '<span class="badge badge-inactive">已停用</span>'}
          </div>
          <div class="pricing-card-body">
            <div class="pricing-field">
              <label>白天价格</label>
              <div class="field-input">
                <input type="number" step="0.01" min="0" id="price-day-${config.id}" value="${Number(config.day_price).toFixed(2)}">
                <span class="field-unit">元</span>
              </div>
            </div>
            <div class="pricing-field">
              <label>夜间价格</label>
              <div class="field-input">
                <input type="number" step="0.01" min="0" id="price-night-${config.id}" value="${Number(config.night_price).toFixed(2)}">
                <span class="field-unit">元</span>
              </div>
            </div>
            <div class="pricing-field">
              <label>基础距离</label>
              <div class="field-input">
                <input type="number" step="0.1" min="0" id="price-base-${config.id}" value="${Number(config.base_distance_km).toFixed(1)}">
                <span class="field-unit">km</span>
              </div>
            </div>
            <div class="pricing-field">
              <label>超距单价</label>
              <div class="field-input">
                <input type="number" step="0.01" min="0" id="price-extra-${config.id}" value="${Number(config.extra_per_km).toFixed(2)}">
                <span class="field-unit">元/km</span>
              </div>
            </div>
            <div class="pricing-toggle">
              <span class="toggle-label">启用此定价</span>
              <label class="switch">
                <input type="checkbox" id="price-active-${config.id}" ${config.is_active ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>
          </div>
          <div class="pricing-card-footer">
            <button class="btn btn-primary btn-sm" onclick="App.savePricing(${config.id})">保存配置</button>
          </div>
        </div>`;
    });
    grid.innerHTML = html;
  }

  function savePricing(id) {
    const config = state.pricing.find(function (c) { return c.id === id; });
    if (!config) return;

    const dayPrice = parseFloat($('#price-day-' + id).value);
    const nightPrice = parseFloat($('#price-night-' + id).value);
    const baseDistanceKm = parseFloat($('#price-base-' + id).value);
    const extraPerKm = parseFloat($('#price-extra-' + id).value);
    const isActive = $('#price-active-' + id).checked;

    if (isNaN(dayPrice) || isNaN(nightPrice) || isNaN(baseDistanceKm) || isNaN(extraPerKm)) {
      showToast('请填写有效的数值', 'error');
      return;
    }
    if (dayPrice < 0 || nightPrice < 0 || baseDistanceKm < 0 || extraPerKm < 0) {
      showToast('数值不能为负数', 'error');
      return;
    }

    const v = VEHICLE_MAP[config.vehicle_type] || { label: config.vehicle_name };
    showConfirm({
      title: '确认修改定价',
      message: '确定修改「' + (config.vehicle_name || v.label) + '」的定价配置吗？',
      desc: '白天 ¥' + dayPrice.toFixed(2) + ' / 夜间 ¥' + nightPrice.toFixed(2) +
        ' / 基础距离 ' + baseDistanceKm.toFixed(1) + 'km / 超距 ¥' + extraPerKm.toFixed(2) + '/km',
      confirmText: '确认修改',
      onConfirm: function () {
        doSavePricing(id, { dayPrice: dayPrice, nightPrice: nightPrice, baseDistanceKm: baseDistanceKm, extraPerKm: extraPerKm, isActive: isActive });
      }
    });
  }

  async function doSavePricing(id, data) {
    try {
      await API.updatePricing(id, data);
      showToast('定价配置已更新', 'success');
      loadPricing();
    } catch (err) {
      showToast(err.message || '保存失败', 'error');
    }
  }

  /* ============================================================
     服务卡管理
     ============================================================ */
  async function loadCards() {
    const tbody = $('#cardsTableBody');
    tbody.innerHTML = `<tr><td colspan="8"><div class="loading-state"><div class="spinner"></div><p>正在加载服务卡...</p></div></td></tr>`;

    try {
      const data = await API.getCards();
      state.cards = Array.isArray(data) ? data : [];
      renderCardsTable();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">⚠️</div><p>${escapeHtml(err.message || '加载失败')}</p></div></td></tr>`;
    }
  }

  function renderCardsTable() {
    const tbody = $('#cardsTableBody');
    const list = state.cards;

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">🎫</div><p>暂无服务卡</p></div></td></tr>`;
      return;
    }

    let html = '';
    list.forEach(function (card) {
      const usedCount = Number(card.used_count) || 0;
      const totalUses = Number(card.total_uses) || 1;
      const usageText = usedCount + ' / ' + totalUses;
      html += `
        <tr>
          <td class="table-cell-mono">${escapeHtml(card.card_no || '-')}</td>
          <td>${getVehicleTag(card.vehicle_type)}</td>
          <td class="table-cell-amount">${formatMoney(card.price)}</td>
          <td>${usageText}</td>
          <td>${getCardStatusBadge(card.status)}</td>
          <td>${card.user_name ? escapeHtml(card.user_name) : '<span style="color:#94a3b8">未绑定</span>'}</td>
          <td>${formatDate(card.created_at)}</td>
          <td>
            <div class="table-actions">
              <button class="btn btn-danger btn-sm" onclick="App.deleteCard(${card.id})">删除</button>
            </div>
          </td>
        </tr>`;
    });
    tbody.innerHTML = html;
  }

  function openGenCardModal() {
    $('#genCardVehicle').value = 'small';
    $('#genCardPrice').value = '';
    openModal('genCardModal');
  }

  async function submitGenCard() {
    const vehicleType = $('#genCardVehicle').value;
    const price = parseFloat($('#genCardPrice').value);

    if (isNaN(price) || price < 0) {
      showToast('请输入有效的价格', 'error');
      return;
    }

    const btn = $('#genCardSubmitBtn');
    btn.disabled = true;
    btn.textContent = '生成中...';

    try {
      const data = await API.createCard({ vehicleType: vehicleType, price: price });
      showToast('服务卡已生成：' + (data.cardNo || ''), 'success');
      closeModal('genCardModal');
      loadCards();
    } catch (err) {
      showToast(err.message || '生成失败', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '生成';
    }
  }

  function deleteCard(id) {
    showConfirm({
      title: '删除服务卡',
      message: '确定删除此服务卡吗？',
      confirmText: '确认删除',
      danger: true,
      onConfirm: function () { doDeleteCard(id); }
    });
  }

  async function doDeleteCard(id) {
    try {
      await API.deleteCard(id);
      showToast('服务卡已删除', 'success');
      loadCards();
    } catch (err) {
      showToast(err.message || '删除失败', 'error');
    }
  }

  /* ============================================================
     系统配置管理
     ============================================================ */
  const CONFIG_GROUPS = {
    business: { title: '资金与结算', desc: '影响平台抽佣、司机提现和用户预付金额。' },
    credit: { title: '信用与防逃单', desc: '影响用户下单资格、逾期判定和信用分变动。' },
    auth: { title: '短信与微信接入', desc: '开发环境可使用模拟能力，生产环境必须填写真实平台参数。' },
    map: { title: '地图与路线计价', desc: '订单距离和超距费用依赖腾讯地图真实驾车路线；密钥无效时系统将停止报价和派单。' },
    dispatch: { title: '订单调度', desc: '影响候选司机筛选和综合排序；建议优先在“订单调度”页面成组修改。' },
    other: { title: '其他设置', desc: '未分类的系统参数。' }
  };

  const CONFIG_META = {
    commission_rate: { group:'business', title:'平台抽佣比例', type:'number', min:0, max:1, step:0.01, unit:'比例', recommended:'0.20', range:'0-1', impact:'数值越大，平台收入越高、司机每单到账越少；0.20 表示平台20%、司机80%。', display:v => `${(Number(v)*100).toFixed(0)}%（司机${(100-Number(v)*100).toFixed(0)}%）` },
    min_withdraw_amount: { group:'business', title:'最低提现金额', type:'number', min:1, max:100000, step:1, unit:'元', recommended:'10', range:'1-100000元', impact:'数值越大可减少小额打款次数，但司机需要更久才能达到提现门槛。', display:v => `¥${Number(v).toFixed(2)}` },
    deposit_ratio: { group:'business', title:'下单押金比例', type:'number', min:0, max:1, step:0.05, unit:'比例', recommended:'0.30', range:'0-1', impact:'按订单总额计算押金。数值越大防逃单能力越强，但用户预付压力越高。', display:v => `${(Number(v)*100).toFixed(0)}%` },
    deposit_min_amount: { group:'business', title:'最低押金金额', type:'number', min:0, max:10000, step:1, unit:'元', recommended:'50', range:'0-10000元', impact:'比例计算结果低于该值时按此金额收取；提高后小额订单的预付金额会增加。', display:v => `¥${Number(v).toFixed(2)}` },

    escape_penalty_score: { group:'credit', title:'逃单扣分', type:'number', min:0, max:100, step:1, unit:'分/次', recommended:'30', range:'0-100分', impact:'数值越大，逾期未支付对用户信用影响越严重。' },
    bad_rating_penalty_score: { group:'credit', title:'差评扣分', type:'number', min:0, max:100, step:1, unit:'分/次', recommended:'5', range:'0-100分', impact:'用于差评场景的信用扣减；过高可能导致用户因单次评价失去下单资格。' },
    pay_on_time_bonus_score: { group:'credit', title:'按时支付奖励', type:'number', min:0, max:20, step:1, unit:'分/次', recommended:'2', range:'0-20分', impact:'用户在规定时间内支付尾款时增加信用分；数值越大恢复信用越快。' },
    credit_min_to_order: { group:'credit', title:'允许下单的最低信用分', type:'number', min:0, max:100, step:1, unit:'分', recommended:'60', range:'0-100分', impact:'信用分低于该值将禁止下单；数值越高，下单审核越严格。' },
    unpaid_pay_timeout_hours: { group:'credit', title:'尾款逾期时限', type:'number', min:1, max:168, step:1, unit:'小时', recommended:'24', range:'1-168小时', impact:'订单完成后超过该时长仍未付款即判定逃单；数值越小催付越严格。' },

    sms_mode: { group:'auth', title:'短信验证码模式', type:'select', options:[['dev','开发模式（固定1234）'],['prod','生产短信服务']], recommended:'开发用dev，上线用prod', range:'dev / prod', impact:'prod 会调用真实短信服务；未完成短信供应商配置前不要切换到生产模式。' },
    wx_appid: { group:'auth', title:'微信小程序 AppID', type:'text', maxLength:128, allowEmpty:true, range:'最多128字符', impact:'用于微信登录和支付身份识别；生产环境必填。' },
    wx_appsecret: { group:'auth', title:'微信小程序 AppSecret', type:'password', maxLength:256, allowEmpty:true, sensitive:true, range:'最多256字符', impact:'用于服务端换取微信凭证。属于敏感信息，不应对外泄露。' },
    wx_merchant_id: { group:'auth', title:'微信支付商户号', type:'text', maxLength:64, allowEmpty:true, range:'最多64字符', impact:'用于发起真实微信支付；留空时当前开发环境会使用模拟支付。' },
    wx_pay_key: { group:'auth', title:'微信支付 APIv3 密钥', type:'password', maxLength:256, allowEmpty:true, sensitive:true, range:'最多256字符', impact:'用于支付签名和回调校验。属于敏感信息，修改错误会导致支付失败。' },

    tencent_map_key: { group:'map', title:'腾讯位置服务 WebService Key', type:'password', maxLength:128, allowEmpty:true, sensitive:true, range:'腾讯位置服务控制台签发的服务器Key', impact:'用于服务端调用驾车路线规划。未配置、配额耗尽或权限错误时，系统不会使用估算距离兜底，以防错误计价。' },
    tencent_map_driving_policy: { group:'map', title:'驾车计价路线策略', type:'select', options:[['SHORT_DISTANCE','距离较短（推荐）'],['LEAST_TIME','时间较短']], recommended:'SHORT_DISTANCE', range:'SHORT_DISTANCE / LEAST_TIME', impact:'距离较短策略不受实时拥堵影响，计价更稳定；时间较短策略可能因路况选择更长路线。' },

    dispatch_enabled: { group:'dispatch', title:'启用自动调度', type:'select', options:[['1','启用'],['0','停用']], recommended:'启用', range:'启用 / 停用', impact:'停用后系统不会自动计算或指派司机，只能由管理员人工处理。' },
    dispatch_strategy: { group:'dispatch', title:'派单策略', type:'select', options:[['auto_assign','自动指派第一名'],['recommend_only','仅推荐，司机抢单'],['manual','仅管理员人工指派']], recommended:'auto_assign', range:'三种策略', impact:'决定候选排名生成后是否直接占用排名第一的司机。' },
    dispatch_require_deposit: { group:'dispatch', title:'支付押金后才派单', type:'select', options:[['1','是'],['0','否']], recommended:'是', range:'是 / 否', impact:'关闭后未付押金订单也可派给司机，会提高逃单风险。' },
    dispatch_allow_busy: { group:'dispatch', title:'允许忙碌司机进入候选', type:'select', options:[['0','否（推荐）'],['1','是']], recommended:'否', range:'是 / 否', impact:'开启可能让同一司机同时承接多单，通常应保持关闭。' },
    dispatch_distance_weight: { group:'dispatch', title:'距离权重', type:'number', min:0, max:1, step:0.05, unit:'权重', recommended:'0.40', range:'0-1', impact:'越大越优先选择距离救援点近的司机。四项权重建议合计为1。' },
    dispatch_rating_weight: { group:'dispatch', title:'评分权重', type:'number', min:0, max:1, step:0.05, unit:'权重', recommended:'0.25', range:'0-1', impact:'越大越优先选择用户评分高的司机。四项权重建议合计为1。' },
    dispatch_level_weight: { group:'dispatch', title:'服务等级权重', type:'number', min:0, max:1, step:0.05, unit:'权重', recommended:'0.20', range:'0-1', impact:'越大越优先选择V等级和派单系数高的司机。四项权重建议合计为1。' },
    dispatch_order_weight: { group:'dispatch', title:'近7日均衡权重', type:'number', min:0, max:1, step:0.05, unit:'权重', recommended:'0.15', range:'0-1', impact:'越大越照顾近7日接单较少的司机，分配更均衡。四项权重建议合计为1。' },
    dispatch_max_candidates: { group:'dispatch', title:'最大候选司机数', type:'number', min:1, max:50, step:1, unit:'人', recommended:'10', range:'1-50人', impact:'数值越大可供后台选择的人越多，但计算和页面信息也更多。' },
    dispatch_max_distance_km: { group:'dispatch', title:'最大调度半径', type:'number', min:1, max:300, step:1, unit:'公里', recommended:'30', range:'1-300公里', impact:'半径外司机不会进入候选；过小可能无人可派，过大会增加司机空驶距离。' }
  };

  async function loadConfig() {
    const container = $('#configContent');
    container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>正在加载配置...</p></div>`;

    try {
      const configs = await API.getConfig();
      renderConfig(configs);
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${escapeHtml(err.message || '加载失败')}</p></div>`;
    }
  }

  function renderConfig(configs) {
    const container = $('#configContent');
    if (!configs || configs.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚙️</div><p>暂无配置项</p></div>`;
      return;
    }

    const grouped = {};
    configs.forEach(config => {
      const group = (CONFIG_META[config.key] || {}).group || 'other';
      (grouped[group] = grouped[group] || []).push(config);
    });

    let html = '<div class="config-overview"><b>填写规则</b><span>修改前请先查看范围和影响说明；带“敏感”标记的密钥不会明文展示。调度权重建议在“订单调度”页面统一保存。</span></div><div class="config-list">';
    Object.keys(CONFIG_GROUPS).forEach(groupKey => {
      const items = grouped[groupKey] || [];
      if (!items.length) return;
      const group = CONFIG_GROUPS[groupKey];
      html += `<section class="config-group"><div class="config-group-head"><div><h3>${group.title}</h3><p>${group.desc}</p></div><span>${items.length} 项</span></div><div class="config-group-body">`;
      items.forEach(config => {
        const meta = CONFIG_META[config.key] || { title: config.description || config.key, type:'text', range:'按业务要求填写', impact:config.description || '修改后立即影响对应功能。' };
        const currentText = meta.sensitive
          ? (config.value ? '已配置（内容已隐藏）' : '未配置')
          : (meta.display ? meta.display(config.value) : String(config.value || '未设置'));
        let input = '';
        if (meta.type === 'select') {
          input = `<select class="form-control" id="config-value-${config.id}">${meta.options.map(option => `<option value="${escapeHtml(option[0])}" ${String(config.value) === option[0] ? 'selected' : ''}>${escapeHtml(option[1])}</option>`).join('')}</select>`;
        } else {
          const type = meta.type === 'password' ? 'password' : (meta.type === 'number' ? 'number' : 'text');
          const value = meta.sensitive ? '' : config.value;
          input = `<input type="${type}" class="form-control" id="config-value-${config.id}" value="${escapeHtml(value)}" ${meta.min != null ? `min="${meta.min}"` : ''} ${meta.max != null ? `max="${meta.max}"` : ''} ${meta.step != null ? `step="${meta.step}"` : ''} ${meta.maxLength ? `maxlength="${meta.maxLength}"` : ''} placeholder="${meta.sensitive && config.value ? '留空表示不修改，输入新值将覆盖' : '请输入配置值'}">`;
        }
        html += `
          <div class="config-row">
            <div class="config-explain">
              <div class="config-name-line"><b>${escapeHtml(meta.title)}</b>${meta.sensitive ? '<span class="config-sensitive">敏感</span>' : ''}<code>${escapeHtml(config.key)}</code></div>
              <p>${escapeHtml(meta.impact)}</p>
              <div class="config-rules"><span>范围：${escapeHtml(meta.range || '-')}</span>${meta.unit ? `<span>单位：${escapeHtml(meta.unit)}</span>` : ''}${meta.recommended ? `<span>推荐：${escapeHtml(meta.recommended)}</span>` : ''}</div>
            </div>
            <div class="config-current"><span>当前值</span><strong>${escapeHtml(currentText)}</strong></div>
            <div class="config-edit">${input}<button class="btn btn-primary btn-sm" onclick="App.saveConfig(${config.id})">保存</button></div>
          </div>`;
      });
      html += '</div></section>';
    });
    html += '</div>';

    container.innerHTML = html;
  }

  async function saveConfig(id) {
    const configs = await API.getConfig();
    const config = configs.find(function (c) { return c.id === id; });
    if (!config) {
      showToast('配置项不存在', 'error');
      return;
    }

    const newValue = $('#config-value-' + id).value.trim();
    const meta = CONFIG_META[config.key] || {};
    if (!newValue && meta.sensitive && config.value) {
      showToast('未填写新值，原配置保持不变', 'warning');
      return;
    }
    if (!newValue && !meta.allowEmpty) {
      showToast('请输入配置值', 'error');
      return;
    }

    if (meta.type === 'number') {
      const value = Number(newValue);
      if (!Number.isFinite(value) || (meta.min != null && value < meta.min) || (meta.max != null && value > meta.max)) {
        showToast(`${meta.title}必须在${meta.range}范围内`, 'error');
        return;
      }
    }
    if (meta.options && !meta.options.some(option => option[0] === newValue)) {
      showToast(`${meta.title}取值无效`, 'error');
      return;
    }
    if (meta.maxLength && newValue.length > meta.maxLength) {
      showToast(`${meta.title}不能超过${meta.maxLength}个字符`, 'error');
      return;
    }

    showConfirm({
      title: '确认修改配置',
      message: '确定修改「' + (meta.title || config.description || config.key) + '」吗？保存后将立即影响相关功能。',
      confirmText: '确认修改',
      onConfirm: function () { doSaveConfig(id, config.key, newValue, config.description); }
    });
  }

  async function doSaveConfig(id, key, value, description) {
    try {
      await API.updateConfig({ key: key, value: value, description: description });
      showToast('配置已更新', 'success');
      loadConfig();
    } catch (err) {
      showToast(err.message || '保存失败', 'error');
    }
  }

  /* ============================================================
     提现管理
     ============================================================ */
  async function loadWithdrawals() {
    const container = $('#withdrawalsContent');
    container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>正在加载提现记录...</p></div>`;

    try {
      const data = await API.getWithdrawals({
        page: state.withdrawals.page,
        pageSize: state.withdrawals.pageSize,
        status: state.withdrawals.status
      });
      state.withdrawals.list = data.list || [];
      state.withdrawals.total = data.total || 0;
      renderWithdrawals(data.list || []);
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${escapeHtml(err.message || '加载失败')}</p></div>`;
    }
  }

  function renderWithdrawals(list) {
    const container = $('#withdrawalsContent');

    if (!list || list.length === 0) {
      container.innerHTML = `
        <div class="page-toolbar">
          <div>
            <label class="form-label">处理状态</label>
            <select class="form-control" onchange="App.setWithdrawalFilter(this.value)">
              <option value="all" ${state.withdrawals.status === 'all' ? 'selected' : ''}>全部状态</option>
              <option value="pending" ${state.withdrawals.status === 'pending' ? 'selected' : ''}>待审核</option>
              <option value="paid" ${state.withdrawals.status === 'paid' ? 'selected' : ''}>已打款</option>
              <option value="rejected" ${state.withdrawals.status === 'rejected' ? 'selected' : ''}>已拒绝</option>
            </select>
          </div>
          <div class="withdraw-total">共 0 条记录</div>
        </div>
        <div class="empty-state"><div class="empty-icon">💰</div><p>当前筛选下暂无提现记录</p></div>`;
      return;
    }

    const typeMap = { wechat: '微信', alipay: '支付宝', bank: '银行卡' };
    const statusMap = {
      pending: { label: '待审核', class: 'badge-pending' },
      approved: { label: '已打款', class: 'badge-approved' },
      paid: { label: '已打款', class: 'badge-approved' },
      rejected: { label: '已拒绝', class: 'badge-cancelled' }
    };

    let html = `
      <div class="page-toolbar">
        <div>
          <label class="form-label">处理状态</label>
          <select class="form-control" onchange="App.setWithdrawalFilter(this.value)">
            <option value="all" ${state.withdrawals.status === 'all' ? 'selected' : ''}>全部状态</option>
            <option value="pending" ${state.withdrawals.status === 'pending' ? 'selected' : ''}>待审核</option>
            <option value="paid" ${state.withdrawals.status === 'paid' ? 'selected' : ''}>已打款</option>
            <option value="rejected" ${state.withdrawals.status === 'rejected' ? 'selected' : ''}>已拒绝</option>
          </select>
        </div>
        <div class="withdraw-total">共 ${state.withdrawals.total} 条记录</div>
      </div>
      <div class="card"><div class="table-wrapper"><table><thead><tr>`;
    html += '<th>ID</th><th>司机</th><th>金额</th><th>收款信息</th><th>状态</th><th>申请时间</th><th>处理信息</th><th>操作</th>';
    html += '</tr></thead><tbody>';

    list.forEach(function (w) {
      const s = statusMap[w.status] || { label: w.status, class: 'badge-pending' };
      const canProcess = w.status === 'pending';
      html += `
        <tr>
          <td class="table-cell-mono">#${w.id}</td>
          <td><strong>${escapeHtml(w.driver_name || '-')}</strong><div class="table-cell-sub">${escapeHtml(w.driver_phone || '-')}</div></td>
          <td class="table-cell-amount">${formatMoney(w.amount)}</td>
          <td>
            <strong>${escapeHtml(typeMap[w.type] || w.type || '-')}</strong>
            <div class="table-cell-sub">${escapeHtml(w.account_name || '-')} · ${escapeHtml(w.account || '-')}</div>
          </td>
          <td><span class="badge ${s.class}">${escapeHtml(s.label)}</span></td>
          <td>${formatDate(w.created_at)}</td>
          <td>
            <div>${w.payment_reference ? '流水：' + escapeHtml(w.payment_reference) : '-'}</div>
            <div class="table-cell-sub">${escapeHtml(w.review_remark || '')}${w.processed_at ? ' · ' + formatDate(w.processed_at) : ''}</div>
          </td>
          <td>
            <div class="table-actions">
              ${canProcess ? `<button class="btn btn-success btn-sm" onclick="App.openWithdrawalProcess(${w.id}, 'pay')">确认打款</button>
                <button class="btn btn-danger btn-sm" onclick="App.openWithdrawalProcess(${w.id}, 'reject')">拒绝</button>` : '<span style="color:#94a3b8">已处理</span>'}
            </div>
          </td>
        </tr>`;
    });

    html += '</tbody></table></div></div>';
    container.innerHTML = html;
  }

  function setWithdrawalFilter(status) {
    state.withdrawals.status = status;
    state.withdrawals.page = 1;
    loadWithdrawals();
  }

  function openWithdrawalProcess(id, action) {
    const item = state.withdrawals.list.find(function (w) { return w.id === id; });
    if (!item) return showToast('提现记录不存在', 'error');
    state.withdrawals.processingId = id;
    state.withdrawals.action = action;
    const isPay = action === 'pay';
    $('#withdrawProcessTitle').textContent = isPay ? '确认提现打款' : '拒绝提现申请';
    $('#withdrawProcessSummary').innerHTML = `
      <div><strong>${escapeHtml(item.driver_name || '-')}</strong> · ${formatMoney(item.amount)}</div>
      <div>${escapeHtml(item.account_name || '-')} · ${escapeHtml(item.account || '-')}</div>`;
    $('#withdrawPaymentReferenceGroup').style.display = isPay ? 'block' : 'none';
    $('#withdrawPaymentReference').value = '';
    $('#withdrawProcessRemark').value = '';
    $('#withdrawRemarkLabel').textContent = isPay ? '处理备注（选填）' : '拒绝原因';
    $('#withdrawProcessRemark').placeholder = isPay ? '可填写打款说明' : '请填写拒绝原因，金额将自动退回司机余额';
    const submit = $('#withdrawProcessSubmit');
    submit.textContent = isPay ? '确认已打款' : '确认拒绝';
    submit.className = 'btn ' + (isPay ? 'btn-success' : 'btn-danger');
    openModal('withdrawProcessModal');
  }

  async function submitWithdrawalProcess() {
    const id = state.withdrawals.processingId;
    const action = state.withdrawals.action;
    const reference = $('#withdrawPaymentReference').value.trim();
    const remark = $('#withdrawProcessRemark').value.trim();
    if (action === 'pay' && reference.length < 4) {
      return showToast('请填写有效的打款流水号', 'warning');
    }
    if (action === 'reject' && remark.length < 2) {
      return showToast('请填写拒绝原因', 'warning');
    }
    const submit = $('#withdrawProcessSubmit');
    submit.disabled = true;
    try {
      if (action === 'pay') {
        await API.approveWithdrawal(id, { payment_reference: reference, remark: remark });
        showToast('提现已确认打款', 'success');
      } else {
        await API.rejectWithdrawal(id, { reason: remark });
        showToast('提现已拒绝，金额已退回司机钱包', 'success');
      }
      closeModal('withdrawProcessModal');
      loadWithdrawals();
    } catch (err) {
      showToast(err.message || '操作失败', 'error');
    } finally {
      submit.disabled = false;
    }
  }

  /* ============================================================
     分页工具
     ============================================================ */
  function getPageNumbers(current, total) {
    const result = [];
    if (total <= 7) {
      for (let i = 1; i <= total; i++) result.push(i);
      return result;
    }
    result.push(1);
    if (current > 3) result.push('...');
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    for (let i = start; i <= end; i++) result.push(i);
    if (current < total - 2) result.push('...');
    result.push(total);
    return result;
  }

  /* ============================================================
     事件绑定
     ============================================================ */
  function bindEvents() {
    // 登录表单
    $('#loginForm').addEventListener('submit', handleLogin);

    // 退出登录
    $('#logoutBtn').addEventListener('click', handleLogout);

    // 侧边栏导航
    $$('.sidebar-nav .nav-item').forEach(function (item) {
      item.addEventListener('click', function () {
        switchView(this.dataset.view);
      });
    });

    // 顶部刷新按钮
    $('#refreshBtn').addEventListener('click', function () {
      refreshCurrentView();
      showToast('数据已刷新', 'info');
    });

    // 看板刷新按钮
    $('#dashboardRefreshBtn').addEventListener('click', function () {
      loadDashboard();
      showToast('看板数据已刷新', 'info');
    });

    // 订单筛选
    $('#orderStatusFilter').addEventListener('change', function () {
      state.orders.status = this.value;
      state.orders.page = 1;
      loadOrders();
    });

    $('#orderVehicleFilter').addEventListener('change', function () {
      state.orders.vehicleType = this.value;
      state.orders.page = 1;
      loadOrders();
    });

    // 订单搜索（防抖）
    const debouncedSearch = debounce(function () {
      state.orders.keyword = $('#orderKeyword').value.trim();
      state.orders.page = 1;
      loadOrders();
    }, 500);
    $('#orderKeyword').addEventListener('input', debouncedSearch);
    $('#orderKeyword').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        state.orders.keyword = this.value.trim();
        state.orders.page = 1;
        loadOrders();
      }
    });

    // 司机筛选
    $('#driverStatusFilter').addEventListener('change', function () {
      state.drivers.statusFilter = this.value;
      renderDriversTable();
    });

    // 改价表单
    $('#priceBase').addEventListener('input', updatePriceTotal);
    $('#priceDistance').addEventListener('input', updatePriceTotal);
    $('#priceExtra').addEventListener('input', updatePriceTotal);
    $('#priceSubmitBtn').addEventListener('click', submitPriceChange);

    // 订单详情改价按钮
    $('#orderDetailPriceBtn').addEventListener('click', function () {
      if (state.currentOrderId) {
        closeModal('orderDetailModal');
        setTimeout(function () {
          openPriceModal(state.currentOrderId);
        }, 200);
      }
    });

    // 生成服务卡
    $('#genCardBtn').addEventListener('click', openGenCardModal);
    $('#genCardSubmitBtn').addEventListener('click', submitGenCard);

    // 编辑司机
    $('#editDriverSubmitBtn').addEventListener('click', submitEditDriver);

    // 用户搜索
    const debouncedUserSearch = debounce(function () {
      state.users.keyword = $('#userKeyword').value.trim();
      state.users.page = 1;
      loadUsers();
    }, 500);
    $('#userKeyword').addEventListener('input', debouncedUserSearch);
    $('#userKeyword').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        state.users.keyword = this.value.trim();
        state.users.page = 1;
        loadUsers();
      }
    });

    // 确认对话框
    $('#confirmOkBtn').addEventListener('click', function () {
      closeModal('confirmModal');
      if (typeof state.confirmCallback === 'function') {
        const cb = state.confirmCallback;
        state.confirmCallback = null;
        cb();
      }
    });

    // 模态框关闭按钮
    $$('[data-close]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closeModal(this.dataset.close);
      });
    });

    // 点击遮罩关闭模态框
    $$('.modal-overlay').forEach(function (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === this) {
          this.classList.remove('show');
        }
      });
    });

    // ESC 关闭模态框
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        $$('.modal-overlay.show').forEach(function (m) {
          m.classList.remove('show');
        });
      }
    });

    // 移动端菜单
    $('#menuToggle').addEventListener('click', function () {
      $('#sidebar').classList.toggle('open');
      $('#sidebarBackdrop').classList.toggle('show');
    });
    $('#sidebarBackdrop').addEventListener('click', function () {
      $('#sidebar').classList.remove('open');
      $('#sidebarBackdrop').classList.remove('show');
    });
  }

  /* ============================================================
     新增：服务卡分配（需求4：创建→分配→核销→跟踪）
     ============================================================ */
  async function loadCardsAssign() {
    const container = $('#cardsAssignContent');
    if (!container) return;
    container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>正在加载服务卡...</p></div>`;
    try {
      const [list, allocations, usages] = await Promise.all([
        API.cardList({ status: 'all' }),
        API.cardAllocations().catch(() => ({ list: [] })),
        API.cardUsages().catch(() => ({ list: [] }))
      ]);
      const dataList = (list && list.list) ? list.list : (Array.isArray(list) ? list : []);
      state.cardsAssign.list = dataList;
      state.cardsAssign.allocations = (allocations && allocations.list) ? allocations.list : [];
      state.cardsAssign.usages = (usages && usages.list) ? usages.list : [];
      renderCardsAssign();
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><p>${escapeHtml(e.message || '加载失败')}</p></div>`;
    }
  }

  function renderCardsAssign() {
    const tab = state.cardsAssign.tab;
    let list = state.cardsAssign.list || [];
    const filter = state.cardsAssign.filter || '';
    if (filter) list = list.filter(c => (c.code || '').includes(filter) || (c.name || '').includes(filter));
    if (tab === 'unallocated') list = list.filter(c => !c.user_id);
    else if (tab === 'allocated') list = list.filter(c => c.user_id);
    else if (tab === 'expired') list = list.filter(c => c.status === 'expired');
    else if (tab === 'used') list = list.filter(c => c.status === 'used' || c.status === 'redeemed');

    const rows = list.map(c => `
      <tr>
        <td><code>${escapeHtml(c.code || '')}</code></td>
        <td>${escapeHtml(c.name || '')}</td>
        <td>${formatMoney(c.discount_amount)}</td>
        <td>${escapeHtml(c.vehicle_size_cn || c.vehicle_size || '通用')}</td>
        <td>${formatDate(c.expires_at)}</td>
        <td>${c.user_id ? `<span class="badge badge-online">已分配 · 用户#${c.user_id}</span>` : `<span class="badge badge-cancelled">未分配</span>`}</td>
        <td>${getCardStatusBadge(c.status)}</td>
        <td>
          ${!c.user_id ? `<button class="btn btn-outline btn-sm" onclick="App.openCardAllocateModal(${c.id})">分配给用户</button>` : `<button class="btn btn-outline btn-sm" disabled>已分配</button>`}
        </td>
      </tr>
    `).join('');

    $('#cardsAssignContent').innerHTML = `
      <div class="data-table-toolbar">
        <div class="tabs-bar" role="tablist">
          <button class="tab-btn ${tab==='unallocated' ? 'on':''}" onclick="App.switchCardsAssignTab('unallocated')">未分配 (${state.cardsAssign.list.filter(c => !c.user_id).length})</button>
          <button class="tab-btn ${tab==='allocated' ? 'on':''}" onclick="App.switchCardsAssignTab('allocated')">已分配 (${state.cardsAssign.list.filter(c => c.user_id).length})</button>
          <button class="tab-btn ${tab==='used' ? 'on':''}" onclick="App.switchCardsAssignTab('used')">已核销 (${state.cardsAssign.list.filter(c => c.status==='used' || c.status==='redeemed').length})</button>
          <button class="tab-btn ${tab==='expired' ? 'on':''}" onclick="App.switchCardsAssignTab('expired')">已过期 (${state.cardsAssign.list.filter(c => c.status==='expired').length})</button>
        </div>
        <div style="display:flex;gap:8px;">
          <input class="form-control" placeholder="搜索卡编号/名称" value="${escapeHtml(state.cardsAssign.filter)}" onchange="App.setCardsAssignFilter(this.value)"/>
          <button class="btn btn-primary btn-sm" onclick="App.openCardBatchModal()">批量分配(按手机号)</button>
          <button class="btn btn-outline btn-sm" onclick="App.openCardCreateModal()">生成新卡</button>
        </div>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>卡编号</th><th>名称</th><th>抵扣金额</th><th>适用车型</th><th>有效期</th><th>分配状态</th><th>使用状态</th><th>操作</th>
          </tr></thead>
          <tbody>${rows || `<tr><td colspan="8" style="padding:40px;text-align:center;color:#94a3b8;">暂无数据</td></tr>`}</tbody>
        </table>
      </div>
      <div class="card-trace">
        <h4 class="sub-title">分配/核销追踪记录</h4>
        <div class="data-table-wrap">
          <table class="data-table">
            <thead><tr><th>类型</th><th>卡编号</th><th>关联订单</th><th>抵扣</th><th>时间</th><th>操作人/备注</th></tr></thead>
            <tbody>
              ${state.cardsAssign.allocations.slice(-20).map(a => `<tr>
                <td><span class="badge badge-online">分配</span></td>
                <td>${escapeHtml(a.card_code || '#')}</td>
                <td>-</td>
                <td>-</td>
                <td>${formatDate(a.allocated_at)}</td>
                <td>用户#${a.user_id} · by Admin#${a.allocated_by || '-'}</td>
              </tr>`).join('')}
              ${state.cardsAssign.usages.slice(-20).map(u => `<tr>
                <td><span class="badge badge-used">核销</span></td>
                <td>${escapeHtml(u.card_code || '#')}</td>
                <td>#${u.order_id}</td>
                <td>${formatMoney(u.discount_amount)}</td>
                <td>${formatDate(u.redeemed_at)}</td>
                <td>${escapeHtml(u.admin_note || '')}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function openCardAllocateModal(cardId) {
    state.cardsAssign._allocCardId = cardId;
    $('#allocCardUserId').value = '';
    $('#allocCardPhone').value = '';
    openModal('allocCardModal');
  }

  async function submitCardAllocate() {
    const cardId = state.cardsAssign._allocCardId;
    const uid = Number($('#allocCardUserId').value) || 0;
    const phone = $('#allocCardPhone').value.trim();
    if (!uid && !phone) return showToast('请填写用户ID或手机号', 'warning');
    try {
      if (uid) await API.cardAllocate(cardId, { user_id: uid });
      else await API.cardBatchAllocate({ phone, card_ids: [cardId] });
      closeModal('allocCardModal');
      showToast('分配成功', 'success');
      loadCardsAssign();
    } catch (e) { showToast(e.message || '分配失败', 'error'); }
  }

  function openCardBatchModal() {
    $('#batchPhone').value = '';
    $('#batchCardIds').value = '';
    openModal('batchCardModal');
  }

  async function submitCardBatch() {
    const phone = $('#batchPhone').value.trim();
    const idsStr = $('#batchCardIds').value.trim();
    if (!phone) return showToast('请填写用户手机号', 'warning');
    const ids = idsStr.split(/[,\s]+/).map(s => Number(s)).filter(Boolean);
    if (!ids.length) return showToast('请填写要分配的卡ID(逗号分隔)', 'warning');
    try {
      await API.cardBatchAllocate({ phone, card_ids: ids });
      closeModal('batchCardModal');
      showToast('批量分配成功', 'success');
      loadCardsAssign();
    } catch (e) { showToast(e.message || '分配失败', 'error'); }
  }

  function openCardCreateModal() {
    $('#newCardName').value = ''; $('#newCardAmount').value = 50;
    $('#newCardVehicle').value = 'all'; $('#newCardCount').value = 1;
    $('#newCardExpireDays').value = 90;
    openModal('newCardModal');
  }
  async function submitCardCreate() {
    const name = $('#newCardName').value.trim();
    const amount = Number($('#newCardAmount').value);
    const vehicle = $('#newCardVehicle').value;
    const count = Math.max(1, Number($('#newCardCount').value) || 1);
    const days = Math.max(1, Number($('#newCardExpireDays').value) || 90);
    if (!name || !amount) return showToast('请填写名称和抵扣金额', 'warning');
    try {
      await API.cardCreate({ name, discount_amount: amount, vehicle_size: vehicle, count, valid_days: days });
      closeModal('newCardModal');
      showToast(`成功创建 ${count} 张服务卡`, 'success');
      loadCardsAssign();
    } catch (e) { showToast(e.message || '创建失败', 'error'); }
  }

  /* ============================================================
     新增：订单调度（需求3：距离+评分+等级+接单量排序）
     ============================================================ */
  async function loadDispatch() {
    const container = $('#dispatchContent');
    if (!container) return;
    container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>正在加载调度模块...</p></div>`;
    try {
      const [levels, weights, queue, logs] = await Promise.all([
        API.dispatchLevels().catch(() => []),
        API.dispatchWeights().catch(() => null),
        API.dispatchQueue().catch(() => ({ list: [] })),
        API.dispatchLogs(30).catch(() => [])
      ]);
      state.dispatch.levels = levels || [];
      state.dispatch.weights = weights || null;
      state.dispatch.queue = (queue && queue.list) || [];
      state.dispatch.logs = logs || [];
      renderDispatchFrame();
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><p>${escapeHtml(e.message || '加载失败')}</p></div>`;
    }
  }

  function renderDispatchFrame() {
    const w0 = state.dispatch.weights || {};
    const num = (v, d) => { const n = Number(v); return isNaN(n) ? d : n; };
    const w = {
      enabled: w0.enabled !== false,
      strategy: w0.strategy || 'auto_assign',
      requireDeposit: w0.requireDeposit !== false,
      allowBusy: w0.allowBusy === true,
      distance: num(w0.distance != null ? w0.distance : w0.distW, 0.4),
      rating: num(w0.rating != null ? w0.rating : w0.ratingW, 0.25),
      level: num(w0.level != null ? w0.level : w0.levelW, 0.2),
      order: num(w0.order != null ? w0.order : w0.orderW, 0.15),
      maxDistanceKm: num(w0.maxDistanceKm != null ? w0.maxDistanceKm : w0.maxKm, 30),
      maxCandidates: num(w0.maxCandidates != null ? w0.maxCandidates : w0.max_candidates, 10)
    };
    const strategyText = {
      auto_assign: '自动指派第一名',
      recommend_only: '生成推荐，司机抢单',
      manual: '仅管理员人工指派'
    };
    const levelRows = state.dispatch.levels.map(l => {
      const minOrders = l.threshold_orders != null ? l.threshold_orders : l.min_orders;
      const minRating = l.threshold_rating != null ? l.threshold_rating : l.min_rating;
      return `
      <div class="lvl-card" style="background: linear-gradient(90deg, ${l.gradient_from}, ${l.gradient_to}); box-shadow: 0 0 12px ${l.glow_color};">
        <div class="lvl-badge">${l.level}</div>
        <div class="lvl-name">${l.name}</div>
        <div class="lvl-sub">门槛 ${minOrders != null ? minOrders : '-'}单 · 评分≥${minRating != null ? minRating : '-'}</div>
        <div class="lvl-coef">派单系数 ×${l.coefficient}</div>
      </div>
    `;}).join('');
    const queueRows = state.dispatch.queue.map(order => `
      <tr>
        <td><b>#${order.id}</b><div class="table-cell-sub">${escapeHtml(order.order_no || '')}</div></td>
        <td>${escapeHtml(order.pickup_address || '-')}<div class="table-cell-sub">${escapeHtml((VEHICLE_MAP[order.vehicle_type] || {}).label || order.vehicle_type || '-')}</div></td>
        <td><span class="badge ${order.deposit_status === 'paid' ? 'badge-online' : 'badge-pending'}">${order.deposit_status === 'paid' ? '押金已付' : '押金未付'}</span></td>
        <td>${order.candidate_count || 0} 人</td>
        <td>${formatDate(order.created_at)}</td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="App.selectDispatchOrder(${order.id})">查看推荐</button>
          ${w.strategy !== 'manual' ? `<button class="btn btn-primary btn-sm" onclick="App.runQueueDispatch(${order.id})">${w.strategy === 'auto_assign' ? '立即派单' : '刷新候选'}</button>` : ''}
        </td>
      </tr>
    `).join('');
    const logRows = state.dispatch.logs.map(log => {
      const resultText = log.result === 'no_candidate' ? '无可用司机' : (log.selected_driver_id ? '已指派' : '已推荐');
      return `
        <tr>
          <td>${formatDate(log.created_at)}</td>
          <td>#${log.order_id || '-'}<div class="table-cell-sub">${escapeHtml(log.order_no || '')}</div></td>
          <td>${log.mode === 'manual_assign' ? '人工指派' : log.mode === 'auto_assign' ? '自动指派' : '候选推荐'}</td>
          <td><span class="badge ${log.result === 'no_candidate' ? 'badge-pending' : 'badge-online'}">${resultText}</span></td>
          <td>${log.selected_driver_id ? `#${log.selected_driver_id} ${escapeHtml(log.driver_name || '')}` : '-'}</td>
          <td>${escapeHtml(log.remark || '-')}</td>
        </tr>
      `;
    }).join('');

    $('#dispatchContent').innerHTML = `
      <div class="dispatch-guide">
        <div class="dispatch-guide-title">调度如何工作</div>
        <div class="dispatch-guide-steps">
          <div><b>1. 进入队列</b><span>${w.requireDeposit ? '用户支付押金后，待派单订单进入队列。' : '订单创建后立即进入调度队列。'}</span></div>
          <div><b>2. 综合排序</b><span>仅筛选审核通过、在线且无进行中订单的司机，再按距离、评分、等级和近7日接单量计算。</span></div>
          <div><b>3. 执行策略</b><span>当前为“${strategyText[w.strategy]}”。人工指派始终会校验订单和司机状态。</span></div>
        </div>
      </div>

      <div class="dispatch-section">
        <div class="dispatch-section-head">
          <div><h3 class="sub-title">派单参数</h3><p>保存后立即作用于新订单和手动重新调度。四项权重之和必须为 1。</p></div>
          <div class="dispatch-switch-row">
            <label class="check-control"><input id="dispatchEnabled" type="checkbox" ${w.enabled ? 'checked' : ''}><span>启用调度</span></label>
            <label class="check-control"><input id="dispatchRequireDeposit" type="checkbox" ${w.requireDeposit ? 'checked' : ''}><span>仅派已付押金订单</span></label>
          </div>
        </div>
        <div class="dispatch-form-grid">
          <label class="dispatch-field"><span>派单策略</span><select id="dispatchStrategy" class="form-control">
            <option value="auto_assign" ${w.strategy === 'auto_assign' ? 'selected' : ''}>自动指派综合排名第一的司机</option>
            <option value="recommend_only" ${w.strategy === 'recommend_only' ? 'selected' : ''}>只生成推荐，保留司机抢单</option>
            <option value="manual" ${w.strategy === 'manual' ? 'selected' : ''}>关闭自动计算，仅人工指派</option>
          </select></label>
          <label class="dispatch-field"><span>最大搜索半径（公里）</span><input id="dispatchMaxDistance" type="number" min="1" max="300" class="form-control" value="${w.maxDistanceKm}"></label>
          <label class="dispatch-field"><span>最多候选人数</span><input id="dispatchMaxCandidates" type="number" min="1" max="50" class="form-control" value="${w.maxCandidates}"></label>
          <label class="dispatch-field"><span>距离权重</span><input id="dispatchWeightDistance" type="number" min="0" max="1" step="0.05" class="form-control" value="${w.distance}"></label>
          <label class="dispatch-field"><span>评分权重</span><input id="dispatchWeightRating" type="number" min="0" max="1" step="0.05" class="form-control" value="${w.rating}"></label>
          <label class="dispatch-field"><span>服务等级权重</span><input id="dispatchWeightLevel" type="number" min="0" max="1" step="0.05" class="form-control" value="${w.level}"></label>
          <label class="dispatch-field"><span>近7日均衡权重</span><input id="dispatchWeightOrder" type="number" min="0" max="1" step="0.05" class="form-control" value="${w.order}"></label>
        </div>
        <div class="dispatch-form-actions">
          <span>忙碌司机默认不进入候选，避免一名司机同时执行多单。</span>
          <button class="btn btn-primary" onclick="App.saveDispatchSettings()">保存并立即生效</button>
        </div>
      </div>

      <div class="dispatch-section">
        <div class="dispatch-section-head">
          <div><h3 class="sub-title">待调度订单</h3><p>共 ${state.dispatch.queue.length} 笔符合当前押金规则的待派订单。</p></div>
          <button class="btn btn-outline btn-sm" onclick="App.reloadDispatch()">刷新</button>
        </div>
        <div class="table-wrapper">
          <table><thead><tr><th>订单</th><th>救援位置</th><th>支付条件</th><th>已有候选</th><th>下单时间</th><th>操作</th></tr></thead>
          <tbody>${queueRows || '<tr><td colspan="6"><div class="empty-state compact"><p>当前没有待调度订单</p></div></td></tr>'}</tbody></table>
        </div>
      </div>

      <div class="dispatch-section">
        <div class="page-toolbar">
          <div><h3 class="sub-title">候选司机计算</h3><p class="dispatch-caption">用于查看评分明细；计算本身不会占用司机，点击“指派该司机”或“立即派单”才会改变订单。</p></div>
          <div class="dispatch-search">
            <input class="form-control" type="number" placeholder="输入订单ID" value="${state.dispatch.orderId || ''}" onchange="App.setDispatchOrderId(this.value)"/>
            <button class="btn btn-primary" onclick="App.runDispatchRecommend()">计算推荐</button>
          </div>
        </div>
        <div id="dispatchRankArea">
          <div class="empty-state compact"><p>输入订单ID或从待调度列表选择订单，查看候选司机及评分依据。</p></div>
        </div>
      </div>

      <div class="dispatch-section">
        <div class="dispatch-section-head"><div><h3 class="sub-title">最近调度记录</h3><p>记录自动指派、人工改派、仅推荐和无候选结果，便于追溯。</p></div></div>
        <div class="table-wrapper">
          <table><thead><tr><th>时间</th><th>订单</th><th>方式</th><th>结果</th><th>司机</th><th>摘要</th></tr></thead>
          <tbody>${logRows || '<tr><td colspan="6"><div class="empty-state compact"><p>暂无调度记录</p></div></td></tr>'}</tbody></table>
        </div>
      </div>

      <div class="dispatch-section">
        <div class="dispatch-section-head"><div><h3 class="sub-title">司机服务等级</h3><p>等级门槛由累计完成单量和评分共同决定，等级系数参与候选排名。</p></div></div>
        <div class="levels-grid">${levelRows || '<div class="empty-state"><p>暂无等级数据</p></div>'}</div>
      </div>
    `;
  }

  async function saveDispatchSettings() {
    const payload = {
      enabled: $('#dispatchEnabled').checked,
      strategy: $('#dispatchStrategy').value,
      requireDeposit: $('#dispatchRequireDeposit').checked,
      allowBusy: false,
      distance: Number($('#dispatchWeightDistance').value),
      rating: Number($('#dispatchWeightRating').value),
      level: Number($('#dispatchWeightLevel').value),
      order: Number($('#dispatchWeightOrder').value),
      maxDistanceKm: Number($('#dispatchMaxDistance').value),
      maxCandidates: Number($('#dispatchMaxCandidates').value)
    };
    const total = payload.distance + payload.rating + payload.level + payload.order;
    if (Math.abs(total - 1) > 0.001) return showToast(`四项权重之和应为1，当前为${total.toFixed(2)}`, 'warning');
    try {
      await API.dispatchSaveSettings(payload);
      showToast('调度参数已保存并立即生效', 'success');
      loadDispatch();
    } catch (e) { showToast(e.message || '保存失败', 'error'); }
  }

  async function runQueueDispatch(orderId) {
    try {
      const result = await API.dispatchRun(orderId);
      const driver = result && result.driver;
      showToast(driver ? `已自动指派给${driver.name}` : '候选列表已更新', 'success');
      state.dispatch.orderId = String(orderId);
      await loadDispatch();
      runDispatchRecommend();
    } catch (e) { showToast(e.message || '调度失败', 'error'); }
  }

  function selectDispatchOrder(orderId) {
    state.dispatch.orderId = String(orderId);
    renderDispatchFrame();
    runDispatchRecommend();
  }

  async function runDispatchRecommend() {
    const id = Number(state.dispatch.orderId);
    if (!id) return showToast('请先输入订单ID', 'warning');
    $('#dispatchRankArea').innerHTML = `<div class="loading-state"><div class="spinner"></div><p>计算推荐司机...</p></div>`;
    try {
      const r = await API.dispatchRecommend(id);
      state.dispatch.recommend = r;
      const list = (r && r.candidates) || [];
      const order = (r && r.order) || {};
      const assignable = ['pending', 'accepted'].includes(order.status) && (!(r.settings && r.settings.requireDeposit) || order.deposit_status === 'paid');
      const html = !list.length ? `<div class="empty-state"><p>${escapeHtml((r && r.reason) || '该订单暂无合适司机(半径内无在线/审核通过司机)')}</p></div>` : `
        <div class="dispatch-meta">订单 #${id} · ${escapeHtml(order.pickup_address || '')} · 共 ${list.length} 名候选 · 当前状态：${escapeHtml((STATUS_MAP[order.status] || {}).label || order.status || '-')}</div>
        <div class="rank-list">
          ${list.map((d, i) => `
            <div class="rank-item ${i===0 ? 'top' : ''}">
              <div class="rk">#${i+1}</div>
              <div class="rk-main">
                <div class="rk-head">
                  <b>司机 #${d.driver_id}</b>
                  <span class="badge badge-online">${d.level_code || 'V1'}</span>
                  <span class="lv-name">${d.level_name || ''}</span>
                </div>
                <div class="rk-meta">
                  <span>距离 ${d.distance_km == null ? '未知' : Number(d.distance_km).toFixed(1) + ' km'}</span>
                  <span>评分 ⭐ ${Number(d.rating).toFixed(2)}</span>
                  <span>等级系数 ×${d.level_coefficient || 1}</span>
                  <span>7日接单 ${d.accept_count_7d || 0} 单</span>
                </div>
                <div class="rk-reason">${escapeHtml(d.reason || '')}</div>
              </div>
              <div class="rk-score">
                <div class="s1">${Number(d.score).toFixed(3)}</div>
                <div class="s2">总分</div>
                ${assignable ? `<button class="btn btn-primary btn-sm" onclick="App.manualAssignDriver(${id}, ${d.driver_id})">指派该司机</button>` : '<span class="rk-disabled">当前不可指派</span>'}
              </div>
            </div>
          `).join('')}
        </div>
      `;
      $('#dispatchRankArea').innerHTML = html;
    } catch (e) {
      $('#dispatchRankArea').innerHTML = `<div class="empty-state"><p>${escapeHtml(e.message || '计算失败')}</p></div>`;
    }
  }

  async function manualAssignDriver(orderId, driverId) {
    try {
      await API.assignDriver(orderId, driverId);
      showToast(`已将订单#${orderId}指派给司机#${driverId}`, 'success');
      loadDispatch();
    } catch (e) { showToast(e.message || '指派失败', 'error'); }
  }

  /* ============================================================
     新增：支付流水（需求5：押金/尾款/退款 + 逃单扫描）
     ============================================================ */
  async function loadPayments() {
    const container = $('#paymentsContent');
    if (!container) return;
    container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>正在加载支付流水...</p></div>`;
    try {
      const r = await API.paymentRecords({ page: state.payments.page, pageSize: state.payments.pageSize, biz_type: state.payments.filterType === 'all' ? undefined : state.payments.filterType, status: state.payments.status === 'all' ? undefined : state.payments.status });
      state.payments.list = (r && r.list) ? r.list : [];
      state.payments.total = (r && r.total) ? r.total : state.payments.list.length;
      renderPayments();
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><p>${escapeHtml(e.message || '加载失败')}</p></div>`;
    }
  }

  function renderPayments() {
    const rows = state.payments.list.map(r => {
      const typeMap = { deposit: '押金', final: '尾款', refund: '退款', card_redeem: '服务卡抵扣' };
      const statusMap = { pending: '待支付', paid: '已支付', refunded: '已退款', failed: '失败' };
      const typeCls = r.biz_type === 'refund' ? 'badge-used' : (r.biz_type === 'deposit' ? 'badge-en_route' : (r.biz_type === 'final' ? 'badge-online' : 'badge-pending'));
      const stCls = r.status === 'paid' ? 'badge-online' : (r.status === 'refunded' ? 'badge-used' : (r.status === 'failed' ? 'badge-cancelled' : 'badge-pending'));
      return `<tr>
        <td>${r.id}</td>
        <td>#${r.order_id || '-'}</td>
        <td>#${r.user_id || '-'}</td>
        <td><span class="badge ${typeCls}">${typeMap[r.biz_type] || r.biz_type}</span></td>
        <td>${formatMoney(r.amount)}</td>
        <td><span class="badge ${stCls}">${statusMap[r.status] || r.status}</span></td>
        <td><code>${escapeHtml(r.transaction_id || r.txn_id || (r.pay_type === 'mock' ? 'MOCK-' + (r.id || '') : '-'))}</code></td>
        <td>${formatDate(r.paid_at || r.created_at)}</td>
        <td>${escapeHtml(r.fail_reason || r.remark || '')}</td>
      </tr>`;
    }).join('');

    $('#paymentsContent').innerHTML = `
      <div class="data-table-toolbar">
        <div style="display:flex;gap:8px;align-items:center;">
          <label>类型：
            <select class="form-control" onchange="App.setPayFilter('filterType', this.value)">
              <option value="all" ${state.payments.filterType==='all'?'selected':''}>全部</option>
              <option value="deposit" ${state.payments.filterType==='deposit'?'selected':''}>押金</option>
              <option value="final" ${state.payments.filterType==='final'?'selected':''}>尾款</option>
              <option value="refund" ${state.payments.filterType==='refund'?'selected':''}>退款</option>
              <option value="card_redeem" ${state.payments.filterType==='card_redeem'?'selected':''}>卡抵扣</option>
            </select>
          </label>
          <label>状态：
            <select class="form-control" onchange="App.setPayFilter('status', this.value)">
              <option value="all">全部</option>
              <option value="pending">待支付</option>
              <option value="paid">已支付</option>
              <option value="refunded">已退款</option>
              <option value="failed">失败</option>
            </select>
          </label>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-danger btn-sm" onclick="App.runEscapeJob()">运行逃单扫描(扣30分/单)</button>
          <button class="btn btn-outline btn-sm" onclick="loadPayments()">刷新</button>
        </div>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>流水ID</th><th>订单ID</th><th>用户ID</th><th>类型</th><th>金额</th><th>状态</th><th>支付流水</th><th>时间</th><th>备注</th>
          </tr></thead>
          <tbody>${rows || `<tr><td colspan="9" style="text-align:center;padding:40px;color:#94a3b8;">暂无流水</td></tr>`}</tbody>
        </table>
      </div>
      <div style="margin-top:10px;color:#64748b;font-size:12px;">共 ${state.payments.total || 0} 条 · page ${state.payments.page}</div>
    `;
  }

  async function runEscapeJob() {
    try {
      const r = await API.paymentRunEscapeJob();
      const n = (r && (r.scanned_count != null ? r.scanned_count : r.scanned)) || 0;
      const p = (r && (r.penalized_count != null ? r.penalized_count : r.escape_count)) || 0;
      showToast(`扫描 ${n} 单，处罚 ${p} 单`, 'success');
      loadPayments();
    } catch (e) { showToast(e.message || '扫描失败', 'error'); }
  }

  /* ============================================================
     新增：信用积分（需求5：按用户查看/调整分）
     ============================================================ */
  async function loadCredit() {
    const container = $('#creditContent');
    if (!container) return;
    container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>正在加载用户列表...</p></div>`;
    try {
      const r = await API.getUsers({ page: 1, pageSize: 200 });
      const users = (r && r.list) ? r.list : [];
      state.credit.users = users;
      renderCredit();
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><p>${escapeHtml(e.message || '加载失败')}</p></div>`;
    }
  }

  async function renderCredit() {
    const rowsHtml = state.credit.users.map(u => `
      <tr>
        <td>${u.id}</td>
        <td>${escapeHtml(u.nickname || '')}</td>
        <td>${escapeHtml(u.phone || (u.openid ? '微信#' + u.openid.slice(0,8) : ''))}</td>
        <td>${u.credit_score != null ? u.credit_score : '100'}</td>
        <td>${u.unpaid_orders_count || 0}</td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="App.openCreditAdjustModal(${u.id}, '${escapeHtml(u.nickname || '')}')">调整积分</button>
        </td>
      </tr>
    `).join('');
    $('#creditContent').innerHTML = `
      <div class="data-table-toolbar">
        <div class="hint-msg">
          🔒 规则：按时付尾款+2 · 逃单-30 · 低于60分禁止下单；建议配合「运行逃单扫描」使用。
        </div>
        <div></div>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead><tr><th>用户ID</th><th>昵称</th><th>手机号</th><th>信用积分</th><th>未付订单数</th><th>操作</th></tr></thead>
          <tbody>${rowsHtml || `<tr><td colspan="6" style="padding:40px;text-align:center;color:#94a3b8;">暂无用户</td></tr>`}</tbody>
        </table>
      </div>
    `;
  }

  function openCreditAdjustModal(userId, nick) {
    state.credit.adjustForm.userId = userId;
    $('#adjustCreditUser').textContent = `#${userId} ${nick || ''}`;
    $('#adjustCreditDelta').value = '';
    $('#adjustCreditReason').value = '';
    openModal('adjustCreditModal');
  }

  async function submitCreditAdjust() {
    const userId = state.credit.adjustForm.userId;
    const delta = Number($('#adjustCreditDelta').value);
    const reason = $('#adjustCreditReason').value.trim();
    if (!delta) return showToast('请填写分数变动（正数加，负数扣）', 'warning');
    if (!reason) return showToast('请填写调整原因', 'warning');
    try {
      await API.paymentAdjustCredit({ user_id: userId, amount: delta, delta, reason });
      closeModal('adjustCreditModal');
      showToast('信用分已调整', 'success');
      loadCredit();
    } catch (e) { showToast(e.message || '调整失败', 'error'); }
  }

  /* ============================================================
     暴露公共 API（供 onclick 调用）
     ============================================================ */
  window.App = Object.assign(window.App || {}, {
    switchCardsAssignTab(tab) { state.cardsAssign.tab = tab; renderCardsAssign(); },
    setCardsAssignFilter(v) { state.cardsAssign.filter = v; renderCardsAssign(); },
    openCardAllocateModal, submitCardAllocate,
    openCardBatchModal, submitCardBatch,
    openCardCreateModal, submitCardCreate,
    setDispatchOrderId(v) { state.dispatch.orderId = v; },
    runDispatchRecommend, manualAssignDriver, saveDispatchSettings,
    runQueueDispatch, selectDispatchOrder,
    reloadDispatch: loadDispatch,
    setPayFilter(k, v) { state.payments[k] = v; state.payments.page = 1; loadPayments(); },
    runEscapeJob,
    openCreditAdjustModal, submitCreditAdjust
  });

  window.App = Object.assign(window.App || {}, {
    showLogin: showLogin,
    loadDashboard: loadDashboard,
    goDrivers: function () { switchView('drivers'); },
    viewOrderDetail: viewOrderDetail,
    openPriceModal: openPriceModal,
    goOrderPage: goOrderPage,
    cancelOrder: cancelOrder,
    deleteOrder: deleteOrder,
    openAssignModal: openAssignModal,
    doAssignDriver: doAssignDriver,
    viewDriverDetail: viewDriverDetail,
    approveDriver: approveDriver,
    rejectDriver: rejectDriver,
    goDriverPage: goDriverPage,
    openEditDriverModal: openEditDriverModal,
    deleteDriver: deleteDriver,
    viewUserDetail: viewUserDetail,
    deleteUser: deleteUser,
    goUserPage: goUserPage,
    deleteCard: deleteCard,
    savePricing: savePricing,
    saveConfig: saveConfig,
    setWithdrawalFilter: setWithdrawalFilter,
    openWithdrawalProcess: openWithdrawalProcess,
    submitWithdrawalProcess: submitWithdrawalProcess
  });

  /* ============================================================
     初始化
     ============================================================ */
  document.addEventListener('DOMContentLoaded', function () {
    bindEvents();
    checkAuth();
  });

})();
