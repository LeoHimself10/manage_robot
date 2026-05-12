# DingTalk Workbench WebApp v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a role-based DingTalk web workbench with separate manager/employee portals, a dedicated conversation center, and an in-progress session page mapped to existing plan states.

**Architecture:** Keep the current single-process Node runtime and extend the existing HTTP handler into a lightweight web app plus JSON APIs. Reuse file-based repos/session stores (`plan-store`, `assignment-draft-repo`, `plan-session-store`) and add a focused workbench service layer for role filtering, conversation sessions, and progress updates. Preserve auditability by writing all mutating actions to assignment/session event logs.

**Tech Stack:** TypeScript, Node HTTP server, existing repos in `src/integrations/repos`, existing orchestrator (`runOrchestrator`), Vitest.

---

## Scope Check

Spec `docs/superpowers/specs/2026-05-11-dingtalk-workbench-webapp-design.md` is implementable as one subsystem in one plan: one web workbench feature set with four pages and minimal APIs. No additional sub-project split is required.

## File Structure (Lock Before Coding)

### New files

- `src/web/workbench-types.ts`  
  Shared DTO/types for role, task rows, subtask progress, conversation session stages.
- `src/web/workbench-auth.ts`  
  Resolve current user + role from entry token and enforce page/API access.
- `src/web/workbench-service.ts`  
  Read model snapshots/repos and assemble manager/employee/in-progress/conversation view models.
- `src/web/workbench-api.ts`  
  Route JSON API endpoints (`/api/me`, `/api/tasks`, `/api/tasks/:id`, etc.).
- `src/web/workbench-pages.ts`  
  Render four HTML pages (manager home, employee home, conversation center, in-progress sessions).
- `tests/web/workbench-auth.test.ts`
- `tests/web/workbench-service.test.ts`
- `tests/web/workbench-api.test.ts`
- `tests/web/workbench-pages.test.ts`

### Modified files

- `src/web/assignment-workbench.ts`  
  Convert from one static page to multi-route web app entry + API dispatch.
- `src/dingtalk-bot.ts`  
  Keep existing behavior, but ensure workbench entry URLs can open role-specific pages.
- `src/dingtalk-session-context.ts`  
  Extend assignment session state with in-progress conversation metadata.
- `src/infra/plan-session-store.ts`  
  Add optional `conversationSessions` array persisted per plan session.
- `src/integrations/repos/assignment-event-repo.ts`  
  Add typed helper to append workbench mutation events (progress update/apply change).
- `tests/web/assignment-workbench.test.ts`  
  Update existing expectations from skeleton page to route-aware behavior.
- `tests/infra/plan-session-store.test.ts`
- `tests/dingtalk-session-context.test.ts`

### Not touched in v1

- Main planner schema/prompt files under `src/agent/demo/`
- OA/approval workflow modules
- External DB/Redis layers

---

### Task 1: Define Workbench Domain Contracts

**Files:**
- Create: `src/web/workbench-types.ts`
- Test: `tests/web/workbench-service.test.ts`

- [ ] **Step 1: Write failing type-usage test for stage mapping**

```ts
// tests/web/workbench-service.test.ts
import { describe, expect, it } from "vitest";
import { mapPlanStatusToWorkbenchStage } from "../../src/web/workbench-service";

describe("mapPlanStatusToWorkbenchStage", () => {
  it("maps known plan statuses to workbench stages", () => {
    expect(mapPlanStatusToWorkbenchStage("DRAFT_READY")).toBe("DRAFT");
    expect(mapPlanStatusToWorkbenchStage("IN_EXECUTION")).toBe("EXECUTION");
    expect(mapPlanStatusToWorkbenchStage("DONE")).toBe("DONE");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/web/workbench-service.test.ts`  
Expected: FAIL with module/function not found for `workbench-service`.

- [ ] **Step 3: Add shared workbench type contracts**

```ts
// src/web/workbench-types.ts
export type WorkbenchRole = "manager" | "employee";

export type WorkbenchStage =
  | "DRAFT"
  | "ASSIGNMENT"
  | "DISPATCHED"
  | "EXECUTION"
  | "ACCEPTANCE"
  | "DONE";

export interface WorkbenchUser {
  userId: string;
  displayName?: string;
  role: WorkbenchRole;
}

export interface WorkbenchTaskSummary {
  planId: string;
  traceId?: string;
  title: string;
  stage: WorkbenchStage;
  ownerUserId?: string;
  updatedAt?: string;
}

export interface WorkbenchSubtaskProgress {
  taskId: string;
  title: string;
  assigneeUserId?: string;
  status: string;
  note?: string;
  updatedAt?: string;
}
```

- [ ] **Step 4: Create stage mapper in service module**

```ts
// src/web/workbench-service.ts
import type { WorkbenchStage } from "./workbench-types";

export function mapPlanStatusToWorkbenchStage(status: string): WorkbenchStage {
  if (status === "DRAFT_READY") return "DRAFT";
  if (status === "ASSIGNMENT_RECOMMENDING" || status === "AWAITING_DISPATCH_CONFIRM") return "ASSIGNMENT";
  if (status === "DISPATCHED") return "DISPATCHED";
  if (status === "NEGOTIATING" || status === "IN_EXECUTION") return "EXECUTION";
  if (status === "IN_ACCEPTANCE") return "ACCEPTANCE";
  return "DONE";
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/web/workbench-service.test.ts`  
Expected: PASS with 1 test passed.

- [ ] **Step 6: Commit**

```bash
git add src/web/workbench-types.ts src/web/workbench-service.ts tests/web/workbench-service.test.ts
git commit -m "feat(web): add workbench domain contracts and stage mapping"
```

---

### Task 2: Add Role Resolution and Access Guards

**Files:**
- Create: `src/web/workbench-auth.ts`
- Modify: `src/security/web-entry-token.ts`
- Test: `tests/web/workbench-auth.test.ts`

- [ ] **Step 1: Write failing auth guard tests**

```ts
// tests/web/workbench-auth.test.ts
import { describe, expect, it } from "vitest";
import { ensureWorkbenchAccess } from "../../src/web/workbench-auth";

describe("ensureWorkbenchAccess", () => {
  it("allows manager route for manager role", () => {
    expect(() => ensureWorkbenchAccess("manager", "/workbench/manager")).not.toThrow();
  });

  it("blocks employee opening manager page", () => {
    expect(() => ensureWorkbenchAccess("employee", "/workbench/manager")).toThrow("forbidden");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/web/workbench-auth.test.ts`  
Expected: FAIL with missing `workbench-auth.ts`.

- [ ] **Step 3: Implement role resolution and guard**

```ts
// src/web/workbench-auth.ts
import { verifyAssignmentEntry } from "../security/web-entry-token";
import type { WorkbenchRole } from "./workbench-types";

export interface WorkbenchIdentity {
  userId: string;
  role: WorkbenchRole;
}

export function resolveWorkbenchIdentityFromToken(token: string): WorkbenchIdentity {
  const verified = verifyAssignmentEntry(token);
  return { userId: verified.userId, role: verified.role as WorkbenchRole };
}

export function ensureWorkbenchAccess(role: WorkbenchRole, path: string): void {
  if (path.startsWith("/workbench/manager") && role !== "manager") {
    throw new Error("forbidden");
  }
  if (path.startsWith("/workbench/employee") && role !== "employee" && role !== "manager") {
    throw new Error("forbidden");
  }
}
```

- [ ] **Step 4: Expand token role union in security layer**

```ts
// src/security/web-entry-token.ts
export interface SignParams {
  planId: string;
  userId: string;
  role: "manager" | "employee";
  ttlSeconds?: number;
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/web/workbench-auth.test.ts tests/security/web-entry-token.test.ts`  
Expected: PASS for both files.

- [ ] **Step 6: Commit**

```bash
git add src/web/workbench-auth.ts src/security/web-entry-token.ts tests/web/workbench-auth.test.ts tests/security/web-entry-token.test.ts
git commit -m "feat(web): add role-based workbench auth guard"
```

---

### Task 3: Persist In-Progress Conversation Sessions

**Files:**
- Modify: `src/infra/plan-session-store.ts`
- Modify: `src/dingtalk-session-context.ts`
- Test: `tests/infra/plan-session-store.test.ts`
- Test: `tests/dingtalk-session-context.test.ts`

- [ ] **Step 1: Add failing persistence test**

```ts
// tests/infra/plan-session-store.test.ts
it("persists conversationSessions in plan session file", () => {
  const store = createPlanSessionStore();
  const session = store.loadOrCreate("chat-key");
  session.conversationSessions = [{ id: "c1", planId: session.planId, stage: "WAITING_MODEL" }];
  store.save(session);
  const loaded = store.loadByChatKey("chat-key");
  expect(loaded?.conversationSessions?.[0]?.id).toBe("c1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/infra/plan-session-store.test.ts`  
Expected: FAIL because `conversationSessions` is not typed/preserved.

- [ ] **Step 3: Extend session model**

```ts
// src/infra/plan-session-store.ts
export interface ConversationSessionState {
  id: string;
  planId: string;
  stage: "WAITING_MODEL" | "WAITING_MANAGER" | "WAITING_EMPLOYEE" | "READY_TO_APPLY";
  lastMessageAt?: string;
  summary?: string;
}

export interface PlanSession {
  // existing fields...
  conversationSessions?: ConversationSessionState[];
}

// inside loadByChatKeyHash return
conversationSessions: Array.isArray(loaded.conversationSessions)
  ? loaded.conversationSessions
  : [],
```

- [ ] **Step 4: Propagate into DingTalk session context**

```ts
// src/dingtalk-session-context.ts
export interface AssignmentSessionState {
  stage?: "RECOMMENDING" | "AWAITING_DISPATCH_CONFIRM" | "DISPATCHED";
  lastAssignmentTraceId?: string;
  inProgressConversationIds?: string[];
}
```

- [ ] **Step 5: Run related tests**

Run: `npm test -- tests/infra/plan-session-store.test.ts tests/dingtalk-session-context.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/infra/plan-session-store.ts src/dingtalk-session-context.ts tests/infra/plan-session-store.test.ts tests/dingtalk-session-context.test.ts
git commit -m "feat(session): persist in-progress conversation session states"
```

---

### Task 4: Build Workbench Service (Task List + Details + In-Progress)

**Files:**
- Modify: `src/web/workbench-service.ts`
- Modify: `src/web/loaders.ts`
- Test: `tests/web/workbench-service.test.ts`

- [ ] **Step 1: Add failing service behavior tests**

```ts
// tests/web/workbench-service.test.ts
it("returns manager-visible tasks with filters", () => {
  const service = createWorkbenchService(deps);
  const tasks = service.listTasks({ role: "manager", userId: "u1" }, { keyword: "客诉" });
  expect(tasks.length).toBeGreaterThan(0);
});

it("restricts employee tasks to assignee scope", () => {
  const service = createWorkbenchService(deps);
  const tasks = service.listTasks({ role: "employee", userId: "emp-1" }, {});
  expect(tasks.every((t) => t.ownerUserId === "emp-1" || t.title.includes("emp-1"))).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify fail**

Run: `npm test -- tests/web/workbench-service.test.ts`  
Expected: FAIL because `createWorkbenchService` and list methods are missing.

- [ ] **Step 3: Implement service factory and task filtering**

```ts
// src/web/workbench-service.ts
export function createWorkbenchService(deps: {
  readAssignmentDraft: typeof readAssignmentDraft;
  getEmployeeProfiles: typeof getEmployeeProfiles;
  loadPlanSessions: () => PlanSession[];
}) {
  return {
    listTasks(identity: WorkbenchUser, query: { keyword?: string; stage?: string }) {
      const all = buildTaskSummaries(deps.loadPlanSessions());
      const scoped = identity.role === "manager"
        ? all
        : all.filter((t) => t.ownerUserId === identity.userId);
      return applyTaskFilters(scoped, query);
    },
    getTaskDetail(planId: string, identity: WorkbenchUser) {
      return buildTaskDetail(planId, identity, deps);
    },
    listInProgressSessions(identity: WorkbenchUser) {
      return buildInProgressSessions(identity, deps.loadPlanSessions());
    },
  };
}
```

- [ ] **Step 4: Add loader to scan session files**

```ts
// src/web/loaders.ts
export function listPlanSessions(sessionDir: string): PlanSession[] {
  const files = readdirSync(sessionDir).filter((f) => f.endsWith(".json"));
  return files.map((f) =>
    JSON.parse(readFileSync(join(sessionDir, f), "utf8")) as PlanSession
  );
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/web/workbench-service.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/workbench-service.ts src/web/loaders.ts tests/web/workbench-service.test.ts
git commit -m "feat(web): add workbench service for role-scoped task views"
```

---

### Task 5: Implement JSON APIs for Workbench

**Files:**
- Create: `src/web/workbench-api.ts`
- Modify: `src/web/assignment-workbench.ts`
- Test: `tests/web/workbench-api.test.ts`

- [ ] **Step 1: Write failing API route tests**

```ts
// tests/web/workbench-api.test.ts
it("GET /api/me returns identity JSON", async () => {
  const res = await request("/api/me?token=valid");
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body).role).toBe("manager");
});

it("PATCH /api/subtasks/:id/progress rejects cross-user write", async () => {
  const res = await request("/api/subtasks/sub-1/progress?token=employee-x", "PATCH", {
    status: "IN_EXECUTION",
  });
  expect(res.statusCode).toBe(403);
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `npm test -- tests/web/workbench-api.test.ts`  
Expected: FAIL with missing API router.

- [ ] **Step 3: Add API dispatcher**

```ts
// src/web/workbench-api.ts
export async function handleWorkbenchApi(req: IncomingMessage, res: ServerResponse, deps: ApiDeps): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (!url.pathname.startsWith("/api/")) return false;

  if (req.method === "GET" && url.pathname === "/api/me") {
    const identity = deps.resolveIdentity(url);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(identity));
    return true;
  }
  // additional handlers for /api/tasks, /api/tasks/:id, /api/in-progress-sessions, /api/conversations*
  return respondNotFound(res);
}
```

- [ ] **Step 4: Wire API into workbench handler**

```ts
// src/web/assignment-workbench.ts
if (await handleWorkbenchApi(req, res, apiDeps)) {
  return true;
}
```

- [ ] **Step 5: Run API tests**

Run: `npm test -- tests/web/workbench-api.test.ts tests/web/assignment-workbench.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/workbench-api.ts src/web/assignment-workbench.ts tests/web/workbench-api.test.ts tests/web/assignment-workbench.test.ts
git commit -m "feat(web): add workbench json api routes"
```

---

### Task 6: Implement Four Page Renderers and Route Split

**Files:**
- Create: `src/web/workbench-pages.ts`
- Modify: `src/web/assignment-workbench.ts`
- Test: `tests/web/workbench-pages.test.ts`

- [ ] **Step 1: Write failing page render tests**

```ts
// tests/web/workbench-pages.test.ts
it("renders manager page with task filters section", () => {
  const html = renderManagerPage({ userName: "主管A", tasks: [] });
  expect(html).toContain("分配与追踪中心");
  expect(html).toContain("筛选");
});

it("renders conversation center with two modes", () => {
  const html = renderConversationCenterPage();
  expect(html).toContain("开启新任务");
  expect(html).toContain("编辑进行中任务");
});
```

- [ ] **Step 2: Run tests to verify fail**

Run: `npm test -- tests/web/workbench-pages.test.ts`  
Expected: FAIL because renderer module does not exist.

- [ ] **Step 3: Add deterministic page renderers**

```ts
// src/web/workbench-pages.ts
export function renderManagerPage(input: { userName: string; tasks: WorkbenchTaskSummary[] }): string {
  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>主管工作台</title></head>
<body><h1>分配与追踪中心</h1><section>筛选</section></body></html>`;
}

export function renderEmployeePage(input: { userName: string; tasks: WorkbenchTaskSummary[] }): string {
  return `<!DOCTYPE html><html lang="zh"><body><h1>我的任务</h1></body></html>`;
}

export function renderConversationCenterPage(): string {
  return `<!DOCTYPE html><html lang="zh"><body><h1>任务对话中心</h1><button>开启新任务</button><button>编辑进行中任务</button></body></html>`;
}

export function renderInProgressPage(): string {
  return `<!DOCTYPE html><html lang="zh"><body><h1>进行中任务</h1></body></html>`;
}
```

- [ ] **Step 4: Route paths in handler**

```ts
// src/web/assignment-workbench.ts
if (url.pathname === "/workbench/manager") { /* renderManagerPage */ }
if (url.pathname === "/workbench/employee") { /* renderEmployeePage */ }
if (url.pathname === "/workbench/conversation") { /* renderConversationCenterPage */ }
if (url.pathname === "/workbench/in-progress") { /* renderInProgressPage */ }
```

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/web/workbench-pages.test.ts tests/web/assignment-workbench.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/workbench-pages.ts src/web/assignment-workbench.ts tests/web/workbench-pages.test.ts tests/web/assignment-workbench.test.ts
git commit -m "feat(web): add role-split workbench pages and routing"
```

---

### Task 7: Add Conversation Center APIs (New Task + Edit In-Progress + Apply)

**Files:**
- Modify: `src/web/workbench-api.ts`
- Modify: `src/agent/orchestrator.ts`
- Modify: `src/dingtalk-bot.ts`
- Test: `tests/web/workbench-api.test.ts`
- Test: `tests/agent/orchestrator.test.ts`

- [ ] **Step 1: Add failing conversation API tests**

```ts
// tests/web/workbench-api.test.ts
it("POST /api/conversations/new-task creates a session", async () => {
  const res = await request("/api/conversations/new-task?token=manager", "POST", { prompt: "新建客诉任务" });
  expect(res.statusCode).toBe(201);
  expect(JSON.parse(res.body).conversationId).toBeTruthy();
});

it("POST /api/conversations/:id/apply writes a new revision", async () => {
  const res = await request("/api/conversations/c1/apply?token=manager", "POST", { suggestionId: "s1" });
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body).applied).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify fail**

Run: `npm test -- tests/web/workbench-api.test.ts`  
Expected: FAIL because conversation endpoints are missing.

- [ ] **Step 3: Implement conversation handlers and apply workflow**

```ts
// src/web/workbench-api.ts
if (req.method === "POST" && url.pathname === "/api/conversations/new-task") {
  const body = await readJson(req);
  const created = deps.conversationService.createNewTaskConversation(identity, body.prompt);
  return respondJson(res, 201, created);
}

if (req.method === "POST" && /\/api\/conversations\/[^/]+\/apply$/.test(url.pathname)) {
  const body = await readJson(req);
  const output = deps.conversationService.applySuggestion(identity, conversationId, body.suggestionId);
  return respondJson(res, 200, output);
}
```

- [ ] **Step 4: Ensure apply path writes revision + event**

```ts
// conversation service implementation called by API
planSessionStore.appendEvent({
  planId,
  chatKeyHash,
  eventType: "WORKBENCH_APPLY_CHANGE",
  payload: { conversationId, suggestionId, actorUserId: identity.userId },
});
```

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/web/workbench-api.test.ts tests/agent/orchestrator.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/workbench-api.ts src/dingtalk-bot.ts src/agent/orchestrator.ts tests/web/workbench-api.test.ts tests/agent/orchestrator.test.ts
git commit -m "feat(web): add conversation center api for new/edit/apply flows"
```

---

### Task 8: Final Verification and Documentation Sync

**Files:**
- Modify: `docs/deploy-aliyun-dingtalk.md`
- Modify: `.env.example`
- Test: `tests/web/*.test.ts`

- [ ] **Step 1: Add environment variables documentation**

```md
# .env.example additions
ASSIGNMENT_WEB_PORT=8787
ASSIGNMENT_WEB_PUBLIC_BASE_URL=
ASSIGNMENT_WEB_SECRET=
WORKBENCH_SESSION_DIR=./data/sessions
```

- [ ] **Step 2: Update deployment doc with new routes**

```md
工作台页面：
- /workbench/manager
- /workbench/employee
- /workbench/conversation
- /workbench/in-progress
JSON API:
- /api/me
- /api/tasks
- /api/tasks/:taskId
- /api/subtasks/:subTaskId/progress
- /api/conversations/new-task
- /api/conversations/:id/messages
- /api/conversations/:id/apply
- /api/in-progress-sessions
```

- [ ] **Step 3: Run focused web tests**

Run: `npm test -- tests/web/assignment-workbench.test.ts tests/web/workbench-auth.test.ts tests/web/workbench-service.test.ts tests/web/workbench-api.test.ts tests/web/workbench-pages.test.ts`  
Expected: PASS all tests.

- [ ] **Step 4: Run full verification**

Run: `npm test && npm run typecheck`  
Expected: all tests pass and TypeScript emits no errors.

- [ ] **Step 5: Commit**

```bash
git add docs/deploy-aliyun-dingtalk.md .env.example tests/web src/web src/infra/plan-session-store.ts src/dingtalk-session-context.ts
git commit -m "feat(workbench): deliver role-split webapp with conversation and progress tracking"
```

---

## Spec Coverage Check (Self-Review)

### 1) Coverage Mapping

- Role-separated pages (manager/employee): **Task 6**
- Separate conversation page + two modes (new/edit): **Task 6 + Task 7**
- In-progress page grouped by session stage: **Task 4 + Task 6**
- Manager all history + subtask progress visibility: **Task 4 + Task 5**
- Employee update own subtask only: **Task 5**
- Existing state machine mapping: **Task 1**
- Versioned apply + audit events: **Task 3 + Task 7**
- API minimal set (8 endpoints): **Task 5 + Task 7**

No uncovered spec requirement remains.

### 2) Placeholder Scan

No `TBD/TODO/later` placeholders remain in task steps.

### 3) Type Consistency Check

- Uses consistent role union: `"manager" | "employee"`.
- Uses consistent conversation stages: `"WAITING_MODEL" | "WAITING_MANAGER" | "WAITING_EMPLOYEE" | "READY_TO_APPLY"`.
- Uses shared stage mapper output type `WorkbenchStage`.

---

## Notes for Execution

- Prefer implementing tasks in order; each task keeps tests green and yields a commit boundary.
- Do not expand scope to OA sync, approvals, or external DB migration during this plan.
