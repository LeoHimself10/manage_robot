# 阿里云部署 + 钉钉 Stream 机器人（MVP）

本文说明如何把当前仓库的 **Qwen 任务拆解 Demo** 以常驻进程跑在阿里云上，并通过钉钉 **Stream 模式机器人** 接收群聊/单聊文本并回复拆解稿。

## 架构说明

- **钉钉 Stream**：业务进程主动连接钉钉网关（WebSocket），**不需要**向公网暴露「回调域名」或解密 HTTP 回调包体，适合单机 ECS / 容器。
- **Qwen（DashScope）**：进程访问 `https://dashscope.aliyuncs.com/compatible-mode/v1`，须允许 **出站 HTTPS**。
- **健康检查**：可选开启 `HEALTH_CHECK_PORT`，对外提供 `GET /health`，便于负载均衡或编排探活（钉钉链路不依赖该端口）。
- **审计（双轨）**：
  - **Demo / 钉钉链路**：只调用 `createTaskPlanningDemo`，完结时追加 **`AUDIT_DEMO_JSONL_PATH`**（默认 `./data/demo-runs.jsonl`），字段含 `traceId`、`status`、`reason?`、`gatePassed?`、`tokenTotals?` 等；现网排障建议挂载或收集该文件。
  - **Harness 编排层**：`createHarness` 可选 `AUDIT_SINK=file` + `AUDIT_JSONL_PATH`，与上者独立。
- **会话与限流**：首版为 **单实例进程内** `Map` + TTL；多副本需后续外置存储（如 Redis），参见 `AGENTS.md`。

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

镜像 `WORKDIR` 为 `/app`；仓库默认将 `./data/demo-runs.jsonl`、`./data/plans/*.json` 写入工作目录下 `data/`（未挂载则随容器重置而丢失）。

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

### 2.7 暂不配钉钉，只想在云上验证 Qwen

当前常驻服务是 **钉钉 Stream 机器人**，没有钉钉凭证时容器会退出。若仅验证模型与网络，可在 ECS 上临时进入一次性容器（不配钉钉变量会失败，故改用 **`demo`**）：

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
| `QWEN_*` | 否 | 模型、超时、重试等；**Qwen 规划请求代码侧固定非流式**，见 `docs/Qwen-接入实施说明.md` |
| `DEMO_DOMAIN_HINT` | 否 | `QUALITY` 或 `RD`，默认由模型判断 |
| `HEALTH_CHECK_PORT` | 否 | 监听 HTTP `/health` |
| `DINGTALK_STREAM_DEBUG` | 否 | `1` / `true` 打印 Stream SDK 调试日志 |
| `DINGTALK_QUICK_ACK` | 否 | 默认开启：任务规划前先发一条「处理中」提示；`0`/`false` 关闭（仍非 token 流式） |

**Demo 管线 / 运维（节选）**

| 变量 | 必填 | 说明 |
|------|------|------|
| `AUDIT_DEMO_JSONL_PATH` | 否 | Demo 完结一行 JSONL 路径（默认 `./data/demo-runs.jsonl`） |
| `AUDIT_DEMO_DISABLED` | 否 | `1` 禁用 Demo JSONL |
| `AUDIT_SINK` | 否 | Harness：`memory`（默认）或 `file` |
| `AUDIT_JSONL_PATH` | 否 | `AUDIT_SINK=file` 时的 Harness 审计路径 |
| `INPUT_MAX_CHARS` | 否 | 单次输入最大字符（超限则追问，不切静默），默认见 `.env.example` |
| `CHAT_SESSION_TTL_MS` | 否 | 钉钉会话 TTL（毫秒） |
| `RATE_LIMIT_WINDOW_MS` | 否 | 同会话最短间隔窗口（毫秒） |
| `PLAN_STORE_DIR` | 否 | `DRAFT_READY` 快照目录 |
| `PLAN_SNAPSHOT_DISABLED` | 否 | `1` 禁用快照 |
| `CONTENT_FILTER_DISABLED` | 否 | `1` 关闭 Markdown 侧 PII 脱敏 |

单测默认会设置 `*_DISABLED`，避免写入仓库外路径；与本节生产配置无关。

本地直连调试：

```bash
npm install
npm run dingtalk-bot
```

## 四、运维与注意事项

- **首token延迟**：单次拆解依赖大模型，可能数十秒；钉钉 Stream 侧若长时间未 `socketCallBackResponse` 可能触发重试，请勿对同一消息高频重复触发。
- **回复长度**：机器人 reply 使用 Markdown，超长内容会在服务端截断并标注（见 `src/dingtalk-bot.ts` 常量）。
- **合规**：CAPA 等字段仍为建议性质，与 PRD v1.3 一致；正式记录以公司 QMS 为准。
- **同会话限速**：短时内重复发问可能收到「请稍后再试」（`RATE_LIMIT_WINDOW_MS`）。
- **可观测**：容器标准输出可见结构化事件；按需 `tail -f data/demo-runs.jsonl`（若已挂载卷）。

## 五、后续可选增强

- **函数计算 FC**：若改为 HTTP 回调型机器人，可使用 FC HTTP 触发器；当前代码路径为 **Stream**，迁移需改用开放平台 HTTP 加解密回调。
- **高可用**：多实例部署需注意钉钉 Stream 连接模型与机器人会话幂等；试点阶段建议 **单实例**。
- **集中式审计 / 网关限流**：进程内已实现 Demo JSONL、Harness 可选 FileSink 及会话限速；若要跨实例报表或网关级配额，可再接入集中日志或 API 网关。
