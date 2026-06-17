# 微光项目组日报视图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不动 legacy 明思/微光日报的前提下，为曹一挥提供「半导体激光·静脉项目」专属视图：引导发现自动建 roster、日常只扫 roster、默认昨日业务日、支持历史日与 7:30 预扫缓存。

**Architecture:** 独立 SQLite 表存 `project_view_roster` 与 `project_view_cache`；discovery 一次性 org_all×30天写入 roster；`collectCustomProjectViewDigest` 改为 roster 驱动；API/页面复用现有 custom view 与日期选择器；prewarm scheduler 挂到 mingsibot 进程 interval loop。

**Tech Stack:** TypeScript, Node `node:sqlite` DatabaseSync, Vitest, 现有 `dingtalk-report-client` / `daily-report-window` / `people-directory-store`

**Spec:** `docs/superpowers/specs/2026-06-09-daily-report-custom-project-views-design.md`

---

## File map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/agent/daily-report-digest/daily-report-project-view-roster-store.ts` | Create | roster CRUD (SQLite) |
| `src/agent/daily-report-digest/daily-report-project-view-cache.ts` | Create | per (viewId, dateYmd) cache |
| `src/agent/daily-report-digest/daily-report-org-scan-contacts.ts` | Create | org_all 候选人（contacts + bot 过滤） |
| `src/agent/daily-report-digest/daily-report-project-view-discovery.ts` | Create | 30天引导发现 + 并发扫描 |
| `src/agent/daily-report-digest/daily-report-project-view-collect.ts` | Create | roster 扫描 + filter（从 project-views 拆出） |
| `src/agent/daily-report-digest/daily-report-project-view-prewarm.ts` | Create | 7:30 预扫 + 启动 bootstrap |
| `src/agent/daily-report-digest/daily-report-project-views.ts` | Modify | discoveryDays、权限 helper |
| `src/agent/daily-report-digest/daily-report-config.ts` | Modify | `discoveryDays` 解析 |
| `src/web/daily-reports-api.ts` | Modify | cache-first、refresh、roster 状态 |
| `src/web/daily-reports-project-view-roster.ts` | Create | HTTP 服务层（搜人/增删/发现） |
| `src/web/daily-reports-page.ts` | Modify | custom 名单面板 + 重新发现 |
| `src/web/assignment-workbench.ts` | Modify | 新 API 路由、prewarm 启动 |
| `src/dingtalk-bot.ts` | Modify | 启动 prewarm scheduler |
| `tests/agent/daily-report-digest/daily-report-project-view-roster-store.test.ts` | Create | roster 单测 |
| `tests/agent/daily-report-digest/daily-report-project-view-cache.test.ts` | Create | cache 单测 |
| `tests/agent/daily-report-digest/daily-report-project-view-discovery.test.ts` | Create | discovery 单测 |
| `tests/agent/daily-report-digest/daily-report-project-views.test.ts` | Modify | collect + access |
| `tests/web/daily-reports.test.ts` | Modify | custom view API + cache |
| `scripts/probe-custom-project-view.mjs` | Modify | org_all + roster 输出 |

---

### Task 1: SQLite roster store

**Files:**
- Create: `src/agent/daily-report-digest/daily-report-project-view-roster-store.ts`
- Test: `tests/agent/daily-report-digest/daily-report-project-view-roster-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addProjectViewRosterMember,
  listProjectViewRoster,
  removeProjectViewRosterMember,
  createProjectViewRosterStore,
} from "../../../src/agent/daily-report-digest/daily-report-project-view-roster-store";

describe("daily-report-project-view-roster-store", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pv-roster-"));
  const dbPath = path.join(tmpDir, "wb.sqlite");

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it("adds and lists members idempotently", () => {
    const store = createProjectViewRosterStore(dbPath);
    try {
      addProjectViewRosterMember("semiconductor-vein", { userid: "u1", name: "张三" }, store);
      addProjectViewRosterMember("semiconductor-vein", { userid: "u1", name: "张三" }, store);
      const list = listProjectViewRoster("semiconductor-vein", store);
      expect(list).toEqual([{ userid: "u1", name: "张三" }]);
    } finally {
      store.close();
    }
  });

  it("removes a member", () => {
    const store = createProjectViewRosterStore(dbPath);
    try {
      addProjectViewRosterMember("semiconductor-vein", { userid: "u1", name: "A" }, store);
      removeProjectViewRosterMember("semiconductor-vein", "u1", store);
      expect(listProjectViewRoster("semiconductor-vein", store)).toEqual([]);
    } finally {
      store.close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/daily-report-digest/daily-report-project-view-roster-store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement roster store**

```typescript
// src/agent/daily-report-digest/daily-report-project-view-roster-store.ts
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";

export interface ProjectViewRosterMember {
  userid: string;
  name?: string;
  source?: "discovery" | "manual";
  addedAt?: string;
}

export interface ProjectViewRosterStore {
  db: DatabaseSync;
  close(): void;
}

export function createProjectViewRosterStore(
  dbPath = resolveWorkbenchSqlitePath(),
): ProjectViewRosterStore {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_report_project_view_roster (
      view_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      added_at TEXT NOT NULL,
      PRIMARY KEY (view_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_dr_pv_roster_view ON daily_report_project_view_roster(view_id);
  `);
  return {
    db,
    close: () => db.close(),
  };
}

export function listProjectViewRoster(
  viewId: string,
  store: ProjectViewRosterStore,
): ProjectViewRosterMember[] {
  const rows = store.db
    .prepare(
      `SELECT user_id, name, source, added_at FROM daily_report_project_view_roster
       WHERE view_id = ? ORDER BY name COLLATE NOCASE, user_id`,
    )
    .all(viewId.trim()) as Array<{ user_id: string; name: string | null; source: string; added_at: string }>;
  return rows.map((r) => ({
    userid: r.user_id,
    name: r.name?.trim() || undefined,
    source: r.source === "discovery" ? "discovery" : "manual",
    addedAt: r.added_at,
  }));
}

export function addProjectViewRosterMember(
  viewId: string,
  member: { userid: string; name?: string; source?: "discovery" | "manual" },
  store: ProjectViewRosterStore,
): void {
  const userid = member.userid.trim();
  if (!userid) throw new Error("userid 不能为空");
  const now = new Date().toISOString();
  store.db
    .prepare(
      `INSERT INTO daily_report_project_view_roster (view_id, user_id, name, source, added_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(view_id, user_id) DO UPDATE SET
         name = COALESCE(excluded.name, daily_report_project_view_roster.name)`,
    )
    .run(viewId.trim(), userid, member.name?.trim() || null, member.source ?? "manual", now);
}

export function removeProjectViewRosterMember(
  viewId: string,
  userid: string,
  store: ProjectViewRosterStore,
): void {
  store.db
    .prepare(`DELETE FROM daily_report_project_view_roster WHERE view_id = ? AND user_id = ?`)
    .run(viewId.trim(), userid.trim());
}

export function mergeDiscoveryMembers(
  viewId: string,
  members: ProjectViewRosterMember[],
  store: ProjectViewRosterStore,
): number {
  let added = 0;
  const existing = new Set(listProjectViewRoster(viewId, store).map((m) => m.userid));
  for (const m of members) {
    if (existing.has(m.userid)) continue;
    addProjectViewRosterMember(viewId, { ...m, source: "discovery" }, store);
    existing.add(m.userid);
    added += 1;
  }
  return added;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/agent/daily-report-digest/daily-report-project-view-roster-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/daily-report-digest/daily-report-project-view-roster-store.ts tests/agent/daily-report-digest/daily-report-project-view-roster-store.test.ts
git commit -m "feat(daily-report): add project view roster SQLite store"
```

---

### Task 2: View cache store

**Files:**
- Create: `src/agent/daily-report-digest/daily-report-project-view-cache.ts`
- Test: `tests/agent/daily-report-digest/daily-report-project-view-cache.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createProjectViewCacheStore,
  getProjectViewCache,
  putProjectViewCache,
} from "../../../src/agent/daily-report-digest/daily-report-project-view-cache";

describe("daily-report-project-view-cache", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pv-cache-"));
  const dbPath = path.join(tmpDir, "wb.sqlite");

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it("round-trips digest payload", () => {
    const store = createProjectViewCacheStore(dbPath);
    try {
      const payload = { submitted: [{ userid: "u1", name: "A", reports: [] }], errors: [] };
      putProjectViewCache("semiconductor-vein", "2026-06-08", payload, store);
      const hit = getProjectViewCache("semiconductor-vein", "2026-06-08", store);
      expect(hit?.payload).toEqual(payload);
      expect(hit?.hitCount).toBe(1);
    } finally {
      store.close();
    }
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/agent/daily-report-digest/daily-report-project-view-cache.test.ts`

- [ ] **Step 3: Implement cache store**

Payload type: reuse `OrgDigest` subset `{ submitted, errors }`. Store as JSON string; `hit_count = submitted.length`.

```typescript
// Key exports:
// createProjectViewCacheStore(dbPath?)
// getProjectViewCache(viewId, dateYmd, store) => { payload, scannedAt, hitCount } | null
// putProjectViewCache(viewId, dateYmd, payload, store)
// deleteProjectViewCache(viewId, dateYmd, store)  // for refresh
```

Table DDL:

```sql
CREATE TABLE IF NOT EXISTS daily_report_project_view_cache (
  view_id TEXT NOT NULL,
  date_ymd TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  scanned_at TEXT NOT NULL,
  PRIMARY KEY (view_id, date_ymd)
);
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/agent/daily-report-digest/daily-report-project-view-cache.ts tests/agent/daily-report-digest/daily-report-project-view-cache.test.ts
git commit -m "feat(daily-report): add project view digest cache store"
```

---

### Task 3: Org-wide scan contacts + discovery

**Files:**
- Create: `src/agent/daily-report-digest/daily-report-org-scan-contacts.ts`
- Create: `src/agent/daily-report-digest/daily-report-project-view-discovery.ts`
- Test: `tests/agent/daily-report-digest/daily-report-project-view-discovery.test.ts`
- Modify: `src/agent/daily-report-digest/daily-report-config.ts` — add `discoveryDays?: number` to `DailyReportProjectViewConfig` via parseProjectViewConfig
- Modify: `src/agent/daily-report-digest/daily-report-project-views.ts` — export `discoveryDays` default 30

- [ ] **Step 1: Write failing discovery test with mock report client**

Test cases:
1. `listOrgScanContacts` excludes names matching `/机器人|T-/`
2. `discoverProjectViewMembers` returns userids only when filter matches in any of last N days
3. `runProjectViewDiscovery` calls `mergeDiscoveryMembers` and returns `{ added, totalRoster }`

Mock pattern:

```typescript
const mockClient = {
  fetchUserReports: vi.fn(async ({ userid }) =>
    userid === "hit" ? [entryWithPairMatch] : [],
  ),
};
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement org scan contacts**

```typescript
// daily-report-org-scan-contacts.ts
import { createPeopleDirectoryStore } from "../../infra/people-directory-store";

const BOT_NAME_RE = /机器人|T-/;

export function isBotLikeContactName(name: string): boolean {
  return BOT_NAME_RE.test(name.trim());
}

export function listOrgScanContacts(deps?: {
  peopleStore?: ReturnType<typeof createPeopleDirectoryStore>;
}): Array<{ userid: string; name: string }> {
  const store = deps?.peopleStore ?? createPeopleDirectoryStore();
  try {
    return store
      .listContacts()
      .filter((c) => c.active && !isBotLikeContactName(c.name))
      .map((c) => ({ userid: c.userId, name: c.name.trim() || c.userId }));
  } finally {
    if (!deps?.peopleStore) store.close();
  }
}
```

- [ ] **Step 4: Implement discovery with concurrency helper**

Add inline helper in discovery file (no new package):

```typescript
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}
```

`discoverProjectViewMembers(org, view, discoveryDays, deps)`:
- Loop `d = 0..discoveryDays-1` calendar days from today backward
- For each contact, `fetchUserReports` per day range via `resolveDayRangeForYmd`
- If any filtered report has contents → add to Set
- Return `{ userid, name }[]`

`runProjectViewDiscovery(viewId, config, deps)`:
- find view + org
- discover members
- merge into roster store
- return stats

**Env:** `DAILY_REPORT_PROJECT_VIEW_SCAN_CONCURRENCY` default `12`

- [ ] **Step 5: Run tests — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/agent/daily-report-digest/daily-report-org-scan-contacts.ts \
  src/agent/daily-report-digest/daily-report-project-view-discovery.ts \
  src/agent/daily-report-digest/daily-report-config.ts \
  src/agent/daily-report-digest/daily-report-project-views.ts \
  tests/agent/daily-report-digest/daily-report-project-view-discovery.test.ts
git commit -m "feat(daily-report): org-wide project view discovery"
```

---

### Task 4: Roster-based collect + cache integration

**Files:**
- Create: `src/agent/daily-report-digest/daily-report-project-view-collect.ts`
- Modify: `src/agent/daily-report-digest/daily-report-project-views.ts` — remove inline collect; re-export
- Modify: `src/web/daily-reports-api.ts`

- [ ] **Step 1: Write failing test for roster collect**

```typescript
it("collectProjectViewDigestForRange scans roster not org.employees", async () => {
  // roster has u1; org.employees empty
  // mock client returns filtered report for u1 only
  // expect submitted.length === 1
});
```

- [ ] **Step 2: Implement collect**

```typescript
// daily-report-project-view-collect.ts
export async function collectProjectViewDigestForRange(
  org: DailyReportOrgConfig,
  view: DailyReportProjectViewConfig,
  range: ReportTimeRange,
  roster: ProjectViewRosterMember[],
  deps?: { reportClient?: DingTalkReportClient; fetchImpl?: typeof fetch },
): Promise<OrgDigest> {
  const client = deps?.reportClient ?? createDingTalkReportClient({ fetchImpl: deps?.fetchImpl });
  const submitted: OrgDigest["submitted"] = [];
  const errors: OrgDigest["errors"] = [];
  const concurrency = Number(process.env.DAILY_REPORT_PROJECT_VIEW_SCAN_CONCURRENCY || 12);

  await mapWithConcurrency(roster, concurrency, async (emp) => {
    try {
      const reps = await client.fetchUserReports({ /* org creds */, userid: emp.userid, startTime: range.startTime, endTime: range.endTime });
      const filteredReports = reps
        .map((r) => filterReportEntryByModuleProjectPair(r, view.filters))
        .map((r) => filterReportEntry(r))
        .filter((r) => r.contents.length > 0);
      if (filteredReports.length > 0) {
        submitted.push({
          userid: emp.userid,
          name: filteredReports[0]?.creatorName?.trim() || emp.name || emp.userid,
          reports: filteredReports,
        });
      }
    } catch (err) {
      errors.push({ userid: emp.userid, name: emp.name || emp.userid, reason: String(err) });
    }
  });

  submitted.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  return { label: org.label, submitted, missing: [], onLeave: [], errors };
}
```

- [ ] **Step 3: Wire API cache-first**

In `buildDailyReportsHttpPayload` custom branch:

```typescript
const refresh = input?.refresh === true;
const rosterStore = createProjectViewRosterStore();
const cacheStore = createProjectViewCacheStore();
try {
  let roster = listProjectViewRoster(customViewId, rosterStore);
  if (roster.length === 0 && !refresh) {
    // trigger background discovery once; return scanning state
  }
  if (!refresh) {
    const cached = getProjectViewCache(customViewId, range.labelYmd, cacheStore);
    if (cached) {
      return buildPayloadFromCache(cached, ...);
    }
  }
  const digest = await collectProjectViewDigestForRange(org, viewDef, range, roster, deps);
  putProjectViewCache(customViewId, range.labelYmd, digest, cacheStore);
  // ...
} finally {
  rosterStore.close();
  cacheStore.close();
}
```

Add to payload:

```typescript
scanning?: boolean;
rosterCount?: number;
cacheScannedAt?: string;
```

Add `refresh?: boolean` to `buildDailyReportsHttpPayload` input.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/agent/daily-report-digest/daily-report-project-views.test.ts tests/web/daily-reports.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/agent/daily-report-digest/daily-report-project-view-collect.ts \
  src/agent/daily-report-digest/daily-report-project-views.ts \
  src/web/daily-reports-api.ts tests/
git commit -m "feat(daily-report): roster-based custom view collect with cache"
```

---

### Task 5: Prewarm scheduler + startup bootstrap

**Files:**
- Create: `src/agent/daily-report-digest/daily-report-project-view-prewarm.ts`
- Modify: `src/dingtalk-bot.ts`

- [ ] **Step 1: Write failing scheduler test**

Use fake timers / inject `now`:

```typescript
it("prewarm runs at 07:30 local on weekdays for yesterday range", async () => {
  // Monday 07:30 → skip (legacy digest also skips Mon)
  // Tuesday 07:30 → prewarm Friday? No - resolveReportRange on Tue → Monday ymd
});
```

Match spec: prewarm on **weekdays** (Tue–Sat aligned with digest send days, skip Sun/Mon same as `isDailyReportSendWindow` weekday rule OR simpler: Mon–Fri 07:30 — **use same weekday gate as legacy**: skip Sunday(0) and Monday(1).

- [ ] **Step 2: Implement prewarm**

```typescript
export function createDailyReportProjectViewPrewarmScheduler(deps?) {
  const PREWARM_HOUR = 7;
  const PREWARM_MINUTE = 30;
  let scanning = false;

  async function runPrewarm(now = new Date()) {
    if (scanning) return;
    const { config } = loadDailyReportDigestConfig();
    const views = listProjectViewsFromConfig(config.orgs);
    if (!views.length) return;
    const { weekday, hour, minute } = getLocalTimeParts(now, config.timezone);
    if (weekday === 0 || weekday === 1) return;
    if (hour !== PREWARM_HOUR || minute < PREWARM_MINUTE || minute >= PREWARM_MINUTE + 5) return;

    scanning = true;
    try {
      const range = resolveReportRange(now, config.timezone, cutoffOpts);
      for (const view of views) {
        const org = config.orgs.find((o) => o.label === view.orgLabel);
        if (!org) continue;
        const roster = listProjectViewRoster(view.id, rosterStore);
        if (!roster.length) {
          await runProjectViewDiscovery(view.id, config);
        }
        const digest = await collectProjectViewDigestForRange(org, view, range, roster);
        putProjectViewCache(view.id, range.labelYmd, digest, cacheStore);
      }
    } finally {
      scanning = false;
    }
  }

  async function bootstrapOnStartup() {
    // For each view with empty roster → fire-and-forget discovery (no notify)
  }

  return { runPrewarm, bootstrapOnStartup, startIntervalLoop, stopIntervalLoop };
}
```

Wire in `dingtalk-bot.ts` after daily report scheduler:

```typescript
const projectViewPrewarm = createDailyReportProjectViewPrewarmScheduler();
projectViewPrewarm.bootstrapOnStartup().catch(() => undefined);
projectViewPrewarm.startIntervalLoop(); // reuse config.scanIntervalMs
```

- [ ] **Step 3: Run tests — PASS**

- [ ] **Step 4: Commit**

```bash
git add src/agent/daily-report-digest/daily-report-project-view-prewarm.ts src/dingtalk-bot.ts tests/
git commit -m "feat(daily-report): project view prewarm scheduler and bootstrap"
```

---

### Task 6: Roster HTTP API + page UI

**Files:**
- Create: `src/web/daily-reports-project-view-roster.ts`
- Modify: `src/web/assignment-workbench.ts`
- Modify: `src/web/daily-reports-page.ts`

- [ ] **Step 1: Implement service layer**

```typescript
// daily-reports-project-view-roster.ts
export function canManageProjectViewRoster(userId: string, viewId: string, config, caps): boolean {
  if (caps.canAccessAdmin) return true;
  const view = findProjectViewById(config, viewId);
  return Boolean(view?.viewers.includes(userId));
}

export async function getProjectViewRosterPayload(viewId: string) { /* list roster */ }
export async function mutateProjectViewRoster(input: { viewId; action: "add"|"remove"; userid; name? }) { /* ... */ }
export async function rediscoverProjectViewRoster(viewId: string) { /* runProjectViewDiscovery */ }
```

- [ ] **Step 2: Add routes in assignment-workbench.ts**

Paths (mirror legacy roster pattern):

- `GET /api/workbench/daily-reports/project-views/:viewId/roster`
- `POST /api/workbench/daily-reports/project-views/:viewId/roster` — `{ action: "add"|"remove", userid, name? }`
- `POST /api/workbench/daily-reports/project-views/:viewId/discover`

Session: require viewer or admin via `canManageProjectViewRoster`.

Also wire `?refresh=1` on GET daily-reports data API.

- [ ] **Step 3: Page UI for customOnly users**

When `access.customOnly` or viewing custom tab:
- Show **「项目组名单」** panel (reuse `.drm-*` styles from legacy roster block)
- Buttons: **重新发现** → POST discover
- Search uses existing `/contacts?org=微光&q=`
- Hide legacy roster / project-groups toolbars for `customOnly`

Client JS additions in `buildDailyReportsClientJs`:
- `PV_ROSTER = API + '/project-views/' + viewId + '/roster'`
- Load roster on tab switch; add/remove handlers

- [ ] **Step 4: Manual smoke**

Run: `npm test -- tests/web/daily-reports.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/web/daily-reports-project-view-roster.ts src/web/assignment-workbench.ts src/web/daily-reports-page.ts tests/web/daily-reports.test.ts
git commit -m "feat(daily-report): project view roster API and workbench UI"
```

---

### Task 7: Probe script + ECS config

**Files:**
- Modify: `scripts/probe-custom-project-view.mjs`
- Modify: `scripts/ecs-setup-mingsibot.sh` or add `scripts/ecs-patch-project-view.mjs`

- [ ] **Step 1: Update probe for org_all**

Replace `org.employees` loop with:

```javascript
import { listOrgScanContacts } from "../src/agent/daily-report-digest/daily-report-org-scan-contacts.ts";
const contacts = listOrgScanContacts();
```

Print `{ rosterCandidates: [...], hitCount, hits }` — **no webhook, no stdout to dingtalk**.

- [ ] **Step 2: Document ECS config patch**

Add to 微光 org in `/opt/manage_robot-mingsibot/data/daily-report-digest.config.json`:

```json
"projectViews": [{
  "id": "semiconductor-vein",
  "label": "半导体激光·静脉项目",
  "viewers": ["01451725613871"],
  "exclusiveForViewers": true,
  "discoveryDays": 30,
  "filters": {
    "workModuleContains": "半导体激光",
    "costProjectContains": "静脉腔内闭合系统"
  }
}]
```

Ensure mingsibot env:
- `WORKBENCH_SQLITE_PATH` points to dingtalk contacts DB **or** sync path
- `DAILY_REPORT_DIGEST_CONFIG_FILE` set

- [ ] **Step 3: Commit**

```bash
git add scripts/probe-custom-project-view.mjs scripts/
git commit -m "chore(daily-report): org_all probe and ECS config notes"
```

---

### Task 8: Verification + deploy (no notifications)

- [ ] **Step 1: Full unit tests**

Run: `npm test -- tests/agent/daily-report-digest/ tests/web/daily-reports.test.ts`
Expected: all PASS

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: ECS read-only probe (operator)**

```bash
# On ECS mingsibot container — read only
PROBE_DAYS=30 ORG_LABEL=微光 node scripts/probe-custom-project-view.mjs
```

Confirm hit list + candidate roster size before enabling viewers.

- [ ] **Step 4: Deploy**

Patch config → restart mingsibot → verify 曹一挥 page:
- Default yesterday
- Historical date pick
- Roster panel populated after bootstrap
- Refresh button updates cache
- **No** digest messages sent

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Legacy unchanged | Tasks 4–6 do not modify `collectOrgDigests` / legacy tabs |
| 曹一挥 exclusive view | Already in project-views; Task 6 UI |
| Filter pair ①–⑥ | Existing filter; Task 4 collect |
| Default yesterday + history | Task 4 API uses existing range helpers |
| Bootstrap discovery auto roster | Task 3, 5 bootstrap |
| Daily roster-only scan | Task 4 |
| 7:30 prewarm | Task 5 |
| Cache | Task 2, 4 |
| Roster add/remove/rediscover | Task 6 |
| No notifications | All tasks — no webhook calls |
| P2 早报 | **Out of scope** |

## Self-review notes

- Roster store uses same SQLite file as contacts (`WORKBENCH_SQLITE_PATH`); tables are new, no conflict with legacy config JSON roster.
- If contacts DB empty on mingsibot, discovery falls back to logging warning — document ECS path requirement in deploy step.
- `collectCustomProjectViewDigest` old function removed/replaced to prevent accidental `org.employees` scan.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-09-daily-report-custom-project-views.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — implement tasks in this session with checkpoints

Which approach?
