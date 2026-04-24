# 多平台邮箱适配器服务框架

## 目标

这个服务对外暴露一套稳定 API，把不同邮箱平台的差异收敛到 provider 层。

- 上游系统只关心统一动作：创建邮箱、读取收件箱、获取邮件详情
- 平台接入只需要实现统一接口，不需要改 HTTP 层
- 运行时通过注册中心选择 provider，通过路径第一层区分平台
- HTTP 型 provider 共享一套请求客户端、超时控制和错误包装

## 当前分层

```text
src/
  app/                  # 启动与 server 组装
  application/          # 用例编排、provider 选择、参数校验
  config/               # 环境变量加载
  core/                 # 通用错误模型、HTTP 客户端
  http/                 # 路由、鉴权、HTTP 响应转换
  providers/
    base/               # provider 抽象接口和 HTTP 基类
    chatgpt-mail/       # 已实现 provider
    twenty-four-email/  # 24.email 接入骨架
```

## 统一 API

- `POST /chatgpt_mail/api/remail?key=...`
- `GET /chatgpt_mail/api/inbox?key=...&mailbox_id=...`
- `GET /chatgpt_mail/api/mail?key=...&id=...`
- `GET /health`

## Provider 约定

每个平台实现以下 3 个方法：

- `createMailbox() -> { id, email, provider }`
- `listInbox({ mailboxId }) -> Array<{ mail_id, sender_name, subject, received_at }>`
- `getMail({ id }) -> { id, subject, content, html, from, received_at }`

接入新平台时：

1. 在 `src/providers/<provider-name>/` 新增 provider 实现
2. 在 `src/providers/provider-definitions.js` 注册定义
3. 在 `src/config/env.js` 增加该 provider 配置
4. 如果是 HTTP 平台，优先复用 `HttpEmailProvider`

## 目前的接入状态

- `chatgpt_mail`: 已实现
- `twenty_four_email`: 已建立框架和配置位，待补实际页面/API 解析逻辑

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
  mail-adapter-service
```

如果不使用 `--env-file`，至少需要显式传入：

- `MC_KEY`
- 对应 provider 的配置，例如 `CHATGPT_MAIL_API_KEY`
