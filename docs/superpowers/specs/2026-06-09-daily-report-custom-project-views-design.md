# 微光可配置项目组日报视图

**日期**：2026-06-09  
**状态**：设计已定稿，待实现  
**关联**：明思+微光 legacy 日报 digest（不动）

## 1. 目标

在**不改动**明思+微光现有日报汇总（config 6 人名单、颅内/脑机/运营、未交/请假、7:00 群早报）的前提下，于微光侧扩展**可配置项目组视图**：

- 不同 viewer 白名单、可隔离 legacy 视图
- **P1（MVP）**：给曹一挥（userid `01451725613871`）「半导体激光·静脉项目」专属视图
- **P2（后续）**：同视图推送项目组早报；多项目组复制同一模式

## 2. 边界与隔离

| 能力 | Legacy（不动） | 新 `projectViews` |
|------|----------------|-------------------|
| 扫描名单 | 各 org `employees`（微光 6 人） | 独立 **roster** |
| 视图 | 公司 / 项目（颅内·脑机·运营） | 各项目组 Tab |
| 未交/请假 | 有 | P1 **无** |
| 推送 | 周二–周六 7:00 群早报 | P2 仅 view `viewers` |

**曹一挥**：`exclusiveForViewers: true` → 仅见本项目 Tab + 名单管理，不见明思/微光 legacy Tab。  
**Admin**：legacy + 全部 custom 视图 + 名单管理。  
**部署/探测**：不发群消息、不触发 digest 发送。

## 3. Filter（全名子串）

- `workModuleContains`: `半导体激光`
- `costProjectContains`: `静脉腔内闭合系统`
- 同一模块块 ①–⑥ 内**成对**匹配（任意序号均可）
- **展示**：只输出命中 filter 的模块块，非整篇日报原文

## 4. 业务日与历史

与 legacy 共用 `daily-report-window`：

- **默认日期**：上一自然日业务日（`resolveReportRange`），与 7:00 早报「昨日」一致
- **时间窗口**：`[D cutoff, D+1 cutoff)`，默认 cutoff **17:00**（支持次日上午补交计入 D）
- **历史浏览**：页面日期选择器可选任意 `YYYY-MM-DD`；API `?date=` 走 `resolveDayRangeForYmd`
- **P2 早报**：仅推送**昨日**业务日；历史靠页面翻查

## 5. 名单（roster）与发现（discovery）

### 5.1 原则

- 首次 **org_all 引导发现**找「谁写过这两个模块」→ **自动写入 roster**
- **日常**只扫 roster 内 userid（十～几十人），不再每日扫微光全员 ~400 人
- 工作台支持 **加人 / 删人**；保留 **「重新发现」** 追加新命中者

### 5.2 引导发现

- **范围**：微光 `dingtalk_contacts` active 用户，排除名称含「机器人」「T-」等
- **时间**：近 `discoveryDays` 自然日（默认 **30**）内各业务日日志
- **命中**：至少一条日报存在 filter 成对命中 → 该 userid **自动加入 roster**（已在名单跳过）
- **触发**：首次部署后自动跑一次；admin / 曹一挥可点「重新发现」重跑
- **并发**：`report/list` 限制 **12 并发**，避免钉钉限流

### 5.3 日常扫描

- **7:30 预扫**（北京，工作日）：对 `resolveReportRange(now)` 的**昨日**业务日，仅扫 roster → 写缓存
- **页面打开**：读缓存；无缓存则扫 roster（名单小，通常秒级～十几秒）
- **手动刷新**：对当前选中业务日重扫 roster 并更新缓存
- **历史日**：扫 roster + 按 `(viewId, dateYmd)` 缓存；业务日结束后结果稳定，缓存长期保留 unless 刷新

### 5.4 名单管理（工作台）

- **可编辑**：该 view 的 `viewers` + admin
- **加人**：从微光通讯录搜索 userid/姓名加入 roster（不要求历史写过两模块）
- **删人**：从 roster 移除；不再出现在该项目组日报列表
- **持久化**：SQLite 表 `daily_report_project_view_roster` 为唯一权威源；config JSON 不手填 roster

## 6. 访问控制

```typescript
resolveDailyReportsAccess(userId, config, caps)
// legacyAccess: admin 或 (canManage && !exclusive)
// customOnly: !legacyAccess && 至少一个 custom view
// customViews: viewers 白名单内的 { id, label }[]
```

Custom API：`GET /api/daily-reports?view=custom:{id}&date=YYYY-MM-DD`  
可选：`POST .../refresh` 或 `?refresh=1` 强制重扫。

## 7. 配置示例（ECS mingsibot）

微光 org 下 `projectViews[]`：

```json
{
  "id": "semiconductor-vein",
  "label": "半导体激光·静脉项目",
  "viewers": ["01451725613871"],
  "exclusiveForViewers": true,
  "discoveryDays": 30,
  "filters": {
    "workModuleContains": "半导体激光",
    "costProjectContains": "静脉腔内闭合系统"
  }
}
```

`roster` 由引导发现 + 工作台维护写入 DB，不必手填 config。

## 8. 缓存

**表** `daily_report_view_cache`（SQLite，mingsibot 进程）：

| 列 | 说明 |
|----|------|
| view_id | projectView id |
| date_ymd | 业务日 YYYY-MM-DD |
| payload_json | 命中人员 + 过滤后 reports |
| scanned_at | ISO 时间 |
| hit_count | 命中人数 |

Key：`(view_id, date_ymd)`。7:30 预扫写昨日；页面读优先；手动刷新覆盖。

## 9. UI（P1）

- Tab：「半导体激光·静脉项目」（`label`）
- 顶栏：日期选择器、刷新、**名单管理**（列表 + 加人 + 删人 + 重新发现）
- 内容：按人折叠/展开，仅 filter 后模块块
- **无**未交/请假列
- 扫描中：空态 + 「正在扫描…」

## 10. P2（不在 P1 范围）

- 周二–周六 **07:00**（或 config `sendHour`）向 `viewers` 推送项目组早报（Markdown/卡片）
- 内容 = 昨日 roster 扫描 + filter 摘要；优先读 7:30 缓存
- 多 `projectViews` 复制配置即可

## 11. 组件与文件

| 模块 | 职责 |
|------|------|
| `daily-report-project-view-filter.ts` | 模块+项目成对 filter |
| `daily-report-project-views.ts` | 配置解析、roster CRUD、discovery、按 roster 收集 digest |
| `daily-report-view-cache.ts` | 缓存读写（新） |
| `daily-report-view-prewarm.ts` | 7:30 预扫 scheduler 钩子（新） |
| `daily-reports-api.ts` | custom view HTTP、refresh、roster API |
| `daily-reports-page.ts` | custom Tab、日期、名单 UI |
| `daily-report-config.ts` | `projectViews[]`、`discoveryDays` 解析 |

**数据源**：微光通讯录 userid 来自 `manage-robot-dingtalk` 容器 `dingtalk_contacts`（或等效 directory API）。

## 12. 测试

- filter 成对/非成对、空块剔除
- discovery：mock 400 人中仅 N 人命中 → roster 自动填充
- 日常 collect：仅 roster userid 被请求
- access：`exclusiveForViewers` 隔离 legacy
- 业务日：默认昨日、指定历史日、17:00 cutoff 边界
- 缓存：命中/未命中、refresh 覆盖
- 不发消息：discovery/prewarm 不调用 webhook

## 13. 上线步骤

1. 合并代码 + 单测
2. ECS patch `daily-report-digest.config.json` 增加 `projectViews`
3. 重启 mingsibot；自动引导发现填充 roster
4. 只读 probe 输出近 30 天命中人数/样例供确认
5. 曹一挥工作台验证：默认昨日、历史日、加删人、刷新

## 14. 验收标准（P1）

- [ ] Legacy 明思/微光 6 人视图与 7:00 早报行为不变
- [ ] 曹一挥仅见「半导体激光·静脉项目」，默认展示**昨日**命中日志
- [ ] 可选历史日期，展示该日 roster 内人员的过滤模块块
- [ ] 引导发现自动填充 roster；重新发现可追加新人
- [ ] 工作台可加/删 roster 成员
- [ ] 7:30 预扫后打开页面 <2s（roster ≤50 人量级）
- [ ] 全程无额外钉钉群/个人推送
