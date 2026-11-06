# 公网 HTTPS 部署

## 前置条件

- 一台 Linux 公网服务器，开放 TCP 80/443。
- 一个已解析到服务器公网 IP 的域名，例如 `api.example.com`。
- 服务器已安装 Docker Engine 与 Docker Compose。
- 微信小程序生产环境使用的域名须符合微信公众平台要求。

## 部署

1. 将项目上传到服务器。
2. 复制 `deploy/.env.production.example` 为 `deploy/.env.production` 并填写真实配置。
3. 如需迁移当前业务数据，将本机 `backend/rescue.json` 放到服务器 `deploy/data/rescue.json`，将 `backend/uploads/` 中的文件复制到 `deploy/data/uploads/`。
4. 在项目根目录执行：

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

5. 验证：

```bash
curl https://你的域名/api/health
```

Caddy 会自动申请并续期 TLS 证书。订单数据库、上传图片和 Caddy 证书都保存在 `deploy/` 下的持久化目录中。

## 微信小程序

在微信公众平台“开发管理 → 开发设置 → 服务器域名”中配置：

- `request 合法域名`：`https://你的域名`
- `uploadFile 合法域名`：`https://你的域名`
- `downloadFile 合法域名`：`https://你的域名`

域名不要包含 `/api`、端口或路径。配置后将 `unified-miniprogram/config/env.js` 的 `DEVICE_HOST` 改为同一 HTTPS 域名。
