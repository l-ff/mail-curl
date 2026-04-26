# mail-curl

mail-curl 是一个轻量级 Node.js 邮箱适配器服务，对外提供稳定的 HTTP API，并把不同临时邮箱平台的差异封装在 provider 模块中。

## 功能

- 统一创建邮箱、读取收件箱、获取邮件详情接口
- 通过 URL 第一段选择邮箱 provider
- 支持共享 API key 鉴权
- 支持从 `.env` 和 `.env.local` 加载配置
- 支持 Docker 部署

## 当前支持的 provider

| Provider | 说明 | 启用方式 |
| --- | --- | --- |
| `chatgpt_mail` | 通过 HTTP API 接入 ChatGPT Mail | 设置 `CHATGPT_MAIL_API_KEY` |
| `twenty_four_email` | 通过 24.email 生成邮箱、读取 WebSocket 收件箱并解析邮件 HTML | 设置 `TWENTY_FOUR_EMAIL_ENABLED=1` |
| `generator_email` | 通过 generator.email 生成邮箱并解析 HTML 收件箱/邮件详情 | 设置 `GENERATOR_EMAIL_ENABLED=1` |

## 环境要求

- Node.js 18+
- npm

## 安装

```bash
npm install
```

## 配置

服务会依次读取 `.env` 和 `.env.local`，但不会覆盖已经存在的系统环境变量。

常用配置：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3100` | HTTP 服务端口 |
| `HOST` | `::` | HTTP 监听地址；Docker 中默认为 `0.0.0.0` |
| `MC_KEY` | `sk-test` | 调用业务接口时传入的共享 API key |
| `CHATGPT_MAIL_API_KEY` | 空 | 设置后启用 `chatgpt_mail` provider |
| `CHATGPT_MAIL_BASE_URL` | `https://mail.chatgpt.org.uk` | `chatgpt_mail` 上游地址 |
| `CHATGPT_MAIL_TIMEOUT_MS` | `15000` | `chatgpt_mail` 请求超时时间 |
| `TWENTY_FOUR_EMAIL_ENABLED` | 空 | 设置为 `1` 后启用 `twenty_four_email` provider |
| `TWENTY_FOUR_EMAIL_BASE_URL` | `https://24.email` | `twenty_four_email` 上游地址 |
| `TWENTY_FOUR_EMAIL_TIMEOUT_MS` | `15000` | `twenty_four_email` 请求超时时间 |
| `GENERATOR_EMAIL_ENABLED` | 空 | 设置为 `1` 后启用 `generator_email` provider |
| `GENERATOR_EMAIL_BASE_URL` | `https://generator.email` | `generator_email` 上游地址 |
| `GENERATOR_EMAIL_TIMEOUT_MS` | `15000` | `generator_email` 请求超时时间 |

示例 `.env`：

```env
MC_KEY=your-secret-key
TWENTY_FOUR_EMAIL_ENABLED=1
GENERATOR_EMAIL_ENABLED=1
# CHATGPT_MAIL_API_KEY=your-chatgpt-mail-api-key
```

## 本地运行

```bash
npm start
```

服务默认监听：

```text
http://localhost:3100
```

## API

### 健康检查

```bash
curl http://localhost:3100/health
```

响应示例：

```json
{
  "ok": true,
  "providers": [
    {
      "name": "twenty_four_email",
      "capabilities": {
        "createMailbox": true,
        "listInbox": true,
        "getMail": true
      }
    }
  ]
}
```

### 创建邮箱

```bash
curl -X POST "http://localhost:3100/twenty_four_email/api/remail?key=your-secret-key"
```

响应示例：

```json
{
  "id": "example@domain.com",
  "email": "example@domain.com",
  "provider": "twenty_four_email"
}
```

### 获取收件箱

```bash
curl "http://localhost:3100/twenty_four_email/api/inbox?key=your-secret-key&mailbox_id=example@domain.com"
```

响应示例：

```json
[
  {
    "mail_id": "message-id",
    "sender_name": "Sender",
    "subject": "Hello",
    "received_at": "2026-04-25T00:00:00.000Z"
  }
]
```

### 获取邮件详情

```bash
curl "http://localhost:3100/twenty_four_email/api/mail?key=your-secret-key&id=message-id"
```

响应示例：

```json
{
  "id": "message-id",
  "subject": "Hello",
  "content": "Plain text content",
  "html": "<p>HTML content</p>",
  "from": "Sender <sender@example.com>",
  "received_at": "2026-04-25T00:00:00.000Z"
}
```

`twenty_four_email` 可以替换为任意已启用 provider 的名称。

## Docker

构建镜像：

```bash
docker build -t mail-curl .
```

运行容器：

```bash
docker run --rm \
  -p 3100:3100 \
  --env-file .env \
  mail-curl
```

推送镜像：

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t lff0/mail-curl:latest \
  --push \
  .
```

## 项目结构

```text
index.js                  # 启动入口
src/
  index.js                # re-export buildApp/startServer
  server.js               # 配置加载、provider 注册、路由、鉴权、server 组装
  config.js               # .env/.env.local 与运行时配置
  errors.js               # 错误模型与 JSON 响应转换
  http-client.js          # fetch 封装、超时、上游错误包装
  random-utils.js         # 随机字符串/数字工具
  providers/
    chatgpt-mail.js
    generator-email.js
    twenty-four-email.js
    twenty-four-email-domains.js
```

## 接入新 provider

1. 在 `src/providers/` 新增 provider 实现。
2. 在 `src/config.js` 增加该 provider 的配置和启用条件。
3. 在 `src/server.js` 的 `createProviders()` 中注册 provider。
4. 如果是 HTTP 型 provider，优先复用 `src/http-client.js`。

每个 provider 需要暴露：

- `name`
- `capabilities()`
- `createMailbox()`
- `listInbox({ mailboxId })`
- `getMail({ id })`

## 开发说明

当前 `package.json` 只提供 `start` 脚本，暂未配置 test、lint 或 build 脚本。
