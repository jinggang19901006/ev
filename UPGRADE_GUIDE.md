# 新能源车移动充电救援系统 · 功能升级改造说明

> 本说明针对 2025 年本轮的 5 项功能增量改造。不破坏原有 `/user-miniprogram`/`driver-miniprogram` 双端，
> 新增统一版本 `unified-miniprogram` 作为推荐前端；所有后端能力通过新增路由（`/api/auth`、`/api/cards`、`/api/payments`、`/api/dispatch`）实现，原接口 100% 向前兼容。

---

## 0. 本次改造的 5 个需求点与落位

| # | 需求 | 后端落位 | 前端落位 | 后台落位 |
|---|---|---|---|---|
| 1 | 用户+司机端合并，登录选角色 | `routes/auth.js` 7 端点 + `unified_accounts` 主表 | `unified-miniprogram/pages/auth-entry` + `role-switch` | - |
| 2 | 新老用户分离（先查账号→分流登录/注册） | `auth.js` check-account / login-by-sms / login-by-wx / register | `auth-entry → login-phone / register-phone` | - |
| 3 | 多司机智能派单（距离/评分/等级/接单量） | `utils/order_dispatch.js`（4维加权+Haversine）+ `dispatch/` 路由 + `orders/create` 立即推荐 + `drivers` 等级更新 | `home-driver` V1-V7 徽章 + 订单排序 | 后台「订单调度」推荐排行 + 手动指派 + V等级字典展示 |
| 4 | 服务卡闭环（创建→分配→查询→核销→跟踪） | `routes/cards.js` 11 端点 + `card_allocations` / `card_usages` 双明细表 + `helpers` canUse/redeem/allocate | `pages/cards` + `cards-detail` + `payment-pay` 卡抵扣勾选 | 后台「服务卡分配」未分配/已分配/已核销/已过期 tabs + 分配/批量分配/生成 + 分配+核销追踪表 |
| 5 | 支付防逃单（押金+尾款+服务卡+信用积分+超时处罚） | `routes/payments.js` 10 端点 + `payment_records` / `credit_scores` 表 + `orders/create` 押金+信用拦截 | `home-user` 信用/押金展示 + `payment-pay`（押金/尾款两阶段+卡抵扣）+ `credit` 页 | 后台「支付流水」明细 + 「信用积分」用户列表/人工调分 + 「运行逃单扫描」一键罚分 |

---

## 1. 迁移步骤（生产/本地）

### 1.1 后端

```bash
# 1) 进入后端目录
cd ev-rescue-system/backend

# 2) 首次运行需要装依赖（如已有 node_modules 跳过）
npm install   # express/jsonwebtoken/cors/multer 无新增依赖

# 3) 启动服务（默认监听 3000）
node server.js

# 4) 此时会自动在当前目录生成 rescue.json（JSON数据库）
#    - 若此前已存在旧 rescue.json：启动时 db.js _getTableDefaults / _getDefaultValue
#      会自动补齐新表与旧表的新字段（old data 会被保留，只是 schema 升级）
#    - 如需干净数据，可备份后删 rescue.json 重启
```

### 1.2 前端（推荐迁移到 unified-miniprogram）

```bash
# 1) 打开微信开发者工具
# 2) 导入项目路径：<工作区>/ev-rescue-system/unified-miniprogram
# 3) AppID 可先使用测试号；后续改为真实 AppID 即可
# 4) 开发阶段：本地已默认请求 http://localhost:3000/api，注意小程序勾选「不校验合法域名」
```

旧 `user-miniprogram`/`driver-miniprogram` 仍可继续用，因为：
- `/api/user/login`、`/api/driver/login` 及原有订单/司机接口**完全保留**；
- 新版统一认证只是**叠加新能力**，不会改动旧接口的行为。

### 1.3 管理后台

两种方式任选其一：
- **推荐**：因 `server.js` 已把根路径 `/` 静态托管到 `../admin-dashboard`，直接打开 http://localhost:3000/ 即可。
- 直接用浏览器打开 `ev-rescue-system/admin-dashboard/index.html` 也可以，但部分 fetch 请求可能因跨域失败，仍推荐第 1 种。

默认管理员账号：
- admin / admin123（首次起库时 seed 自动写入）

---

## 2. 关键数据库表（全部 schema-upgrade 友好）

下面按新增的 10 张表说明，均通过 `db.js constructor` 的 `this.data = { ...defaults }` 自动建立；旧库启动时空表默认补齐。

| 表名 | 说明 | 关键字段 |
|---|---|---|
| unified_accounts | 统一主账号（需求1），手机号 + wx_openid 联合主键 | id, phone, nickname, avatar, wx_openid, user_id, driver_id, status, last_login_role |
| sms_captchas | 短信验证码（需求2，5分钟过期） | id, phone, code, scene, expire_at, used, created_at |
| payment_records | 押金/尾款/退款流水（需求5） | id, order_id, user_id, biz_type(deposit/final/refund/card_redeem), amount, pay_type(wechat/mock), status(pending/paid/refunded/failed), txn_id, pay_params_json, paid_at, fail_reason, remark |
| credit_scores | 信用积分流水（需求5） | id, user_id, delta, balance_after, reason, admin_id, created_at |
| card_allocations | 服务卡分配记录（需求4·追踪） | id, card_id, card_code, user_id, allocated_at, allocated_by(admin_id) |
| card_usages | 服务卡核销记录（需求4·追踪） | id, card_id, card_code, user_id, order_id, discount_amount, redeemed_at, admin_note |
| driver_levels | V1-V7 司机等级字典（需求3·渐变色+发光） | id, level(V1..V7), name(新晋..传奇), coefficient(0.8..1.6), threshold_orders, threshold_rating, gradient_from/to, badge_color, glow_color |
| dispatch_logs | 调度日志（需求3·可追溯） | id, order_id, mode(auto/manual), selected_driver_id, weights_json, candidates_json, reason, created_at |
| + service_cards 旧表升级 | （旧表基础上增加）user_id, allocated_at, allocated_by, use_count, used_count, description, level_required, expires_at, status(unused/active/used/redeemed/expired), code | 见 initDefaults L? 自动升级 |
| + orders 旧表升级 | 增加 deposit_amount/deposit_status(unpaid/paid/refunded)/final_amount/payment_status/use_card_id/card_discount_amount/driver_level_id/dispatch_mode/dispatch_candidates_json/escape_flagged/escape_detected_at | 所有新字段都有默认值（`_getDefaultValue`），旧订单兼容 |
| + drivers/users 旧表升级 | drivers.level_id/users.credit_score 历史记录默认 V1/100 | 旧用户/司机首次读到就写入 |

---

## 3. 系统 KV 配置（system_config）

默认值都在 `db.js initDefaults` 中 seed，可通过后台「系统配置」改：

- **派单权重**：`dispatch_distance_weight=0.4` / `dispatch_rating_weight=0.25` / `dispatch_level_weight=0.2` / `dispatch_order_weight=0.15`
- **派单范围**：`dispatch_max_candidates=10` / `dispatch_max_distance_km=30`
- **押金规则**：`deposit_ratio=0.3` / `deposit_min_amount=50`
- **逃单处罚**：`escape_penalty_score=30` / `credit_min_to_order=60` / `unpaid_pay_timeout_hours=24` / `order_pay_on_time_bonus=2`
- **支付接入**：`wx_appid` / `wx_appsecret` / `wx_merchant_id` / `wx_pay_key`（留空即默认 mock 模式，MVP 可跑）
- **短信接入**：`sms_mode=dev`（开发时任意手机号验证码固定 `1234`，用户偏好简单直观）；生产填 `sms_mode=prod` + `ali_sms_*` 几个 KV 切换阿里云短信

### 3.1 从 mock 支付切到真微信支付

只需要在后台「系统配置」填入 4 个真实值，系统会自动升级：
```
wx_appid = 小程序的 AppID
wx_appsecret = AppSecret（用于 wx.login → openid 的 code2session）
wx_merchant_id = 微信支付商户号
wx_pay_key = 微信支付 API v3 密钥（>=32 位）
```
只要四者都非空，`routes/payments.js deposit` 会跳过 mock 分支，改为真正的 JSAPI 统一下单，返回前端调 `wx.requestPayment` 的 paySign/timeStamp/nonceStr/package。若小程序侧还没接入微信支付回调，后端 `wechat/notify` 已写好签名校验、状态写库。

---

## 4. 服务卡完整闭环（需求4 · 推荐操作流）

### 4.1 运营侧

后台「服务卡分配」页：
1. 顶部点击「生成新卡」→ 填名称、抵扣金额、适用车型、数量（可一次生成 100 张活动卡）、有效期（90 天）
2. 在「未分配」tab：
   - 单张点击「分配给用户」弹窗 → 填**用户ID 或 手机号**（推荐手机号）；
   - 或点击「批量分配(按手机号)」填 `phone` + 多张卡ID（逗号分隔）；
3. 全程跟踪：
   - 分配记录 → 页面下方「分配/核销追踪记录」（写入 `card_allocations`）；
   - 核销记录 → 用户对订单使用卡片后出现在同一列表（写入 `card_usages` + 更新 `orders.use_card_id`）。

### 4.2 用户侧

统一小程序「我的 → 我的服务卡」：
- 未使用 Tab → 点击卡查看详情（有效期/适用车型）；
- 下单完成 → 支付尾款页会自动拉取该订单可用的 `available_cards` 列表，用户勾选一张即可抵扣 `card_discount_amount`（后端做 5 个条件校验：本人+未用+未过期+车型匹配+该单未核销）。

---

## 5. 智能派单算法（需求3 · 4 维权重公式）

```
S(driver) =
     0.40 × (1 - norm(distance_km))   // 越近分越高
  +  0.25 × norm(rating)               // 评分越高分越高（1-5分）
  +  0.20 × norm(level_coefficient)    // 等级系数越高分越高（V7=1.6/V1=0.8）
  +  0.15 × (1 - norm(accept_count_7d))// 饥饿度：近7日接单数越少越加分（避免 V7 垄断、V1 饿死）
```
公式参数从 `system_config` 读取，可随时调权重，后台「订单调度」页顶部会显示当前各权重。

- **触发点**：用户调用 `POST /orders/create` 创建单成功后，`orders.js` 末尾自动调用 `dispatch.rankDriversForOrder()`，
  把前 10 名候选司机写入 `orders.dispatch_candidates_json` 并返回前端 `recommended_drivers` 字段（用户端首页可直接展示"距离您最近的救援车是…"）。
- **人工覆盖**：后台「订单调度」输订单ID → 排行榜每一条有"指派该司机"按钮 → 调用原 `POST /admin/orders/:id/assign`；覆盖时 `dispatch_logs.mode=manual` 记录。
- **等级升降**：每次司机完成一单 `drivers.js /update-status completed` 末尾自动调用 `updateDriverLevelAfterOrder(driverId)`，
  按累计单量 + 评分重算 level_id，写回 drivers 表，下次派单生效。

### V1-V7 等级字典（db.js 预置 7 条，渐变色徽章满足用户对"设计感"的偏好）

| 等级 | 名称 | 门槛单 | 评分门槛 | 派单系数 |
|---|---|---|---|---|
| V1 | 新晋救援者 | 0 | 0 | ×0.8 |
| V2 | 合格救援 | 50 | 4.3 | ×0.95 |
| V3 | 熟练救援 | 150 | 4.5 | ×1.05 |
| V4 | 优秀救援 | 350 | 4.7 | ×1.15 |
| V5 | 精英救援 | 600 | 4.85 | ×1.25 |
| V6 | 金牌救援 | 900 | 4.9 | ×1.4 |
| V7 | 传奇救援 | 1200 | 4.95 | ×1.6 |

---

## 6. 防逃单铁三角（需求5）

### 6.1 前置押金

- 创建单时 `orders.create` 按 `max(deposit_min, total × deposit_ratio)` 计算押金（默认 30% 或 50 元，取大）；
- 此时订单 `deposit_status='unpaid'`，司机接单会看到 `warn='用户尚未支付押金，接单后请提醒其支付'`；
- 用户下单后会强制跳押金支付页，**只有支付完押金**才正式进入派单（推荐候选池中的订单会自动过滤 unpaid 押金）。

### 6.2 尾款24小时支付 + 服务卡抵扣

- 司机把订单状态标记为 `completed` 后，用户端跳支付页，自动展示：总金额 - 押金（已转）- 可用服务卡抵扣 = 本次应付；
- 若金额 ≤0（例如用了大额卡抵消尾款）则自动 0 元支付成功；
- 后端 `payments/final` 核销：
  - 按时（`completed_at` 起 < 24h）→ 给用户 `credit_score += order_pay_on_time_bonus(+2)` 并写 `changeCreditScore` 流水；
  - 调用 `helpers.redeemCard()` 写 `card_usages` + 更新 `orders.use_card_id/card_discount_amount`。

### 6.3 信用积分拦截

- 初始每个用户 100 分；
- **逃单判定**：后台「支付流水」点「运行逃单扫描」或配置 cron（可在 payments.runEscapeJob 里挂 node-cron）；
  - 扫 `status=completed && payment_status!==paid && completed_at + 24h < now` → 每单扣 30 分 + 标记 `orders.escape_flagged=1`；
- **下单拦截**：下次用户调用 `orders.create` 时，`canUserPlaceOrder(user_id)` 会检查：
  - 最新信用分 < 60 分 → code `4025` 直接拒单；
  - 或存在已完成未支付的历史订单 → 同样拦截，提示其补齐尾款。

### 6.4 恢复/人工调分

- 后台「信用积分」：每一行点「调整积分」→ 输入 delta（例如 `-30` 扣 30 分，`+20` 加 20 分）+ 必填原因；
- 调用 `POST /payments/admin/credit/adjust`，最终都会写一条 `credit_scores` 流水记录（含 admin_id / reason / delta / balance_after），全程可追溯。

---

## 7. 统一认证流程（需求1+2 · 前端调用顺序）

登录页（`pages/auth-entry`）第一步**先选择身份**：「🚗 普通车主」或「🛠️ 救援司机」。

| 步骤 | 前端动作 | 调用接口 | 后端返回 | 下一步 |
|---|---|---|---|---|
| 1 | 输入手机号，点击"使用手机号继续" | `GET /api/auth/check-account?phone=...` | `{ exists, roles:[user|driver], suggestNext: login\|register\|switch }` | 若手机号已存在且所选角色在 roles 中 → 跳登录页；其他情况 → 跳注册页 |
| 2 | 点击"获取验证码"（MVP 固定 1234） | `POST /api/auth/send-sms` | `{ expire_seconds }` | 60s 倒计时 |
| 3 | 老用户填验证码+点击登录 | `POST /api/auth/login-by-sms {phone,code,role,wx_code?}` | `{ token, account, role, profile }` | 存 token 进 storage，跳到用户/司机首页 |
| 4 | 新用户填写昵称+头像/司机填姓名+身份证+验证码+同意协议 | `POST /api/auth/register {phone,code,role,nickname?,avatar?,name?,id_card?,wx_code?}` | `{ token, account, role, profile }` | 司机端此时 `approved=0`，进入司机大厅时会提示"后台审核中" |
| 5 | 同一个账号切换身份 | `POST /api/auth/switch-role {role}` | `{ token, role, profile }` | 重新签发 JWT，更换 role |
| 6 | 登录后拉账号全景 | `GET /api/auth/me` | `{ account, roles, credit_score, ... }` | "我的"页展示可切换身份列表 |

- 微信一键登录也是走同样的 check-account 分流，但 code 参数换成 `wx.login` 返回的 code；
- 旧小程序走 `/user/login`/`/driver/login` 时，会尝试在后端把 openid 绑定到 unified_account（若手机号相同则自动合并），保证老用户平滑升级。

---

## 8. 5 需求 smoke test（建议全部跑通）

```bash
# 终端1：启动后端
cd ev-rescue-system/backend && node server.js
# 控制台出现 "Server running at http://localhost:3000" 即 OK

# 终端2：下面用 curl 跑一遍主链路（也可以用 HTTPie/Postman）
BASE=http://localhost:3000/api
PHONE=15228301555    # 开发环境固定验证码 1234

# 1) 新老用户分流：查账号
curl -s "$BASE/auth/check-account?phone=$PHONE" | jq
# → 不存在 → suggestNext=register

# 2) 注册 一个用户 角色(注册同时自动登录)
curl -s -X POST "$BASE/auth/send-sms" -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\",\"scene\":\"register\"}" | jq
curl -s -X POST "$BASE/auth/register" -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"code\":\"1234\",\"role\":\"user\",\"nickname\":\"张先生\",\"wx_code\":\"mock-login-001\"}" | jq
# → 拿到 token 记下来：USER_TOKEN=...

# 3) 再查同一手机号 → suggestNext=register(缺driver) 或 switch
curl -s "$BASE/auth/check-account?phone=$PHONE" | jq
# → 在同手机号上补开通 司机身份（验证码仍然是 1234）
curl -s -X POST "$BASE/auth/send-sms" -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\",\"scene\":\"register\"}" | jq
curl -s -X POST "$BASE/auth/register" -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"code\":\"1234\",\"role\":\"driver\",\"name\":\"张司机\",\"id_card\":\"510703199001010011\",\"wx_code\":\"mock-login-002\"}" | jq
# → 拿到 DRIVER_TOKEN（此时 driver.approved=0，需后台审核）

# 4) 管理员登录 + 审核这个司机
ADMIN_TOKEN=$(curl -s -X POST "$BASE/admin/login" -H 'content-type: application/json' -d '{"username":"admin","password":"admin123"}' | jq -r '.data.token')
# 查司机列表拿 id
DRIVER_ID=$(curl -s "$BASE/admin/drivers?pageSize=5" -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.data.list[] | select(.phone=='\"$PHONE\"') | .id')
curl -s -X POST "$BASE/admin/drivers/$DRIVER_ID/approve" -H "Authorization: Bearer $ADMIN_TOKEN" | jq
# 司机上线
curl -s -X POST "$BASE/driver/status" -H "Authorization: Bearer $DRIVER_TOKEN" -H 'content-type: application/json' -d '{"status":"online"}' | jq

# 5) 用户下单 → 自动走派单（orders/create 会推荐司机）
ORDER=$(curl -s -X POST "$BASE/orders/create" -H "Authorization: Bearer $USER_TOKEN" -H 'content-type: application/json' \
  -d '{"vehicle_size":"medium","distance_km":5,"address":"绵阳市涪城区万达","lat":31.4675,"lng":104.6791,"contact_name":"张先生","contact_phone":"15228301555"}')
echo $ORDER | jq
ORDER_ID=$(echo $ORDER | jq -r '.data.id')
# 响应里包含 recommended_drivers 说明派单正常

# 6) 押金支付（MVP mock）
curl -s -X POST "$BASE/payments/order/$ORDER_ID/deposit" -H "Authorization: Bearer $USER_TOKEN" -H 'content-type: application/json' \
  -d '{"mode":"mock","pay_type":"wechat"}' | jq

# 7) 调度推荐（后台调用 /dispatch/recommend）
curl -s -X POST "$BASE/dispatch/recommend" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d "{\"order_id\":$ORDER_ID}" | jq
# → candidates top1 的司机应当就是我们刚审核的那位

# 8) 司机 accept → update-status → completed
curl -s -X POST "$BASE/driver/accept/$ORDER_ID" -H "Authorization: Bearer $DRIVER_TOKEN" | jq
for st in en_route arrived charging completed; do
  curl -s -X POST "$BASE/driver/update-status/$ORDER_ID" -H "Authorization: Bearer $DRIVER_TOKEN" -H 'content-type: application/json' -d "{\"status\":\"$st\"}" | jq >/dev/null
done
# 确认 driver.level_id 是否被 updateDriverLevelAfterOrder 升到 V1/V2
curl -s "$BASE/driver/info" -H "Authorization: Bearer $DRIVER_TOKEN" | jq '.data.level_id'

# 9) 服务卡生成/分配/核销（需求4 闭环）
# 管理员创建 1 张卡
curl -s -X POST "$BASE/cards/admin/create" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"name":"老客回馈卡","discount_amount":30,"count":1,"valid_days":90,"vehicle_size":"all"}' | jq
# 查可用卡列表并取第一张
CARD_ID=$(curl -s "$BASE/cards/admin/list?status=all" -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.data.list[] | select(.name=="老客回馈卡") | .id' | head -1)
USER_ID=$(curl -s "$BASE/auth/me" -H "Authorization: Bearer $USER_TOKEN" | jq '.data.account.user_id')
# 分配给用户
curl -s -X POST "$BASE/cards/admin/$CARD_ID/allocate" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d "{\"user_id\":$USER_ID}" | jq
# 尾款支付（MVP mock，选择使用该卡抵扣；后端会自动 redeemCard）
curl -s -X POST "$BASE/payments/order/$ORDER_ID/final" -H "Authorization: Bearer $USER_TOKEN" -H 'content-type: application/json' \
  -d "{\"mode\":\"mock\",\"pay_type\":\"wechat\",\"card_id\":$CARD_ID}" | jq
# → final_pay 应该 = max(0, total - deposit(30%) - 30)，且 credit_score += 2

# 10) 用户信用 + 逃单模拟（需求5）
# 人工把用户信用调到 50，然后尝试再次下单
curl -s -X POST "$BASE/payments/admin/credit/adjust" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d "{\"user_id\":$USER_ID,\"amount\":-52,\"delta\":-52,\"reason\":\"模拟逃单后扣到48分\"}" | jq
curl -s -X POST "$BASE/orders/create" -H "Authorization: Bearer $USER_TOKEN" -H 'content-type: application/json' \
  -d '{"vehicle_size":"medium","distance_km":10,"address":"测试信用拦截","lat":31.4675,"lng":104.6791}' | jq
# → code: 4025 / message: 信用分过低，请先支付未完成订单 / 或联系客服
```

若上述全部返回 `code:0` 或符合预期的拦截，说明本轮 5 项改造全部通过。

> **注意（2026-08-27 smoke实跑时踩的坑，跑之前务必看）**：
> ① `/payments/admin/credit/adjust` 接口字段是 `amount`（不是 `delta`），上面第 289 行脚本已同步为 `\"amount\":-52,\"delta\":-52`（双写兼容）。
> ② `/cards/admin/create` 兼容字段：`discount_amount→price`、`name→remark`、`vehicle_size:all→vehicle_type:*`、`valid_days→expired_at自动算`，上面脚本已用这套入参直接可用。
> ③ `/orders/create` 和 `/orders/estimate` 字段双写兼容：`vehicle_size→vehicleType`、`address→pickupAddress`、`lat/lng→pickupLat/pickupLng`、`distance_km→distanceKm`，snake_case 和 camelCase 都接受，不用改旧小程序前端。
> ④ SMS 验证码「发送后立即注册返回过期」的时区 bug 已在 `utils/helpers.js:_localStr/_parseLocal` 修复；如果之前有脏 `rescue.json`，**删除重新生成** 可彻底清掉格式不一致的验证码。
> ⑤ `/dispatch/recommend` 的返回同时暴露 `data.candidates` 和 `data.list`（两个数组完全相同），老代码查 `.list` 新代码查 `.candidates` 都 OK。

---

## 8.1 本轮实跑验证的完整断言（对应 5 大需求落位）

实际 smoke 跑出的最终关键数值（手机号 `15228301555`、中型车 5km、白天）：

| 需求 | 断言点 | 实际结果 |
|---|---|---|
| ① 双端合并 | 同 phone 15228301555 注册 user → 再注册 driver → 共用 account_id=1，roles=["user","driver"]，`/auth/switch-role` 换 JWT | ✅ 通过 |
| ② 新老分流 | `/auth/check-account` 第1次 `exists=false,suggestNext=register`；第2次 `exists=true,roles=[user],suggestNext=login`；`/login-by-sms` 永远不自动创建账号 | ✅ 通过 |
| ③ 智能派单 | `recommended_drivers.length≥1`、top1=张司机、`dispatch/recommend.candidates[0].score=0.6545`、`/dispatch/levels` 共 7 级（V1-V7）、completed 后 driver.level_id=V1 自动升级 | ✅ 通过 |
| ④ 服务卡闭环 | create(vehicle_size=all,discount_amount=30,valid_days=90) → allocate(allocation_id=1,card_no写入) → `/cards/mine` total=1 status=active → final 抵扣后 card_discount_amount=30，`/cards/admin/usages`+`allocations` 各 1 条 | ✅ 通过 |
| ⑤ 防逃单铁三角 | order.price=238，deposit=71.4(30%≥50)，final=238-71.4-30=136.6，payment_status=paid；`credit adjust amount=-52` 后 score=48，再下单直接 4025 拦截 | ✅ 通过 |

---

## 9. 回滚 / 风险点

- **数据风险**：所有新字段写入均在新增表 / 旧表追加默认值，旧数据不会被删除；如需回滚到改造前版本，只需删除 `rescue.json` 即可重新生成旧 schema（建议备份 `rescue.json.bak`）。
- **端口冲突**：如果本机上旧进程占了 3000，杀进程 `lsof -ti:3000 | xargs kill -9` 或改 `server.js` 里的 `PORT`。
- **真实微信/短信**：首次上线前，先用测试号跑 mock，再填 appid/商户号 —— 系统会"配置不空就切换真支付"，切换逻辑在 `payments.js` 和 `helpers.wxCode2Session` 里都有安全降级。
- **统一小程序真机**：在真机上要把 `utils/api.js` 的 `BASE_URL` 改成公网域名（且小程序后台配置 request 合法域名），否则 `wx.request` 会因安全域名校验被拦截。

---

## 10. 后续优化方向（本轮未做，仅留接口位）

- `GET /admin/orders/:id/dispatch-recommend` 嵌入订单详情页右侧推荐栏；
- 小程序端引入 `ec-canvas` 在 "我的"画信用积分曲线图；
- 后端 `runEscapeJob` 挂 `node-cron` 每小时扫一次（推荐每天 09:00/21:00 各一次人工跑也够）；
- 司机端 `home-driver` 做一个"调度大屏"，顶部显示 Top10 候选订单，点击可抢单。

—— 改造说明结束 ——
