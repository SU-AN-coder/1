# 运营者配置指南

这份文档只回答一件事：`接下来最后需要做什么`。  
当前项目已经有一版可运行的 MVP 编排层骨架，但默认仍然使用内存存储，GitHub webhook 也还没有接真实的 GitHub App 鉴权和数据库持久化。

把运行环境和外部依赖准备好。等这些配置完成后，再把 PostgreSQL、Redis 和 GitHub App 接进来就会很顺。

## 当前状态

项目里已经具备：

- 任务状态机
- 契约门禁
- 契约变更级联阻塞
- P2P 协商 3 回合熔断
- GitHub webhook 冲突升级
- 仓储接口抽象，方便替换 PostgreSQL/Redis

目前还没有接入：

- PostgreSQL 持久化
- Redis 幂等/锁/队列
- GitHub App 认证与签名校验
- 生产环境配置

## 现在要做的事

按顺序完成下面 6 件事。

### 1. 确认部署方式

先决定这套服务准备跑在哪里：

- 一台内网 Linux/Windows 服务器
- Docker 容器
- Kubernetes

MVP 阶段建议先用 `单机 + Docker Compose` 或 `单机直接运行 Node.js`，最省事。

你需要确认：

- 服务运行机器 IP 或域名
- 是否走 HTTPS
- 是否允许 GitHub Enterprise webhook 访问到这台机器

### 2. 准备 PostgreSQL

项目下一步会把仓储接口接到 PostgreSQL，所以你现在先把数据库准备好。

建议你创建：

- 一个数据库，例如 `multi_agent_platform`
- 一个专用账号，例如 `platform_app`
- 一个专用密码

你需要记住这些信息：

- `POSTGRES_HOST`
- `POSTGRES_PORT`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_SSLMODE`

建议：

- 非本机环境默认开启网络访问白名单
- 至少准备一个独立 schema，例如 `platform`
- 不要直接用超级管理员账号连接应用

### 3. 准备 Redis

Redis 后面主要会用于：

- webhook 幂等键
- 分布式锁
- 短期消息/协商状态
- 超时控制

你需要准备：

- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_PASSWORD`
- `REDIS_DB`
- 是否启用 TLS

MVP 阶段单实例 Redis 就够了。

### 4. 创建 GitHub App

这是你最关键的一步。  
因为后面平台要通过 GitHub App 去接 webhook、读 PR、写 Review、查 Check-run。

你需要在 GitHub Enterprise 上创建一个 App，并记录以下信息：

- `GITHUB_ENTERPRISE_BASE_URL`
- `GITHUB_APP_ID`
- `GITHUB_APP_CLIENT_ID`
- `GITHUB_APP_CLIENT_SECRET`
- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_PRIVATE_KEY`
- 安装到哪些 Organization / Repository

建议的 GitHub App 权限：

- Repository contents: `Read and write`
- Pull requests: `Read and write`
- Issues: `Read-only` 或 `Read and write`
- Commit statuses: `Read and write`
- Checks: `Read and write`
- Metadata: `Read-only`
- Webhooks: 开启

建议订阅的 webhook 事件：

- `pull_request`
- `pull_request_review`
- `pull_request_review_comment`
- `check_run`
- `check_suite`
- `push`

注意：

- webhook URL 暂时先预留成未来服务地址，例如 `/webhooks/github`
- private key 建议保存为单独文件，不要直接硬编码进代码仓库

### 5. 确认组织级协作规则

在接真实 GitHub 之前，你最好先把团队规则定死，不然系统接好了也会乱。

需要确认：

- 哪些仓库纳入平台管理
- 哪些人可以作为 `Human Approver`
- 契约 PR 是否必须双签
- 高风险 PR 是否必须人工合并
- 哪些分支允许合并
- 是否开启分支保护

建议在 GitHub Enterprise 中配置：

- 默认保护主分支
- 禁止直接 push 主分支
- 必须通过 PR 合并
- 必须通过状态检查后才允许合并

### 6. 整理环境变量

现在可以先把下面这些变量整理出来，等下一步代码接入时直接填。

```env
NODE_ENV=development
APP_HOST=0.0.0.0
APP_PORT=3000
APP_BASE_URL=http://localhost:3000

POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_DB=multi_agent_platform
POSTGRES_USER=platform_app
POSTGRES_PASSWORD=replace_me
POSTGRES_SSLMODE=disable

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_TLS=false

GITHUB_ENTERPRISE_BASE_URL=https://github.example.com
GITHUB_APP_ID=
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
GITHUB_WEBHOOK_SECRET=
GITHUB_PRIVATE_KEY_PATH=
GITHUB_ALLOWED_ORGS=
```

## 你做完后需要交给我的信息

等配置完成后，下一轮直接把下面信息告诉我，我就可以继续把真实基础设施接进去：

### PostgreSQL

- 连接方式
- 数据库名
- 用户名
- 是否启用 SSL

### Redis

- 连接方式
- 是否有密码
- 是否启用 TLS

### GitHub Enterprise

- Base URL
- GitHub App ID
- Webhook Secret
- Private Key 文件路径放在哪里
- App 安装到了哪些 repo/org

### 运行方式

- 你准备本地跑、服务器跑，还是 Docker 跑
- webhook 最终回调地址是什么

## 推荐执行顺序

建议你按这个顺序做：

1. 先把 PostgreSQL 和 Redis 准备好
2. 再创建 GitHub App
3. 再决定部署机器和域名
4. 最后把环境变量整理出来

这样下一步我就能直接开始做：

- PostgreSQL 仓储实现
- Redis 幂等和锁实现
- GitHub App 签名校验与鉴权
- `.env` 加载
- Docker Compose 或部署脚本

## 代码里后面会用到的接入点

这些文件就是下一步接基础设施的主要入口：

- `src/repositories.ts`
- `src/platform.ts`
- `src/app.ts`

如果只是做配置，不需要修改这些文件。

## 完成标准

当你满足下面 4 条时，就可以回来找我继续：

- PostgreSQL 可连接
- Redis 可连接
- GitHub App 已创建并安装到目标仓库
- 上面的环境变量你已经整理齐

做到这里，你的状态就是：`可以开始真实接入`
