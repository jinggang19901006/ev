# 新能源车移动充电救援系统 - Code Wiki

> **版本**: v1.0.0  
> **更新日期**: 2026-08-27  
> **服务区域**: 绵阳及周边30公里  
> **服务热线**: 15228301555

---

## 目录

1. [项目概述](#1-项目概述)
2. [整体架构](#2-整体架构)
3. [后端模块 (backend)](#3-后端模块-backend)
4. [用户端小程序 (user-miniprogram)](#4-用户端小程序-user-miniprogram)
5. [司机端小程序 (driver-miniprogram)](#5-司机端小程序-driver-miniprogram)
6. [管理后台 (admin-dashboard)](#6-管理后台-admin-dashboard)
7. [系统设计文档 (ev-charging-rescue-system)](#7-系统设计文档-ev-charging-rescue-system)
8. [关键类与函数说明](#8-关键类与函数说明)
9. [数据模型](#9-数据模型)
10. [API 接口总览](#10-api-接口总览)
11. [订单状态流转](#11-订单状态流转)
12. [依赖关系图](#12-依赖关系图)
13. [项目运行方式](#13-项目运行方式)
14. [部署指南](#14-部署指南)
15. [定价规则](#15-定价规则)

---

## 1. 项目概述

### 1.1 项目简介

本项目是一个**绵阳24小时新能源应急充电救援平台**，基于「微信小程序 + Web管理后台 + Node.js后端」的三端完整系统，覆盖用户下单、司机接单救援、运营管理全流程。提供60kW大功率直流移动补电服务，支持小型车、中型车（4.2米货车）、大型车（重卡）三类车型。

### 1.2 核心功能

| 角色 | 核心功能 |
|------|----------|
| **用户端** | 一键下单救援、实时价格预估、订单追踪、在线支付、评价服务 |
| **司机端** | 接单大厅、导航救援、充电操作、拍照凭证、收入统计、钱包提现 |
| **管理后台** | 数据看板、订单管理、司机审核、定价配置、服务卡管理、提现审批、用户管理 |

### 1.3 技术选型

| 组件 | 技术栈 | 说明 |
|------|--------|------|
| 后端服务 | Node.js + Express | 轻量级Web框架 |
| 数据存储 | JSON文件数据库 (自定义实现) | MVP阶段，无需安装数据库 |
| 认证鉴权 | JWT (jsonwebtoken) | 用户/司机/管理员统一认证 |
| 文件上传 | Multer | 救援前后照片上传 |
| 用户端 | 微信原生小程序 | 无需下载，分享方便 |
| 司机端 | 微信原生小程序 | 与用户端独立部署 |
| 管理后台 | 原生HTML/CSS/JS (SPA) | 无需构建工具，直接运行 |

### 1.4 项目目录结构

```
EV/
├── CODE_WIKI.md                     # 本文档
├── ev-rescue-system/                # 主系统（三端+后端）
│   ├── README.md                    # 项目说明
│   ├── backend/                     # 后端API服务
│   ├── user-miniprogram/            # 用户端微信小程序
│   ├── driver-miniprogram/          # 司机端微信小程序
│   └── admin-dashboard/             # 运营管理Web后台
└── ev-charging-rescue-system/       # 系统设计可视化文档
    └── ev-charging-rescue-system.html
```

---

## 2. 整体架构

### 2.1 系统架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              客户端层                                    │
├─────────────────────┬─────────────────────┬─────────────────────────────┤
│   用户端小程序       │   司机端小程序       │      管理后台 (Web)         │
│  (user-miniprogram) │ (driver-miniprogram) │    (admin-dashboard)       │
│                     │                     │                             │
│  · 首页/服务介绍    │  · 登录注册         │  · 登录认证                 │
│  · 下单/价格预估    │  · 订单大厅         │  · 数据看板                 │
│  · 订单追踪         │  · 接单/操作流程    │  · 订单管理                 │
│  · 支付/评价        │  · 拍照/额外费用    │  · 司机审核                 │
│  · 个人中心         │  · 收入/钱包提现    │  · 定价配置                 │
│                     │                     │  · 服务卡/提现管理          │
└─────────────────────┴─────────────────────┴─────────────────────────────┘
                              │ HTTP/HTTPS (RESTful API, JWT)
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           后端服务层 (Express)                            │
│                            [server.js]                                   │
├─────────────────────────────────────────────────────────────────────────┤
│  中间件: CORS · JSON解析 · JWT认证 · 管理员鉴权 · Multer上传            │
├─────────────┬───────────────┬───────────────┬──────────────┬────────────┤
│ 用户路由     │  司机路由     │  订单路由      │  管理路由    │  配置路由   │
│  [users.js] │ [drivers.js]  │  [orders.js]   │  [admin.js]  │ [config.js]│
└─────────────┴───────────────┴───────────────┴──────────────┴────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        数据与工具层                                       │
├──────────────────────────────┬──────────────────────────────────────────┤
│   JSON文件数据库 [db.js]      │       定价引擎 [pricing.js]              │
│                              │                                          │
│  · users        (用户表)      │  · isNightTime()  夜间时段判断          │
│  · drivers      (司机表)      │  · generateOrderNo() 订单号生成         │
│  · orders       (订单表)      │  · calculatePrice() 价格计算            │
│  · pricing_config (定价表)    │                                          │
│  · service_cards (服务卡表)   │                                          │
│  · admins       (管理员表)    │                                          │
│  · system_config (系统配置)   │                                          │
│  · withdrawals  (提现记录表)  │                                          │
└──────────────────────────────┴──────────────────────────────────────────┘
                              │
                              ▼
                    rescue.json (持久化文件)
                    uploads/ (图片存储目录)
```

### 2.2 数据流向

1. **用户下单流程**: 用户小程序 → `POST /api/orders/create` → 定价引擎计算 → 写入 `orders` 表 → 推送到司机接单大厅
2. **司机接单流程**: 司机小程序 → `POST /api/driver/accept/:id` → 更新订单状态 + 司机状态 → 订单追踪实时同步
3. **订单完成流程**: 司机更新为 `completed` → 计算司机收入/平台抽成 → 写入钱包 → 用户支付+评价
4. **运营管理**: 管理员后台 → `api/admin/*` → 数据看板/订单/司机/定价/提现 全维度管理

---

## 3. 后端模块 (backend)

**目录**: [backend/](file:///Users/bytedance/Documents/EV/ev-rescue-system/backend)

### 3.1 模块职责

后端是整个系统的核心枢纽，承担：RESTful API 提供、业务逻辑处理、数据持久化、认证鉴权、静态资源服务。

### 3.2 文件结构

| 文件/目录 | 职责 | 代码参考 |
|-----------|------|----------|
| `server.js` | Express服务入口，中间件注册、路由挂载、全局错误处理 | [server.js](file:///Users/bytedance/Documents/EV/ev-rescue-system/backend/server.js) |
| `db.js` | JSON文件数据库（兼容SQL风格API） | [db.js](file:///Users/bytedance/Documents/EV/ev-rescue-system/backend/db.js) |
| `package.json` | 依赖与启动脚本定义 | [package.json](file:///Users/bytedance/Documents/EV/ev-rescue-system/backend/package.json) |
| `rescue.json` | 数据持久化文件（自动生成） | - |
| `routes/users.js` | 用户端API（登录/信息/订单/服务卡） | [routes/users.js](file:///Users/bytedance/Documents/EV/ev-rescue-system/backend/routes/users.js) |
| `routes/drivers.js` | 司机端API（登录/接单/状态/收入/钱包/提现） | [routes/drivers.js](file:///Users/bytedance/Documents/EV/ev-rescue-system/backend/routes/drivers.js) |
| `routes/orders.js` | 订单API（创建/预估/详情/取消/支付/评价/上传） | [routes/orders.js](file:///Users/bytedance/Documents/EV/ev-rescue-system/backend/routes/orders.js) |
| `routes/admin.js` | 管理后台API（看板/订单/司机/用户/定价/服务卡/配置/提现） | [routes/admin.js](file:///Users/bytedance/Documents/EV/ev-rescue-system/backend/routes/admin.js) |
| `routes/config.js` | 公开配置API（定价/服务信息） | [routes/config.js](file:///Users/bytedance/Documents/EV/ev-rescue-system/backend/routes/config.js) |
| `utils/pricing.js` | 定价计算引擎 | [utils/pricing.js](file:///Users/bytedance/Documents/EV/ev-rescue-system/backend/utils/pricing.js) |
| `uploads/` | 图片上传目录（救援前/后照片） | - |

### 3.3 核心中间件

#### 3.3.1 JWT用户认证中间件

**位置**: [server.js#L34-L45](file:///Users/bytedance/Documents/EV/ev-rescue-system/backend/server.js#L34-L45)

```javascript
function authMiddleware(req, res, next) {
  // 从 Authorization: Bearer <token> 提取并验证JWT
  // 验证通过则注入 req.user = { id, openid, role }
  // 失败返回 401
}
```

**使用范围**: 用户端、司机端、订单API。

#### 3.3.2 管理员鉴权中间件

**位置**: [server.js#L48-L63](file:///Users/bytedance/Documents/EV/ev-rescue-system/backend/server.js#L48-L63)

```javascript
function adminAuthMiddleware(req, res, next) {
  // 验证JWT + 检查 role === 'admin'
  // 无权限返回 403
}
```

**使用范围**: 仅管理后台 `api/admin/*` 所有接口。

#### 3.3.3 Multer文件上传

**位置**: [server.js#L24-L31](file:///Users/bytedance/Documents/EV/ev-rescue-system/backend/server.js#L24-L31)

- 上传目录: `backend/uploads/`
- 文件名格式: `{timestamp}-{random}.{ext}`
- 静态访问: `/uploads/{filename}`

### 3.4 NPM依赖

| 包名 | 版本 | 用途 |
|------|------|------|
| `express` | ^4.18.2 | Web框架，路由/中间件/HTTP服务 |
| `cors` | ^2.8.5 | 跨域资源共享（小程序/后台跨域调用） |
| `jsonwebtoken` | ^9.0.2 | JWT令牌签发与验证 |
| `multer` | ^1.4.5-lts.1 | multipart/form-data 文件上传处理 |

---

## 4. 用户端小程序 (user-miniprogram)

**目录**: [user-miniprogram/](file:///Users/bytedance/Documents/EV/ev-rescue-system/user-miniprogram)

### 4.1 模块职责

面向C端车主的微信小程序，提供救援服务入口、订单下单与追踪、个人中心等功能。入口页面通过TabBar分为首页/订单/我的三个主页面。

### 4.2 页面结构

| 页面路径 | 页面名称 | 核心功能 | 代码参考 |
|----------|----------|----------|----------|
| `pages/home/home` | 首页 | 服务信息展示、定价卡片、夜间标识、一键救援按钮、进行中订单入口 | [home.js](file:///Users/bytedance/Documents/EV/ev-rescue-system/user-miniprogram/pages/home/home.js) |
| `pages/order/order` | 下单页 | 车型选择(3类)、车牌号、电量%、仪表盘开关、地址选择(经纬度)、距离、价格预估、提交订单 | [order.js](file:///Users/bytedance/Documents/EV/ev-rescue-system/user-miniprogram/pages/order/order.js) |
| `pages/tracking/tracking` | 订单追踪 | 订单状态进度条(6阶段)、司机信息/电话、位置、费用明细、支付按钮、评价入口 | - |
| `pages/orders/orders` | 订单列表 | 历史订单分页列表、状态筛选、进入详情/追踪 | - |
| `pages/mine/mine` | 个人中心 | 用户信息、服务卡、累计消费、联系客服、救援电话 | - |

### 4.3 全局配置 (app.json)

**位置**: [app.json](file:///Users/bytedance/Documents/EV/ev-rescue-system/user-miniprogram/app.json)

- **导航主题**: 深蓝底 (`#0a1628`) + 白字
- **TabBar主题**: 选中色 青色 (`#00d4ff`)
- **权限**: 位置权限 (用于地址定位/导航)
- **TabBar Pages**: 首页 → 订单 → 我的

### 4.4 全局逻辑 (app.js)

**位置**: [app.js](file:///Users/bytedance/Documents/EV/ev-rescue-system/user-miniprogram/app.js)

| 属性/方法 | 说明 |
|-----------|------|
| `globalData` | 全局状态：userInfo、token、apiUrl、servicePhone、状态栏/导航栏高度 |
| `onLaunch()` | 获取系统信息适配导航栏、检查本地token登录、预取wx.login code、小程序热更新监听 |
| `getLoginCode()` | 调用 `wx.login()` 预取code（用于后端换openid，当前MVP直接传openid） |
| `getUserInfo()` | 拉取用户信息，失败自动清除失效token |
| `checkActiveOrder()` | 查询进行中的订单（首页入口判断用） |

### 4.5 API封装 (utils/api.js)

**位置**: [utils/api.js](file:///Users/bytedance/Documents/EV/ev-rescue-system/user-miniprogram/utils/api.js)

统一封装了 `request()` 函数，特性：
- **BASE_URL**: `http://localhost:3000/api`（生产需改为HTTPS域名）
- 自动注入 `Authorization: Bearer <token>`
- 统一返回格式解包：`{code:0, message, data}` → 直接 resolve(data)
- 401自动清除token并提示重新登录
- Loading 遮罩 + Toast 错误提示
- 15秒超时

公开接口（无需登录）:
- `getPricing()` → `GET /config/pricing`
- `getServiceInfo()` → `GET /config/service-info`

用户接口（需登录）:
- `login()`、`getUserInfo()`、`getUserOrders()`、`getUserCards()`
- `createOrder()`、`estimatePrice()`、`getOrderDetail()`、`getActiveOrder()`
- `cancelOrder()`、`payOrder()`、`rateOrder()`

---

## 5. 司机端小程序 (driver-miniprogram)

**目录**: [driver-miniprogram/](file:///Users/bytedance/Documents/EV/ev-rescue-system/driver-miniprogram)

### 5.1 模块职责

面向救援司机的独立微信小程序，负责接单大厅、服务流程操作、凭证上传、收入与钱包管理。通过TabBar分为「订单大厅」和「我的」。

### 5.2 页面结构

| 页面路径 | 页面名称 | 核心功能 | 代码参考 |
|----------|----------|----------|----------|
| `pages/login/login` | 登录页 | openid+手机号+姓名 注册或登录 | - |
| `pages/orders/orders` | 订单大厅 | 上线/下线开关、待接单卡片列表(每10秒自动刷新)、接单按钮、当前服务订单入口 | [orders.js](file:///Users/bytedance/Documents/EV/ev-rescue-system/driver-miniprogram/pages/orders/orders.js) |
| `pages/detail/detail` | 订单详情 | 状态进度操作、救援前/后照片上传、高速费/停车费额外费用录入、完成订单 | - |
| `pages/mine/mine` | 个人中心 | 司机信息、收入统计(今日/本月/累计)、审核状态、在线状态 | - |
| `pages/wallet/wallet` | 钱包 | 余额、提现记录、申请提现（微信/银行卡，最低10元） | - |

### 5.3 全局配置 (app.json)

**位置**: [app.json](file:///Users/bytedance/Documents/EV/ev-rescue-system/driver-miniprogram/app.json)

- **TabBar主题**: 选中色 橙色 (`#f59e0b`)
- **TabBar Pages**: 订单大厅 → 我的
- **默认启动页**: `pages/orders/orders`（未登录自动跳转login）

### 5.4 全局逻辑 (app.js)

**位置**: [app.js](file:///Users/bytedance/Documents/EV/ev-rescue-system/driver-miniprogram/app.js)

| 属性/方法 | 说明 |
|-----------|------|
| `globalData` | baseUrl、token、driver对象、status (online/offline/busy) |
| `onLaunch()` | 获取系统信息适配导航栏，调用 `checkLogin()` |
| `checkLogin()` | 从本地storage恢复登录态 |
| `saveLogin(token, driver)` / `clearLogin()` | 登录态持久化/清除 |
| `isLoggedIn()` / `getToken()` / `updateStatus(status)` | 工具方法 |

### 5.5 API封装 (utils/api.js)

**位置**: [utils/api.js](file:///Users/bytedance/Documents/EV/ev-rescue-system/driver-miniprogram/utils/api.js)

在用户端request封装基础上，额外提供：

- **`resolveImageUrl(url)`**: 将 `/uploads/xxx.png` 相对路径转换为完整URL（`FILE_BASE_URL` = `http://localhost:3000`）
- **`uploadFile(filePath, url, fieldName)`**: `wx.uploadFile` 封装，用于救援照片上传
- **司机专属接口**: `login()`、`getDriverInfo()`、`updateDriverStatus()`、`getPendingOrders()`、`acceptOrder()`、`updateOrderStatus()`、`getDriverOrders()`、`getEarnings()`、`getWallet()`、`requestWithdraw()`、`uploadImage()`

### 5.6 订单大厅核心机制 ([orders.js](file:///Users/bytedance/Documents/EV/ev-rescue-system/driver-miniprogram/pages/orders/orders.js))

| 机制 | 说明 |
|------|------|
| 登录校验 | `onShow()` 未登录 → `wx.reLaunch` 到登录页 |
| 状态驱动 | `online` 加载待接单列表 + 10秒定时器；`busy` 查找当前服务订单并跳转详情 |
| 自动刷新 | `startAutoRefresh()` → `setInterval` 每10秒 `loadOrders()`（仅online且非接单中） |
| 接单流程 | `onAcceptOrder()` → 调用接单API → 司机状态置busy → 停止刷新 → 跳转详情页 |
| 忙碌兜底 | 若status=busy但无活跃订单 → 自动重置online并恢复接单 |

---

## 6. 管理后台 (admin-dashboard)

**目录**: [admin-dashboard/](file:///Users/bytedance/Documents/EV/ev-rescue-system/admin-dashboard)

### 6.1 模块职责

运营管理Web控制台，单页应用（SPA），原生HTML/CSS/JS零构建实现，直接用浏览器打开即可运行。提供8大功能视图。

### 6.2 文件结构

| 文件 | 职责 | 代码参考 |
|------|------|----------|
| `index.html` | 单页主结构：登录页 + 应用布局（侧边栏+顶栏+视图容器+模态框+Toast） | - |
| `css/style.css` | 全部样式：主题CSS变量、卡片、表格、徽章、分页、模态框、响应式 | - |
| `js/api.js` | Fetch封装 + Token管理 + 全量API接口定义 | [api.js](file:///Users/bytedance/Documents/EV/ev-rescue-system/admin-dashboard/js/api.js) |
| `js/app.js` | 主逻辑：状态管理、视图切换、8大模块渲染+交互（约2000+行） | [app.js](file:///Users/bytedance/Documents/EV/ev-rescue-system/admin-dashboard/js/app.js) |

### 6.3 8大功能视图 (VIEW_TITLES)

| 视图key | 名称 | 核心功能 |
|---------|------|----------|
| `dashboard` | 数据看板 | 今日/本月订单&营收&利润、在线/待审核司机数、今日车型分布 |
| `orders` | 订单管理 | 条件筛选(状态/车型/关键词)、分页列表、详情、改价、指派司机、取消、删除 |
| `drivers` | 司机管理 | 分页列表、审核通过/拒绝、编辑信息、删除、详情、状态标签 |
| `users` | 用户管理 | 关键词搜索、用户订单统计、详情(近10单)、删除 |
| `pricing` | 定价配置 | 3类车型的白天/夜间价、基础里程、超里程单价、启停开关 |
| `cards` | 服务卡管理 | 生成服务卡、删除、关联用户 |
| `config` | 系统配置 | commission_rate(抽佣比例)、min_withdraw_amount(最低提现) 等KV配置 |
| `withdrawals` | 提现管理 | 司机提现申请审批（通过/拒绝，拒绝自动退回钱包余额） |

### 6.4 API封装 (js/api.js)

**位置**: [api.js](file:///Users/bytedance/Documents/EV/ev-rescue-system/admin-dashboard/js/api.js)

| 组件 | 说明 |
|------|------|
| **TokenManager** | `get()/set()/remove()/clear()` 管理 `localStorage.admin_token` 和 `admin_info` |
| **request(path, options)** | 统一fetch封装，401清除token并跳登录，code===0返回data，否则抛错 |
| **API对象** | 20+个方法覆盖全部 `/api/admin/*` 接口，支持 URLSearchParams 分页/筛选查询串 |

### 6.5 主逻辑 (js/app.js) 核心模式

**位置**: [app.js](file:///Users/bytedance/Documents/EV/ev-rescue-system/admin-dashboard/js/app.js)

- **状态对象 `state`**: 集中存储当前视图、各模块分页/筛选参数、当前操作id、confirm回调、抽佣比例
- **常量映射**: `STATUS_MAP`/`VEHICLE_MAP`/`DRIVER_STATUS_MAP` → 统一徽章标签与CSS类
- **工具函数**: `escapeHtml`(防XSS)、`formatMoney`、`formatDate`、`getStatusBadge`等
- **视图切换**: `switchView(viewName)` → 侧边栏高亮 + 视图display + 标题 + 触发 `load*()`
- **二级确认**: `showConfirm(options)` → 通用确认模态框，title/message/confirmText/danger/onConfirm
- **Toast**: `showToast(msg, type)` → 右上角滑入消失提示 (success/error/warning/info)

---

## 7. 系统设计文档 (ev-charging-rescue-system)

**目录**: [ev-charging-rescue-system/](file:///Users/bytedance/Documents/EV/ev-charging-rescue-system)

### 7.1 模块职责

可视化的系统设计方案页面（HTML单页），包含架构图、流程图、时序图、数据模型图等。用于方案评审和新人上手理解。

| 资源 | 说明 |
|------|------|
| `ev-charging-rescue-system.html` | 主文档，包含完整方案说明与Mermaid/ECharts图表 |
| `_shared/fonts/*.ttf` | InstrumentSans + JetBrainsMono 字体 |
| `_shared/js/*.min.js` | ECharts + Mermaid 图表库（离线可用） |
| `assets/charts.js` | 自定义图表初始化脚本 |

---

## 8. 关键类与函数说明

### 8.1 JSONDatabase 类 ([db.js#L11-L130](file:///Users/bytedance/Documents/EV/ev-rescue-system/backend/db.js#L11-L130))

**核心设计思想**: 零依赖的文件数据库，使用SQL风格的 `prepare/run/get/all` API，底层存储为单一JSON文件。MVP阶段避免了安装MySQL/SQLite，同时为未来迁移到真实DB保留了SQL接口。

| 方法 | 签名 | 说明 |
|------|------|------|
| `constructor()` | - | 初始化8张空表 + counters对象；`load()` 从文件恢复；`initDefaults()` 写入种子数据 |
| `load()` | - | 读取 `rescue.json` 合并到内存 |
| `save()` | - | 序列化 `{data, counters}` 写入文件（每次写操作后自动调用） |
| `nextId(table)` | number | 自增主键（内存counters + 扫描最大值兜底） |
| `initDefaults()` | - | 种子：3条定价、1个admin(admin/admin123)、2条系统配置；为老司机补 `wallet_balance` 字段 |
| `getConfig(key, def)` | any | 读 `system_config` KV |
| `setConfig(key, value, desc?)` | - | 写 `system_config` KV |
| `now()` | string | YYYY-MM-DD HH:mm:ss 格式时间戳 |
| `prepare(sql)` | PreparedStatement | 兼容SQLite风格的入口 |
| `exec(sql)` | - | DDL语句忽略（JSON无需建表） |

### 8.2 PreparedStatement 类 ([db.js#L132-L834](file:///Users/bytedance/Documents/EV/ev-rescue-system/backend/db.js#L132-L834))

SQL兼容层，解析有限子集的SQL语法，转为内存数组操作。

| 方法 | 说明 |
|------|------|
| `run(...params)` | 写操作：分发到 `_executeInsert` / `_executeUpdate` / `_executeDelete` |
| `get(...params)` | 单条查询：`all()[0]` |
| `all(...params)` | 批量查询：`_executeSelect` |

**SQL语法支持范围**：
- SELECT: FROM / WHERE (=, !=, LIKE, IN, NOT IN, DATE(), 1=1 AND OR) / LEFT JOIN(单字段) / GROUP BY(COUNT,SUM,SUM+CASE,SUM+乘法) / ORDER BY ASC/DESC / LIMIT OFFSET
- INSERT: `INSERT INTO table (cols) VALUES (?,?)` + 自动id + 各表默认字段
- UPDATE: `SET col=?, col=字面, col=col+?, col=col-数字` + `WHERE col=?`
- DELETE: `DELETE FROM table WHERE col=?`

### 8.3 定价引擎核心函数 ([utils/pricing.js](file:///Users/bytedance/Documents/EV/ev-rescue-system/backend/utils/pricing.js))

| 函数 | 位置 | 说明 |
|------|------|------|
| `isNightTime(date)` | [pricing.js#L4-L7](file:///Users/bytedance/Documents/EV/ev-rescue-system/backend/utils/pricing.js#L4-L7) | 判断是否夜间：hour≥22 或 hour<6 → 走夜间价 |
| `generateOrderNo()` | [pricing.js#L10-L20](file:///Users/bytedance/Documents/EV/ev-rescue-system/backend/utils/pricing.js#L10-L20) | 订单号规则：`EV` + YYYYMMDDHHmmss + 4位随机数 |
| `calculatePrice(vehicleType, distanceKm, orderTime, extraFee)` | [pricing.js#L23-L64](file:///Users/bytedance/Documents/EV/ev-rescue-system/backend/utils/pricing.js#L23-L64) | **核心定价**：按车型读配置 → 选昼/夜基价 → 超30km×5元/km → extraFee支持对象或数字 → 返回 `{basePrice, distanceFee, extraFee, totalPrice, isNight, baseDistance, extraPerKm}` |

### 8.4 订单完成分账逻辑 ([routes/drivers.js#L142-L157](file:///Users/bytedance/Documents/EV/ev-rescue-system/backend/routes/drivers.js#L142-L157))

司机将订单状态更新为 `completed` 时触发：

1. 读取更新后的 `total_price`（含司机后来追加的额外费用）
2. 从 `system_config` 取 `commission_rate`（默认20%）
3. 计算: `driverIncome = total × (1 - 佣金)`, `platformIncome = total × 佣金`
4. 写入 `orders.driver_income` 和 `platform_income`
5. 原子更新司机：`total_orders + 1`, `total_earnings + driverIncome`, `wallet_balance + driverIncome`
6. 司机状态从 busy 恢复为 online（可接下一单）

### 8.5 司机提现流程 ([routes/drivers.js#L227-L266](file:///Users/bytedance/Documents/EV/ev-rescue-system/backend/routes/drivers.js#L227-L266) + [routes/admin.js#L395-L425](file:///Users/bytedance/Documents/EV/ev-rescue-system/backend/routes/admin.js#L395-L425))

```
司机申请: 校验金额 ≥ min_withdraw_amount(默认10元) 且 ≤ wallet_balance
       → 扣减 wallet_balance
       → 插入 withdrawals 表(status=pending)
管理员审批 通过: withdrawals.status → approved + processed_at
          拒绝: withdrawals.status → rejected + 退回余额(wallet_balance + amount)
```

---

## 9. 数据模型

### 9.1 数据存储总览

所有数据持久化于单一JSON文件 `backend/rescue.json`，结构:

```json
{
  "data": {
    "users": [], "drivers": [], "orders": [], "pricing_config": [],
    "service_cards": [], "admins": [], "system_config": [], "withdrawals": []
  },
  "counters": { "users": 10, "drivers": 5, "orders": 42, ... }
}
```

### 9.2 users (用户表)

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `id` | number | 自增 | 主键 |
| `openid` | string | - | 微信openid（登录唯一标识） |
| `phone` | string | '' | 手机号 |
| `nickname` | string | '微信用户' | 昵称 |
| `avatar` | string | '' | 头像URL |
| `created_at` | string | now() | 注册时间 |

### 9.3 drivers (司机表)

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `id` | number | 自增 | 主键 |
| `openid` | string | - | 微信openid |
| `phone` | string | '' | 手机号（必填） |
| `name` | string | '' | 真实姓名（必填） |
| `avatar` | string | '' | 头像 |
| `status` | string | 'offline' | online/offline/busy |
| `approved` | number | 0 | 0=待审核 1=通过（通过才能接单） |
| `rating` | number | 5.0 | 平均评分(1.0-5.0) |
| `total_orders` | number | 0 | 累计完成订单数 |
| `total_earnings` | number | 0 | 累计司机收入（已扣佣金） |
| `wallet_balance` | number | 0 | 钱包可提现余额 |
| `created_at` | string | now() | 注册时间 |

### 9.4 orders (订单表)

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `id` | number | 自增 | 主键 |
| `order_no` | string | - | 订单号 EV+时间戳+随机 |
| `user_id` | number | - | 用户id |
| `driver_id` | number | null | 接单司机id |
| `vehicle_type` | string | - | small/medium/large |
| `vehicle_plate` | string | '' | 车牌号 |
| `battery_percent` | number | 0 | 下单时剩余电量% |
| `dashboard_off` | number | 0 | 仪表盘是否不亮 1/0 |
| `pickup_lat/lng` | number | 0 | 救援位置经纬度 |
| `pickup_address` | string | - | 救援地址文本 |
| `pickup_description` | string | '' | 补充描述 |
| `distance_km` | number | 0 | 行驶距离km |
| `base_price` | number | 0 | 基础费用（昼/夜价） |
| `distance_fee` | number | 0 | 超里程费用 |
| `extra_fee` | number | 0 | 高速费+停车费+其他 |
| `total_price` | number | 0 | 合计 = base + distance + extra |
| `driver_income` | number | null | 完成时计算：total×(1-佣金) |
| `platform_income` | number | null | 完成时计算：total×佣金 |
| `is_night` | number | 0 | 是否夜间时段 1/0 |
| `status` | string | 'pending' | 见11.状态流转 |
| `payment_status` | string | 'unpaid' | unpaid/pending/paid |
| `before_photo` | string | null | 救援前照片URL |
| `after_photo` | string | null | 救援后照片URL |
| `start_time` | string | null | 接单时间 |
| `arrive_time` | string | null | 到达时间 |
| `charging_start_time` | string | null | 开始充电 |
| `charging_end_time` | string | null | 结束充电 |
| `complete_time` | string | null | 完成时间 |
| `user_rating` | number | null | 用户评分1-5 |
| `user_comment` | string | '' | 用户评价文本 |
| `created_at` | string | now() | 下单时间 |

### 9.5 pricing_config (定价配置表)

| 字段 | 说明 | 默认种子 |
|------|------|----------|
| `vehicle_type` | small/medium/large | 三种车型 |
| `vehicle_name` | 中文名 | 小型车/中型车(4.2米货车)/大型车(重卡) |
| `day_price` | 白天(06:00-22:00)一口价 | 198 / 238 / 408 元 |
| `night_price` | 夜间(22:00-06:00)一口价 | 228 / 268 / 438 元 |
| `base_distance_km` | 包含基础里程 | 30 km |
| `extra_per_km` | 超基础里程单价 | 5 元/km |
| `is_active` | 是否启用 | 1 |

### 9.6 service_cards (服务卡表)

| 字段 | 说明 |
|------|------|
| `card_no` | 卡号 CARD+时间戳+随机 |
| `vehicle_type` | 对应车型 |
| `price` | 面额 |
| `user_id` | 绑定用户 |
| `total_uses` / `used_count` | 总次数/已用次数 |
| `status` | unused/used/expired |

### 9.7 admins (管理员表)

种子数据：`{ username: 'admin', password: 'admin123', name: '系统管理员' }`

### 9.8 system_config (系统配置KV表)

| key | 默认值 | 说明 |
|-----|--------|------|
| `commission_rate` | '0.2' | 平台抽佣比例(0-1) |
| `min_withdraw_amount` | '10' | 最低提现金额(元) |

### 9.9 withdrawals (提现记录表)

| 字段 | 说明 |
|------|------|
| `driver_id / name / phone` | 司机冗余信息 |
| `amount` | 提现金额 |
| `type` | wechat / bank 等 |
| `account` | 收款账号 |
| `status` | pending / approved / rejected |
| `created_at / processed_at` | 申请/处理时间 |

---

## 10. API 接口总览

### 10.1 公开接口 (无需认证)

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/health` | 健康检查：返回 `{status:'running', time}` |
| GET | `/api/config/pricing` | 获取全部激活的定价配置 |
| GET | `/api/config/service-info` | 获取服务介绍(名称/功率/区域/电话/营业时间/特色) |

### 10.2 用户端 API (前缀 `/api/user`, 用户JWT)

| Method | Path | 说明 |
|--------|------|------|
| POST | `/login` | {openid,phone,nickname,avatar} → {token,user} 查不存在即注册 |
| GET | `/info` | 获取当前登录用户信息 |
| GET | `/orders?page&pageSize` | 用户订单列表(LEFT JOIN 司机信息) |
| GET | `/cards` | 用户服务卡列表 |

### 10.3 订单 API (前缀 `/api/orders`, 用户/司机JWT)

| Method | Path | 说明 |
|--------|------|------|
| POST | `/estimate` | 价格预估(用户填完车型+距离+附加费即可查) |
| POST | `/create` | 创建订单 → 调用calculatePrice + generateOrderNo |
| GET | `/active` | 当前进行中订单（状态非completed/cancelled） |
| GET | `/:id` | 订单详情 (支持id或order_no查询, LEFT JOIN司机) |
| POST | `/cancel/:id` | 用户取消 (仅pending/accepted可取消；已接单则释放司机回online) |
| POST | `/pay/:id` | 标记 payment_status=paid (MVP模拟支付) |
| POST | `/rate/:id` | 评价 (rating+comment)，同时更新司机平均评分 |
| POST | `/upload` | Multer单图上传，返回 `{url: '/uploads/xxx.png'}` |

### 10.4 司机端 API (前缀 `/api/driver`, 司机JWT)

| Method | Path | 说明 |
|--------|------|------|
| POST | `/login` | {openid,phone,name,avatar} → {token,driver}，缺参数拒绝 |
| GET | `/info` | 司机信息 + system_config.commission_rate 注入返回 |
| POST | `/status` | 更新 status (online/offline/busy) |
| GET | `/pending-orders` | 全部 status=pending 订单 + 用户电话 (未审核司机禁止) |
| POST | `/accept/:orderId` | 接单：校验审核通过+online+订单仍pending → 置accepted + start_time + 司机busy |
| POST | `/update-status/:orderId` | 核心操作流：en_route/arrived(写arrive_time)/charging(写charging_start_time)/completed(触发分账+钱包) + 上传照片URL + 额外费用重算total_price |
| GET | `/orders?page&pageSize` | 司机历史订单 + 用户信息 |
| GET | `/earnings` | 收入统计：今日(orders+earnings) / 本月 / 累计 / wallet_balance |
| GET | `/wallet` | 钱包余额 + 提现记录 |
| POST | `/withdraw` | 申请提现：校验金额&最低额 → 扣余额 → 插入withdrawals(pending) |

### 10.5 管理后台 API (前缀 `/api/admin`, 管理员JWT)

| Method | Path | 说明 |
|--------|------|------|
| POST | `/login` | username+password 查admins表 → JWT(7天) |
| GET | `/dashboard` | 数据看板(今日/本月统计+在线/待审司机+待提现+车型分布) |
| GET | `/orders` | 订单分页(LEFT JOIN司机+用户) + status/vehicleType/keyword筛选 |
| GET | `/orders/:id` | 订单详情 |
| POST | `/orders/:id/price` | 手动改价(basePrice/distanceFee/extraFee → 自动total) |
| POST | `/orders/:id/cancel` | 管理员取消订单 |
| DELETE | `/orders/:id` | 物理删除订单 |
| POST | `/orders/:id/assign` | 指派司机(释放原司机+新司机busy+状态accepted) |
| GET | `/drivers` | 司机分页列表 |
| GET | `/drivers/available` | 已审核司机列表(用于指派弹窗) |
| POST | `/drivers/:id/approve` | 审核通过 approved=1 |
| POST | `/drivers/:id/reject` | 拒绝/取消资格 approved=0 |
| POST | `/drivers/:id/edit` | 修改姓名+电话 |
| DELETE | `/drivers/:id` | 删除(有进行中订单拒绝) |
| GET | `/users` | 用户分页 + keyword搜索 + JS层计算订单数/消费额 |
| GET | `/users/:id` | 用户详情 + 最近10条订单 |
| DELETE | `/users/:id` | 删除用户(有进行中订单拒绝) |
| GET | `/pricing` | 定价配置 |
| POST | `/pricing/:id` | 更新定价(昼/夜价、基础里程、超程单价、启用状态) |
| GET | `/cards` | 服务卡列表 + 用户名 |
| POST | `/cards` | 生成服务卡 CARD+timestamp+随机 |
| DELETE | `/cards/:id` | 删除服务卡 |
| GET | `/config` | 全部system_config KV |
| POST | `/config` | 新增或更新 KV |
| GET | `/withdrawals` | 提现申请分页 + status筛选 |
| POST | `/withdrawals/:id/approve` | 通过提现(status→approved+processed_at) |
| POST | `/withdrawals/:id/reject` | 拒绝提现(退回余额) |
| GET | `/wallets` | 所有司机余额一览(按余额降序) |

---

## 11. 订单状态流转

```
                    ┌───────────────────────────────────────────────────────────────┐
                    │                    订单完整生命周期                               │
                    └───────────────────────────────────────────────────────────────┘

   [用户下单] ───► pending ────────────────────────────────────────────►  cancelled
                      │   (待接单，订单大厅可见)                             ▲
                      │                                                     │
                      ▼           (用户取消/司机已接受前取消)                  │
                   accepted ───────────────────────────────────────────────┘
                      │   (已接单，司机busy)
                      │
                      ▼           (司机：前往救援地址中)
                   en_route
                      │
                      ▼           (司机：已到达现场)
                    arrived ───► [before_photo 救援前照片上传]
                      │
                      ▼           (司机：开始充电)
                   charging ───► 充电进度（60kW直流大功率补电）
                      │
                      ▼           (司机：结束充电 → 触发分账)
                  completed  ───► [after_photo, extra_fee, driver_income/platform_income]
                      │              ↓
                      │         司机 status → online (恢复接单)
                      │              ↓
                      │         支付环节 (payment_status: pending → paid)
                      │              ↓
                      │         用户评价 (rating+comment → 司机avg评分更新)
                      ▼
                 [ 闭环完成 ]
```

| 状态值 | 中文名 | 触发方 | 写入时间字段 |
|--------|--------|--------|--------------|
| `pending` | 待接单 | 用户 | `created_at` |
| `accepted` | 已接单 | 司机/管理员 | `start_time` |
| `en_route` | 前往中 | 司机 | - |
| `arrived` | 已到达 | 司机 | `arrive_time` |
| `charging` | 充电中 | 司机 | `charging_start_time` |
| `completed` | 已完成 | 司机 | `charging_end_time`, `complete_time` |
| `cancelled` | 已取消 | 用户/管理员 | - |

---

## 12. 依赖关系图

### 12.1 模块级依赖

```
                    ┌─────────────────────────────────────┐
                    │      utils/pricing.js (零依赖)        │
                    │   isNightTime / generateOrderNo      │
                    │      calculatePrice                  │
                    └────────────────▲────────────────────┘
                                     │ 使用
┌───────────────┐   ┌────────────────┴────────────────┐  ┌───────────────┐
│ users.js      │   │            db.js                 │  │ pricing.js    │
│ drivers.js    │──►│   JSONDatabase / PreparedStatement│◄─┤  (种子写入)   │
│ orders.js     │   │   8张内存表 + rescue.json 持久化  │  └───────────────┘
│ admin.js      │   └────────────────▲────────────────┘
│ config.js     │                    │ require
└───────┬───────┘                    │
        │ 注入参数                    │
        │  (jwt, JWT_SECRET,         │
        │   authMiddleware, upload)  │
        ▼                            │
   server.js ◄───────────────────────┘
   ├─ express / cors / express.json / express.urlencoded
   ├─ jwt (authMiddleware, adminAuthMiddleware)
   ├─ multer (upload 配置)
   └─ 静态服务: /uploads → backend/uploads/
```

### 12.2 前后端交互

```
user-miniprogram ──► https://<api-host>/api/{user,orders,config}/*
                       │  JWT: role=user  │
driver-miniprogram ───► https://<api-host>/api/{driver,orders,config}/*
                       │  JWT: role=driver│
admin-dashboard ──────► https://<api-host>/api/{admin}/*
                       │  JWT: role=admin │
                       ▼                  ▼
                 Express server.js ─► rescue.json (DB)
                                    ─► uploads/ (静态图片)
```

---

## 13. 项目运行方式

### 13.1 环境要求

| 环境 | 最低版本 | 说明 |
|------|----------|------|
| Node.js | >= 18 | 后端运行时 |
| npm | >= 9 | 依赖管理（Node自带） |
| 微信开发者工具 | 最新稳定版 | 小程序调试与发布 |
| 现代浏览器 | Chrome/Edge/Safari 最新 | 管理后台访问 |

### 13.2 启动后端服务

```bash
cd /Users/bytedance/Documents/EV/ev-rescue-system/backend
npm install      # 首次安装依赖
node server.js   # 启动服务（或 npm start / npm run dev）
```

**启动后控制台输出**:

```
🚀 救援系统后端服务已启动: http://localhost:3000
📱 API地址: http://localhost:3000/api
🔧 管理员账号: admin / admin123
```

首次启动后，`backend/rescue.json` 与 `backend/uploads/` 目录会自动创建。

**校验服务**: 浏览器访问 `http://localhost:3000/api/health` 应返回:
```json
{ "code": 0, "message": "ok", "data": { "status": "running", "time": "..." } }
```

### 13.3 打开管理后台

方式一（直接本地打开）:
- 双击 `ev-rescue-system/admin-dashboard/index.html`
- 登录：admin / admin123

方式二（通过后端静态托管，推荐用于联调）:
- 访问 `http://localhost:3000/`（如需需自行在server.js中追加静态托管 `express.static` 指向 admin-dashboard）

### 13.4 用户端小程序调试

1. 打开 **微信开发者工具**
2. 「导入项目」→ 选择目录: `/Users/bytedance/Documents/EV/ev-rescue-system/user-miniprogram`
3. 填入自己的小程序 AppID（或使用「测试号」）
4. 确认 `utils/api.js` 第7行 `BASE_URL` 为 `http://localhost:3000/api`
5. 编译运行（模拟器中可用）

**注意**: 本地HTTP在真机预览需在开发者工具 → 详情 → 本地设置 → 勾选「不校验合法域名」。

### 13.5 司机端小程序调试

与用户端流程相同，目录选择:
`/Users/bytedance/Documents/EV/ev-rescue-system/driver-miniprogram`

司机注册后，**必须**用管理员账号在后台「司机管理」中审核通过才能进入接单大厅接单。

### 13.6 快速联调流程（建议顺序）

1. 启动后端 → `node server.js`
2. 后台登录 → admin/admin123 → 「定价配置」按需调整
3. 用户小程序下单（Home→ 一键救援 → 选车型 →填写地址 → 预估价格 → 提交订单）
4. 后台「司机管理」手动新增或审核通过一个司机账号
5. 司机小程序登录（手机号+姓名）→ 切换「上线」→ 订单大厅出现刚下的单 → 接单
6. 司机详情页依次点击: 前往 → 到达（上传前照片）→ 开始充电 → 结束（上传后照片+高速费等）→ 完成
7. 用户端订单追踪页 → 支付 → 评分
8. 司机「我的」→ 查看今日收入/钱包 → 申请提现
9. 后台「提现管理」→ 审批通过/拒绝

---

## 14. 部署指南

### 14.1 后端部署（Linux云服务器）

```bash
# 1. 安装 Node.js 18+
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs   # Debian/Ubuntu
# 或 yum install nodejs  (CentOS)

# 2. 上传 backend 目录到 /opt/ev-rescue/backend
scp -r backend/* user@server:/opt/ev-rescue/backend/

# 3. 安装依赖
cd /opt/ev-rescue/backend && npm install --production

# 4. 使用 pm2 守护进程（推荐）
npm install -g pm2
pm2 start server.js --name ev-rescue
pm2 save
pm2 startup   # 开机自启

# 5. 配置 Nginx 反向代理 + HTTPS (小程序必须HTTPS)
# 示例 /etc/nginx/conf.d/ev-rescue.conf:
server {
    listen 443 ssl http2;
    server_name api.your-domain.com;
    ssl_certificate     /etc/ssl/certs/your-domain.pem;
    ssl_certificate_key /etc/ssl/private/your-domain.key;

    # API 转发
    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    # 上传图片访问
    location /uploads/ {
        proxy_pass http://127.0.0.1:3000/uploads/;
    }
    # 管理后台静态
    location / {
        root /opt/ev-rescue/admin-dashboard;
        try_files $uri $uri/ /index.html;
    }
}
systemctl reload nginx
```

### 14.2 小程序发布

1. 登录 **微信公众平台** (mp.weixin.qq.com) → 注册小程序
2. 获取 AppID → 分别填入 `user-miniprogram/project.config.json` 和 `driver-miniprogram/project.config.json` 的 `appid` 字段
3. 将两个小程序 `utils/api.js` 中 `BASE_URL` 改为 `https://api.your-domain.com/api`，司机端还要改 `FILE_BASE_URL`
4. 公众平台 → 开发设置 → 服务器域名：添加 `request合法域名`、`uploadFile合法域名`、`downloadFile合法域名` 均为HTTPS正式域名
5. 微信开发者工具 → 上传 → 填写版本号/备注
6. 公众平台 → 版本管理 → 提交审核 → 审核通过 → 发布

### 14.3 管理后台静态部署

两种方式均可：
- **方式A**: 同后端部署（14.1 Nginx已包含，通过 `/` 访问）
- **方式B**: 部署到对象存储/CDN（阿里云OSS/腾讯云COS），将 `admin-dashboard/*` 上传，并配置跨域（`api.js` 已支持跨域CORS请求）

---

## 15. 定价规则

### 15.1 计费公式

```
total_price = base_price                     // 白天或夜间一口价（30km内）
            + distance_fee                   // max(0, distance_km - 30) × 5元/km
            + extra_fee                      // 高速费 + 停车费 + 其他（司机现场录入）
```

### 15.2 默认定价表（基于绵阳实际运营数据）

| 车型 | 白天 06:00-22:00 | 夜间 22:00-06:00 | 基础里程 | 超里程单价 |
|------|------------------|-------------------|----------|------------|
| 🚗 小型车 (轿车/SUV) | ¥198 | ¥228 | 30 km | ¥5 / km |
| 🚚 中型车 (4.2米货车) | ¥238 | ¥268 | 30 km | ¥5 / km |
| 🚛 大型车 (重卡/大巴) | ¥408 | ¥438 | 30 km | ¥5 / km |

- 距离上限保护：`distance_km` 超过 200km 按 200km 封顶（[pricing.js#L25](file:///Users/bytedance/Documents/EV/ev-rescue-system/backend/utils/pricing.js#L25)）
- 功率规格：**60kW 大功率直流移动补电**
- 说明：高速费/停车费由司机现场垫付并在订单完成时录入，实报实销。

### 15.3 分账规则

| 分配方 | 比例 | 写入字段 |
|--------|------|----------|
| 司机收入 | **80%** (可配置 1 - commission_rate) | `driver_income` |
| 平台收入 | **20%** (默认，system_config.commission_rate) | `platform_income` |

修改方式：后台「系统配置」页，或直接修改 `rescue.json` 中 `system_config` 的 `commission_rate` 值。

---

## 附录 A. 默认账号速查

| 系统 | 用户名 | 密码 | 说明 |
|------|--------|------|------|
| 管理后台 | admin | admin123 | 首次登录后建议修改密码（编辑 rescue.json → admins 表或在 db.js initDefaults 中修改） |
| 司机端 | 手机号 + 姓名 + 微信openid注册 | - | 注册后需管理员后台审核通过才能接单 |
| 用户端 | 首次调用 /user/login 自动创建 | - | MVP阶段使用openid直登，生产需接入code2session |

## 附录 B. 常见问题

**Q: 数据文件 rescue.json 损坏/想重置怎么办？**  
A: 直接删除 rescue.json，重启后端会自动重建种子数据（定价+admin账号），所有历史数据清空。

**Q: 小程序真机无法请求接口？**  
A: ①检查是否HTTPS；②后台合法域名是否配置；③本地调试勾选「不校验合法域名」；④防火墙开放服务器3000端口或Nginx 443端口。

**Q: 司机端订单大厅看不到单？**  
A: 排查：① 司机状态是否「online」；② 司机是否审核通过（后台approved=1）；③ 订单状态是pending（已被其他司机接走就看不到了）；④ 刷新或等待下一个10秒自动轮询。

**Q: 定价改了但前端没生效？**  
A: 用户端/司机端首页有兜底内置定价，如果接口失败会使用本地默认。重启小程序或触发 `loadPricing()` 重新拉取即可。

---

*本文档由项目代码自动分析生成，最后更新: 2026-08-27*
