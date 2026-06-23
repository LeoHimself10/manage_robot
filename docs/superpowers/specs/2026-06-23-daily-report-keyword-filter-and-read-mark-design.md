# 微光日报：单关键词召回 + 原日志已读调研

**日期**：2026-06-23  
**状态**：待评审  
**需求方**：曹一挥（CTO）  
**关联**：
- `docs/superpowers/specs/2026-06-09-daily-report-custom-project-views-design.md`（projectView / roster / filter v1）
- `docs/superpowers/specs/2026-06-09-daily-report-project-view-morning-digest-design.md`（CTO 合并早报）

---

## 1. 背景

### 1.1 召回不全（曹反馈 2026-06-22/23）

现网 filter **v1** 要求同一模块块（①–⑥）内 **工作模块 + 成本归属** 两个字段 **同时** 含指定子串才保留。例如半导体视图：

- `workModuleContains`: `半导体激光`
- `costProjectContains`: `静脉腔内闭合系统`

员工若只在「工作模块」写了 `半导体`、成本归属填了简称或留空/填别的项目名，整模块块会被丢弃 → **早报与工作台都看不到**，表现为「日志没召回」。

### 1.2 原日志已读（曹新需求）

曹希望：在 **managebot 工作台** 读过某条日报后，钉钉 **日志 App「我收到的」** 里也能标记为已读，便于用钉钉原生筛选未读。

---

## 2. 目标与非目标

### 2.1 目标

| # | 目标 |
|---|------|
| G1 | **Filter v2**：每 projectView **一个关键词**；模块块内 **工作模块或成本归属** 任一字段含该词即命中 |
| G2 | 五个 digest 视图关键词更新为：`CLA` / `OCT` / `冲击波` / `斑块减容` / `半导体` |
| G3 | discovery、日常 collect、缓存、早报、工作台 **共用同一套 filter**，避免 roster 与展示不一致 |
| G4 | 对「原日志已读」给出 **可交付结论** + 可落地的替代方案 |

### 2.2 非目标

- 不改 mingsibot legacy 群推
- 不改造钉钉日志模板字段结构
- 不实现「后台静默替用户写钉钉已读」（官方无 API，见 §5）
- 不在本 spec 内改 CTO 早报 plain text / prewarm 时序（已在 DR-1~4 闭环）

---

## 3. Filter v2 设计

### 3.1 产品规则（已确认）

- **每 view 一个关键词**（见 §3.3 映射表）
- 匹配范围：模块块 ①–⑥ 内的 **「工作模块」或「成本归属项目」** 字段（与 v1 相同字段族，见 `daily-report-project-view-filter.ts` 的 `fieldForModule`）
- 逻辑：**OR** — 同一序号块内，工作模块含关键词 **或** 成本归属含关键词 → 保留该块全部模块字段
- 仍 **不保留** 非模块字段（备注、分隔线等）；仍走 `filterReportEntry` 去空块
- 匹配方式：**子串**、区分大小写（`CLA`/`OCT` 按原文；中文按 UTF-8 子串）

### 3.2 配置形态

**推荐**：在 `filters` 增加显式 `keyword`，保留旧字段用于迁移期回读。

```json
{
  "filters": {
    "keyword": "半导体",
    "workModuleContains": "半导体激光",
    "costProjectContains": "静脉腔内闭合系统"
  }
}
```

**运行时优先级**：

1. 若 `keyword` 非空 → **Filter v2**（OR，工作模块 / 成本归属）
2. 否则若 `workModuleContains` + `costProjectContains` 均非空 → **Filter v1**（AND，兼容旧 config）
3. 否则 → 该 view 配置无效（`parseProjectViewConfig` 失败或 discovery 跳过）

迁移完成后 ECS config 只保留 `keyword`；旧字段可删。

### 3.3 五项目关键词映射

| view `id` | 展示名（现网） | 新 `keyword` | 现网 v1（参考） |
|-----------|----------------|--------------|-----------------|
| `cla` | CLA 项目 | `CLA` | 长模块名 + 355 等 |
| `oct` | OCT 项目 | `OCT` | 长模块名 + 项目号 |
| `laser-shockwave` | 激光冲击波 项目 | `冲击波` | … |
| `large-vessel-plaque` | 大血管斑块减容 项目 | `斑块减容` | … |
| `semiconductor-vein` | 半导体激光·静脉项目 | `半导体` | `半导体激光` + `静脉腔内闭合系统` |

### 3.4 代码触点（实现时）

| 模块 | 变更 |
|------|------|
| `daily-report-project-views.ts` | `parseProjectViewConfig` 接受 `filters.keyword`；校验 `keyword` 或 legacy 成对 |
| `daily-report-project-view-filter.ts` | 新增 `moduleBlockMatchesKeywordFilter` + `filterReportEntryByKeyword`；v1 函数保留 |
| `daily-report-project-view-collect.ts` | 调用统一 `filterReportEntryForView(entry, view.filters)` |
| `daily-report-project-view-discovery.ts` | discovery 命中判定同上 |
| 测试 | 扩展 filter / discovery / collect 用例：仅工作模块命中、仅成本归属命中、双 miss |

### 3.5 召回变宽的影响

- **正面**：曹反馈的漏召回应显著减少
- **风险**：可能多召回相邻项目（如「半导体」命中非静脉项目模块）→ 接受；若噪声大再收窄关键词或加 exclude 规则（**不在 v2**）
- **roster**：discovery 规则变宽后，「重新发现」可能新增 userid；**不自动删** 旧 roster 成员
- **缓存**：改 filter 后 **旧 `(viewId, dateYmd)` 缓存语义变化** → 部署后建议对五个 view **清缓存或强制 refresh 一次**（运维脚本或 `?refresh=1`）

---

## 4. 原日志「标记已读」— 可行性结论

### 4.1 结论（给曹）

> **无法通过开放 API，在 managebot 内「读完即写」钉钉原生已读状态。**  
> 钉钉日志的已读是 **接收人在钉钉客户端打开该日志** 时写入；开放平台仅提供 **查询** 已读/未读，**无写入接口**。

### 4.2 调研依据

钉钉官方「日志接口能力」与 Connection 执行动作清单（2026-06 查阅）包含：

| 接口 | 能力 | 读/写 |
|------|------|------|
| `topapi/report/list` | 用户**发出**的日志列表 | 读 |
| `topapi/report/statistics/listbytype` (type=0) | 某日志 **已读人员** userid 列表 | 读 |
| `topapi/report/getunreadcount` | 某用户未读日志 **数量** | 读 |
| `topapi/report/receiver/list` | 日志接收人列表 | 读 |
| `topapi/report/comment/list` | 评论列表 | 读 |
| `topapi/report/create` | 创建日志 | 写（与已读无关） |

**不存在**：`report/markread`、`report/read`、`comment/create`（日志）等写入已读/评论接口。

managebot 现仅用 `report/list` 拉取 **员工提交** 的全文；后端拉取 **不会** 改变曹在「我收到的」里的已读状态。

### 4.3 与「打开原日志深链」的关系

工作台已支持 `reportId` → landray `viewreport.html` / `openapp` 深链（`daily-report-dingtalk-report-link.ts`）。

| 行为 | 钉钉原生已读 |
|------|--------------|
| 曹在工作台看汇总正文（不点原日志） | ❌ 不变 |
| 曹点击深链，**在钉钉客户端**打开详情 | ⚠️ **可能**变已读（客户端行为，非 API 保证） |
| 后台代读 / 工作台按钮「标记已读」调 API | ❌ **无 API** |

**待实测**（部署 filter v2 时可一并验收）：曹账号点工作台「打开原日志」→ 钉钉「我收到的」该条是否从未读变已读。  
若 H5 侧栏打开 **不算** 已读，则原生筛选 **无法** 与工作台联动。

### 4.4 可交付替代方案

**Phase R1 — 工作台已读（推荐先做）**

- SQLite 表 `daily_report_read_state(viewer_userid, report_id, read_at)` 或并入现有 cache 元数据
- 工作台项目详情：已读/未读角标；筛选「仅未读」
- **只服务曹等 viewer**，不要求钉钉 App 同步

**Phase R2 — 与钉钉已读对齐（只读）**

- 对曹可见的 `report_id`，调 `statistics/listbytype` type=0，合并钉钉侧已读集合
- UI 展示「钉钉已读 / 仅工作台已读 / 未读」三态
- 注意 API 配额（标准版 1 万次/月）；按日批量、缓存

**Phase R3 — 深链引导（可选）**

- 工作台「处理完」引导 copy：「在钉钉中打开即记已读」+ 原日志按钮
- 不做假标记

**明确不做**：伪造 API 写已读、爬虫 landray 内网接口（无授权、易碎）。

---

## 5. 验收标准

### 5.1 Filter v2

- [ ] 五 view config 已写入 `filters.keyword`（ECS `daily-report-digest.config.json`）
- [ ] 单元测试：仅工作模块含 `半导体`、仅成本归属含 `半导体`、均不含 → 前两种召回
- [ ] 对 2026-06-22 业务日 dry-run / 工作台 refresh：曹反馈的漏报 case 可再现为 **已召回**（抽样 ≥3 条）
- [ ] discovery 与 collect 测试同一 filter 入口

### 5.2 已读

- [ ] 文档/评审结论已同步曹：**原生已读 API 不可写**
- [ ] （可选）深链实测记录 1 页：打开方式 vs 钉钉未读数变化
- [ ] 若做 R1：工作台可按 viewer 筛未读

---

## 6. 发布与回滚

1. 合并代码 → `git push` → ECS **`git pull` 到指定 commit** → `docker build`（**禁止 scp 单文件**）
2. Patch config 五 view 的 `keyword`
3. 清五 view 昨日/当日 cache 或 admin refresh
4. 曹验收工作台 + 次日早报

**回滚 filter**：config 去掉 `keyword` 恢复 v1 成对字段 + 部署上一版；或 `keyword` 置空走 legacy。

**回滚已读**：功能 flag `DAILY_REPORT_READ_STATE_ENABLED=0`（若实现 R1）。

---

## 7. 开放问题

| # | 问题 | 建议 |
|---|------|------|
| Q1 | 深链打开是否算钉钉已读 | 曹实测 1 次后关闭 |
| Q2 | `CLA`/`OCT` 大小写 | 保持区分大小写；员工模板若小写 `cla` 则不命中 → 观察后再定是否 `toUpperCase` 归一 |
| Q3 | 是否要「重新发现」扩 roster | filter 变宽后建议曹点一次「重新发现」，非强制 |

---

## 8. 下一步

1. **你评审本 spec**（确认 keyword 映射与已读结论）
2. 通过后 → `writing-plans` 出 implementation plan（filter 改造 + config patch + 可选 R1 已读）
3. 实现 → PR → 正规 ECS 发布
