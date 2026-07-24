# 统一会议 AI 听记上线清单

## 目标

同一会议只保留一条记录。系统自动组合日历、Stream 事件、`conferenceId`、`taskUuid`、实时 ASR、企业应用云转写和主管 OAuth 听记，不要求用户判断会议类型。没有任何 AI 听记或可读转写的会议不展示。

## 当前现网预检（2026-07-24，只读）

| 项目 | managebot | mingsibot |
|---|---:|---:|
| 容器运行 | 正常 | 正常 |
| 最近会议开关 | 已开启 | 已开启 |
| 通讯录同步 | 已开启 | 已开启 |
| 会议事件监听 | 正常 | 正常 |
| 最近 30 天 `minutes_task_status_change` | 已观察到 | 未观察到 |
| 容器内 DWS | 缺失 | 缺失 |
| 主管 OAuth profiles | 缺失 | 缺失 |
| 工作台 SQLite | 约 14 MB | 约 2 MB |

ECS `/opt/manage_robot` 当前存在较多未提交改动，发布禁止直接 `git pull`。候选镜像必须使用独立 release 目录构建，不能覆盖现网 checkout。

## 已准备的工具

1. `scripts/ecs-stage-unified-meetings.ps1`
   - 本地完整测试；
   - 从 Git HEAD 生成干净源码树，只覆盖本功能明确修改的文件；
   - 上传独立 release 目录；
   - 构建 `manage-robot:dingtalk-unified-meetings` 候选镜像；
   - 不重启现网容器。

2. `scripts/ecs-authorize-dingtalk-minutes.sh`
   - 每个组织、每位试点主管分别完成 DWS device OAuth；
   - profile 保存在该实例自己的持久化数据卷；
   - 自动验证 `auth status` 和只读 `minutes list all`；
   - 原子更新 `dws-minutes-profiles.json`，权限为 `0600`。

3. `scripts/ecs-preflight-unified-meetings.sh`
   - 检查候选镜像和 DWS；
   - 检查现网 DB 完整性；
   - 在临时 DB 副本上演练 schema 迁移；
   - 逐一验证主管 OAuth 和 AI 听记只读能力；
   - 检查会议事件监听；
   - 不修改生产数据库。

4. `scripts/ecs-activate-unified-meetings.sh`
   - 两个实例预检全部通过后才允许执行；
   - 用 SQLite `VACUUM INTO` 创建一致性备份；
   - 备份两个 env；
   - 写入 DWS 配置并重建两个容器；
   - 健康检查失败自动恢复旧 env 和旧镜像。

## 上线顺序

### 1. 构建候选镜像

本地 PowerShell：

```powershell
.\scripts\ecs-stage-unified-meetings.ps1
```

### 2. 主管授权

在 ECS 独立 release 目录中运行。每个主管只在其所属组织执行一次：

```bash
bash scripts/ecs-authorize-dingtalk-minutes.sh managebot <主管userId>
bash scripts/ecs-authorize-dingtalk-minutes.sh mingsibot <主管userId>
```

命令会显示钉钉设备授权提示。主管本人在浏览器或钉钉完成确认即可；不要复制 access token、refresh token 或 profile 文件内容。

### 3. 双实例预检

```bash
bash scripts/ecs-preflight-unified-meetings.sh managebot
bash scripts/ecs-preflight-unified-meetings.sh mingsibot
```

两条命令都必须输出 `[ok]`。

### 4. 激活

```bash
bash scripts/ecs-activate-unified-meetings.sh
```

### 5. 上线验收

- `https://managebot.vivolightsales.com/health`
- `https://mingsibot.vivolightsales.com/health`
- 两个组织各做一场 1–2 分钟带 AI 听记的测试会议；
- 主管打开“任务快录入 → 最近会议”，应只看到一条会议；
- 点击后应读取完整转写并进入待办预览；
- 再做一场不开 AI 听记的会议，列表中不应出现；
- 检查日志无 `dingtalk_meeting_event_cache_failed`、`meeting_transcript_fetch_failed`。

## 需要业务/管理员协助的事项

1. 确定两个组织首批需要使用会议导入的主管名单。
2. 每位主管完成一次 DWS device OAuth。授权必须由本人确认，技术侧不能代替。
3. 钉钉管理员确认两个应用均订阅 `minutes_task_status_change`：
   - managebot 最近 30 天已经收到该事件；
   - mingsibot 最近 30 天没有观察到事件，需要确认是无人使用 AI 听记，还是尚未订阅。
4. 钉钉管理员确认两个应用均具备 `VideoConference.Conference.Read`，用于无需主管个人 OAuth 的云转写回退。

除以上四项外，镜像构建、数据库备份、迁移演练、配置写入、容器切换、健康检查和失败回滚均由发布脚本完成。
