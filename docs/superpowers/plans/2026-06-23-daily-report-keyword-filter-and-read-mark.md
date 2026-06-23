# 日报单关键词召回 + 工作台已读 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 projectView 召回从 v1「工作模块 AND 成本归属」升级为 v2「单 keyword + OR」；更新五项目 ECS 配置；在工作台为 viewer 记录已读/未读（不依赖钉钉写已读 API）。

**Architecture:** 在 `daily-report-project-view-filter.ts` 增加 keyword OR 逻辑 + 统一入口 `filterReportEntryForView`；`parseProjectViewConfig` 支持 `filters.keyword` 并保留 legacy 成对字段；collect/discovery 改调统一入口；R1 用 SQLite `daily_report_read_state` + 工作台 UI 筛选。

**Tech Stack:** TypeScript, Vitest, `node:sqlite` DatabaseSync, 现有 `dingtalk-report-client`

**Spec:** `docs/superpowers/specs/2026-06-23-daily-report-keyword-filter-and-read-mark-design.md`

---

## File map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/agent/daily-report-digest/daily-report-project-view-filter.ts` | Modify | keyword OR 匹配 + `filterReportEntryForView` |
| `src/agent/daily-report-digest/daily-report-project-views.ts` | Modify | `ProjectViewFilter` 类型 + `parseProjectViewConfig` |
| `src/agent/daily-report-digest/daily-report-project-view-collect.ts` | Modify | 调用 `filterReportEntryForView` |
| `src/agent/daily-report-digest/daily-report-project-view-discovery.ts` | Modify | 同上 |
| `src/agent/daily-report-digest/daily-report-read-state-store.ts` | Create | viewer×report_id 已读 SQLite |
| `src/web/daily-reports-api.ts` | Modify | 读写已读、列表带 `read` 字段 |
| `src/web/daily-reports-page.ts` | Modify | 未读筛选 + 标记已读 UI |
| `scripts/patch-project-view-keywords.mjs` | Create | ECS config 五 view 写 keyword |
| `scripts/clear-project-view-cache.mjs` | Create | 部署后清五 view 缓存 |
| `tests/agent/daily-report-digest/daily-report-project-view-filter.test.ts` | Create | keyword OR 单测 |
| `tests/agent/daily-report-digest/daily-report-project-views.test.ts` | Modify | parse keyword + legacy |
| `tests/agent/daily-report-digest/daily-report-read-state-store.test.ts` | Create | 已读 store 单测 |
| `tests/web/daily-reports.test.ts` | Modify | API 已读字段 |
| `docs/superpowers/specs/2026-06-09-daily-report-custom-project-views-design.md` | Modify | §3 Filter 指向 v2 spec |
| `AGENTS.md` | Modify | 一句 filter v2 说明 |

---

## Phase A — Filter v2

### Task 1: Keyword OR 单元测试

**Files:**
- Create: `tests/agent/daily-report-digest/daily-report-project-view-filter.test.ts`
- Modify: `src/agent/daily-report-digest/daily-report-project-view-filter.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "vitest";
import {
  filterReportEntryForView,
  moduleBlockMatchesKeywordFilter,
} from "../../../src/agent/daily-report-digest/daily-report-project-view-filter";
import type { ReportEntry } from "../../../src/agent/daily-report-digest/dingtalk-report-client";

function block(idx: string, work: string, project: string) {
  return [
    { key: `${idx} 工作模块`, value: work },
    { key: `${idx} 成本归属项目`, value: project },
    { key: `${idx} 事项-结果`, value: "完成调试" },
  ];
}

const entry: ReportEntry = {
  creatorUserId: "u1",
  creatorName: "张三",
  templateName: "日报",
  createTime: 1,
  contents: [
    ...block("①", "Y1b13 半导体激光", "其他项目"),
    ...block("②", "行政", "静脉腔内闭合系统"),
    ...block("③", "无关", "无关"),
  ],
};

describe("moduleBlockMatchesKeywordFilter", () => {
  it("matches work module only", () => {
    expect(moduleBlockMatchesKeywordFilter(entry.contents, "①", "半导体")).toBe(true);
  });
  it("matches cost project only", () => {
    expect(moduleBlockMatchesKeywordFilter(entry.contents, "②", "静脉")).toBe(true);
  });
  it("misses when neither field contains keyword", () => {
    expect(moduleBlockMatchesKeywordFilter(entry.contents, "③", "半导体")).toBe(false);
  });
});

describe("filterReportEntryForView keyword mode", () => {
  it("keeps blocks matching keyword in work OR project", () => {
    const filtered = filterReportEntryForView(entry, { keyword: "半导体" });
    const keys = filtered.contents.map((f) => f.key).join("|");
    expect(keys).toContain("①");
    expect(keys).not.toContain("③");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- tests/agent/daily-report-digest/daily-report-project-view-filter.test.ts
```

Expected: `filterReportEntryForView` / `moduleBlockMatchesKeywordFilter` not exported.

- [ ] **Step 3: Implement filter v2**

在 `daily-report-project-view-filter.ts`：

```typescript
export interface ProjectViewFilter {
  keyword?: string;
  workModuleContains?: string;
  costProjectContains?: string;
}

/** @deprecated alias */
export type ModuleProjectPairFilter = Required<
  Pick<ProjectViewFilter, "workModuleContains" | "costProjectContains">
>;

export function moduleBlockMatchesKeywordFilter(
  contents: ReportContentField[],
  idx: string,
  keyword: string,
): boolean {
  const needle = normalizeLabel(keyword);
  if (!needle) return false;
  const work = normalizeLabel(fieldForModule(contents, idx, "work")?.value ?? "");
  const project = normalizeLabel(fieldForModule(contents, idx, "project")?.value ?? "");
  return work.includes(needle) || project.includes(needle);
}

export function filterReportEntryByKeyword(entry: ReportEntry, keyword: string): ReportEntry {
  const needle = normalizeLabel(keyword);
  if (!needle) return { ...entry, contents: [] };
  const kept = new Set<string>();
  for (const idx of MODULE_INDICES) {
    if (moduleBlockMatchesKeywordFilter(entry.contents, idx, needle)) kept.add(idx);
  }
  if (kept.size === 0) return { ...entry, contents: [] };
  const contents = entry.contents.filter((f) => {
    if (SEPARATOR_KEY_RE.test(f.key.trim())) return false;
    const idx = moduleIndexFromKey(f.key);
    if (!idx || !isModuleField(f.key)) return false;
    return kept.has(idx);
  });
  return { ...entry, contents };
}

export function filterReportEntryForView(entry: ReportEntry, filter: ProjectViewFilter): ReportEntry {
  const keyword = normalizeLabel(filter.keyword ?? "");
  if (keyword) return filterReportEntryByKeyword(entry, keyword);
  const work = normalizeLabel(filter.workModuleContains ?? "");
  const project = normalizeLabel(filter.costProjectContains ?? "");
  if (work && project) {
    return filterReportEntryByModuleProjectPair(
      entry,
      { workModuleContains: work, costProjectContains: project },
    );
  }
  return { ...entry, contents: [] };
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test -- tests/agent/daily-report-digest/daily-report-project-view-filter.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/agent/daily-report-digest/daily-report-project-view-filter.ts tests/agent/daily-report-digest/daily-report-project-view-filter.test.ts
git commit -m "feat(daily-report): add keyword OR filter for project views"
```

---

### Task 2: Config 解析 + collect/discovery 统一入口

**Files:**
- Modify: `src/agent/daily-report-digest/daily-report-project-views.ts`
- Modify: `src/agent/daily-report-digest/daily-report-project-view-collect.ts`
- Modify: `src/agent/daily-report-digest/daily-report-project-view-discovery.ts`
- Modify: `tests/agent/daily-report-digest/daily-report-project-views.test.ts`

- [ ] **Step 1: Write failing parse test**

在 `daily-report-project-views.test.ts` 追加：

```typescript
it("parseProjectViewConfig accepts filters.keyword only", () => {
  const v = parseProjectViewConfig(
    {
      id: "cla",
      label: "CLA",
      viewers: ["u1"],
      filters: { keyword: "CLA" },
    },
    "微光",
  );
  expect(v?.filters.keyword).toBe("CLA");
});

it("parseProjectViewConfig still accepts legacy pair", () => {
  const v = parseProjectViewConfig(
    {
      id: "v1",
      label: "旧",
      viewers: ["u1"],
      filters: { workModuleContains: "A", costProjectContains: "B" },
    },
    "微光",
  );
  expect(v?.filters.workModuleContains).toBe("A");
});
```

- [ ] **Step 2: Run — expect FAIL** on keyword-only parse

- [ ] **Step 3: Update parse + types**

`daily-report-project-views.ts`：

```typescript
import type { ProjectViewFilter } from "./daily-report-project-view-filter";

export interface DailyReportProjectViewConfig {
  // ...
  filters: ProjectViewFilter;
}

// parseProjectViewConfig 内：
const keyword = asString(filtersRaw.keyword);
const workModuleContains = asString(filtersRaw.workModuleContains);
const costProjectContains = asString(filtersRaw.costProjectContains);
if (!id || !label || viewers.length === 0) return null;
if (!keyword && (!workModuleContains || !costProjectContains)) return null;
return {
  // ...
  filters: {
    ...(keyword ? { keyword } : {}),
    ...(workModuleContains ? { workModuleContains } : {}),
    ...(costProjectContains ? { costProjectContains } : {}),
  },
};
```

`collect.ts` / `discovery.ts`：将

```typescript
filterReportEntryByModuleProjectPair(r, view.filters)
```

改为

```typescript
filterReportEntryForView(r, view.filters)
```

- [ ] **Step 4: Run full digest tests**

```bash
npm test -- tests/agent/daily-report-digest/
```

- [ ] **Step 5: Commit**

```bash
git add src/agent/daily-report-digest/daily-report-project-views.ts \
  src/agent/daily-report-digest/daily-report-project-view-collect.ts \
  src/agent/daily-report-digest/daily-report-project-view-discovery.ts \
  tests/agent/daily-report-digest/daily-report-project-views.test.ts
git commit -m "feat(daily-report): wire keyword filter through collect and discovery"
```

---

### Task 3: ECS config patch + 缓存清理脚本

**Files:**
- Create: `scripts/patch-project-view-keywords.mjs`
- Create: `scripts/clear-project-view-cache.mjs`

- [ ] **Step 1: Add patch script**

```javascript
#!/usr/bin/env node
/**
 * 为五 projectView 写入 filters.keyword（保留 legacy 字段）。
 * Usage: node scripts/patch-project-view-keywords.mjs /path/to/daily-report-digest.config.json
 */
import fs from "node:fs";

const KEYWORDS = {
  cla: "CLA",
  oct: "OCT",
  "laser-shockwave": "冲击波",
  "large-vessel-plaque": "斑块减容",
  "semiconductor-vein": "半导体",
};

const path = process.argv[2] || "data/daily-report-digest.config.json";
const cfg = JSON.parse(fs.readFileSync(path, "utf8"));
for (const org of cfg.orgs ?? []) {
  for (const pv of org.projectViews ?? []) {
    const kw = KEYWORDS[pv.id];
    if (!kw) continue;
    pv.filters = pv.filters || {};
    pv.filters.keyword = kw;
  }
}
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
console.log("patched keywords for", Object.keys(KEYWORDS).join(", "));
```

- [ ] **Step 2: Add cache clear script**

```javascript
#!/usr/bin/env node
/** Delete cache rows for five digest views (optional dateYmd arg). */
import { DatabaseSync } from "node:sqlite";
const views = ["cla","oct","laser-shockwave","large-vessel-plaque","semiconductor-vein"];
const dbPath = process.env.WORKBENCH_SQLITE_PATH || "data/workbench/workbench.sqlite";
const dateYmd = process.argv[2];
const db = new DatabaseSync(dbPath);
for (const viewId of views) {
  if (dateYmd) {
    db.prepare("DELETE FROM daily_report_project_view_cache WHERE view_id=? AND date_ymd=?").run(viewId, dateYmd);
  } else {
    db.prepare("DELETE FROM daily_report_project_view_cache WHERE view_id=?").run(viewId);
  }
}
console.log("cleared cache for", views.join(", "), dateYmd ?? "(all dates)");
```

- [ ] **Step 3: Commit**

```bash
git add scripts/patch-project-view-keywords.mjs scripts/clear-project-view-cache.mjs
git commit -m "chore(daily-report): add ECS keyword patch and cache clear scripts"
```

---

### Task 4: 部署验收（Filter）

- [ ] **Step 1: 本地验证**

```bash
npm run typecheck && npm test -- tests/agent/daily-report-digest/
```

- [ ] **Step 2: push + ECS 正规发布**

```bash
git push origin HEAD
# ECS:
cd /opt/manage_robot && git pull && npm run typecheck
node scripts/patch-project-view-keywords.mjs data/daily-report-digest.config.json
node scripts/clear-project-view-cache.mjs 2026-06-22
docker build -t manage-robot:dingtalk . && docker stop manage-robot-dingtalk && docker rm manage-robot-dingtalk
docker run -d --name manage-robot-dingtalk --restart unless-stopped -p 8080:8080 \
  --env-file /etc/manage-robot.env -v /opt/manage_robot/data:/app/data manage-robot:dingtalk
```

- [ ] **Step 3: 曹验收**

工作台 `?view=custom:semiconductor-vein&date=2026-06-22&refresh=1` 对比漏报 case。

---

## Phase B — 工作台已读 R1

### Task 5: Read state store

**Files:**
- Create: `src/agent/daily-report-digest/daily-report-read-state-store.ts`
- Create: `tests/agent/daily-report-digest/daily-report-read-state-store.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import {
  createDailyReportReadStateStore,
  isReportReadByViewer,
  markReportReadByViewer,
} from "../../../src/agent/daily-report-digest/daily-report-read-state-store";

describe("daily-report-read-state-store", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("marks and checks read", () => {
    dir = mkdtempSync(join(tmpdir(), "dr-read-"));
    const store = createDailyReportReadStateStore(join(dir, "wb.sqlite"));
    markReportReadByViewer("viewer1", "report-abc", store);
    expect(isReportReadByViewer("viewer1", "report-abc", store)).toBe(true);
    expect(isReportReadByViewer("viewer1", "report-xyz", store)).toBe(false);
    store.close();
  });
});
```

- [ ] **Step 2: Implement store**

表：`daily_report_read_state(viewer_user_id, report_id, read_at)`，PK `(viewer_user_id, report_id)`。

- [ ] **Step 3: Run test + commit**

```bash
npm test -- tests/agent/daily-report-digest/daily-report-read-state-store.test.ts
git commit -m "feat(daily-report): SQLite store for workbench read state"
```

---

### Task 6: API + 工作台 UI

**Files:**
- Modify: `src/web/daily-reports-api.ts`
- Modify: `src/web/daily-reports-page.ts`
- Modify: `src/web/assignment-workbench.ts`（路由 `POST .../reports/mark-read`）
- Modify: `tests/web/daily-reports.test.ts`

- [ ] **Step 1:** `buildDailyReportsHttpPayload` 对每条 report 带 `reportId` 时查 `isReportReadByViewer(viewerUserId, reportId)` → `read: boolean`

- [ ] **Step 2:** `POST /api/workbench/daily-reports/mark-read` body `{ reportIds: string[] }`，session user 为 viewer

- [ ] **Step 3:** 页面 Tab「未读」筛选；打开员工卡片或点「标记已读」调 API

- [ ] **Step 4:** 测试 + commit

```bash
npm test -- tests/web/daily-reports.test.ts
git commit -m "feat(daily-report): workbench read/unread for project view reports"
```

---

### Task 7: 文档

- [ ] 更新 `AGENTS.md`：filter v2 keyword OR；工作台已读仅本地、钉钉 API 不可写
- [ ] 更新 `2026-06-09-daily-report-custom-project-views-design.md` §3 指向 `2026-06-23` spec
- [ ] Commit docs

---

## Spec coverage self-check

| Spec § | Task |
|--------|------|
| G1 Filter v2 OR | Task 1–2 |
| G2 五关键词 | Task 3 |
| G3 discovery/collect 一致 | Task 2 |
| G4 已读结论（文档） | Task 7 |
| R1 工作台已读 | Task 5–6 |
| 缓存失效 | Task 3–4 |
| git pull 部署 | Task 4 |

**Out of scope（本 plan 不做）：** 钉钉 `listbytype` 三态同步（R2）、深链实测自动化（手动验收）。

---

## Execution handoff

Plan 已保存至 `docs/superpowers/plans/2026-06-23-daily-report-keyword-filter-and-read-mark.md`。

**执行方式：**

1. **Subagent-Driven（推荐）** — 每个 Task 独立 subagent + 任务间 review  
2. **Inline Execution** — 本会话按 Task 1→7 连续实现，Phase A 完成后 checkpoint

选哪种？或直接说「开始实现 Phase A」。
