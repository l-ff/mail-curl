# 多平台邮箱适配器服务框架

## 目标

这个服务对外暴露一套稳定 API，把不同邮箱平台的差异收敛到 provider 模块。

- 上游系统只关心统一动作：创建邮箱、读取收件箱、获取邮件详情
- 平台接入只需要实现统一 provider 接口，不需要改 HTTP API 约定
- 运行时根据配置启用 provider，通过路径第一层区分平台
- HTTP 型 provider 共享 `HttpClient` 的基础请求、超时和错误包装

## 当前结构

```text
src/
  index.js                    # re-export buildApp/startServer
  server.js                   # 配置加载、provider 注册、路由、鉴权、server 组装
  config.js                   # .env/.env.local 与运行时配置
  errors.js                   # 错误模型与 JSON 响应转换
  http-client.js              # fetch 封装、超时、上游错误包装
  random-utils.js             # 随机字符串/数字工具
  providers/
    chatgpt-mail.js           # chatgpt_mail provider
    twenty-four-email.js      # twenty_four_email provider
    twenty-four-email-domains.js
```

## 统一 API

- `POST /chatgpt_mail/api/remail?key=...`
- `GET /chatgpt_mail/api/inbox?key=...&mailbox_id=...`
- `GET /chatgpt_mail/api/mail?key=...&id=...`
- `GET /health`

`chatgpt_mail` 可以替换为任何已启用 provider 的名称。

## 核心流程

1. 根 `index.js` 调用 `src/index.js` 导出的 `startServer()`。
2. `src/server.js` 调用 `loadConfig()`，按配置注册 enabled providers。
3. Router 解析路径第一段作为 provider name，并对业务端点校验 `key` 查询参数。
4. Router 校验 `mailbox_id` / `id` 等必填参数后调用 provider。
5. `errors.js` 将应用错误统一转换为 JSON HTTP 响应。

## Provider 约定

每个平台暴露以下成员：

- `name`
- `capabilities()`
- `createMailbox() -> { id, email, provider }`
- `listInbox({ mailboxId }) -> Array<{ mail_id, sender_name, subject, received_at }>`
- `getMail({ id }) -> { id, subject, content, html, from, received_at }`

接入新平台时：

1. 在 `src/providers/` 新增 provider 实现
2. 在 `src/config.js` 增加该 provider 配置和启用条件
3. 在 `src/server.js` 的 `createProviders()` 中注册 provider
4. 如果是 HTTP 平台，优先复用 `HttpClient`

## 目前的接入状态

- `chatgpt_mail`: 已实现 HTTP API 接入
- `twenty_four_email`: 已实现地址生成、WebSocket 收件箱读取和 HTML 邮件详情解析

## Docker 运行

构建镜像：

```bash
docker build -t mail-curl .
```

推送镜像：

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t lff0/mail-curl:latest \
  --push \
  .
```

运行容器：

```bash
docker run --rm \
  -p 3100:3100 \
  --env-file .env \
  mail-curl
```

如果不使用 `--env-file`，至少需要显式传入：

- `MC_KEY`
- 对应 provider 的配置，例如 `CHATGPT_MAIL_API_KEY` 或 `TWENTY_FOUR_EMAIL_ENABLED=1`
