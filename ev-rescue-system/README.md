# 新能源车移动充电救援系统

绵阳24小时新能源应急充电救援平台 - 三端完整系统

## 系统简介

基于微信小程序 + Web后台的移动充电救援管理系统，覆盖用户下单、司机接单救援、运营管理全流程。

### 核心功能
- **用户端**：一键下单救援、实时价格预估、订单追踪、在线支付、评价
- **司机端**：接单大厅、导航救援、充电操作、拍照凭证、收入统计
- **管理后台**：数据看板、订单管理、司机审核、定价配置、服务卡管理

### 定价（基于绵阳实际运营数据）
| 车型 | 白天(06:00-22:00) | 夜间(22:00-06:00) |
|------|------------------|-------------------|
| 小型车 | 198元 | 228元 |
| 中型车(4.2米货车) | 238元 | 268元 |
| 大型车(重卡) | 408元 | 438元 |

- 30公里内一口价，超30公里5元/公里
- 高速费/停车费另算
- 60kW大功率直流移动补电

## 项目结构

```
ev-rescue-system/
├── backend/                    # 后端API服务 (Node.js + Express)
│   ├── server.js               # Express服务器入口
│   ├── db.js                   # JSON文件数据库（无需安装数据库）
│   ├── package.json
│   ├── routes/
│   │   ├── users.js            # 用户端API
│   │   ├── drivers.js          # 司机端API
│   │   ├── orders.js           # 订单API
│   │   ├── admin.js            # 管理后台API
│   │   └── config.js           # 公开配置API
│   ├── utils/
│   │   └── pricing.js          # 定价计算引擎
│   └── uploads/                # 上传文件目录
│
├── user-miniprogram/           # 用户端微信小程序
│   ├── app.js / app.json / app.wxss
│   ├── utils/api.js            # API请求封装
│   └── pages/
│       ├── home/               # 首页（服务信息+定价+一键救援）
│       ├── order/              # 下单页（选车型+填地址+价格预估）
│       ├── tracking/           # 订单追踪（状态进度+充电进度）
│       ├── orders/             # 订单列表
│       └── mine/               # 个人中心
│
├── driver-miniprogram/         # 司机端微信小程序
│   ├── app.js / app.json / app.wxss
│   ├── utils/api.js
│   └── pages/
│       ├── login/              # 登录注册
│       ├── orders/             # 订单大厅（待接单+上线开关）
│       ├── detail/             # 订单详情（操作流程+拍照+额外费用）
│       └── mine/               # 个人中心（收入统计）
│
└── admin-dashboard/            # 运营管理Web后台
    ├── index.html              # 单页应用
    ├── css/style.css
    └── js/
        ├── api.js              # API封装
        └── app.js              # 主逻辑
```

## 快速开始

### 1. 启动后端服务

```bash
cd backend
npm install
node server.js
```

服务启动后：
- API地址: http://localhost:3000/api
- 管理员账号: admin / admin123
- 数据文件: backend/rescue.json（自动创建）

#### 腾讯地图真实驾车路线计价

订单距离、超距费用和派单距离统一调用腾讯位置服务 Direction WebService API。上线前必须创建服务器类型的 WebService Key，并任选一种方式配置：

1. 管理后台进入“系统设置 → 地图与路线计价”，填写“腾讯位置服务 WebService Key”。
2. 启动后端前设置环境变量 `TENCENT_MAP_KEY`（环境变量优先于后台配置）。

默认使用 `SHORT_DISTANCE` 路线策略，避免实时拥堵改变计价路线。腾讯接口不可用或密钥无效时，系统会停止报价和派单，不会回退到直线距离估算。

### 2. 管理后台

直接用浏览器打开 `admin-dashboard/index.html`，或在后端服务运行后访问 http://localhost:3000 即可（需配置静态文件服务）。

登录账号：admin / admin123

### 3. 微信小程序

1. 打开微信开发者工具
2. 导入项目，分别选择 `user-miniprogram` 和 `driver-miniprogram` 目录
3. 在 `utils/api.js` 中确认API地址为 `http://localhost:3000/api`
4. 需要替换自己的小程序 AppID

## API接口文档

### 公开接口
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/health | 健康检查 |
| GET | /api/config/pricing | 获取定价配置 |
| GET | /api/config/service-info | 获取服务信息 |

### 用户端
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/user/login | 用户登录 |
| GET | /api/user/info | 获取用户信息 |
| GET | /api/user/orders | 用户订单列表 |
| GET | /api/user/cards | 用户服务卡 |
| POST | /api/orders/create | 创建订单 |
| GET | /api/orders/:id | 订单详情 |
| POST | /api/orders/estimate | 价格预估 |
| POST | /api/orders/cancel/:id | 取消订单 |
| POST | /api/orders/pay/:id | 支付订单 |
| POST | /api/orders/rate/:id | 评价订单 |
| GET | /api/orders/active | 当前进行中订单 |

### 司机端
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/driver/login | 司机登录 |
| GET | /api/driver/info | 司机信息 |
| POST | /api/driver/status | 更新在线状态 |
| GET | /api/driver/pending-orders | 待接单列表 |
| POST | /api/driver/accept/:orderId | 接单 |
| POST | /api/driver/update-status/:orderId | 更新订单状态 |
| GET | /api/driver/orders | 订单历史 |
| GET | /api/driver/earnings | 收入统计 |

### 管理后台
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/admin/login | 管理员登录 |
| GET | /api/admin/dashboard | 数据看板 |
| GET | /api/admin/orders | 订单列表 |
| GET | /api/admin/orders/:id | 订单详情 |
| POST | /api/admin/orders/:id/price | 手动改价 |
| GET | /api/admin/drivers | 司机列表 |
| POST | /api/admin/drivers/:id/approve | 审核通过 |
| POST | /api/admin/drivers/:id/reject | 拒绝审核 |
| GET | /api/admin/pricing | 定价配置 |
| POST | /api/admin/pricing/:id | 更新定价 |
| GET | /api/admin/cards | 服务卡列表 |
| POST | /api/admin/cards | 生成服务卡 |

## 订单状态流转

```
pending(待接单) → accepted(已接单) → en_route(前往中) → arrived(已到达) → charging(充电中) → completed(已完成)
                    ↓
              cancelled(已取消)
```

## 技术选型

| 组件 | 技术 | 说明 |
|------|------|------|
| 后端 | Node.js + Express | 轻量级Web框架 |
| 数据库 | JSON文件存储 | 无需安装数据库，MVP阶段够用 |
| 认证 | JWT (jsonwebtoken) | 用户/司机/管理员统一认证 |
| 文件上传 | Multer | 救援前后照片上传 |
| 用户端 | 微信原生小程序 | 无需下载，分享方便 |
| 司机端 | 微信原生小程序 | 与用户端独立 |
| 管理后台 | 原生HTML/CSS/JS | 无需构建工具，直接运行 |

## 部署上线

### 后端部署
1. 购买云服务器（阿里云/腾讯云，2核4G足够）
2. 安装 Node.js (>= 18)
3. 上传 backend 目录，npm install && node server.js
4. 配置域名和HTTPS（小程序要求HTTPS）
5. 用 pm2 管理进程：`pm2 start server.js --name ev-rescue`

### 小程序发布
1. 在微信公众平台注册小程序账号
2. 获取 AppID，替换 project.config.json 中的 appid
3. 在 utils/api.js 中配置正式API地址
4. 微信开发者工具上传代码
5. 提交审核

### 管理后台部署
1. 将 admin-dashboard 目录部署到任意静态服务器
2. 配置 API 代理指向后端服务

## 联系方式

救援电话：15228301555
服务区域：绵阳及周边30公里

## 更新记录
1. 2016-11-05 : 完善司机端接单后的地位导航功能
