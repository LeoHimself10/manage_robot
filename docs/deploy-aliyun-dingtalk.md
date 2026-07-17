# 阿里云部署 + 钉钉 Stream 机器人（MVP）

本文说明如何把当前仓库的 **钉钉任务规划机器人**（任务拆解、指派预览、工作台、催办与进展推送）以常驻进程跑在阿里云上，并通过钉钉 **Stream 模式机器人** 接收群聊/单聊文本并回复。

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
- **公网访问（试点）**：浏览器 → **Caddy**（`manage-robot-caddy`）→ 反代业务容器。组织 A：`https://managebot.vivolightsales.com` → **`127.0.0.1:8080`** → `manage-robot-dingtalk`；组织 B（明思）：`https://mingsibot.vivolightsales.com` → **`127.0.0.1:8081`** → `manage-robot-mingsibot`。Caddy 与 bot 容器独立；**bot 挂掉时 Caddy 仍在，站点会 404/连不上**，但 **各实例 `/opt/manage_robot*/data` 挂载卷与任务库不受影响**。

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
   - **指派工作台入站**：若启用 `ASSIGNMENT_PHASE_ENABLED=1`，需放行 **`ASSIGNMENT_WEB_PORT`**（默认 `8787`）TCP 入站，供发起人通过签名 URL 访问工作台。
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
# 工作台网页应用（/workbench）：前端会先请求后端 GET /api/workbench/auth/jsapi-config 做 dd.config（需 corpId + AgentId）；
# 再 getAuthCode；仍失败时可取消下行注释注入 corpId 兜底。
# DINGTALK_CORP_ID=dingxxxxxxxxxxxxxxxx
# DINGTALK_AGENT_ID=开放平台微应用 AgentId（数字）
HEALTH_CHECK_PORT=8080
EOF

docker run -d --name manage-robot-dingtalk --restart unless-stopped \
  --env-file /etc/manage-robot.env \
  -p 8080:8080 \
  manage-robot:dingtalk
```

**务必确认** `/etc/manage-robot.env` 中同时包含 **`QWEN_API_KEY`** 与 **`DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET`**。仅配 Qwen、不配钉钉时，进程会反复报错退出（与本地行为一致）。工作台在钉钉内打开时，前端脚本（镜像构建 `npm run build:workbench-login` → `/app/dist/workbench-dd-login.js`）会先拉取 **`/api/workbench/auth/jsapi-config`**，用返回的 **`corpId`、`agentId`、签名** 调用 **`dd.config`**，再 **`getAuthCode`**。为此请在环境中配置 **`DINGTALK_CORP_ID`**（企业 CorpId）与 **`DINGTALK_AGENT_ID`**（开放平台微应用 **AgentId**，非 ClientId）；缺任一项时接口会返回错误提示。开放平台还需为应用开通 **JSAPI** / **免登** 等相关权限，并将 **应用首页 URL** 与实际打开的页面域名路径对齐（签名按当前页 URL 计算）。

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

**推荐**：本机执行 `scripts/ecs-deploy-dingtalk.ps1`（见 2.7），顺序已优化为 **先 build、再 swap**。

若必须手工在 ECS 上操作，**不要**先 `stop/rm` 再 `build`（会在 build 数分钟内完全断服）。应：

```bash
cd /opt/manage_robot
git pull --ff-only
docker build -t manage-robot:dingtalk .    # ① 旧容器仍在服务
docker stop manage-robot-dingtalk && docker rm manage-robot-dingtalk   # ② 仅 build 成功后 swap
docker run -d --name manage-robot-dingtalk --restart unless-stopped \
  --env-file /etc/manage-robot.env \
  -v /opt/manage_robot/data:/app/data \
  -p 8080:8080 \
  manage-robot:dingtalk
curl -sf http://127.0.0.1:8080/health    # ③ 必须 ok
```

密钥也可改用 **`--env-file /etc/manage-robot.env`**，与 2.4 对齐。

### 2.7 Windows 一键拉代码并重建容器（本机脚本）

在项目根目录（已配置 SSH 密钥、ECS 已有 `/opt/manage_robot` 与 `/etc/manage-robot.env` 时）：

```powershell
.\scripts\ecs-deploy-dingtalk.ps1 -PublicIp 你的ECS公网IP -PemPath "$env:USERPROFILE\Downloads\你的密钥.pem"
```

可选参数：`-RepoDir`、`-EnvFile`、`-PublishPort`（默认 `8080`）。

远端顺序（`ecs-deploy-dingtalk.ps1`，2026-05-25 起）：

1. `git pull --ff-only`
2. **`docker build`**（此阶段 **旧容器仍在服务**）
3. `docker stop` / `docker rm`
4. `docker run -d …`
5. 轮询 **`curl http://127.0.0.1:8080/health`** 直至 `ok`

脚本含 **`trap`**：若在 `run` 失败且容器不在跑，会尝试用已有镜像 **`manage-robot:dingtalk`** 做一次 recovery run。SSH 使用 `ServerAliveInterval` 降低长 build 期间静默断连概率。

#### 部署后必查（每次都要做）

```bash
docker ps --filter name=manage-robot-dingtalk   # 必须为 Up
curl -sf http://127.0.0.1:8080/health          # 必须返回 ok
# 若有 Caddy 反代，再验公网域名
curl -sf https://managebot.vivolightsales.com/health
```

**只有脚本/命令打印 `health ok` 或上述 curl 成功，才算部署完成。** 不要只看本地 PowerShell 是否打印 `Done.`——SSH 中途断开时，本地也可能误报。

#### 运维纪律

| 纪律 | 说明 |
|------|------|
| **勿短时间连 deploy 两次** | 第一次刚起来又 deploy，第二次若中断极易「只拆不装」 |
| **纯文档 / 纯 eval 变更** | 不必重建容器；`git pull` 到 ECS 仅为了留档时，**不要**跑 stop/rm |
| **中断后先救活再查因** | 见下文「事故复盘」手动 `docker run` |
| **数据** | 任务库在 **`-v /opt/manage_robot/data:/app/data`**；容器删了数据不丢 |

#### 事故复盘：「只拆不装」（2026-05-25）

**现象**：工作台 `https://managebot…` 404 或连不上约 1 小时；钉钉 bot 也可能无响应。**不是代码或 SQLite 损坏**，是 **8080 上已无进程**，Caddy 反代到空地址。

**Docker 事件摘要（CST）**：

| 时间 | 事件 |
|------|------|
| 16:28:39 | 部署成功，`manage-robot-dingtalk` 启动 |
| 16:33:11 | **同一容器** kill → stop → destroy |
| 16:33 ~ 17:31 | **无** 新的 `docker build` 完成 / `container create` |
| 17:31:55 | 人工 `docker run` 恢复 |

**根因**：约 16:28 完整部署后，**5 分钟内又为仅文档 commit 重复执行部署**；旧版脚本在 `git pull` 后 **立即 `stop/rm`**，随后 `docker build` 需数分钟。第二次部署 **SSH 连接在 build/run 完成前断开**（`set -e` 退出，未执行 `docker run`），形成 **只拆掉旧容器、未装回新容器**。

**为何 Caddy 还在但站点挂了**：Caddy 容器独立运行；后端 `127.0.0.1:8080` 无人监听即失败。

**旧版危险顺序（勿再用）**：

```text
git pull → stop → rm → build（数分钟空窗）→ run
```

**现版顺序**：

```text
git pull → build（旧容器仍服务）→ stop → rm → run → /health
```

**应急恢复**（部署中断、容器不在跑时，在 ECS 上执行；镜像通常仍在）：

```bash
docker rm -f manage-robot-dingtalk 2>/dev/null || true
docker run -d --name manage-robot-dingtalk --restart unless-stopped \
  --env-file /etc/manage-robot.env \
  -v /opt/manage_robot/data:/app/data \
  -p 8080:8080 \
  manage-robot:dingtalk
curl -sf http://127.0.0.1:8080/health && echo OK
```

恢复后再查：`docker logs --tail 50 manage-robot-dingtalk`（应见 Stream 已连接），并排查本次 deploy 为何中断（SSH 超时、`git pull` 冲突、`docker build` 报错等）。

#### 双容器部署（dingtalk + mingsibot）

现网 ECS 上通常跑 **两个业务容器**，共用同一镜像 `manage-robot:dingtalk`：

| 容器 | 端口 | 数据卷 | 环境文件 |
|------|------|--------|----------|
| `manage-robot-dingtalk` | `8080` | `/opt/manage_robot/data` | `/etc/manage-robot.env` |
| `manage-robot-mingsibot` | `8081` | `/opt/manage_robot-mingsibot/data` | `/etc/manage-robot-mingsibot.env` |

Caddy 反代示例：组织 A → `:8080`（`managebot.vivolightsales.com`）；组织 B → `:8081`（`mingsibot.vivolightsales.com`）。

代码仓库只有一份：`/opt/manage_robot`（Git 托管）。**mingsibot 不单独 clone**，重建镜像后两个容器各 **stop/rm/run** 一次即可加载新代码与新 env。

**改 env 后必须重建容器**：`docker restart` **不会**重新读取 `--env-file`。正确做法见下文「mingsibot 环境变量与链接」与 `scripts/ecs-fix-mingsibot-urls.sh`。

**推荐发版流程（两个容器都更新）**：

```powershell
# ① 本机：先 push 到 GitHub
git push origin feat/draft-full-memory-mutate   # 或你的 ECS 跟踪分支

# ② 本机：dingtalk 容器（git pull + build + swap）
.\scripts\ecs-deploy-dingtalk.ps1 -PublicIp 你的ECS公网IP -PemPath "c:\Users\EDY\Downloads\hh.pem"

# ③ ECS 上：用新镜像重启 mingsibot（共用同一 tag）
ssh -i hh.pem root@你的ECS公网IP "
  docker stop manage-robot-mingsibot && docker rm manage-robot-mingsibot
  docker run -d --name manage-robot-mingsibot --restart unless-stopped \
    --env-file /etc/manage-robot-mingsibot.env \
    -v /opt/manage_robot-mingsibot/data:/app/data \
    -p 8081:8081 manage-robot:dingtalk
  curl -sf http://127.0.0.1:8081/health && echo OK
"
```

**勿与 `ecs-deploy-dingtalk.ps1` 并行跑 `ecs-deploy-followup.ps1`**（见下节）。

#### mingsibot 环境变量与链接（组织 B）

明思实例除独立 `DINGTALK_*` 外，须显式配置工作台/通知域名（勿沿用组织 A 的 `managebot`）：

| 变量 | 明思示例 |
|------|----------|
| `HEALTH_CHECK_PORT` / `ASSIGNMENT_WEB_PORT` | `8081` |
| `ASSIGNMENT_WEB_PUBLIC_BASE_URL` | `https://mingsibot.vivolightsales.com` |
| `WORKBENCH_NOTIFY_DETAIL_URL_BASE` | `https://mingsibot.vivolightsales.com/workbench/employee/task` |
| `WORKBENCH_NOTIFY_MANAGER_DETAIL_URL_BASE` | `https://mingsibot.vivolightsales.com` |
| `DINGTALK_ROBOT_CODE` | 与明思应用一致；空时可回退 `DINGTALK_CLIENT_ID` |
| `WORKBENCH_ADMIN_USER_IDS` | 逗号分隔 admin userId（**仅 env**；例：姚凯珩 + Rain） |
| `WORKBENCH_MANAGER_USER_IDS` | env 静态主管；另可与 `data/workbench-managers.json` 动态名单并集 |

#### Manager groups（mingsibot 试点）

`WORKBENCH_MANAGER_GROUPS_ENABLED=1` 后，Admin 可在「权限中心」创建多个主管组，并把主管加入对应组。普通主管最多属于一个组；组内成员对正式任务、项目、周报 Dashboard、绩效看板和主管操作同权；不同主管组之间隔离。未发布的个人对话草案仍不共享。

建议先只在 `mingsibot` 开启：

```env
WORKBENCH_MANAGER_GROUPS_ENABLED=1
WORKBENCH_MANAGER_GROUPS_FILE=/app/data/workbench-manager-groups.json
```

开启后先由 Admin 创建主管组并迁入历史个人任务/项目，再让业务主管使用。改 `/etc/manage-robot-mingsibot.env` 后必须 `docker stop && docker rm && docker run --env-file ...` 重建容器，`docker restart` 不会读取新 env。

一键校正链接并重建容器：`bash scripts/ecs-fix-mingsibot-urls.sh`（在 ECS `/opt/manage_robot` 执行）。首次搭 mingsibot：`bash scripts/ecs-setup-mingsibot.sh`。

**授予 Admin 权限**（保留既有主管）：编辑 `/etc/manage-robot-mingsibot.env` 的 `WORKBENCH_ADMIN_USER_IDS`，确保目标 userId 仍在主管名单（env 或 `/opt/manage_robot-mingsibot/data/workbench-managers.json`），然后 **stop/rm/run** 重建 `manage-robot-mingsibot`（不可只 restart）。

#### 两种部署路径：git pull vs SCP（重要）

仓库有两个 Windows 部署脚本，机制不同：

| 脚本 | 同步代码方式 | 是否弄脏 Git 工作区 | 适用场景 |
|------|-------------|---------------------|----------|
| `ecs-deploy-dingtalk.ps1` | **`git pull --ff-only`** | 否（与 GitHub 一致） | **日常发版（推荐）** |
| `ecs-deploy-followup.ps1` | **`scp` 本机文件直接覆盖** | **是**（Git 认为整仓被改） | 历史遗留；仅催办 env 补丁时可单独用，**不要与 dingtalk 脚本并行** |

`ecs-deploy-followup.ps1` 会把本机 `src/`、`tests/`、`scripts/`、`docs/` 等 **整目录 SCP 到 `/opt/manage_robot`**，不经过 git commit。后果：

1. **`git pull` 失败** — 下次跑 `ecs-deploy-dingtalk.ps1` 时 Git 报 `Your local changes would be overwritten by merge`。
2. **CRLF 换行污染** — 从 Windows SCP 的 `.sh` 文件带 `\r\n`，Linux shebang 失效，容器启动报 `./scripts/docker-entrypoint-dingtalk.sh: not found`。
3. **假阳性大量 Modified** — `git status` 可能显示 200+ 文件改动，但 `git diff --ignore-cr-at-eol` 后内容往往与 HEAD 一致，**仅是换行符差异**。

#### 事故复盘：followup SCP 弄脏工作区（2026-06-08）

**现象**：

- `ecs-deploy-dingtalk.ps1` 在 `git pull` 阶段失败，提示 `resolve-assignees.ts`、`suggest-targets.ts` 等将被覆盖。
- 并行跑完的 `ecs-deploy-followup.ps1` 重建了容器，但容器 **Restarting**，日志为 `docker-entrypoint-dingtalk.sh: not found`。
- `git status` 显示 200+ `M` 文件；`git diff package.json` 为整文件 `-`/`+` 对等行数（CRLF vs LF）。

**根因**：followup 脚本用 SCP 覆盖 ECS 工作区 + Windows CRLF；dingtalk 脚本依赖 `git pull`，二者冲突。

**恢复步骤**（在 ECS 上）：

```bash
cd /opt/manage_robot
git fetch origin
git reset --hard origin/feat/draft-full-memory-mutate   # 对齐远程分支
git clean -fd

# 去掉 shell 脚本的 Windows 换行（若曾 SCP 过）
find scripts -name '*.sh' -exec sed -i 's/\r$//' {} \;
chmod +x scripts/docker-entrypoint-dingtalk.sh

# 必须 --no-cache 重建，否则 Docker 可能沿用带 CRLF 的 scripts 层缓存
docker build --no-cache -t manage-robot:dingtalk .
# 再按 2.6 / 2.7  swap dingtalk 容器，并 restart mingsibot
```

**纪律（新增）**：

| 纪律 | 说明 |
|------|------|
| **发版只用 `ecs-deploy-dingtalk.ps1`** | 两个容器共用镜像，build 一次、分别 restart |
| **勿并行跑 followup SCP** | 会与 `git pull` 冲突并引入 CRLF |
| **`git pull` 冲突时先 `reset --hard`** | 确认 ECS 无需要保留的手工改动后再重置 |
| **容器 entrypoint not found** | 优先查 `head -1 scripts/docker-entrypoint-dingtalk.sh \| od -c` 是否含 `\r` |

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
| `DINGTALK_CORP_ID` | 工作台强烈建议 | **JSAPI `dd.config` 与企业 corpId**：用于签名接口返回及兜底注入；仅在仅靠旧版 `getCurrentCorpId` 时可不配（不推荐） |
| `DINGTALK_AGENT_ID` | 工作台强烈建议 | 开放平台微应用 **AgentId**（数字），与 `dd.config` 一致；缺则 `/api/workbench/auth/jsapi-config` 不可用 |
| `WORKBENCH_DINGTALK_NOTIFY_ENABLED` | 否 | `1` 时启用员工通知总开关：发布/改派=卡片+机器人1:1；员工 accept 后=钉钉原生待办；默认关闭 |
| `WORKBENCH_NOTIFY_DETAIL_URL_BASE` | 否 | 通知卡片/待办详情链接基础地址，建议设为 `https://你的域名/workbench/employee/task` |
| `WORKBENCH_DINGTALK_NOTIFY_AGENT_ID` | 否 | 通知备用 AgentId。当前实现优先读取 `DINGTALK_AGENT_ID`，为空时才回退此变量 |
| `DINGTALK_CONTACT_SYNC_ENABLED` | 否 | `1` 开启钉钉通讯录同步（落地到 SQLite `dingtalk_contacts`）。**员工 accept 后创建待办需要 unionId，必须启用此项** |
| `DINGTALK_CONTACT_SYNC_INTERVAL_MS` | 否 | 通讯录兜底同步周期（默认 `1800000`，即 30 分钟） |
| `DINGTALK_CONTACT_ROOT_DEPT_ID` | 否 | 通讯录全量同步部门根节点（默认 `1`） |
| `DINGTALK_CONTACT_EVENT_TOKEN` | 否 | 通讯录事件回调鉴权 token；配置后需在请求头 `x-contact-event-token` 传入 |
| `DINGTALK_ROLE_ROUTING_ENABLED` | 否 | `1` 时按身份动态路由到 `manager/employee/planner` profile；默认 `0` 固定 planner（兼容旧行为） |
| `SEARCH_WEB_ENABLED` | 否 | `0` 全局关闭 `search_web` 工具；默认 `1`（仍受“用户明确要求搜索”语义门控） |
| `SEARCH_SIMILAR_PLANS_ENABLED` | 否 | `0` 关闭 `search_similar_plans` 工具，并跳过钉钉侧有草案时的异步 embedding 写入；默认 `1` |
| `DINGTALK_PLANID_ROTATE_ENABLED` | 否 | `0` 关闭「`publish_task` 成功后自动轮转 `planId`」；默认 `1`（同钉钉会话可连发多条正式任务） |
| `SEARCH_WEB_MODEL` | 否 | 搜索补充调用模型（默认 `qwen-turbo`） |
| `SEARCH_WEB_TIMEOUT_MS` | 否 | 搜索调用超时（毫秒，默认 `8000`） |
| `SEARCH_WEB_STRATEGY` | 否 | `turbo`/`quality`/`adaptive`；默认 `turbo` |
| `READ_URL_ENABLED` | 否 | `0` 关闭 `read_url` 工具；默认 `1`（模型按需读取用户提供的公网 http(s) 链接） |
| `READ_URL_TIMEOUT_MS` | 否 | 单链抓取超时（毫秒，默认 `12000`） |
| `READ_URL_MAX_BYTES` | 否 | 响应体最大字节（默认 `524288`，即 512KB） |
| `READ_URL_MAX_TEXT_CHARS` | 否 | 注入模型的正文最大字符（默认 `12000`） |
| `READ_URL_PER_ORCHESTRATOR_MAX` | 否 | 单轮 orchestrator 最多调用 `read_url` 次数（默认 `2`） |
| `DINGTALK_ORCHESTRATOR_MAX_ITERATIONS` | 否 | ReAct 工具循环上限（代码默认 `6`；**ECS 现网 `30`**；勿调低——复杂 WBS 逐行 add/update 会超限崩溃） |
| `AGENT_MAX_TOOL_CALLS` | 否 | 单轮 orchestrator 工具调用总次数上限（ECS 现网 `16`；勿调低——超限抛错中断本轮） |
| `MANAGER_TURN_MAX_RERUNS` | 否 | 每条用户消息最多完整重跑 orchestrator 次数（默认 `1`；0 = 禁止重跑） |
| `AGENT_HISTORY_TURNS` | 否 | 注入历史对话轮数（默认 `6`） |
| `ORCHESTRATOR_DRAFT_MEMORY_MAX_CHARS` | 否 | memory_context 草案注入字符上限（默认 `12000`） |
| `AGENT_MAX_TOTAL_MS` | 否 | 单轮 orchestrator 总耗时上限毫秒（ECS 现网 `180000`） |
| `UPDATE_DRAFT_TASK_PER_ORCHESTRATOR_MAX` | 否 | 单轮 `update_draft_task` 上限（默认 `4`；ECS 现网 `12`） |
| `ORCHESTRATOR_ENGINE` | 否 | `v2` 启用 LangGraph 编排器（Turn Contract 事务化补跑）；默认 `legacy`。**ECS 现网已设 `v2`**；回退 legacy 删除此行或改 `legacy` 后重建容器 |
| `V2_HISTORY_COMPACT_CHARS` | 否 | v2 历史压缩触发字符阈值（默认 `24000`） |
| `V2_HISTORY_COMPACT_KEEP_TURNS` | 否 | v2 压缩后保留最近轮数（默认 `6`） |
| `DRAFT_FALLBACK_EXTRACT_ENABLED` | 否 | `1` 时 orchestrator 可从仅 message 的 WBS 口播兜底提取 draft（默认 `1`） |
| `READ_URL_ALLOWED_HOSTS` | 否 | 可选域名白名单（逗号分隔）；未配置则允许公网 host（内网/localhost 仍被 SSRF 防护拒绝）。**钉钉文档/需登录页通常读不到**，应引导用户粘贴正文 |
| `QWEN_*` | 否 | 模型、超时、重试等；**SSE 流式默认开**（`QWEN_STREAM=0` 关闭），见 `docs/Qwen-接入实施说明.md` |
| `DEMO_DOMAIN_HINT` | 否 | `QUALITY` 或 `RD`，默认由模型判断 |
| `DEMO_LLM_CORRECTION` | 否 | 默认开；`0`/`false`/`no` 关闭校验失败后的第二轮模型自纠正（更快，失败率可能升），见 `docs/Qwen-接入实施说明.md` |
| `SESSION_DIGEST_MAX_CHARS` | 否 | 钉钉多轮时上轮摘要最大字符（默认 `2000`，范围 `200`–`8000`） |
| `HEALTH_CHECK_PORT` | 否 | 监听 HTTP `/health` |
| `DINGTALK_STREAM_DEBUG` | 否 | `1` / `true` 打印 Stream SDK 调试日志 |

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
| `ASSIGNMENT_WEB_PORT` | 否 | 指派工作台 HTTP 端口（默认 `8787`；需安全组放行） |
| `ASSIGNMENT_WEB_PUBLIC_BASE_URL` | 否 | 指派工作台公网地址（例如 `http://你的ECS公网IP:8787`） |
| `ASSIGNMENT_WEB_SECRET` | 否 | 指派工作台 URL 的 HMAC-SHA256 签名密钥（防止篡改） |
| `WORKBENCH_EXTERNAL_LOGIN_ENABLED` | 否 | `1` 开启外部执行者账号密码登录（`/workbench/external/login`） |
| `WORKBENCH_COOKIE_SECURE` | 否 | `1` 时为 session cookie 加 `Secure`（HTTPS 环境推荐） |
| `EXTERNAL_EXECUTOR_INITIAL_PASSWORD` | 否 | 运行 `npm run seed:external-executors` 时的初始密码（≥8 位，勿写入仓库） |
| `DINGTALK_ASSIGNMENT_MOCK` | 否 | `1` 使用 mock 钉钉交互卡片（无需真实卡片回调） |
| `WORKBENCH_MANAGER_USER_IDS` | 否 | 钉钉 **主管** 身份白名单（与 `TASK_INITIATOR_USER_IDS` 独立），逗号分隔 `userId`。供后续工作台网页应用 Session 判定；未配或空则人均按非主管处理（见 `src/security/workbench-manager-whitelist.ts`） |
| `WORKBENCH_MANAGER_IDS_FILE` | 否 | 主管名单 JSON 数组文件路径（格式同 `TASK_INITIATOR_IDS_FILE`）；存在且为数组时优先于 `WORKBENCH_MANAGER_USER_IDS` |
| `WORKBENCH_MANAGER_GROUPS_ENABLED` | 否 | `1` 开启 Admin 管理的主管组；组内共享正式任务/项目/看板和主管操作，组间隔离（建议 mingsibot 试点） |
| `WORKBENCH_MANAGER_GROUPS_FILE` | 否 | 主管组 JSON 文件路径；容器内建议 `/app/data/workbench-manager-groups.json` |
| `FOLLOWUP_REMINDER_ENABLED` | 否 | `1` 开启催办 scheduler（默认 `0`）；**单实例**假设，**切勿水平扩容** `dingtalk-bot` |
| `FOLLOWUP_SCAN_INTERVAL_MS` | 否 | scheduler 扫描间隔（默认 `300000`） |
| `FOLLOWUP_TIMEZONE` | 否 | 自然日与静默时段时区（默认 `Asia/Shanghai`）；纯日期 `due_at` 默认 **当天 18:00** 过期 |
| `FOLLOWUP_WEEKDAYS_ONLY` | 否 | 预提醒仅工作日发（默认 `1`） |
| `FOLLOWUP_PRE_DUE_HOUR` | 否 | T-1 员工预提醒小时（默认 `10`，与 9:00 日报错开） |
| `FOLLOWUP_PRE_DUE_MINUTE` | 否 | T-1 预提醒分钟（默认 `0`） |
| `FOLLOWUP_TIER2_AFTER_OVERDUE_DAYS` | 否 | 手动催办逾期满 N 天后 day2plus 追加卡片（默认 `1`） |
| `FOLLOWUP_QUIET_HOURS` | 否 | 静默时段，如 `22:00-08:00`（默认同左） |
| `FOLLOWUP_MANUAL_LLM_ENABLED` | 否 | 手动催办是否尝试 LLM 润色（默认 `1`） |
| `FOLLOWUP_MANUAL_LLM_TIMEOUT_MS` | 否 | 手动催办 LLM 超时毫秒（默认 `5000`） |
| `PROGRESS_DIGEST_ENABLED` | 否 | `1` 开启每日任务进展推送 scheduler（默认 `0`）；**单实例**假设 |
| `PROGRESS_DIGEST_MODE` | 否 | `delivery_reminder`（默认，近一周交付单表）或 `full`（legacy 三表+LLM） |
| `PROGRESS_DIGEST_HORIZON_DAYS` | 否 | 交付提醒滚动窗口自然日数（默认 `7`） |
| `PROGRESS_DIGEST_EXCLUDE_USER_IDS` | 否 | 实例级排除名单（逗号分隔）；用于多组织隔离。系统同时只选择当前仍有未完成任务的主管/员工 |
| `PROGRESS_DIGEST_SCAN_INTERVAL_MS` | 否 | 扫描间隔（默认 `300000`） |
| `PROGRESS_DIGEST_TIMEZONE` | 否 | 发送时刻与自然日判定时区（默认 `Asia/Shanghai`） |
| `PROGRESS_DIGEST_HOUR` | 否 | 发送小时（默认 `9`） |
| `PROGRESS_DIGEST_MINUTE` | 否 | 发送分钟（默认 `0`） |
| `PROGRESS_DIGEST_WEEKDAYS_ONLY` | 否 | 仅工作日推送（默认 `1`） |
| `PROGRESS_DIGEST_LOOKBACK_HOURS` | 否 | **已废弃**（动态改为 `PROGRESS_DIGEST_TIMEZONE` 前一自然日 00:00–24:00） |
| `PROGRESS_DIGEST_MAX_TASK_LINES` | 否 | 列表截断行数（默认 `8`） |
| `PROGRESS_DIGEST_LLM_ENABLED` | 否 | `full` 模式下是否用 qwen 生成概览/建议（`delivery_reminder` 默认不调 LLM，建议 `0`） |
| `PROGRESS_DIGEST_LLM_MODEL` | 否 | 总结模型（默认 `qwen3.6-flash`） |
| `PROGRESS_DIGEST_LLM_TIMEOUT_MS` | 否 | LLM 超时毫秒，超时走模板 fallback（默认 `8000`） |
| `PROGRESS_DIGEST_LLM_MAX_TOKENS` | 否 | LLM 输出 token 上限（默认 `800`） |

### 每日早报汇总（Daily Report Digest）

| 变量 | 必填 | 说明 |
|------|------|------|
| `DAILY_REPORTS_PAGE_ENABLED` | 否 | `1` 开启工作台日报汇总页入口（默认 `0`；明思实例建议开 `1`） |
| `DAILY_REPORT_DIGEST_ENABLED` | 否 | `1` 开启 8:30 群推 scheduler（默认 `0`） |
| `DAILY_REPORT_DIGEST_CONFIG_FILE` | 否 | 名单 + webhook 配置 JSON（默认 `data/daily-report-digest.config.json`） |
| `DAILY_REPORT_DIGEST_TIMEZONE` | 否 | 发送时区（默认 `Asia/Shanghai`） |
| `DAILY_REPORT_DIGEST_HOUR` | 否 | 群推小时（默认 `8`） |
| `DAILY_REPORT_DIGEST_MINUTE` | 否 | 群推分钟（默认 `30`） |
| `DAILY_REPORT_DIGEST_WEEKDAYS_ONLY` | 否 | 仅工作日发送（默认 `1`） |
| `DAILY_REPORT_DIGEST_STATE_DIR` | 否 | 去重状态目录（默认 `data/daily-report-digest`） |
| `DAILY_REPORT_DIGEST_SCAN_INTERVAL_MS` | 否 | 扫描间隔毫秒（默认 `300000`） |
| `DAILY_REPORT_MORNING_LLM_ENABLED` | 否 | LLM 综述开关（默认 `1`；推荐开，`0` 退化为模板汇总） |
| `DAILY_REPORT_MORNING_LLM_MODEL` | 否 | 综述模型（默认 `qwen3.6-flash`） |
| `DAILY_REPORT_MORNING_LLM_TIMEOUT_MS` | 否 | LLM 超时毫秒（默认 `12000`） |
| `DAILY_REPORT_MORNING_LLM_MAX_TOKENS` | 否 | LLM 输出 token 上限（默认 `900`） |

### 员工交付绩效看板

| 变量 | 必填 | 说明 |
|------|------|------|
| `PERFORMANCE_DASHBOARD_ENABLED` | 否 | `1` 开启看板页（默认 `1`；`0` 隐藏入口） |
| `PERFORMANCE_WINDOW_DAYS` | 否 | 绩效统计回溯自然日（默认 `90`，按截止日期回溯） |

### 主管周度 Dashboard

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `WEEKLY_DASHBOARD_TIMEZONE` | 否 | 周边界时区，默认回退 `FOLLOWUP_TIMEZONE`，再回退 `Asia/Shanghai`；自然周为周一 00:00 到下周一 00:00 |
| `WEEKLY_DASHBOARD_SPAN_MAX` | 否 | 页面可查看中心周前后 span 上限（默认 `6`） |
| `WEEKLY_DASHBOARD_FEED_PAGE_SIZE` | 否 | 动态 feed 默认分页大小（默认 `50`） |
| `WEEKLY_DASHBOARD_FEED_MAX_PAGE_SIZE` | 否 | 单页最大条数（默认 `100`） |
| `WEEKLY_ADVISOR_LLM_ENABLED` | 否 | 工作台内「周会建议」是否调用 LLM（默认 `1`）；失败或超时使用模板 |
| `WEEKLY_ADVISOR_LLM_MODEL` | 否 | 建议助手模型（默认 `qwen3.6-flash`） |
| `WEEKLY_ADVISOR_LLM_TIMEOUT_MS` | 否 | 建议助手超时毫秒（默认 `8000`） |
| `WEEKLY_ADVISOR_LLM_MAX_TOKENS` | 否 | 建议助手输出 token 上限（默认 `900`） |

单测默认会设置 `*_DISABLED`，避免写入仓库外路径；`vitest.setup.ts` 默认 `FOLLOWUP_REMINDER_ENABLED=0` 与 `PROGRESS_DIGEST_ENABLED=0` 避免测试进程启动后台扫描。与本节生产配置无关。

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
- **Admin+主管双角色**（如运营负责人兼主管）：同一钉钉 `userId` 须同时出现在 **`WORKBENCH_ADMIN_USER_IDS`（env）** 与 **主管名单**（`WORKBENCH_MANAGER_USER_IDS` 和/或 `data/workbench-managers.json`）。工作台免登默认 **主管视图**，侧栏可切 Admin；钉钉 Agent 在 `DINGTALK_ROLE_ROUTING_ENABLED=1` 时走 **`toolProfile=manager`**（`admin_also_manager`），非纯 admin 工具集。纯 admin（不在主管名单）才用 admin 工具集 + 回复末尾运营看板深链。

## 五、后续可选增强

- **指派工作台 HTTPS**（可选）：`ASSIGNMENT_WEB_PORT` 默认仅提供 HTTP。若需 HTTPS，可在 ECS 前加一层反向代理（如 Nginx / Caddy）做 TLS 终止，将 443 转发到本地 `8787`。此时 `ASSIGNMENT_WEB_PUBLIC_BASE_URL` 应设为 `https://你的域名`。反向代理示例（Caddy）：`caddy reverse-proxy --from 你的域名 --to :8787`，Caddy 会自动申请 Let's Encrypt 证书。
- **函数计算 FC**：若改为 HTTP 回调型机器人，可使用 FC HTTP 触发器；当前代码路径为 **Stream**，迁移需改用开放平台 HTTP 加解密回调。
- **高可用**：多实例部署需注意钉钉 Stream 连接模型与机器人会话幂等；试点阶段建议 **单实例**。
- **集中式审计 / 网关限流**：进程内已实现 Demo JSONL、Harness 可选 FileSink 及会话限速；若要跨实例报表或网关级配额，可再接入集中日志或 API 网关。
- **发布后员工通知**：若启用 `WORKBENCH_DINGTALK_NOTIFY_ENABLED=1`，`publish_task` 成功后向员工发送钉钉卡片 + 机器人 1:1 消息（**不在发布时创建待办**）。员工在工作台 **accept** 子任务后才创建钉钉原生待办（需 `DINGTALK_CONTACT_SYNC_ENABLED=1` 以解析 unionId）。通知失败不会回滚发布，在 `warnings` 与 `task_events` 中留痕（`EMPLOYEE_NOTIFY_FAILED` / `EMPLOYEE_TODO_*`）。
- **外部执行者网页登录**（无法加入钉钉组织的影子账号）：
  - 环境变量：`WORKBENCH_EXTERNAL_LOGIN_ENABLED=1`；生产 HTTPS 建议同时设 `WORKBENCH_COOKIE_SECURE=1` 或使用 `https://` 开头的 `ASSIGNMENT_WEB_PUBLIC_BASE_URL`。
  - 初始化：`EXTERNAL_EXECUTOR_INITIAL_PASSWORD='你的初始密码' npm run seed:external-executors`（写入武传宾 `ext_wuchuanbin` / 曲绍志 `ext_qu_shaozhi` 影子联系人与登录账号）。
  - 登录入口：`{ASSIGNMENT_WEB_PUBLIC_BASE_URL}/workbench/external/login`（账号示例：`wuchuanbin` / `qushaozhi`）。
  - 发布/改派时，影子账号**不会**走钉钉 notify；主管侧会提示「外部执行者请登录网页工作台查看」。内部员工通知行为不变。

## 六、上线前清库（纯 SQLite 模式）

若你希望以“全新正式任务数据”上线，发布前在 ECS 执行：

```bash
rm -f /opt/manage_robot/data/workbench/workbench.sqlite
rm -f /opt/manage_robot/data/workbench/tasks.json
docker restart manage-robot-dingtalk
```

说明：

- 当前工作台运行时只读 SQLite 正式任务库。
- `tasks.json` 不再作为运行时查询源，保留该文件仅用于人工备份排查。
