const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const jwt = require('jsonwebtoken');

// 导入数据库（会自动初始化）
require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'ev-rescue-secret-2024';

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态文件服务（上传的图片）
const uploadDir = path.join(__dirname, 'uploads');
// 兜底：uploads/ 目录不存在时自动创建（multer.diskStorage destination 在不存在时会 ENOENT → 500）
try { fs.mkdirSync(uploadDir, { recursive: true }); } catch (e) { /* ignore */ }
app.use('/uploads', express.static(uploadDir));

// 文件上传配置
const storage = multer.diskStorage({
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
dispatchRoutes.post('/recommend', authMiddleware, (req, res) => {
  const body = req.body || {};
  // 兼容多种入参字段：order_id / orderId / id，以及直接传 order 对象
  const orderId = Number(body.order_id || body.orderId || body.id || (typeof body === 'number' ? body : null));
  const pickupLat = body.pickup_lat || body.pickupLat || body.lat;
  if (!orderId && !pickupLat) return res.json({ code: 400, message: '请提供订单id或经纬度/车型' });
  let orderFull = body;
  if (orderId) {
    const o = (require('./db').data.orders || []).find(x => x.id === Number(orderId));
    if (o) orderFull = Object.assign({}, body, o);
  }
  const list = dispatch.rankDriversForOrder(orderFull, { manualDriverId: body.manual_driver_id ? Number(body.manual_driver_id) : undefined });
  // 同时返回 list（后台标准）和 candidates（前端订单推荐）双写
  res.json({ code: 0, message: 'ok', data: { total: list.length, list, candidates: list, weights: dispatch.readWeights() } });
});
dispatchRoutes.get('/weights', (req, res) => {
  // 双写字段：distW/ratingW/levelW/orderW（算法内部用）+ distance/rating/level/order（后台页面用）
  const w = dispatch.readWeights();
  res.json({
    code: 0,
    data: {
      ...w,
      distance: w.distW,
      rating: w.ratingW,
      level: w.levelW,
      order: w.orderW,
      max_distance_km: w.maxKm,
      max_candidates: w.maxCandidates
    }
  });
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
  res.json({ code: 0, message: 'ok', data: { status: 'running', time: new Date().toISOString() } });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({ code: 500, message: '服务器内部错误', error: err.message });
});

// 启动服务
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 救援系统后端服务已启动: http://localhost:${PORT}`);
  console.log(`📱 API地址: http://localhost:${PORT}/api`);
  console.log(`🔧 管理员账号: admin / admin123`);
});

module.exports = app;
