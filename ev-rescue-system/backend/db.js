/**
 * JSON文件数据库 - 替代better-sqlite3
 * 提供与better-sqlite3兼容的prepare/exec API
 * 数据存储在JSON文件中，无需编译原生模块
 */
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'rescue.json');

class JSONDatabase {
  constructor() {
    this.data = {
      users: [],
      drivers: [],
      orders: [],
      pricing_config: [],
      service_cards: [],
      admins: [],
      system_config: [],
      withdrawals: [],
      // ------- 新增表：统一账号与登录 -------
      unified_accounts: [],   // 统一账号表（一个手机号/微信身份 可关联多个角色）
      sms_captchas: [],       // 短信验证码表（手机号+验证码+过期时间+使用状态）
      // ------- 新增表：支付与信用 -------
      payment_records: [],    // 支付记录表（押金/尾款/退款，支持微信/支付宝/余额/服务卡抵扣）
      credit_scores: [],      // 用户信用积分表（初始100分，逃单扣分，按时支付+评价加分）
      // ------- 新增表：服务卡闭环 -------
      card_allocations: [],   // 服务卡分配/发放记录表（后台分配给哪个用户、谁分配、什么时间）
      card_usages: [],        // 服务卡核销/使用明细表（哪张卡、哪笔订单、抵扣金额）
      // ------- 新增表：司机等级与订单分配 -------
      driver_levels: [],      // 司机服务等级字典表（V1-V7，等级系数、准入门槛）
      // ------- 新增表：订单分配调度 -------
      dispatch_logs: []       // 智能派单日志表（推荐列表、最终选择人、是否手动指派）
    };
    this.counters = {};
    this.load();
    this.initDefaults();
  }

  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        this.data = { ...this.data, ...parsed.data };
        this.counters = parsed.counters || {};
      }
    } catch (e) {
      console.error('加载数据库失败:', e.message);
    }
  }

  save() {
    const payload = { data: this.data, counters: this.counters };
    fs.writeFileSync(DB_FILE, JSON.stringify(payload, null, 2));
  }

  nextId(table) {
    if (!this.counters[table]) {
      const maxId = this.data[table].reduce((max, r) => Math.max(max, r.id || 0), 0);
      this.counters[table] = maxId;
    }
    return ++this.counters[table];
  }

  initDefaults() {
    // 1. 定价配置种子
    if (this.data.pricing_config.length === 0) {
      // 定价统一：基础里程 5km 内一口价，超出按 km 加收（与 pricing.js calculatePrice FALLBACK 完全对齐）
      this.data.pricing_config = [
        { id: 1, vehicle_type: 'small',  vehicle_name: '小型轿车(A级)', day_price: 168, night_price: 198, base_distance_km: 5, extra_per_km: 6,  is_active: 1 },
        { id: 2, vehicle_type: 'medium', vehicle_name: '中型轿车/SUV',   day_price: 238, night_price: 268, base_distance_km: 5, extra_per_km: 7,  is_active: 1 },
        { id: 3, vehicle_type: 'large',  vehicle_name: '大型车(MPV)',    day_price: 328, night_price: 368, base_distance_km: 5, extra_per_km: 10, is_active: 1 }
      ];
      this.counters.pricing_config = 3;
    }
    // 2. 管理员账号种子
    if (this.data.admins.length === 0) {
      this.data.admins.push({ id: 1, username: 'admin', password: 'admin123', name: '系统管理员', created_at: this.now() });
      this.counters.admins = 1;
    }
    // 3. 系统配置KV（新增：押金/信用积分/微信支付/逃单拦截/服务卡相关）
    const defaultConfigs = [
      { key: 'commission_rate', value: '0.2', description: '平台抽佣比例(0-1)' },
      { key: 'min_withdraw_amount', value: '10', description: '最低提现金额(元)' },
      // ---- 支付防逃单配置 ----
      { key: 'deposit_ratio', value: '0.3', description: '下单时预支付押金比例(0-1)，如0.3=30%' },
      { key: 'deposit_min_amount', value: '50', description: '押金最低金额(元)，比例计算不足则按此值收取' },
      { key: 'escape_penalty_score', value: '30', description: '逃单一次扣信用积分' },
      { key: 'bad_rating_penalty_score', value: '5', description: '差评一次扣信用积分（司机端）' },
      { key: 'pay_on_time_bonus_score', value: '2', description: '完成服务后24h内支付加信用积分' },
      { key: 'credit_min_to_order', value: '60', description: '信用分低于此值禁止下单（需先补交欠款+恢复积分）' },
      { key: 'unpaid_pay_timeout_hours', value: '24', description: '订单完成后多少小时未支付判定为逃单' },
      // ---- 短信/微信认证配置（MVP使用开发验证码1234） ----
      { key: 'sms_mode', value: 'dev', description: '短信模式：dev=开发固定1234，prod=阿里云短信' },
      { key: 'wx_appid', value: '', description: '微信小程序AppID（生产环境必填）' },
      { key: 'wx_appsecret', value: '', description: '微信小程序AppSecret（生产环境必填）' },
      { key: 'wx_merchant_id', value: '', description: '微信支付商户号（生产环境必填）' },
      { key: 'wx_pay_key', value: '', description: '微信支付APIv3密钥（生产环境必填）' },
      // ---- 智能派单配置 ----
      { key: 'dispatch_distance_weight', value: '0.4', description: '派单权重-距离(越近越高分)' },
      { key: 'dispatch_rating_weight', value: '0.25', description: '派单权重-司机评分' },
      { key: 'dispatch_level_weight', value: '0.2', description: '派单权重-服务等级(V系数)' },
      { key: 'dispatch_order_weight', value: '0.15', description: '派单权重-接单量(近7日，饥饿式分配)' },
      { key: 'dispatch_max_candidates', value: '10', description: '派单候选司机最大数量' },
      { key: 'dispatch_max_distance_km', value: '30', description: '派单最大半径(公里)' }
    ];
    const existingKeys = new Set((this.data.system_config || []).map(c => c.key));
    let cfgAdded = false;
    for (const cfg of defaultConfigs) {
      if (!existingKeys.has(cfg.key)) {
        this.data.system_config.push({ id: this.nextId('system_config'), key: cfg.key, value: cfg.value, description: cfg.description, created_at: this.now() });
        cfgAdded = true;
      }
    }
    // 4. 司机等级 V1-V7 种子（满足用户偏好：渐变色+发光+徽章的基础数据）
    if (!this.data.driver_levels || this.data.driver_levels.length === 0) {
      this.data.driver_levels = [
        { id: 1, level: 'V1', name: '新晋救援者', min_orders: 0, min_rating: 0, coefficient: 0.8, badge_color: '#9CA3AF', gradient_from: '#F3F4F6', gradient_to: '#E5E7EB', glow_color: 'rgba(156,163,175,0.4)', created_at: this.now() },
        { id: 2, level: 'V2', name: '熟练司机', min_orders: 10, min_rating: 4.5, coefficient: 0.9, badge_color: '#22C55E', gradient_from: '#DCFCE7', gradient_to: '#86EFAC', glow_color: 'rgba(34,197,94,0.45)', created_at: this.now() },
        { id: 3, level: 'V3', name: '精英救援', min_orders: 50, min_rating: 4.6, coefficient: 1.0, badge_color: '#3B82F6', gradient_from: '#DBEAFE', gradient_to: '#93C5FD', glow_color: 'rgba(59,130,246,0.5)', created_at: this.now() },
        { id: 4, level: 'V4', name: '金牌救援', min_orders: 150, min_rating: 4.7, coefficient: 1.1, badge_color: '#F59E0B', gradient_from: '#FEF3C7', gradient_to: '#FCD34D', glow_color: 'rgba(245,158,11,0.55)', created_at: this.now() },
        { id: 5, level: 'V5', name: '钻石救援', min_orders: 300, min_rating: 4.8, coefficient: 1.25, badge_color: '#06B6D4', gradient_from: '#CFFAFE', gradient_to: '#67E8F9', glow_color: 'rgba(6,182,212,0.6)', created_at: this.now() },
        { id: 6, level: 'V6', name: '王者救援', min_orders: 600, min_rating: 4.9, coefficient: 1.4, badge_color: '#8B5CF6', gradient_from: '#EDE9FE', gradient_to: '#C4B5FD', glow_color: 'rgba(139,92,246,0.65)', created_at: this.now() },
        { id: 7, level: 'V7', name: '传奇救援', min_orders: 1200, min_rating: 4.95, coefficient: 1.6, badge_color: '#EC4899', gradient_from: '#FCE7F3', gradient_to: '#F9A8D4', glow_color: 'rgba(236,72,153,0.7)', created_at: this.now() }
      ];
      this.counters.driver_levels = 7;
    }
    // 5. 为已有 drivers 补充字段（wallet_balance + level_id + accept_count_7d + last_order_at）
    let schemaModified = false;
    if (this.data.drivers && this.data.drivers.length > 0) {
      for (const d of this.data.drivers) {
        if (d.wallet_balance === undefined) { d.wallet_balance = 0; schemaModified = true; }
        if (d.level_id === undefined) { d.level_id = 1; schemaModified = true; }   // 默认V1
        if (d.accept_count_7d === undefined) { d.accept_count_7d = 0; schemaModified = true; }
        if (d.last_order_at === undefined) { d.last_order_at = null; schemaModified = true; }
        // ===== D2：司机坐标为 0/空 → 回填绵阳中心（避免 0,0 vs 绵阳 = 999km 永远派单空）=====
        if (!d.lat) { d.lat = 31.4700; schemaModified = true; }
        if (!d.lng) { d.lng = 104.7400; schemaModified = true; }
        // ===== D1：approved 空/0 → 回填 1（开发模式默认通过）=====
        if (d.approved === undefined || d.approved === 0 || d.approved === false || String(d.approved) === '0') { d.approved = 1; schemaModified = true; }
        if (d.id_card_no === undefined) { d.id_card_no = ''; schemaModified = true; }
      }
    }
    // 6. 为已有 users 补充字段（信用积分、累计完成订单数、未支付订单数）
    if (this.data.users && this.data.users.length > 0) {
      for (const u of this.data.users) {
        if (u.total_orders === undefined) { u.total_orders = 0; schemaModified = true; }
        if (u.total_spent === undefined) { u.total_spent = 0; schemaModified = true; }
      }
    }
    // 7. 为已有 orders 补充字段（押金/尾款状态、服务卡抵扣、调度模式、指派司机候选）
    if (this.data.orders && this.data.orders.length > 0) {
      for (const o of this.data.orders) {
        if (o.deposit_amount === undefined) { o.deposit_amount = 0; schemaModified = true; }
        if (o.deposit_status === undefined) { o.deposit_status = 'none'; schemaModified = true; } // none/unpaid/paid/refunded
        if (o.final_pay_amount === undefined) { o.final_pay_amount = 0; schemaModified = true; }
        if (o.card_discount_amount === undefined) { o.card_discount_amount = 0; schemaModified = true; }
        if (o.use_card_id === undefined) { o.use_card_id = null; schemaModified = true; }
        if (o.dispatch_mode === undefined) { o.dispatch_mode = 'manual'; schemaModified = true; } // auto/manual
        if (o.dispatch_candidates === undefined) { o.dispatch_candidates = ''; schemaModified = true; }
      }
    }
    // 8. 为已有 service_cards 补充字段（车辆类型映射+面额+绑定用户+分配记录）
    if (this.data.service_cards && this.data.service_cards.length > 0) {
      for (const c of this.data.service_cards) {
        if (c.vehicle_type === undefined) { c.vehicle_type = 'small'; schemaModified = true; }
        if (c.price === undefined) { c.price = 0; schemaModified = true; }
        if (c.allocated_by === undefined) { c.allocated_by = null; schemaModified = true; }
        if (c.allocated_at === undefined) { c.allocated_at = null; schemaModified = true; }
        if (c.remark === undefined) { c.remark = ''; schemaModified = true; }
      }
    }
    if (cfgAdded || schemaModified) this.save();
    this.save();
  }

  /**
   * 获取系统配置
   */
  getConfig(key, defaultValue) {
    const item = this.data.system_config.find(c => c.key === key);
    return item ? item.value : defaultValue;
  }

  /**
   * 设置系统配置
   */
  setConfig(key, value, description) {
    const item = this.data.system_config.find(c => c.key === key);
    if (item) {
      item.value = String(value);
      if (description) item.description = description;
    } else {
      this.data.system_config.push({
        id: this.nextId('system_config'),
        key,
        value: String(value),
        description: description || '',
        created_at: this.now()
      });
    }
    this.save();
  }

  now() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
  }

  // SQL兼容层：解析简单SQL并执行
  prepare(sql) {
    return new PreparedStatement(this, sql);
  }

  exec(sql) {
    // CREATE TABLE等DDL直接忽略，JSON存储不需要建表
  }

  pragma() {}
}

class PreparedStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.trim();
    this.normalized = this.sql.replace(/\s+/g, ' ').trim();
  }

  run(...params) {
    const sql = this.normalized;
    
    if (sql.startsWith('INSERT')) {
      return this._executeInsert(sql, params);
    }
    if (sql.startsWith('UPDATE')) {
      return this._executeUpdate(sql, params);
    }
    if (sql.startsWith('DELETE')) {
      return this._executeDelete(sql, params);
    }
    return { changes: 0 };
  }

  get(...params) {
    const results = this.all(...params);
    return results[0] || undefined;
  }

  all(...params) {
    const sql = this.normalized;
    
    if (sql.startsWith('SELECT')) {
      return this._executeSelect(sql, params);
    }
    return [];
  }

  _executeInsert(sql, params) {
    // 解析: INSERT INTO table (col1, col2, ...) VALUES (?, ?, ...)
    const match = sql.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/);
    if (!match) {
      // 尝试不指定列名的INSERT
      const simpleMatch = sql.match(/INSERT\s+INTO\s+(\w+)\s*VALUES\s*\(([^)]+)\)/);
      if (!simpleMatch) return { changes: 0 };
      return { changes: 0 };
    }

    const table = match[1];
    const columns = match[2].split(',').map(c => c.trim());

    const row = {};
    columns.forEach((col, i) => {
      let val = params[i];
      // 处理DEFAULT值
      if (val === undefined) {
        val = this._getDefaultValue(col);
      }
      row[col] = val;
    });

    // 添加id
    if (!row.id) {
      row.id = this.db.nextId(table);
    }

    // 添加创建时间
    if (!row.created_at) {
      row.created_at = this.db.now();
    }

    // 为已知表补充缺失的默认字段
    const tableDefaults = this._getTableDefaults(table);
    for (const [col, val] of Object.entries(tableDefaults)) {
      if (row[col] === undefined) {
        row[col] = val;
      }
    }

    this.db.data[table].push(row);
    this.db.save();

    return { changes: 1, lastInsertRowid: row.id };
  }

  _getTableDefaults(table) {
    const defaults = {
      users: { phone: '', nickname: '微信用户', avatar: '', total_orders: 0, total_spent: 0 },
      // ===== D1-D2 修复：司机默认 approved=1（开发模式不用审核）+ lat/lng 默认绵阳中心（避免 0,0→999km 永远被过滤）=====
      // （绵阳中心经纬度约 31.4700°N, 104.7400°E，覆盖"绵阳及周边30km服务范围"用户订单）
      drivers: { status: 'offline', approved: 1, rating: 5.0, total_orders: 0, total_earnings: 0, wallet_balance: 0, level_id: 1, accept_count_7d: 0, last_order_at: null, lat: 31.4700, lng: 104.7400, id_card_no: '' },
      orders: { status: 'pending', payment_status: 'unpaid', dashboard_off: 0, distance_km: 0, base_price: 0, distance_fee: 0, extra_fee: 0, total_price: 0, is_night: 0, user_rating: null, user_comment: '', deposit_amount: 0, deposit_status: 'none', final_pay_amount: 0, card_discount_amount: 0, use_card_id: null, dispatch_mode: 'manual', dispatch_candidates: '' },
      pricing_config: { is_active: 1, base_distance_km: 5, extra_per_km: 7 },
      service_cards: { total_uses: 1, used_count: 0, status: 'unused', vehicle_type: 'small', price: 0, allocated_by: null, allocated_at: null, remark: '' },
      // 新表默认值
      unified_accounts: { status: 'active', user_id: null, driver_id: null, last_login_at: null, last_login_role: null },
      sms_captchas: { used: 0, used_at: null },
      payment_records: { pay_type: 'wechat', pay_channel: 'mnp', transaction_id: '', third_party_no: '', status: 'pending', refund_amount: 0, refund_at: null, remark: '' },
      credit_scores: { score: 100, change_reason: '', change_amount: 0, balance_after: 100 },
      card_allocations: { allocated_by: null, remark: '' },
      card_usages: { used_amount: 0, order_id: null, used_at: null },
      driver_levels: { coefficient: 1.0, min_orders: 0, min_rating: 4.0 },
      dispatch_logs: { mode: 'auto', selected_driver_id: null, is_manual_override: 0, remark: '' }
    };
    return defaults[table] || {};
  }

  _getDefaultValue(col) {
    const defaults = {
      status: 'pending', approved: 0, rating: 5.0, total_orders: 0, total_earnings: 0,
      wallet_balance: 0, is_active: 1, is_night: 0, dashboard_off: 0, distance_km: 0,
      base_price: 0, distance_fee: 0, extra_fee: 0, total_price: 0, payment_status: 'unpaid',
      used_count: 0, total_uses: 1, level_id: 1, accept_count_7d: 0, deposit_amount: 0,
      deposit_status: 'none', final_pay_amount: 0, card_discount_amount: 0, dispatch_mode: 'manual',
      score: 100, change_amount: 0, balance_after: 100, used: 0, is_manual_override: 0,
      coefficient: 1.0, min_orders: 0, min_rating: 4.0, used_amount: 0, refund_amount: 0
    };
    return defaults[col] !== undefined ? defaults[col] : null;
  }

  _executeSelect(sql, params) {
    // 解析SELECT语句
    const tableMatch = sql.match(/FROM\s+(\w+)/);
    if (!tableMatch) return [];
    
    const table = tableMatch[1];
    let rows = [...(this.db.data[table] || [])];

    // 处理JOIN -  LEFT JOIN
    // 修复：旧代码用jm[2]===table判断主表列，但jm[2]是别名(如'o')而非表名(如'orders')，导致左右列搞反
    // 新方案：存储两侧列名，匹配时双向尝试
    const joins = [];
    const joinMatches = [...sql.matchAll(/LEFT\s+JOIN\s+(\w+)\s+(?:\w+\s+)?ON\s+(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/gi)];

    for (const jm of joinMatches) {
      const joinTable = jm[1];
      const col1 = jm[3];  // ON左边的列名
      const col2 = jm[5];  // ON右边的列名
      joins.push({ table: joinTable, col1, col2 });
    }

    // 处理WHERE条件
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT\s|\s+GROUP\s+BY|$)/);
    if (whereMatch) {
      rows = this._filterRows(rows, whereMatch[1], params, table);
    }

    // 如果有JOIN，合并数据
    if (joins.length > 0) {
      rows = rows.map(row => {
        const merged = { ...row };
        for (const join of joins) {
          const joinRows = this.db.data[join.table] || [];
          // 双向尝试匹配：col1=row.col2 或 col2=row[col1]
          // 因为不确定ON子句哪边是主表哪边是join表
          const joinRow = joinRows.find(jr =>
            (jr[join.col1] !== undefined && row[join.col2] !== undefined &&
              String(jr[join.col1]) === String(row[join.col2])) ||
            (jr[join.col2] !== undefined && row[join.col1] !== undefined &&
              String(jr[join.col2]) === String(row[join.col1]))
          );
          if (joinRow) {
            // 添加join表的字段，用表名前缀
            for (const key in joinRow) {
              if (key !== 'id') {
                const prefix = join.table === 'drivers' ? 'driver_' : 
                               join.table === 'users' ? 'user_' : `${join.table}_`;
                merged[`${prefix}${key}`] = joinRow[key];
              }
            }
          }
        }
        return merged;
      });
    }

    // 处理GROUP BY
    const groupMatch = sql.match(/GROUP\s+BY\s+(\w+)/);
    if (groupMatch) {
      const groupCol = groupMatch[1];
      // 简化处理：对COUNT和SUM做聚合
      const groups = {};
      rows.forEach(row => {
        const key = row[groupCol];
        if (!groups[key]) groups[key] = [];
        groups[key].push(row);
      });
      
      // 检查是否有聚合函数
      const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM/);
      if (selectMatch) {
        const selectCols = selectMatch[1];
        const result = [];
        for (const key in groups) {
          const group = groups[key];
          const aggRow = {};
          
          // 解析聚合列
          const countMatch = selectCols.match(/COUNT\(\*\)\s+as\s+(\w+)/);
          const sumMatches = [...selectCols.matchAll(/SUM\(CASE\s+WHEN\s+(.+?)\s+THEN\s+(\w+)\s+ELSE\s+0\s+END\)\s+as\s+(\w+)/g)];
          const simpleSumMatch = selectCols.match(/SUM\((\w+)\)\s+as\s+(\w+)/);
          
          aggRow[groupCol] = key;
          if (countMatch) aggRow[countMatch[1]] = group.length;
          
          for (const sm of sumMatches) {
            const condition = sm[1];
            const col = sm[2];
            const alias = sm[3];
            aggRow[alias] = group.reduce((sum, r) => {
              if (this._matchCondition(r, condition)) {
                return sum + (r[col] || 0);
              }
              return sum;
            }, 0);
          }
          
          if (simpleSumMatch) {
            const col = simpleSumMatch[1];
            const alias = simpleSumMatch[2];
            aggRow[alias] = group.reduce((sum, r) => sum + (r[col] || 0), 0);
          }
          
          result.push(aggRow);
        }
        rows = result;
      }
    }

    // 处理ORDER BY
    const orderMatch = sql.match(/ORDER\s+BY\s+(\w+)\s*(ASC|DESC)?/);
    if (orderMatch) {
      const col = orderMatch[1];
      const dir = orderMatch[2] || 'ASC';
      rows.sort((a, b) => {
        const av = a[col], bv = b[col];
        if (typeof av === 'string' && typeof bv === 'string') {
          return dir === 'DESC' ? bv.localeCompare(av) : av.localeCompare(bv);
        }
        return dir === 'DESC' ? (bv || 0) - (av || 0) : (av || 0) - (bv || 0);
      });
    }

    // 处理LIMIT和OFFSET
    const limitMatch = sql.match(/LIMIT\s+\?\s+OFFSET\s+\?/);
    if (limitMatch) {
      const limit = params[params.length - 2];
      const offset = params[params.length - 1];
      rows = rows.slice(offset, offset + limit);
    } else {
      const simpleLimitMatch = sql.match(/LIMIT\s+(\d+)/);
      if (simpleLimitMatch) {
        rows = rows.slice(0, parseInt(simpleLimitMatch[1]));
      }
    }

    // 处理无GROUP BY的聚合查询（如SELECT COUNT(*) as x, SUM(CASE...) as y FROM ...）
    const selectMatch2 = sql.match(/SELECT\s+(.+?)\s+FROM/);
    if (selectMatch2 && !groupMatch) {
      const selectCols = selectMatch2[1];
      // 检测是否包含聚合函数
      const hasAggregate = /COUNT\(|SUM\(|AVG\(|MAX\(|MIN\(/i.test(selectCols);
      
      if (hasAggregate) {
        const aggRow = {};
        
        // COUNT(*) as alias
        const countAgg = selectCols.match(/COUNT\(\*\)\s+as\s+(\w+)/);
        if (countAgg) {
          aggRow[countAgg[1]] = rows.length;
        }
        
        // SUM(CASE WHEN condition THEN col ELSE 0 END) as alias
        const sumCaseMatches = [...selectCols.matchAll(/SUM\(CASE\s+WHEN\s+(.+?)\s+THEN\s+(\w+|\*)\s+ELSE\s+0\s+END\)\s+as\s+(\w+)/gi)];
        for (const sm of sumCaseMatches) {
          const condition = sm[1];
          const col = sm[2];
          const alias = sm[3];
          aggRow[alias] = rows.reduce((sum, r) => {
            if (this._matchCondition(r, condition)) {
              return sum + (col === '*' ? 1 : (Number(r[col]) || 0));
            }
            return sum;
          }, 0);
        }
        
        // SUM(col * number) as alias - 支持乘法表达式
        const sumMulMatches = [...selectCols.matchAll(/SUM\((\w+)\s*\*\s*([\d.]+)\)\s+as\s+(\w+)/gi)];
        for (const sm of sumMulMatches) {
          const col = sm[1];
          const multiplier = parseFloat(sm[2]);
          const alias = sm[3];
          aggRow[alias] = rows.reduce((sum, r) => sum + (Number(r[col]) || 0) * multiplier, 0);
        }
        
        // 简单 SUM(col) as alias
        const simpleSum = [...selectCols.matchAll(/SUM\((\w+)\)\s+as\s+(\w+)/gi)];
        for (const sm of simpleSum) {
          if (!aggRow[sm[2]]) {
            aggRow[sm[2]] = rows.reduce((sum, r) => sum + (Number(r[sm[1]]) || 0), 0);
          }
        }
        
        // 如果没有任何聚合结果，返回空
        if (Object.keys(aggRow).length > 0) {
          return [aggRow];
        }
      }
    }
    
    // 处理简单COUNT(*)查询
    const countMatch = sql.match(/SELECT\s+COUNT\(\*\)\s+as\s+count\s+FROM/);
    if (countMatch) {
      return [{ count: rows.length }];
    }

    // 解析SELECT中的别名映射 (如 u.nickname as user_name)
    // JOIN合并后字段名为 user_nickname，需映射到 user_name
    if (joins.length > 0) {
      // 构建表别名到表名的映射
      const aliasToTable = {};
      // FROM table alias
      const fromAlias = sql.match(/FROM\s+(\w+)\s+(\w+)/);
      if (fromAlias) aliasToTable[fromAlias[2]] = fromAlias[1];
      // JOIN table alias
      const joinAliasMatches = [...sql.matchAll(/LEFT\s+JOIN\s+(\w+)\s+(\w+)/gi)];
      for (const jam of joinAliasMatches) {
        aliasToTable[jam[2]] = jam[1];
      }

      const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM/is);
      if (selectMatch) {
        const selectCols = selectMatch[1];
        // 匹配 alias.col as aliasName
        const aliasRegex = /(\w+)\.(\w+)\s+as\s+(\w+)/gi;
        let am;
        while ((am = aliasRegex.exec(selectCols)) !== null) {
          const tableAlias = am[1];  // 如 'd' 或 'u'
          const colName = am[2];      // 如 'phone' 或 'nickname'
          const aliasName = am[3];   // 如 'driver_phone' 或 'user_name'
          if (colName === '*' || colName === aliasName) continue;

          // 根据表别名确定前缀
          const tableName = aliasToTable[tableAlias] || tableAlias;
          const prefix = tableName === 'drivers' ? 'driver_' :
                         tableName === 'users' ? 'user_' :
                         `${tableName}_`;

          rows = rows.map(row => {
            if (row[aliasName] === undefined && row[prefix + colName] !== undefined) {
              row[aliasName] = row[prefix + colName];
            }
            return row;
          });
        }
      }
    }

    return rows;
  }

  _matchCondition(row, condition) {
    const cond = condition.trim();
    
    // status NOT IN ('a','b','c')
    const notInMatch = cond.match(/(\w+)\s+NOT\s+IN\s*\(([^)]+)\)/i);
    if (notInMatch) {
      const col = notInMatch[1];
      const vals = notInMatch[2].split(',').map(v => v.trim().replace(/^'|'$/g, ''));
      return !vals.includes(String(row[col]));
    }
    
    // status IN ('a','b')
    const inMatch = cond.match(/(\w+)\s+IN\s*\(([^)]+)\)/i);
    if (inMatch) {
      const col = inMatch[1];
      const vals = inMatch[2].split(',').map(v => v.trim().replace(/^'|'$/g, ''));
      return vals.includes(String(row[col]));
    }
    
    // status = 'completed'
    const m = cond.match(/(\w+)\s*=\s*'(\w+)'/);
    if (m) {
      return row[m[1]] === m[2];
    }
    
    // status = 123 (数字比较)
    const numMatch = cond.match(/(\w+)\s*=\s*(\d+)/);
    if (numMatch) {
      return row[numMatch[1]] == numMatch[2];
    }
    
    return false;
  }

  _filterRows(rows, whereClause, params, table) {
    // 解析WHERE条件
    let paramIndex = 0;
    
    // 处理1=1的情况
    if (whereClause.trim() === '1=1') {
      return rows;
    }

    // 先提取括号内的OR分组，如 (o.order_no LIKE ? OR o.vehicle_plate LIKE ? OR ...)
    const orGroups = [];
    let processedWhere = whereClause;
    const parenRegex = /\(([^()]+)\)/g;
    let parenMatch;
    let groupIndex = 0;
    while ((parenMatch = parenRegex.exec(whereClause)) !== null) {
      const groupContent = parenMatch[1].trim();
      // 检查是否包含OR
      if (/\s+OR\s+/i.test(groupContent)) {
        const orParts = groupContent.split(/\s+OR\s+/i);
        const orConditions = [];
        for (const part of orParts) {
          const trimmed = part.trim();
          // LIKE ? 模式
          const likeMatch = trimmed.match(/^(\w+(?:\.\w+)?)\s+LIKE\s+\?$/);
          if (likeMatch) {
            orConditions.push({ type: 'like', col: likeMatch[1].split('.').pop(), val: params[paramIndex++] });
            continue;
          }
          // = ? 模式
          const eqMatch = trimmed.match(/^(\w+(?:\.\w+)?)\s*=\s*\?$/);
          if (eqMatch) {
            orConditions.push({ type: 'eq', col: eqMatch[1].split('.').pop(), val: params[paramIndex++] });
            continue;
          }
        }
        orGroups.push(orConditions);
        // 替换括号内容为占位符
        processedWhere = processedWhere.replace(parenMatch[0], '1=1');
        groupIndex++;
      }
    }

    // 简单条件解析
    const conditions = [];
    const parts = processedWhere.split(/\s+AND\s+/);
    
    for (const part of parts) {
      const trimmed = part.trim();
      
      if (trimmed === '1=1' || trimmed === '1 = 1') continue;
      
      // column = ?
      const eqMatch = trimmed.match(/^(\w+(?:\.\w+)?)\s*=\s*\?$/);
      if (eqMatch) {
        conditions.push({ type: 'eq', col: eqMatch[1].split('.').pop(), val: params[paramIndex++] });
        continue;
      }

      // column = '字面字符串' (如 status = 'pending')
      const eqStrMatch = trimmed.match(/^(\w+(?:\.\w+)?)\s*=\s*'([^']*)'$/);
      if (eqStrMatch) {
        conditions.push({ type: 'eq', col: eqStrMatch[1].split('.').pop(), val: eqStrMatch[2] });
        continue;
      }

      // column = 数字字面值 (如 approved = 0, approved = 1)
      const eqNumMatch = trimmed.match(/^(\w+(?:\.\w+)?)\s*=\s*(\d+(?:\.\d+)?)$/);
      if (eqNumMatch) {
        conditions.push({ type: 'eq', col: eqNumMatch[1].split('.').pop(), val: eqNumMatch[2] });
        continue;
      }

      // column LIKE ?
      const likeMatch = trimmed.match(/^(\w+(?:\.\w+)?)\s+LIKE\s+\?$/);
      if (likeMatch) {
        conditions.push({ type: 'like', col: likeMatch[1].split('.').pop(), val: params[paramIndex++] });
        continue;
      }

      // column != ?
      const neqMatch = trimmed.match(/^(\w+(?:\.\w+)?)\s*!=\s*\?$/);
      if (neqMatch) {
        conditions.push({ type: 'neq', col: neqMatch[1].split('.').pop(), val: params[paramIndex++] });
        continue;
      }

      // column != '字面字符串'
      const neqStrMatch = trimmed.match(/^(\w+(?:\.\w+)?)\s*!=\s*'([^']*)'$/);
      if (neqStrMatch) {
        conditions.push({ type: 'neq', col: neqStrMatch[1].split('.').pop(), val: neqStrMatch[2] });
        continue;
      }
      
      // column IN (?, ?) - for date filtering
      const inMatch = trimmed.match(/^(\w+)\s+IN\s*\(([^)]+)\)/);
      if (inMatch) {
        const count = inMatch[2].split(',').length;
        const vals = params.slice(paramIndex, paramIndex + count);
        paramIndex += count;
        conditions.push({ type: 'in', col: inMatch[1], vals });
        continue;
      }
      
      // column NOT IN ('val1', 'val2') - 字面值
      const notInMatch = trimmed.match(/(\w+(?:\.\w+)?)\s+NOT\s+IN\s*\(([^)]+)\)/i);
      if (notInMatch) {
        const col = notInMatch[1].split('.').pop();
        const vals = notInMatch[2].split(',').map(v => v.trim().replace(/^'|'$/g, ''));
        conditions.push({ type: 'notin', col, vals });
        continue;
      }
      
      // column IN ('val1', 'val2') - 字面值
      const inLiteralMatch = trimmed.match(/(\w+(?:\.\w+)?)\s+IN\s*\(([^)]+)\)/i);
      if (inLiteralMatch) {
        const col = inLiteralMatch[1].split('.').pop();
        const vals = inLiteralMatch[2].split(',').map(v => v.trim().replace(/^'|'$/g, ''));
        conditions.push({ type: 'inliteral', col, vals });
        continue;
      }
      
      // DATE(column) = ?
      const dateMatch = trimmed.match(/DATE\((\w+(?:\.\w+)?)\)\s*=\s*\?/);
      if (dateMatch) {
        conditions.push({ type: 'date', col: dateMatch[1].split('.').pop(), val: params[paramIndex++] });
        continue;
      }
      
      // column LIKE ? (for month matching like '2024-08%')
      const monthMatch = trimmed.match(/^(\w+)\s+LIKE\s+\?/);
      if (monthMatch) {
        conditions.push({ type: 'like', col: monthMatch[1], val: params[paramIndex++] });
        continue;
      }
    }

    return rows.filter(row => {
      // 检查AND条件
      const andMatch = conditions.every(cond => {
        switch (cond.type) {
          case 'eq':
            return row[cond.col] == cond.val;
          case 'neq':
            return row[cond.col] != cond.val;
          case 'like':
            if (typeof cond.val !== 'string') return false;
            const pattern = cond.val.replace(/%/g, '.*').replace(/\?/g, '\\?');
            return new RegExp(pattern).test(String(row[cond.col] || ''));
          case 'in':
            return cond.vals.includes(row[cond.col]);
          case 'notin':
            return !cond.vals.includes(String(row[cond.col]));
          case 'inliteral':
            return cond.vals.includes(String(row[cond.col]));
          case 'date':
            const rowDate = String(row[cond.col] || '').substring(0, 10);
            return rowDate === cond.val;
          default:
            return true;
        }
      });
      if (!andMatch) return false;

      // 检查OR分组（每个分组内任意条件满足即可）
      for (const orConditions of orGroups) {
        const orMatch = orConditions.some(cond => {
          switch (cond.type) {
            case 'eq':
              return row[cond.col] == cond.val;
            case 'like':
              if (typeof cond.val !== 'string') return false;
              const pattern = cond.val.replace(/%/g, '.*').replace(/\?/g, '\\?');
              return new RegExp(pattern).test(String(row[cond.col] || ''));
            default:
              return false;
          }
        });
        if (!orMatch) return false;
      }

      return true;
    });
  }

  _executeUpdate(sql, params) {
    // 解析: UPDATE table SET col1 = ?, col2 = ? WHERE id = ?
    // 也支持: UPDATE table SET col1 = 1 WHERE id = ? (字面值)
    const match = sql.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+(.+)/);
    if (!match) return { changes: 0 };

    const table = match[1];
    const setClause = match[2];
    const whereClause = match[3];

    // 解析SET字段 - 支持?占位符、字面值、和 col = col + ? 表达式
    const setFields = []; // {col, type: 'param'|'literal'|'increment', value, paramIdx}
    const setParts = setClause.split(',').map(s => s.trim());
    let paramIdx = 0;
    for (const part of setParts) {
      // 匹配 col = col + ? (自增表达式，参数版)
      const incParamMatch = part.match(/(\w+)\s*=\s*(\w+)\s*\+\s*\?/);
      if (incParamMatch && incParamMatch[1] === incParamMatch[2]) {
        setFields.push({ col: incParamMatch[1], type: 'increment_param', paramIdx: paramIdx++ });
        continue;
      }
      // 匹配 col = col - ? (自减表达式，参数版)
      const decParamMatch = part.match(/(\w+)\s*=\s*(\w+)\s*-\s*\?/);
      if (decParamMatch && decParamMatch[1] === decParamMatch[2]) {
        setFields.push({ col: decParamMatch[1], type: 'decrement_param', paramIdx: paramIdx++ });
        continue;
      }
      // 匹配 col = col + 数字 (自增表达式，字面值)
      const incNumMatch = part.match(/(\w+)\s*=\s*(\w+)\s*\+\s*(\d+(?:\.\d+)?)/);
      if (incNumMatch && incNumMatch[1] === incNumMatch[2]) {
        setFields.push({ col: incNumMatch[1], type: 'increment_literal', value: Number(incNumMatch[3]) });
        continue;
      }
      // 匹配 col = col - 数字 (自减)
      const decNumMatch = part.match(/(\w+)\s*=\s*(\w+)\s*-\s*(\d+(?:\.\d+)?)/);
      if (decNumMatch && decNumMatch[1] === decNumMatch[2]) {
        setFields.push({ col: decNumMatch[1], type: 'decrement_literal', value: Number(decNumMatch[3]) });
        continue;
      }
      // 匹配 col = ?
      const paramMatch = part.match(/(\w+)\s*=\s*\?/);
      if (paramMatch) {
        setFields.push({ col: paramMatch[1], type: 'param', paramIdx: paramIdx++ });
        continue;
      }
      // 匹配 col = 数字
      const numMatch = part.match(/(\w+)\s*=\s*(\d+(?:\.\d+)?)/);
      if (numMatch) {
        setFields.push({ col: numMatch[1], type: 'literal', value: Number(numMatch[2]) });
        continue;
      }
      // 匹配 col = '字符串'
      const strMatch = part.match(/(\w+)\s*=\s*'([^']*)'/);
      if (strMatch) {
        setFields.push({ col: strMatch[1], type: 'literal', value: strMatch[2] });
        continue;
      }
    }

    // 解析WHERE条件
    const whereIdMatch = whereClause.match(/(\w+)\s*=\s*\?/);
    let whereCol, whereVal;
    if (whereIdMatch) {
      whereCol = whereIdMatch[1];
      whereVal = params[paramIdx]; // WHERE参数在SET参数之后
    }

    const rows = this.db.data[table] || [];
    let changes = 0;
    
    for (let i = 0; i < rows.length; i++) {
      if (whereCol && rows[i][whereCol] == whereVal) {
        setFields.forEach(field => {
          switch (field.type) {
            case 'param':
              rows[i][field.col] = params[field.paramIdx];
              break;
            case 'literal':
              rows[i][field.col] = field.value;
              break;
            case 'increment_param':
              rows[i][field.col] = (Number(rows[i][field.col]) || 0) + (Number(params[field.paramIdx]) || 0);
              break;
            case 'decrement_param':
              rows[i][field.col] = (Number(rows[i][field.col]) || 0) - (Number(params[field.paramIdx]) || 0);
              break;
            case 'increment_literal':
              rows[i][field.col] = (Number(rows[i][field.col]) || 0) + field.value;
              break;
            case 'decrement_literal':
              rows[i][field.col] = (Number(rows[i][field.col]) || 0) - field.value;
              break;
          }
        });
        changes++;
      }
    }

    if (changes > 0) {
      this.db.save();
    }

    return { changes };
  }

  _executeDelete(sql, params) {
    const match = sql.match(/DELETE\s+FROM\s+(\w+)\s+WHERE\s+(.+)/);
    if (!match) return { changes: 0 };
    
    const table = match[1];
    const whereClause = match[2];
    const whereIdMatch = whereClause.match(/(\w+)\s*=\s*\?/);
    
    if (whereIdMatch) {
      const whereCol = whereIdMatch[1];
      const whereVal = params[0];
      const before = this.db.data[table].length;
      this.db.data[table] = this.db.data[table].filter(r => r[whereCol] != whereVal);
      const changes = before - this.db.data[table].length;
      this.db.save();
      return { changes };
    }
    
    return { changes: 0 };
  }
}

// 创建全局数据库实例
const db = new JSONDatabase();

module.exports = db;
