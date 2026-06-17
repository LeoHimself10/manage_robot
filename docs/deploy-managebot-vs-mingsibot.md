# managebot 与 mingsibot 实例对照（ECS 现网）

**核查时间**：2026-06-17（SSH `root@47.243.199.153`）  
**代码仓库**：单 repo `/opt/manage_robot`，两容器共用镜像 `manage-robot:dingtalk`  
**本文不含任何密钥 / token / webhook secret，仅记录路径与开关。**

---

## 1. 公网入口（Caddy）

| 域名 | 反代目标 | 容器 |
|------|----------|------|
| `https://managebot.vivolightsales.com` | `127.0.0.1:8080` | `manage-robot-dingtalk` |
| `https://mingsibot.vivolightsales.com` | `127.0.0.1:8081` | `manage-robot-mingsibot` |

Caddy 容器名：`manage-robot-caddy`（与 bot 容器独立；bot 挂掉时 Caddy 仍在，站点会连不上后端）。

---

## 2. 容器与端口（`docker ps` 快照）

| 容器 | 状态（核查时） | 宿主机端口 |
|------|----------------|------------|
| `manage-robot-dingtalk` | Up | `0.0.0.0:8080->8080/tcp` |
| `manage-robot-mingsibot` | Up | `0.0.0.0:8081->8081/tcp` |

---

## 3. 环境文件与数据卷

| 项目 | managebot | mingsibot |
|------|-----------|-----------|
| env 文件 | `/etc/manage-robot.env` | `/etc/manage-robot-mingsibot.env` |
| 数据卷 | `/opt/manage_robot/data` → `/app/data` | `/opt/manage_robot-mingsibot/data` → `/app/data` |
| 钉钉应用 | **独立** `DINGTALK_CLIENT_ID` / `DINGTALK_CORP_ID`（两文件内均已配置，值不同） | 同上（明思侧应用） |

---

## 4. 与日报 / 工作台相关的 env（文件 + 运行时）

### 4.1 `/etc/manage-robot.env`（managebot）

**文件中不存在**下列键（核查时 `grep` 无匹配）：

- `DAILY_REPORT_DIGEST_ENABLED`
- `DAILY_REPORT_DIGEST_CONFIG_FILE`
- `DAILY_REPORTS_PAGE_ENABLED`
- `DAILY_REPORT_PROJECT_VIEWS_ENABLED`

**容器内 `printenv` 可见**（与日报直接相关）：

| 变量 | 值 |
|------|-----|
| `MEETING_IMPORT_ENABLED` | `0` |
| `ASSIGNMENT_WEB_PUBLIC_BASE_URL` | `https://managebot.vivolightsales.com` |
| `ASSIGNMENT_WEB_PORT` | `8787` |
| `HEALTH_CHECK_PORT` | `8080` |

### 4.2 `/etc/manage-robot-mingsibot.env`（mingsibot）

**文件中存在**（键名；值为 `<set>` 不列出）：

| 变量 | 说明 |
|------|------|
| `DAILY_REPORT_DIGEST_ENABLED` | 已配置 |
| `DAILY_REPORT_DIGEST_CONFIG_FILE` | `/app/data/daily-report-digest.config.json` |
| `DAILY_REPORTS_PAGE_ENABLED` | 已配置 |

**文件中不存在**：`DAILY_REPORT_PROJECT_VIEWS_ENABLED`（核查时尚未部署微光项目组视图）

**容器内运行时**：

| 变量 | 值 |
|------|-----|
| `DAILY_REPORT_DIGEST_ENABLED` | `1` |
| `DAILY_REPORT_DIGEST_CONFIG_FILE` | `/app/data/daily-report-digest.config.json` |
| `DAILY_REPORTS_PAGE_ENABLED` | `1` |
| `MEETING_IMPORT_ENABLED` | `0` |
| `ASSIGNMENT_WEB_PUBLIC_BASE_URL` | `https://mingsibot.vivolightsales.com` |
| `ASSIGNMENT_WEB_PORT` | `8081` |
| `HEALTH_CHECK_PORT` | `8081` |

---

## 5. 日报配置文件（核查时）

| 路径 | managebot | mingsibot |
|------|-----------|-----------|
| `/app/data/daily-report-digest.config.json` | **不存在** | **存在**（2255 字节） |

### mingsibot 配置摘要（无 secret）

- **title**：每日早报  
- **timezone**：`Asia/Shanghai`  
- **sendHour / sendMinute**：7 / 0  
- **reportDayCutoffHour**：17（业务日 17:00 截止）  
- **pushMode**：`morning`  
- **leaveCheckEnabled**：`true`  
- **webhook**：已配置（群机器人推送用）  
- **orgs**：

| org | 凭证 | employees 数 | projectFilter | projectViews |
|-----|------|--------------|---------------|--------------|
| 明思 | `useDeployedAppCredentials: true` | 2 | 3 项 | 无 |
| 微光 | 独立 `appKey` / `appSecret` | 6（曹杰、李强、贾三祥、惠芳芳、韦静、薛婷） | 2 项 | **无**（核查时） |

- **发送状态目录**：`/app/data/daily-report-digest/` 存在 `.sent` 标记（如 `2026-06-16.sent`），说明定时群早报曾在 mingsibot 运行。

### managebot

- **无** `daily-report-digest.config.json` → 核查时 **无 legacy 日报页、无群早报、无项目组视图**。

---

## 6. 业务分工（目标态 vs 现网核查时）

| 能力 | 目标部署位置 | 核查时实际 |
|------|--------------|------------|
| Legacy 明思+微光 6 人 digest + 7:00 群早报 + 日报页（公司/项目视图） | **保持 mingsibot** | ✅ 在 mingsibot |
| 微光「半导体激光·静脉项目」`projectViews` + 曹一挥专属页 | **managebot** | ❌ 尚未部署 |
| 任务工作台 / Stream 机器人 | 两实例各自独立钉钉应用 | ✅ 均在运行 |

**易混点**：实例 hostname 叫 `mingsibot` 不等于「只有明思」——现网 legacy 日报 config **同时**含明思与微光两个 org，这是历史部署结果；**新**微光项目组视图应只在 **managebot** 开启 `DAILY_REPORT_PROJECT_VIEWS_ENABLED=1`，且 **不要**在 mingsibot 写 `projectViews`。

---

## 7. env 矩阵（目标态，managebot 部署项目组视图后）

| 变量 | managebot | mingsibot |
|------|-----------|-----------|
| `DAILY_REPORT_DIGEST_ENABLED` | `0` | `1` |
| `DAILY_REPORT_DIGEST_CONFIG_FILE` | `/app/data/daily-report-digest.config.json` | 同左 |
| `DAILY_REPORTS_PAGE_ENABLED` | `1` | `1`（legacy 页） |
| `DAILY_REPORT_PROJECT_VIEWS_ENABLED` | `1` | **不设 / `0`** |

managebot 的 config 仅需 **微光 org + `projectViews[]`**（可从 mingsibot 复制微光凭证块，**不要**复制 webhook / 明思 org）。

---

## 8. 部署命令（勿搞混容器）

```bash
# 微光项目组视图 → 仅 managebot
cd /opt/manage_robot
git pull --ff-only
bash scripts/ecs-deploy-managebot-project-view.sh

# legacy 日报 cutoff / 6 人名单 / 群 webhook → 仅 mingsibot（现有脚本 ecs-deploy-daily-report-*.sh）
# 禁止把 ecs-patch-project-view.mjs 指向 manage_robot-mingsibot/data
```

**改 env 后必须 `docker stop && docker rm && docker run`**，不能只 `docker restart`（`--env-file` 不会热更新）。

---

## 9. 核查脚本

```bash
# 在 ECS 上（部署后复验）
bash /opt/manage_robot/scripts/ecs-inspect-instances.sh
```

本地只读 probe（mingsibot 容器内，**不发消息**）：

```bash
docker exec manage-robot-mingsibot node scripts/probe-custom-project-view.mjs
```

managebot 部署后 probe 应在 **manage-robot-dingtalk** 内执行，且 config 在 `/opt/manage_robot/data/`。

---

## 10. ECS Git 快照（核查时）

```
809ceaf fix(daily-report): treat 8h leave as full-day per company work schedule
```

部署 managebot 项目组视图前，需 `git pull` 到含 `ecs-deploy-managebot-project-view.sh` 与 `DAILY_REPORT_PROJECT_VIEWS_ENABLED` 逻辑的 commit。

---

## 11. 禁止事项

1. 在 mingsibot 的 config 增加 `projectViews` 或打开 `DAILY_REPORT_PROJECT_VIEWS_ENABLED`。  
2. 在 managebot 打开 `DAILY_REPORT_DIGEST_ENABLED=1` 并配置 webhook（避免双份群早报）。  
3. 把 `ecs-patch-project-view.mjs` 默认路径改成 `manage_robot-mingsibot/data`。  
4. 将 webhook / appSecret 写入本文档或提交到 Git。
