# 阿里云部署 + 钉钉 Stream 机器人（MVP）

本文说明如何把当前仓库的 **Qwen 任务拆解 Demo** 以常驻进程跑在阿里云上，并通过钉钉 **Stream 模式机器人** 接收群聊/单聊文本并回复拆解稿。

## 架构说明

- **钉钉 Stream**：业务进程主动连接钉钉网关（WebSocket），**不需要**向公网暴露「回调域名」或解密 HTTP 回调包体，适合单机 ECS / 容器。
- **Qwen（DashScope）**：进程访问 `https://dashscope.aliyuncs.com/compatible-mode/v1`，须允许 **出站 HTTPS**。
- **健康检查**：可选开启 `HEALTH_CHECK_PORT`，对外提供 `GET /health`，便于负载均衡或编排探活（钉钉链路不依赖该端口）。
- **审计（双轨）**：
  - **钉钉主链路**：调用 `runOrchestrator`，stdout 输出 `orchestrator_done` 等结构化事件；有草案时写 `./data/plans/<traceId>.json` 快照，并可写 embedding 索引。
  - **Demo/评测链路**：`createTaskPlanningDemo` 仍写 **`AUDIT_DEMO_JSONL_PATH`**（默认 `./data/demo-runs.jsonl`），用于 CLI 回归与离线评测。
  - **Harness 编排层**：`createHarness` 可选 `AUDIT_SINK=file` + `AUDIT_JSONL_PATH`，与上者独立。
- **会话与限流**：首版为 **单实例进程内** `Map` + TTL；多副本需后续外置存储（如 Redis），参见 `AGENTS.md`。
- **用户可见回复**：钉钉链路单次返回一条 Markdown（草案/追问/错误），并在有 `draft` 时自动补充“结构化字段任务表”。`ASSIGNMENT_PHASE_ENABLED=1` 时，会在同一条回复中追加“分配建议”表（推荐成功时）。
- **Web 工作台**：启用 `HEALTH_CHECK_PORT` 后，同一 HTTP 服务会提供 `/health`、签名工作台页面 `/workbench/*` 与 `/api/*` JSON 接口；所有工作台入口均依赖 `ASSIGNMENT_WEB_SECRET` 签名 token。

## 一、钉钉开放平台配置

1. 使用管理员账号登录 [钉钉开放平台](https://open.dingtalk.com)，创建 **企业内部应用**。
2. 记录 **Client ID（原 AppKey）**、**Client Secret（原 AppSecret）**，对应环境变量：`DINGTALK_CLIENT_ID`、`DINGTALK_CLIENT_SECRET`。
3. 在应用内添加能力：**机器人**，接入方式选择 **Stream 模式**，填写机器人名称与图标后 **发布版本**。
4. 在组织架构中为该企业应用 **开通可见范围 / 安装**，并把机器人拉进需要使用的内部群（或以单聊方式测试）。

官方教程索引：[Stream 模式说明](https://opensource.dingtalk.com/developerpedia/docs/learn/stream/overview)。

## 二、阿里云 ECS（推荐最小路径）

1. 你已购买 ECS 后，在控制台确认：**分配公网 IP**（或通过跳板访问），并能用 **SSH** 登录（密钥对或密码）。
2. **安全组**（很重要）：
   - **出站**：默认放行即可（需能访问公网 `HTTPS 443`，否则连不上钉钉与 DashScope）。
   - **入站**： SSH `22` 仅对你办公网或跳板机 IP 放行；若启用下文 `HEALTH_CHECK_PORT`，再按需放行对应 TCP 端口（例如 `8080`）。
   - **工作台入站**：若启用 Web 工作台，需对可信来源放行 `HEALTH_CHECK_PORT` 对应 TCP 入站，供发起人/承接人通过签名 URL 访问页面与 JSON API。
3. 云上常驻进程对应本仓库命令 **`npm run dingtalk-bot`**（容器内等价命令见 Dockerfile）。需要同时备好 **DashScope Key** 与 **钉钉 Stream 机器人** 的应用凭证（见第一节）；缺一不可时进程会启动失败。

### 2.1 实操：SSH 登录

Windows 可用 PowerShell：

```powershell
ssh root@你的ECS公网IP
```

（若使用 `ecs-user` / `ubuntu` 等账号，把 `root` 换成控制台提示的用户名。）

### 2.2 实操：安装 Docker

**Alibaba Cloud Linux 3**（常见）：

```bash
sudo dnf install -y docker
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

执行完 `usermod` 后需 **重新登录 SSH**，再试 `docker ps`。若提示无权限，本轮可先用 `sudo docker …`。

**Ubuntu 22.04**（官方一键脚本，简单可靠）：

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

### 2.3 实操：把代码放到服务器上

任选其一。

**方式 A：`git clone`（代码已在 Git 托管）**

```bash
sudo dnf install -y git   # 或 Ubuntu: sudo apt-get install -y git
cd /opt
sudo git clone https://github.com/你的组织/manage_robot.git
sudo chown -R $USER:$USER manage_robot
cd manage_robot
```

若仓库为 **GitHub 私有仓库**，无交互 `git clone` 会报 `could not read Username`。任选其一：

- 在本机执行：`.\scripts\ecs-login-clone.ps1 -PublicIp ... -PemPath ... -GitHubPat "你的PAT"`（PAT 须具备该仓库 **Contents: Read**；脚本不会回显 token）。
- 或先在 GitHub 将仓库改为 **Public**（试点阶段），再裸 `git clone`。
- 或在 ECS 上配置 [Deploy keys](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys) / SSH clone（需在脚本外自备密钥）。

**方式 B：本机打包上传（适合暂未推送远端仓库）**

在你自己的电脑项目根目录打包（排除 `node_modules`）：

```powershell
# Windows PowerShell，在 D:\manage_robot 下执行
Compress-Archive -Path src,package.json,package-lock.json,tsconfig.json,Dockerfile,.dockerignore -DestinationPath manage_robot-deploy.zip
```

用 **阿里云控制台「Workbench」上传**，或 `scp`：

```powershell
scp manage_robot-deploy.zip root@你的ECS公网IP:/opt/
```

到 ECS 上：

```bash
sudo mkdir -p /opt/manage_robot && sudo unzip /opt/manage_robot-deploy.zip -d /opt/manage_robot
sudo chown -R $USER:$USER /opt/manage_robot
cd /opt/manage_robot
```

若压缩包里没有 Dockerfile，请从仓库再拷贝一份 `Dockerfile`、`.dockerignore` 到同一目录。

### 2.4 实操：构建镜像并后台运行

在 **`Dockerfile` 所在目录**（即项目根目录）执行：

```bash
docker build -t manage-robot:dingtalk .
docker run -d --name manage-robot-dingtalk --restart unless-stopped \
  -e QWEN_API_KEY="你的DashScopeKey" \
  -e DINGTALK_CLIENT_ID="钉钉ClientID" \
  -e DINGTALK_CLIENT_SECRET="钉钉ClientSecret" \
  -e HEALTH_CHECK_PORT=8080 \
  -p 8080:8080 \
  manage-robot:dingtalk
```

密钥也可改用编排平台的「密钥管理」注入，**不要**写入镜像层或提交到 Git。

当前试点 ECS 也可使用 root-only 环境文件承载密钥（文件权限 `600`，不进入 Git、不进入镜像）：

```bash
sudo install -m 600 /dev/null /etc/manage-robot.env
sudo sh -c 'cat > /etc/manage-robot.env' <<'EOF'
QWEN_API_KEY=你的DashScopeKey
QWEN_MODEL=qwen3.6-plus
QWEN_TIMEOUT_MS=60000
QWEN_MAX_RETRIES=0
DINGTALK_CLIENT_ID=钉钉ClientID
DINGTALK_CLIENT_SECRET=钉钉ClientSecret
HEALTH_CHECK_PORT=8080
ASSIGNMENT_PHASE_ENABLED=1
ASSIGNMENT_WEB_SECRET=替换为至少32字符随机密钥
ASSIGNMENT_WEB_PUBLIC_BASE_URL=http://你的ECS公网IP:8080
WORKBENCH_SESSION_DIR=./data/sessions
EOF

docker run -d --name manage-robot-dingtalk --restart unless-stopped \
  --env-file /etc/manage-robot.env \
  -p 8080:8080 \
  manage-robot:dingtalk
```

**务必确认** `/etc/manage-robot.env` 中同时包含 **`QWEN_API_KEY`** 与 **`DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET`**。仅配 Qwen、不配钉钉时，进程会反复报错退出（与本地行为一致）。

如需在容器重启后仍保留 **demo 审计 JSONL、Plan 快照** 等文件，可增加数据卷挂载，例如（路径可按主机调整）：

```bash
docker run -d --name manage-robot-dingtalk --restart unless-stopped \
  --env-file /etc/manage-robot.env \
  -v /opt/manage_robot-data:/app/data \
  -p 8080:8080 \
  manage-robot:dingtalk
```

镜像 `WORKDIR` 为 `/app`。镜像内附带 **`/app/AGENTS.md`** 与 **`/app/docs/`**（与构建时提交一致），便于 `docker exec` 查阅。仓库默认将 `./data/demo-runs.jsonl`、`./data/plans/*.json` 写入工作目录下 `data/`（未挂载则随容器重置而丢失）。

### 2.5 实操：确认是否在跑

```bash
docker ps
docker logs -f manage-robot-dingtalk
```

看到类似 **「Stream 已连接」** 且无反复报错即正常。在钉钉里对该机器人发一条 **纯文本** 任务描述，应收到 markdown 回复（首次模型较慢属正常）。

### 2.6 更新版本（重新部署）

```bash
cd /opt/manage_robot
git pull
docker stop manage-robot-dingtalk && docker rm manage-robot-dingtalk
docker build -t manage-robot:dingtalk .
docker run -d --name manage-robot-dingtalk --restart unless-stopped \
  -e QWEN_API_KEY="你的DashScopeKey" \
  -e DINGTALK_CLIENT_ID="钉钉ClientID" \
  -e DINGTALK_CLIENT_SECRET="钉钉ClientSecret" \
  -e HEALTH_CHECK_PORT=8080 \
  -p 8080:8080 \
  manage-robot:dingtalk
```

推荐使用 **`--env-file /etc/manage-robot.env`** 的等价写法，便于与文档 2.4 对齐并避免冗长 `-e`。

### 2.7 Windows 一键拉代码并重建容器（本机脚本）

在项目根目录（已配置 SSH 密钥、ECS 已有 `/opt/manage_robot` 与 `/etc/manage-robot.env` 时）：

```powershell
.\scripts\ecs-deploy-dingtalk.ps1 -PublicIp 你的ECS公网IP -PemPath "$env:USERPROFILE\Downloads\你的密钥.pem"
```

可选参数：`-RepoDir`、`-EnvFile`、`-PublishPort`（默认 `8080`）。等价于远端 `git pull --ff-only` → `docker build` → 用 env-file **重建** `manage-robot-dingtalk` 容器。

### 2.8 暂不配钉钉，只想在云上验证 Qwen

当前常驻镜像入口是 **`npm run dingtalk-bot`**，没有钉钉凭证时进程会退出。若仅验证模型与网络，可在 ECS 上临时进入一次性容器（不配钉钉变量会失败，故改用 **`demo`**）：

```bash
docker run --rm -e QWEN_API_KEY="你的DashScopeKey" manage-robot:dingtalk \
  npx tsx src/demo.ts
```

（需基于已构建的同一镜像；该命令打印一次示例拆解后退出，用于连通性抽查。）

运行多场景冒烟：

```bash
docker run --rm --env-file /etc/manage-robot.env manage-robot:dingtalk \
  npx tsx scripts/run-qwen-scenarios.ts
```

## 三、进程内配置一览

完整变量说明见仓库根目录 **`.env.example`**。云上常驻（钉钉 Bot）至少需要：

| 变量 | 必填 | 说明 |
|------|------|------|
| `QWEN_API_KEY` | 是 | DashScope Compatible API Key |
| `DINGTALK_CLIENT_ID` | 是 | 钉钉应用 Client ID |
| `DINGTALK_CLIENT_SECRET` | 是 | 钉钉应用 Client Secret |
| `QWEN_*` | 否 | 模型、超时、重试等；**SSE 流式默认开**（`QWEN_STREAM=0` 关闭），见 `docs/Qwen-接入实施说明.md` |
| `DEMO_DOMAIN_HINT` | 否 | `QUALITY` 或 `RD`，默认由模型判断 |
| `DEMO_LLM_CORRECTION` | 否 | 默认开；`0`/`false`/`no` 关闭校验失败后的第二轮模型自纠正（更快，失败率可能升），见 `docs/Qwen-接入实施说明.md` |
| `SESSION_DIGEST_MAX_CHARS` | 否 | 钉钉多轮时上轮摘要最大字符（默认 `2000`，范围 `200`–`8000`） |
| `HEALTH_CHECK_PORT` | 否 | 监听 HTTP `/health`，并承载 `/workbench/*` 页面与 `/api/*` JSON 接口 |
| `DINGTALK_STREAM_DEBUG` | 否 | `1` / `true` 打印 Stream SDK 调试日志 |
| `DINGTALK_QWEN_THINKING` | 否 | 钉钉主链路默认关闭 thinking；设 `1` 开启 |
| `DINGTALK_QWEN_MAX_TOKENS` | 否 | 钉钉主链路最大输出 token，默认 `2200` |
| `DINGTALK_ORCHESTRATOR_MAX_ITERATIONS` | 否 | 钉钉 ReAct 编排最大工具轮数，默认 `6` |
| `DINGTALK_ASSIGNMENT_MAX_ITERATIONS` | 否 | 指派推荐最大工具轮数，默认 `3` |
| `DINGTALK_APPEND_STRUCTURED_TABLE` | 否 | `1` 时在模型正文未含任务表时追加结构化任务表 |

**Demo 管线 / 运维（节选）**

| 变量 | 必填 | 说明 |
|------|------|------|
| `AUDIT_DEMO_JSONL_PATH` | 否 | Demo 完结一行 JSONL 路径（默认 `./data/demo-runs.jsonl`） |
| `AUDIT_DEMO_DISABLED` | 否 | `1` 禁用 Demo JSONL |
| `AUDIT_SINK` | 否 | Harness：`memory`（默认）或 `file` |
| `AUDIT_JSONL_PATH` | 否 | `AUDIT_SINK=file` 时的 Harness 审计路径 |
| `INPUT_MAX_CHARS` | 否 | 历史变量；当前 `dingtalk-bot` 主链路不再用它阻断模型调用（仅保留在 demo/pipeline 相关资料中） |
| `CHAT_SESSION_TTL_MS` | 否 | 钉钉会话 TTL（毫秒） |
| `RATE_LIMIT_WINDOW_MS` | 否 | 同会话最短间隔窗口（毫秒） |
| `PLAN_STORE_DIR` | 否 | `DRAFT_READY` 快照目录 |
| `PLAN_SNAPSHOT_DISABLED` | 否 | `1` 禁用快照 |
| `CONTENT_FILTER_DISABLED` | 否 | `1` 关闭 Markdown 侧 PII 脱敏 |
| `ASSIGNMENT_PHASE_ENABLED` | 否 | `1` 开启指派阶段（v0.2 MVP）；见 `AGENTS.md` |
| `ASSIGNMENT_WEB_PORT` | 否 | 历史/兼容配置；当前钉钉常驻进程的工作台 HTTP 服务随 `HEALTH_CHECK_PORT` 启动 |
| `ASSIGNMENT_WEB_PUBLIC_BASE_URL` | 否 | 工作台公网地址（例如 `http://你的ECS公网IP:8080`，需与实际暴露端口一致） |
| `ASSIGNMENT_WEB_SECRET` | 否 | 指派工作台 URL 的 HMAC-SHA256 签名密钥（防止篡改） |
| `WORKBENCH_SESSION_DIR` | 否 | 工作台读取和更新的会话目录；默认复用 Plan session 存储目录 |
| `DINGTALK_ASSIGNMENT_MOCK` | 否 | `1` 使用 mock 钉钉交互卡片（无需真实卡片回调） |

单测默认会设置 `*_DISABLED`，避免写入仓库外路径；与本节生产配置无关。

### 3.1 Web 工作台页面

所有页面都需要签名 token，支持 `?token=...` 或 `?access_token=...`。token 由 `ASSIGNMENT_WEB_SECRET` 做 HMAC-SHA256 签名，包含 `planId`、`userId`、`role` 和过期时间；`employee` 角色不能访问主管工作台。

| 路径 | 说明 |
|------|------|
| `GET /assignment/workbench?token=...` | v0.2 兼容入口，展示签名 token 对应的规划、用户与角色 |
| `GET /workbench/manager?token=...` | 主管分配与追踪中心，展示任务筛选和任务列表 |
| `GET /workbench/employee?token=...` | 员工个人任务页，展示承接人可见的待处理子任务 |
| `GET /workbench/conversation?token=...` | 任务对话中心，支持“开启新任务”和“编辑进行中任务”两个入口 |
| `GET /workbench/in-progress?token=...` | 进行中任务页，展示当前用户可见的会话队列 |

### 3.2 Web 工作台 JSON API

JSON API 同样通过查询参数 token 鉴权，返回 `application/json`。生产环境建议把工作台端口放在 HTTPS 反向代理之后，并限制安全组来源。

| 接口 | 说明 |
|------|------|
| `GET /api/me?token=...` | 返回当前 token 解析出的 `planId`、`userId`、`role` |
| `GET /api/tasks?token=...&keyword=&stage=&ownerUserId=` | 返回角色可见的任务摘要；主管可筛选，员工仅看到自己承接的任务 |
| `GET /api/tasks/:taskId?token=...` | 返回单个任务详情、子任务进度、最新草案与指派信息 |
| `GET /api/in-progress-sessions?token=...` | 返回当前用户可见的进行中会话列表 |
| `POST /api/conversations/new-task?token=...` | 创建工作台新任务会话；JSON body：`{ "conversationId"?: string, "message": string }` |
| `POST /api/conversations/:id/messages?token=...` | 向已有会话追加消息并记录审计事件；JSON body：`{ "message": string }` |
| `POST /api/conversations/:id/apply?token=...` | 记录会话修订应用事件；JSON body：`{ "note"?: string, "revision"?: object }` |
| `PATCH /api/subtasks/:subTaskId/progress?token=...` | 更新子任务进度；JSON body：`{ "status": "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE", "note"?: string }` |

本地直连调试：

```bash
npm install
npm run dingtalk-bot
```

## 四、运维与注意事项

- **延迟优化**：主耗时在 DashScope；可在 `/etc/manage-robot.env` 调整 `QWEN_MODEL`、`QWEN_MAX_TOKENS`、`QWEN_MAX_RETRIES`，以及 `DEMO_LLM_CORRECTION` / `SESSION_DIGEST_MAX_CHARS`（见 **`docs/Qwen-接入实施说明.md`** 末节）。
- **首token延迟**：单次拆解依赖大模型，可能数十秒；钉钉 Stream 侧若长时间未 `socketCallBackResponse` 可能触发重试，请勿对同一消息高频重复触发。
- **回复长度**：机器人 reply 使用 Markdown，超长内容会在服务端截断并标注（见 `src/dingtalk-bot.ts` 常量）。
- **合规**：CAPA 等字段仍为建议性质，与 PRD v1.3 一致；正式记录以公司 QMS 为准。
- **同会话限速**：短时内重复发问可能收到「请稍后再试」（`RATE_LIMIT_WINDOW_MS`）。
- **可观测**：容器标准输出可见结构化事件（如 `orchestrator_done`、assignment 相关事件）；钉钉主链路建议重点看容器日志 + `data/plans` 快照。`createTaskPlanningDemo` 的 JSONL 审计（`demo-runs.jsonl`）主要用于 CLI demo/eval 回归。

## 五、后续可选增强

- **指派工作台 HTTPS**（可选）：`ASSIGNMENT_WEB_PORT` 默认仅提供 HTTP。若需 HTTPS，可在 ECS 前加一层反向代理（如 Nginx / Caddy）做 TLS 终止，将 443 转发到本地 `8787`。此时 `ASSIGNMENT_WEB_PUBLIC_BASE_URL` 应设为 `https://你的域名`。反向代理示例（Caddy）：`caddy reverse-proxy --from 你的域名 --to :8787`，Caddy 会自动申请 Let's Encrypt 证书。
- **函数计算 FC**：若改为 HTTP 回调型机器人，可使用 FC HTTP 触发器；当前代码路径为 **Stream**，迁移需改用开放平台 HTTP 加解密回调。
- **高可用**：多实例部署需注意钉钉 Stream 连接模型与机器人会话幂等；试点阶段建议 **单实例**。
- **集中式审计 / 网关限流**：进程内已实现 Demo JSONL、Harness 可选 FileSink 及会话限速；若要跨实例报表或网关级配额，可再接入集中日志或 API 网关。
