const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const jwt = require('jsonwebtoken');

// 导入数据库（会自动初始化）
const db = require('./db');
const cloudbase = require('./cloudbase');
const time = require('./utils/time');

const app = express();
const PORT = process.env.PORT || 3108;
const JWT_SECRET = process.env.JWT_SECRET || process.env.MYSQL_PASSWORD || 'ev-rescue-secret-2024';
if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'ev-rescue-secret-2024') {
  throw new Error('生产环境必须配置 JWT_SECRET');
}
app.set('trust proxy', 1);

// 中间件
app.use(cors());
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));

// 静态文件服务（上传的图片）
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
// 兜底：uploads/ 目录不存在时自动创建（multer.diskStorage destination 在不存在时会 ENOENT → 500）
try { fs.mkdirSync(uploadDir, { recursive: true }); } catch (e) { /* ignore */ }
app.use('/uploads', express.static(uploadDir));

// 文件上传配置
const storage = cloudbase.isEnabled()
  ? multer.memoryStorage()
  : multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`);
    }
  });
const upload = multer({ storage, dest: uploadDir });

// JWT验证中间件
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ code: 401, message: '未登录' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ code: 401, message: '登录已过期' });
  }
}

// 管理员验证中间件
function adminAuthMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ code: 401, message: '未登录' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ code: 403, message: '无权限' });
    }
    req.admin = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ code: 401, message: '登录已过期' });
  }
}

// 导入路由（原有5个）
const userRoutes = require('./routes/users')(jwt, JWT_SECRET, authMiddleware);
const driverRoutes = require('./routes/drivers')(jwt, JWT_SECRET, authMiddleware);
const orderRoutes = require('./routes/orders')(authMiddleware, upload);
const adminRoutes = require('./routes/admin')(jwt, JWT_SECRET, adminAuthMiddleware, upload);
const configRoutes = require('./routes/config')(authMiddleware);

// ====== 新增4个统一能力路由（对应需求1-5改造） ======
const authRoutes = require('./routes/auth')(jwt, JWT_SECRET, authMiddleware);
const cardRoutes = require('./routes/cards')(authMiddleware, adminAuthMiddleware);
const paymentRoutes = require('./routes/payments')(authMiddleware, adminAuthMiddleware);
// 智能订单调度路由（独立路由提供推荐+手动指派+权重配置查询）
const dispatchRoutes = require('express').Router();
const dispatch = require('./utils/order_dispatch');
dispatchRoutes.post('/recommend', adminAuthMiddleware, async (req, res) => {
  const body = req.body || {};
  const orderId = Number(body.order_id || body.orderId || body.id);
  const order = (require('./db').data.orders || []).find(item => Number(item.id) === orderId);
  if (!order) return res.json({ code: 1, message: '订单不存在' });
  let list;
  try {
    list = await dispatch.rankDriversForOrder(order, {
      manualDriverId: body.manual_driver_id ? Number(body.manual_driver_id) : undefined
    });
  } catch (error) {
    return res.json({ code: 1, message: error.message || '腾讯地图路线计算失败' });
  }
  res.json({
    code: 0,
    message: 'ok',
    data: {
      order,
      total: list.length,
      list,
      candidates: list,
      settings: dispatch.readSettings(),
      reason: list.length ? '' : '调度范围内暂无通过审核、在线且无进行中订单的司机'
    }
  });
});
dispatchRoutes.get('/weights', adminAuthMiddleware, (req, res) => {
  const settings = dispatch.readSettings();
  res.json({
    code: 0,
    data: {
      ...settings,
      distW: settings.distance,
      ratingW: settings.rating,
      levelW: settings.level,
      orderW: settings.order,
      maxKm: settings.maxDistanceKm,
      max_distance_km: settings.maxDistanceKm,
      max_candidates: settings.maxCandidates
    }
  });
});
dispatchRoutes.put('/settings', adminAuthMiddleware, (req, res) => {
  const result = dispatch.saveSettings(req.body || {});
  if (!result.ok) return res.json({ code: 1, message: result.message });
  res.json({ code: 0, message: '调度参数已保存并立即生效', data: result.settings });
});
dispatchRoutes.get('/queue', adminAuthMiddleware, (req, res) => {
  const list = dispatch.getPendingOrders();
  res.json({ code: 0, data: { list, total: list.length } });
});
dispatchRoutes.get('/logs', adminAuthMiddleware, (req, res) => {
  res.json({ code: 0, data: dispatch.getLogs(req.query.limit) });
});
dispatchRoutes.post('/run/:orderId', adminAuthMiddleware, async (req, res) => {
  let result;
  try {
    result = await dispatch.dispatchOrder(Number(req.params.orderId));
  } catch (error) {
    return res.json({ code: 1, message: error.message || '腾讯地图路线计算失败' });
  }
  if (!result.ok && !result.skipped) return res.json({ code: 1, message: result.message, data: result });
  if (!result.ok) return res.json({ code: 1, message: result.message, data: result });
  res.json({ code: 0, message: result.message || (result.assigned ? '自动派单完成' : '候选列表已更新'), data: result });
});
dispatchRoutes.get('/levels', (req, res) => {
  // 双写字段：min_orders/min_rating（库内字段）+ threshold_orders/threshold_rating（后台页面读）
  const list = ((require('./db').data.driver_levels || [])).map(l => ({
    ...l,
    threshold_orders: l.min_orders,
    threshold_rating: l.min_rating
  }));
  res.json({ code: 0, data: list });
});

// 注册路由
app.use('/api/user', userRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/config', configRoutes);
app.use('/api/auth', authRoutes);           // 需求1+2：统一认证+角色选择+注册/登录分离
app.use('/api/cards', cardRoutes);         // 需求4：服务卡闭环
app.use('/api/payments', paymentRoutes);   // 需求5：支付防逃单+押金+尾款+信用
app.use('/api/dispatch', dispatchRoutes);  // 需求3：智能派单算法+V等级字典+权重查询

// 额外：静态托管管理后台（直接 http://localhost:3000/ 即可打开后台）
app.use('/', require('express').static(require('path').join(__dirname, '../admin-dashboard')));

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ code: 0, message: 'ok', data: { status: 'running', time: time.nowISO(), timezone: 'Asia/Shanghai' } });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({ code: 500, message: '服务器内部错误', error: err.message });
});

// 启动服务：云托管先恢复云数据库快照，避免以镜像内旧数据对外提供服务。
async function start() {
  await db.ready();
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`救援系统后端服务已启动: http://localhost:${PORT}`);
    console.log(`API地址: http://localhost:${PORT}/api`);
    console.log('管理后台已启用，请使用已配置的管理员凭据登录');
  });

  const shutdown = async signal => {
    console.log(`收到 ${signal}，正在持久化业务数据`);
    server.close(async () => {
      try {
        await db.flush();
        process.exit(0);
      } catch (error) {
        console.error('关闭前持久化失败:', error.message);
        process.exit(1);
      }
    });
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  return server;
}

if (require.main === module) {
  start().catch(error => {
    console.error('服务启动失败:', error);
    process.exit(1);
  });
}

module.exports = app;
