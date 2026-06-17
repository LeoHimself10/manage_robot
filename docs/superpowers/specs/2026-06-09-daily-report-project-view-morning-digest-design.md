# 微光项目组早报（1:1 推送）

**日期**：2026-06-09  
**状态**：设计已定稿，待实现  
**关联**：
- P1/P2：`docs/superpowers/specs/2026-06-09-daily-report-custom-project-views-design.md`
- legacy 明思+微光 digest（**不动**，仍在 mingsibot）

## 1. 目标

在 **managebot**（微光钉钉机器人）上，为可配置 `projectViews`（首期 `semiconductor-vein`）向 **viewers** 推送「昨日业务日」项目组日报早报：

- 风格与 mingsibot **明思早报**一致：**LLM 综述 + 按人短摘要** + 工作台深链 ActionCard
- **1:1 机器人私聊**，不走群 Webhook
- **周二–周六 08:00**（北京）发送；汇总 **昨日**业务日（17:00 cutoff，与页面一致）
- **上线分两阶段**：先 **运维脚本** 只发姚凯珩验收；验收通过后再开 **定时 scheduler** 发给 viewers（首期曹一挥）

## 2. 边界

| 能力 | mingsibot legacy | managebot projectView 早报 |
|------|------------------|----------------------------|
| 实例 | `manage-robot-mingsibot` | `manage-robot-dingtalk` |
| 通道 | 群 Webhook | 机器人 **1:1** |
| 时间 | 7:00 | **8:00** |
| 名单 | org `employees` | projectView **roster**（SQLite） |
| 内容 | 明思+微光 6 人 / 颅内·脑机·运营 | 仅 filter 后模块块 |
| 未交/请假 | 有 | **无** |
| 收件人 | 群成员 | 仅 `projectViews[].viewers` |

**禁止**改动 mingsibot config、Webhook、7:00 scheduler。

## 3. 已确认产品决策（2026-06-09）

| 决策 | 选择 |
|------|------|
| 内容形态 | **A** — LLM 综述 + 按人摘要 + 工作台链接 |
| 发送时刻 | **C** — **08:00**（多留补交窗口） |
| 发送日 | **A** — **周二–周六**；周日、周一不发 |
| 预览方式 | **B** — **运维脚本**手动发姚凯珩；验收后再开定时 |
| 昨日 0 条相关日报 | **A** — **仍发送**；禁止用语「命中/filter/roster」等内部词 |
| 正式收件人 | **A** — 仅 **`viewers`**（不含 admin，除非写入 viewers） |

### 3.1 用户可见文案原则

- ✅ 「统计名单内 N 人」「昨日有 M 人提交了与 **半导体激光·静脉项目** 相关的日报」
- ✅ 「昨日暂无与该项目相关的日报记录」
- ❌ 「命中」「filter」「roster」「成对匹配」

## 4. 数据与缓存

1. **业务日**：`resolveReportRange(now)` → 昨日 `labelYmd`（与 legacy 早报「昨日」一致）
2. **数据源**：`collectProjectViewDigestForRange` 同等逻辑——仅 **roster** 内 userid；仅展示 filter 后模块块
3. **缓存优先**：8:00 推送前读 `daily_report_project_view_cache(view_id, date_ymd)`；无缓存则同步扫 roster 并写缓存（与页面 refresh 同路径）
4. **预扫**：现有 **7:30** prewarm 不变；8:00 通常命中缓存

## 5. LLM

- 复用 `daily-report-morning-llm` 基础设施（模型、超时、fallback 模板），**新增** projectView 专用 prompt / 输入结构：
  - 输入：view `label`、业务日、按人过滤后摘要（姓名 + 模块块要点，不含未交/请假）
  - 输出：`DailyReportMorningSummary` 同形或专用字段，供 render 使用
- **零数据日**：仍调用 LLM 生成简短综述（或短模板 + 可选 LLM 润色一句）；必须包含名单人数与「暂无相关日报」自然表述
- 超时/失败：模板 fallback（与 legacy morning 一致），写审计 `daily_report_project_view_digest_llm_fallback`

## 6. 推送通道

- API：`POST https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend`
- 凭证：managebot 部署 env `DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET` / `DINGTALK_ROBOT_CODE`
- 卡片：`sampleActionCard`（与 `send-daily-report-preview-to-yao.ts`、`workbench-notify` 一致）
- 深链：`buildDailyReportsPublicUrlForDingtalkOutbound` + `?view=custom:{viewId}&date={labelYmd}`

## 7. 两阶段交付

### 7.1 阶段 1 — 运维脚本（先做）

**脚本**：`scripts/send-project-view-morning-digest.ts`

```bash
npx tsx scripts/send-project-view-morning-digest.ts \
  --view=semiconductor-vein \
  --to=652949075622784820 \
  [--date=YYYY-MM-DD] \
  [--dry-run]
```

| 参数 | 说明 |
|------|------|
| `--view` | projectView id，默认 `semiconductor-vein` |
| `--to` | 收件 userid；**文档/帮助默认姚凯珩**，防止误发曹一挥 |
| `--date` | 业务日；默认昨日 |
| `--dry-run` | 只 stdout Markdown，不调钉钉 |

**验收**：姚凯珩确认内容、链接、空数据日文案 OK 后，进入阶段 2。

**首期明确要求**：脚本验收完成前 **不得**向曹一挥（`01451725613871`）发送。

### 7.2 阶段 2 — 定时 scheduler

| env | 说明 |
|-----|------|
| `DAILY_REPORT_PROJECT_VIEW_DIGEST_ENABLED=1` | 仅 managebot |
| `DAILY_REPORT_PROJECT_VIEWS_ENABLED=1` | 前置（已有） |

- 钩子：managebot 进程内 scheduler（与 prewarm 并列）；**周二–周六 08:00–08:05** 窗口
- 对每个 `projectViews[]`（且 `digest.enabled !== false`）向 **`viewers[]`** 各发 1 条
- **日去重**：表 `daily_report_project_view_digest_state` 或 `data/daily-report-state/project-view-digest/{viewId}.{dateYmd}.{userId}.sent`
- 失败：写 `warnings` / 结构化日志；**不回滚**缓存

可选 config（阶段 2）：

```json
"digest": {
  "enabled": false,
  "sendHour": 8,
  "sendMinute": 0
}
```

阶段 1 脚本 **不读取** `digest.enabled`；阶段 2 以 env + config 双门禁。

## 8. 组件与文件（计划新增/修改）

| 模块 | 职责 |
|------|------|
| `daily-report-project-view-digest-collect.ts` | 读缓存或 collect，产出 LLM 输入 DTO |
| `daily-report-project-view-morning-llm.ts` | projectView 专用 prompt + 调用 |
| `daily-report-project-view-morning-render.ts` | Markdown / ActionCard 文本 |
| `daily-report-project-view-digest-send.ts` | 1:1 batchSend + 去重 |
| `daily-report-project-view-digest-scheduler.ts` | 8:00 窗口（阶段 2） |
| `scripts/send-project-view-morning-digest.ts` | 阶段 1 运维入口 |
| `dingtalk-bot.ts` | 阶段 2 启动 scheduler |
| `daily-report-config.ts` | 可选解析 `digest` 块 |

## 9. 测试

- filter 后内容进入 LLM 输入；零数据日仍生成可发送 Markdown
- 文案 snapshot：不含「命中」
- `--dry-run` 不调用钉钉 API
- scheduler 去重：同 view+date+user 不重复发
- 单测 mock LLM / mock fetch；**禁止** CI 真发钉钉

## 10. 验收标准

### 阶段 1（脚本）

- [ ] `--dry-run` 输出 LLM 综述 + 按人摘要 + 正确深链
- [ ] 姚凯珩收到 1:1 卡片，打开链接进入「半导体激光·静脉项目」+ 对应业务日
- [ ] 零数据日仍收到自然表述早报，无内部术语
- [ ] **曹一挥未收到**任何早报（验收期）

### 阶段 2（scheduler，姚 OK 后）

- [ ] 周二–周六 8:00 曹一挥自动收到；周日周一不发
- [ ] 仅 `viewers` 收到；admin 不在 viewers 则不收
- [ ] mingsibot legacy 7:00 群早报行为不变
- [ ] 同业务日重复触发不重复发送

## 11. 上线步骤

1. 合并代码 + 单测
2. managebot 部署新镜像（**不**开 `DAILY_REPORT_PROJECT_VIEW_DIGEST_ENABLED`）
3. 运行脚本 `--dry-run` → 姚凯珩 review
4. 脚本正式发姚凯珩（ `--to=652949075622784820` ）
5. 姚确认 OK 后：开 env + 可选 config `digest.enabled: true`；重启 managebot
6. 观察首个 8:00 窗口；确认曹一挥收到且 mingsibot 无影响
