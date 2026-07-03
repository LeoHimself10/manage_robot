# Manager Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-managed manager groups so multiple supervisors in the same group can fully manage shared tasks and projects, while different groups remain isolated.

**Architecture:** Add a small JSON-backed manager-group directory for membership and Admin UI management, then add `manager_group_id` ownership to formal tasks and projects. Runtime authorization resolves each manager request into either personal scope or group scope; existing personal-manager behavior remains the default when `WORKBENCH_MANAGER_GROUPS_ENABLED` is off.

**Tech Stack:** TypeScript, Vitest, Node SQLite (`node:sqlite`), existing workbench HTTP handler, existing Admin permissions page, existing DingTalk/Workbench task store.

---

## File Structure

- Create `src/security/workbench-manager-groups.ts` for the feature flag, group JSON persistence, membership validation, and simple CRUD.
- Create `src/security/workbench-manager-scope.ts` for resolving a manager actor to personal or group scope and checking task/project access.
- Modify `src/security/workbench-manager-whitelist.ts` so enabled manager-group members count as managers.
- Modify `src/infra/workbench-project-types.ts` to include `managerGroupId`.
- Modify `src/infra/workbench-formal-task-store.ts` to add `manager_group_id`, group-scoped task/project methods, migration helpers, and group-aware authorization inputs.
- Modify `src/web/admin-workbench-pages.ts` to add the Admin "主管组" UI.
- Modify `src/web/assignment-workbench.ts` to expose Admin manager-group APIs and use manager scope for task/project/detail/action endpoints.
- Modify `src/web/workbench-project-api.ts`, `src/web/weekly-dashboard-api.ts`, `src/web/performance-dashboard-api.ts`, and related fact builders to accept group scope.
- Modify `src/agent/tools/list-managed-tasks.ts`, `src/agent/tools/get-task-detail.ts`, `src/agent/tools/reassign-task.ts`, `src/agent/tools/send-subtask-reminder.ts`, `src/agent/tools/publish-task.ts`, `src/agent/tools/project-portfolio-tools.ts`, and v2 tool equivalents to use manager scope.
- Modify `.env.example` and `docs/deploy-aliyun-dingtalk.md` to document the mingsibot-only rollout switch.
- Add tests in `tests/security/workbench-manager-groups.test.ts`, `tests/infra/workbench-formal-task-store.test.ts`, `tests/web/admin-permissions-page.test.ts`, `tests/web/assignment-workbench.test.ts`, `tests/agent/tools/manager-groups.test.ts`, and dashboard/tool tests as noted below.

---

### Task 1: Manager Group Directory And Feature Flag

**Files:**
- Create: `src/security/workbench-manager-groups.ts`
- Modify: `src/security/workbench-manager-whitelist.ts`
- Test: `tests/security/workbench-manager-groups.test.ts`
- Test: `tests/security/workbench-manager-whitelist.test.ts`

- [ ] **Step 1: Write failing directory tests**

Add `tests/security/workbench-manager-groups.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  addWorkbenchManagerGroupMember,
  createWorkbenchManagerGroup,
  findWorkbenchManagerGroupForUser,
  isWorkbenchManagerGroupsEnabled,
  listWorkbenchManagerGroups,
  listWorkbenchManagerGroupMemberIds,
  migrateLegacyManagerGroupFile,
  removeWorkbenchManagerGroupMember,
  updateWorkbenchManagerGroup,
} from "../../src/security/workbench-manager-groups";

describe("workbench manager groups", () => {
  let dir = "";
  let file = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "manager-groups-"));
    file = join(dir, "groups.json");
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_FILE", file);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled unless WORKBENCH_MANAGER_GROUPS_ENABLED=1", () => {
    expect(isWorkbenchManagerGroupsEnabled()).toBe(false);
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    expect(isWorkbenchManagerGroupsEnabled()).toBe(true);
  });

  it("creates groups and enforces one group per regular manager", () => {
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    const a = createWorkbenchManagerGroup({ name: "明思项目主管组", description: "项目侧" });
    const b = createWorkbenchManagerGroup({ name: "商务部主管组" });

    addWorkbenchManagerGroupMember(a.groupId, "rain");
    expect(() => addWorkbenchManagerGroupMember(b.groupId, "rain")).toThrow(/already belongs/i);
    expect(findWorkbenchManagerGroupForUser("rain")?.groupId).toBe(a.groupId);
    expect(listWorkbenchManagerGroupMemberIds()).toEqual(new Set(["rain"]));
  });

  it("removes members and preserves the group", () => {
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    const group = createWorkbenchManagerGroup({ name: "商务部主管组" });
    addWorkbenchManagerGroupMember(group.groupId, "biz-1");
    removeWorkbenchManagerGroupMember(group.groupId, "biz-1");
    expect(findWorkbenchManagerGroupForUser("biz-1")).toBeUndefined();
    expect(listWorkbenchManagerGroups()).toHaveLength(1);
  });

  it("updates name, description, status and portfolio flag", () => {
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    const group = createWorkbenchManagerGroup({ name: "旧名称" });
    const updated = updateWorkbenchManagerGroup(group.groupId, {
      name: "明思项目主管组",
      description: "共享项目管理",
      status: "inactive",
      portfolioEnabled: true,
    });
    expect(updated).toMatchObject({
      groupId: group.groupId,
      name: "明思项目主管组",
      description: "共享项目管理",
      status: "inactive",
      portfolioEnabled: true,
    });
  });

  it("normalizes old array files into the object shape", () => {
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    migrateLegacyManagerGroupFile([
      { groupId: "mgrgrp:legacy", name: "Legacy", memberUserIds: ["a", "b"] },
    ]);
    const raw = JSON.parse(readFileSync(file, "utf8")) as { groups: unknown[] };
    expect(raw.groups).toHaveLength(1);
    expect(listWorkbenchManagerGroups()[0].memberUserIds).toEqual(["a", "b"]);
  });
});
```

Extend `tests/security/workbench-manager-whitelist.test.ts`:

```ts
  it("includes manager group members when manager groups are enabled", async () => {
    const { createWorkbenchManagerGroup, addWorkbenchManagerGroupMember } = await import(
      "../../src/security/workbench-manager-groups"
    );
    if (!dynamicFile) throw new Error("missing dynamic file");
    const groupFile = join(tmpdir(), `test-workbench-manager-groups-${Date.now()}.json`);
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_FILE", groupFile);
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "");
    const group = createWorkbenchManagerGroup({ name: "明思项目主管组" });
    addWorkbenchManagerGroupMember(group.groupId, "group-mgr");
    expect(isWorkbenchManager("group-mgr")).toBe(true);
  });
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run tests/security/workbench-manager-groups.test.ts tests/security/workbench-manager-whitelist.test.ts
```

Expected: FAIL because `src/security/workbench-manager-groups.ts` does not exist and `listWorkbenchManagerIds()` does not read group members.

- [ ] **Step 3: Implement the manager-group directory**

Create `src/security/workbench-manager-groups.ts`:

```ts
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type WorkbenchManagerGroupStatus = "active" | "inactive";

export interface WorkbenchManagerGroup {
  groupId: string;
  name: string;
  description?: string;
  status: WorkbenchManagerGroupStatus;
  portfolioEnabled: boolean;
  memberUserIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface ManagerGroupFile {
  groups: WorkbenchManagerGroup[];
}

export function isWorkbenchManagerGroupsEnabled(): boolean {
  return process.env.WORKBENCH_MANAGER_GROUPS_ENABLED === "1";
}

export function resolveWorkbenchManagerGroupsPath(): string {
  return process.env.WORKBENCH_MANAGER_GROUPS_FILE?.trim() || "./data/workbench-manager-groups.json";
}

function normalizeUserId(userId: string): string {
  return String(userId ?? "").trim();
}

function normalizeGroup(raw: unknown, now: string): WorkbenchManagerGroup | undefined {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const name = String(obj.name ?? "").trim();
  if (!name) return undefined;
  const groupId = String(obj.groupId ?? "").trim() || `mgrgrp:${randomUUID()}`;
  const seen = new Set<string>();
  const memberUserIds = Array.isArray(obj.memberUserIds)
    ? obj.memberUserIds.map((x) => normalizeUserId(String(x))).filter(Boolean).filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
    : [];
  return {
    groupId,
    name,
    description: String(obj.description ?? "").trim() || undefined,
    status: obj.status === "inactive" ? "inactive" : "active",
    portfolioEnabled: obj.portfolioEnabled === true,
    memberUserIds,
    createdAt: String(obj.createdAt ?? "").trim() || now,
    updatedAt: String(obj.updatedAt ?? "").trim() || now,
  };
}

function readFile(): ManagerGroupFile {
  const path = resolveWorkbenchManagerGroupsPath();
  const now = new Date().toISOString();
  if (!existsSync(path)) return { groups: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const source = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { groups?: unknown }).groups)
        ? (parsed as { groups: unknown[] }).groups
        : [];
    return { groups: source.map((g) => normalizeGroup(g, now)).filter((g): g is WorkbenchManagerGroup => Boolean(g)) };
  } catch {
    return { groups: [] };
  }
}

function writeFile(data: ManagerGroupFile): void {
  const path = resolveWorkbenchManagerGroupsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ groups: data.groups }, null, 2), "utf8");
}

function assertUniqueMember(groups: WorkbenchManagerGroup[], userId: string, targetGroupId: string): void {
  for (const group of groups) {
    if (group.groupId !== targetGroupId && group.memberUserIds.includes(userId)) {
      throw new Error(`user already belongs to manager group: ${group.name}`);
    }
  }
}

export function migrateLegacyManagerGroupFile(groups: unknown[]): void {
  const now = new Date().toISOString();
  writeFile({ groups: groups.map((g) => normalizeGroup(g, now)).filter((g): g is WorkbenchManagerGroup => Boolean(g)) });
}

export function listWorkbenchManagerGroups(): WorkbenchManagerGroup[] {
  if (!isWorkbenchManagerGroupsEnabled()) return [];
  return readFile().groups;
}

export function listWorkbenchManagerGroupMemberIds(): Set<string> {
  const ids = new Set<string>();
  for (const group of listWorkbenchManagerGroups()) {
    if (group.status !== "active") continue;
    for (const id of group.memberUserIds) ids.add(id);
  }
  return ids;
}

export function findWorkbenchManagerGroupForUser(userId: string): WorkbenchManagerGroup | undefined {
  const uid = normalizeUserId(userId);
  if (!uid) return undefined;
  return listWorkbenchManagerGroups().find((group) => group.status === "active" && group.memberUserIds.includes(uid));
}

export function createWorkbenchManagerGroup(input: {
  name: string;
  description?: string;
  portfolioEnabled?: boolean;
}): WorkbenchManagerGroup {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("manager group name is required");
  const now = new Date().toISOString();
  const data = readFile();
  const group: WorkbenchManagerGroup = {
    groupId: `mgrgrp:${randomUUID()}`,
    name,
    description: String(input.description ?? "").trim() || undefined,
    status: "active",
    portfolioEnabled: input.portfolioEnabled === true,
    memberUserIds: [],
    createdAt: now,
    updatedAt: now,
  };
  data.groups.push(group);
  writeFile(data);
  return group;
}

export function updateWorkbenchManagerGroup(
  groupId: string,
  patch: { name?: string; description?: string; status?: WorkbenchManagerGroupStatus; portfolioEnabled?: boolean },
): WorkbenchManagerGroup {
  const gid = String(groupId ?? "").trim();
  const data = readFile();
  const group = data.groups.find((g) => g.groupId === gid);
  if (!group) throw new Error("manager group not found");
  if (patch.name !== undefined) {
    const name = String(patch.name ?? "").trim();
    if (!name) throw new Error("manager group name is required");
    group.name = name;
  }
  if (patch.description !== undefined) group.description = String(patch.description ?? "").trim() || undefined;
  if (patch.status !== undefined) group.status = patch.status === "inactive" ? "inactive" : "active";
  if (patch.portfolioEnabled !== undefined) group.portfolioEnabled = patch.portfolioEnabled === true;
  group.updatedAt = new Date().toISOString();
  writeFile(data);
  return group;
}

export function addWorkbenchManagerGroupMember(groupId: string, userId: string): WorkbenchManagerGroup {
  const gid = String(groupId ?? "").trim();
  const uid = normalizeUserId(userId);
  if (!uid) throw new Error("userId is required");
  const data = readFile();
  const group = data.groups.find((g) => g.groupId === gid);
  if (!group) throw new Error("manager group not found");
  assertUniqueMember(data.groups, uid, gid);
  if (!group.memberUserIds.includes(uid)) group.memberUserIds.push(uid);
  group.updatedAt = new Date().toISOString();
  writeFile(data);
  return group;
}

export function removeWorkbenchManagerGroupMember(groupId: string, userId: string): WorkbenchManagerGroup {
  const gid = String(groupId ?? "").trim();
  const uid = normalizeUserId(userId);
  const data = readFile();
  const group = data.groups.find((g) => g.groupId === gid);
  if (!group) throw new Error("manager group not found");
  group.memberUserIds = group.memberUserIds.filter((id) => id !== uid);
  group.updatedAt = new Date().toISOString();
  writeFile(data);
  return group;
}
```

Modify `src/security/workbench-manager-whitelist.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { resolveWorkbenchDynamicManagersPath } from "./workbench-manager-dynamic-path";
import { listWorkbenchManagerGroupMemberIds } from "./workbench-manager-groups";

// Inside listWorkbenchManagerIds(), just before `return allow;`:
for (const id of listWorkbenchManagerGroupMemberIds()) {
  allow.add(id);
}
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
npx vitest run tests/security/workbench-manager-groups.test.ts tests/security/workbench-manager-whitelist.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/security/workbench-manager-groups.ts src/security/workbench-manager-whitelist.ts tests/security/workbench-manager-groups.test.ts tests/security/workbench-manager-whitelist.test.ts
git commit -m "feat: add manager group directory"
```

---

### Task 2: Manager Scope Resolver

**Files:**
- Create: `src/security/workbench-manager-scope.ts`
- Test: `tests/security/workbench-manager-scope.test.ts`

- [ ] **Step 1: Write failing scope tests**

Create `tests/security/workbench-manager-scope.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addWorkbenchManagerGroupMember, createWorkbenchManagerGroup } from "../../src/security/workbench-manager-groups";
import { canAccessManagerOwnedObject, resolveWorkbenchManagerScope } from "../../src/security/workbench-manager-scope";

describe("workbench manager scope", () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "manager-scope-"));
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_FILE", join(dir, "groups.json"));
  });

  it("returns personal scope when manager groups are disabled", () => {
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "0");
    expect(resolveWorkbenchManagerScope("mgr-a")).toEqual({
      actorUserId: "mgr-a",
      managerUserId: "mgr-a",
      managerGroupId: undefined,
    });
  });

  it("returns group scope for enabled active group members", () => {
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    const group = createWorkbenchManagerGroup({ name: "商务部主管组" });
    addWorkbenchManagerGroupMember(group.groupId, "biz-a");
    expect(resolveWorkbenchManagerScope("biz-a")).toEqual({
      actorUserId: "biz-a",
      managerUserId: "biz-a",
      managerGroupId: group.groupId,
    });
  });

  it("allows group objects for same group and personal objects for the actor", () => {
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    const group = createWorkbenchManagerGroup({ name: "明思项目主管组" });
    addWorkbenchManagerGroupMember(group.groupId, "mgr-a");
    const scope = resolveWorkbenchManagerScope("mgr-a");
    expect(canAccessManagerOwnedObject({ managerUserId: "mgr-b", managerGroupId: group.groupId }, scope)).toBe(true);
    expect(canAccessManagerOwnedObject({ managerUserId: "mgr-a" }, scope)).toBe(true);
    expect(canAccessManagerOwnedObject({ managerUserId: "mgr-b" }, scope)).toBe(false);
    expect(canAccessManagerOwnedObject({ managerUserId: "mgr-b", managerGroupId: "mgrgrp:other" }, scope)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npx vitest run tests/security/workbench-manager-scope.test.ts
```

Expected: FAIL because `workbench-manager-scope.ts` does not exist.

- [ ] **Step 3: Implement scope resolver**

Create `src/security/workbench-manager-scope.ts`:

```ts
import { findWorkbenchManagerGroupForUser } from "./workbench-manager-groups";

export interface WorkbenchManagerScope {
  actorUserId: string;
  managerUserId: string;
  managerGroupId?: string;
}

export interface ManagerOwnedObject {
  managerUserId: string;
  managerGroupId?: string;
}

export function resolveWorkbenchManagerScope(actorUserId: string): WorkbenchManagerScope {
  const actor = String(actorUserId ?? "").trim();
  const group = findWorkbenchManagerGroupForUser(actor);
  return {
    actorUserId: actor,
    managerUserId: actor,
    managerGroupId: group?.groupId,
  };
}

export function canAccessManagerOwnedObject(
  object: ManagerOwnedObject,
  scope: WorkbenchManagerScope,
): boolean {
  const objectGroupId = String(object.managerGroupId ?? "").trim();
  if (scope.managerGroupId && objectGroupId) return objectGroupId === scope.managerGroupId;
  if (objectGroupId && !scope.managerGroupId) return false;
  return String(object.managerUserId ?? "").trim() === scope.managerUserId;
}

export function managerScopeLabel(scope: WorkbenchManagerScope): string {
  return scope.managerGroupId ? `group:${scope.managerGroupId}` : `manager:${scope.managerUserId}`;
}
```

- [ ] **Step 4: Run test and verify pass**

Run:

```bash
npx vitest run tests/security/workbench-manager-scope.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/security/workbench-manager-scope.ts tests/security/workbench-manager-scope.test.ts
git commit -m "feat: resolve manager group scope"
```

---

### Task 3: Store Schema, Group Ownership, And Migration Helpers

**Files:**
- Modify: `src/infra/workbench-project-types.ts`
- Modify: `src/infra/workbench-formal-task-store.ts`
- Test: `tests/infra/workbench-formal-task-store.test.ts`

- [ ] **Step 1: Write failing store tests**

Append to `tests/infra/workbench-formal-task-store.test.ts`:

```ts
  it("publishes tasks and projects into manager group scope", () => {
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: "hash-group-publish",
      planId: "plan-group-publish",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "mgr-a",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "组内任务",
        tasks: [{ id: "task_1", title: "交付样品" }],
      },
      latestAssignment: {
        assignments: [{ taskId: "task_1", primary: { userId: "emp-a" } }],
      },
    };
    const project = store.createProject({
      ownerUserId: "mgr-a",
      managerGroupId: "mgrgrp:mingsi",
      name: "明思项目",
    });
    const published = store.publishFromSession({
      planId: "plan-group-publish",
      session,
      managerUserId: "mgr-a",
      managerGroupId: "mgrgrp:mingsi",
      initiatorDepartment: "项目部",
      actorUserId: "mgr-a",
      projectId: project.projectId,
    });
    expect(published.task.managerGroupId).toBe("mgrgrp:mingsi");
    expect(project.managerGroupId).toBe("mgrgrp:mingsi");
    expect(store.listManagerTasks({ managerUserId: "mgr-b", managerGroupId: "mgrgrp:mingsi" })).toHaveLength(1);
    expect(store.listManagerTasks({ managerUserId: "mgr-b", managerGroupId: "mgrgrp:biz" })).toHaveLength(0);
    expect(store.getProjectForManagerScope(project.projectId, { managerUserId: "mgr-b", managerGroupId: "mgrgrp:mingsi" })?.name).toBe("明思项目");
  });

  it("migrates existing personal tasks and projects into a manager group", () => {
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: "hash-migrate-group",
      planId: "plan-migrate-group",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "mgr-a",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "历史个人任务",
        tasks: [{ id: "task_1", title: "历史事项" }],
      },
      latestAssignment: {
        assignments: [{ taskId: "task_1", primary: { userId: "emp-a" } }],
      },
    };
    const project = store.createProject({ ownerUserId: "mgr-a", name: "历史项目" });
    store.publishFromSession({
      planId: "plan-migrate-group",
      session,
      managerUserId: "mgr-a",
      initiatorDepartment: "项目部",
      actorUserId: "mgr-a",
      projectId: project.projectId,
    });
    const result = store.migrateManagerObjectsToGroup({
      managerUserId: "mgr-a",
      managerGroupId: "mgrgrp:mingsi",
    });
    expect(result).toEqual({ tasksUpdated: 1, projectsUpdated: 1 });
    expect(store.listManagerTasks({ managerUserId: "mgr-b", managerGroupId: "mgrgrp:mingsi" })).toHaveLength(1);
  });
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npx vitest run tests/infra/workbench-formal-task-store.test.ts -t "manager group|migrates existing personal"
```

Expected: FAIL because store types and methods do not support `managerGroupId`.

- [ ] **Step 3: Add project and task row fields**

Modify `src/infra/workbench-project-types.ts`:

```ts
export interface WorkbenchProjectRow {
  projectId: string;
  name: string;
  description?: string;
  ownerUserId: string;
  managerGroupId?: string;
  status: WorkbenchProjectStatus;
  aliases: string[];
  createdAt: string;
  updatedAt: string;
}
```

Modify `src/infra/workbench-formal-task-store.ts`:

```ts
export interface WorkbenchTaskRow {
  taskId: string;
  taskNo: string;
  planId: string;
  title: string;
  description?: string;
  status: WorkbenchTaskStatus;
  initiatorUserId: string;
  initiatorDepartment: string;
  managerUserId: string;
  managerGroupId?: string;
  sourceTraceId?: string;
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
  projectId?: string;
  sourceMeetingBatchId?: string;
}

export type WorkbenchManagerTaskScope =
  | string
  | { managerUserId: string; managerGroupId?: string };

function normalizeManagerTaskScope(scope: WorkbenchManagerTaskScope): {
  managerUserId: string;
  managerGroupId?: string;
} {
  if (typeof scope === "string") return { managerUserId: scope.trim() };
  return {
    managerUserId: String(scope.managerUserId ?? "").trim(),
    managerGroupId: String(scope.managerGroupId ?? "").trim() || undefined,
  };
}
```

In `mapTaskRow`, add:

```ts
managerGroupId: asString(row.manager_group_id),
```

In project row mapping, add:

```ts
managerGroupId: asString(row.manager_group_id),
```

- [ ] **Step 4: Add schema migrations**

Add helpers near existing schema helpers:

```ts
function ensureTaskManagerGroupIdColumn(db: DatabaseSync): void {
  const rows = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name?: string }>;
  if (!rows.some((r) => String(r.name ?? "") === "manager_group_id")) {
    db.exec("ALTER TABLE tasks ADD COLUMN manager_group_id TEXT");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_manager_group ON tasks(manager_group_id)");
}

function ensureProjectManagerGroupIdColumn(db: DatabaseSync): void {
  const rows = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name?: string }>;
  if (!rows.some((r) => String(r.name ?? "") === "manager_group_id")) {
    db.exec("ALTER TABLE projects ADD COLUMN manager_group_id TEXT");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_projects_manager_group ON projects(manager_group_id)");
}
```

Call them after existing project/task schema calls:

```ts
ensureProjectsTable(db);
ensureTaskProjectIdColumn(db);
ensureTaskManagerGroupIdColumn(db);
ensureProjectManagerGroupIdColumn(db);
```

- [ ] **Step 5: Update publish and project writes**

Modify `publishFromSession` input and insert:

```ts
publishFromSession(input: {
  planId: string;
  session: PlanSession;
  managerUserId: string;
  managerGroupId?: string | null;
  initiatorDepartment?: string;
  actorUserId: string;
  actorName?: string;
  projectId?: string | null;
})
```

When validating `projectId`, allow either same owner or same group:

```ts
const rawManagerGroupId = String(input.managerGroupId ?? "").trim();
const projectOwnerClause = rawManagerGroupId
  ? "(owner_user_id = ? OR manager_group_id = ?)"
  : "owner_user_id = ?";
const projectOwnerArgs = rawManagerGroupId
  ? [input.managerUserId.trim(), rawManagerGroupId]
  : [input.managerUserId.trim()];
const proj = db
  .prepare(
    `SELECT * FROM projects WHERE project_id = ? AND ${projectOwnerClause} AND status = 'active' LIMIT 1`,
  )
  .get(rawProjectId, ...projectOwnerArgs) as Record<string, unknown> | undefined;
```

Update task insert SQL to include `manager_group_id`:

```ts
`INSERT INTO tasks(task_id, task_no, plan_id, title, description, status, initiator_user_id, initiator_department, manager_user_id, manager_group_id, source_trace_id, published_at, created_at, updated_at, project_id)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
```

Pass:

```ts
input.managerUserId,
rawManagerGroupId || null,
asString(input.session.lastTraceId) || null,
```

Modify `createProject` input and insert:

```ts
createProject(input: {
  ownerUserId: string;
  managerGroupId?: string | null;
  name: string;
  description?: string;
  aliases?: string[];
}): WorkbenchProjectRow
```

Use:

```ts
`INSERT INTO projects(project_id, name, description, owner_user_id, manager_group_id, status, aliases_json, created_at, updated_at)
 VALUES(?,?,?,?,?,?,?,?,?)`
```

- [ ] **Step 6: Add group-scoped reads and migration**

Update `listManagerTasks` to accept `WorkbenchManagerTaskScope`:

```ts
listManagerTasks(
  scopeInput: WorkbenchManagerTaskScope,
  filter?: { projectId?: string },
): Array<WorkbenchTaskRow & { subtasksCount: number; blockedCount: number }> {
  const scope = normalizeManagerTaskScope(scopeInput);
  const mid = scope.managerUserId;
  const gid = scope.managerGroupId;
  const pid = String(filter?.projectId ?? "").trim();
  const scopeClause = gid ? "t.manager_group_id = ?" : "t.manager_user_id = ?";
  const scopeArgs = gid ? [gid] : [mid];
  const projectClause = pid === UNASSIGNED_PROJECT_BUCKET
    ? " AND (t.project_id IS NULL OR t.project_id = '')"
    : pid
      ? " AND t.project_id = ?"
      : "";
  const rows = db.prepare(
    `SELECT t.*,
      (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.task_id) AS subtasks_count,
      (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.task_id AND s.status = 'BLOCKED') AS blocked_count
     FROM tasks t
     WHERE ${scopeClause}${projectClause}
     ORDER BY t.updated_at DESC`,
  ).all(...scopeArgs, ...(pid && pid !== UNASSIGNED_PROJECT_BUCKET ? [pid] : [])) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    ...mapTaskRow(row),
    subtasksCount: Number(row.subtasks_count ?? 0),
    blockedCount: Number(row.blocked_count ?? 0),
  }));
}
```

Add methods:

```ts
listProjectsForManagerScope(scopeInput: WorkbenchManagerTaskScope): WorkbenchProjectRow[] {
  const scope = normalizeManagerTaskScope(scopeInput);
  const rows = scope.managerGroupId
    ? db.prepare("SELECT * FROM projects WHERE manager_group_id = ? ORDER BY CASE WHEN status = 'archived' THEN 1 ELSE 0 END, updated_at DESC").all(scope.managerGroupId)
    : db.prepare("SELECT * FROM projects WHERE owner_user_id = ? ORDER BY CASE WHEN status = 'archived' THEN 1 ELSE 0 END, updated_at DESC").all(scope.managerUserId);
  return (rows as Array<Record<string, unknown>>).map((row) => mapProjectRow(row));
},

getProjectForManagerScope(projectId: string, scopeInput: WorkbenchManagerTaskScope): WorkbenchProjectRow | undefined {
  const scope = normalizeManagerTaskScope(scopeInput);
  const row = scope.managerGroupId
    ? db.prepare("SELECT * FROM projects WHERE project_id = ? AND manager_group_id = ? LIMIT 1").get(projectId.trim(), scope.managerGroupId)
    : db.prepare("SELECT * FROM projects WHERE project_id = ? AND owner_user_id = ? LIMIT 1").get(projectId.trim(), scope.managerUserId);
  return row ? mapProjectRow(row as Record<string, unknown>) : undefined;
},

migrateManagerObjectsToGroup(input: { managerUserId: string; managerGroupId: string }): {
  tasksUpdated: number;
  projectsUpdated: number;
} {
  const managerUserId = input.managerUserId.trim();
  const managerGroupId = input.managerGroupId.trim();
  if (!managerUserId || !managerGroupId) throw new Error("managerUserId and managerGroupId are required");
  const now = nowIso();
  const tasks = db.prepare(
    "UPDATE tasks SET manager_group_id = ?, updated_at = ? WHERE manager_user_id = ? AND (manager_group_id IS NULL OR manager_group_id = '')",
  ).run(managerGroupId, now, managerUserId).changes;
  const projects = db.prepare(
    "UPDATE projects SET manager_group_id = ?, updated_at = ? WHERE owner_user_id = ? AND (manager_group_id IS NULL OR manager_group_id = '')",
  ).run(managerGroupId, now, managerUserId).changes;
  return { tasksUpdated: Number(tasks ?? 0), projectsUpdated: Number(projects ?? 0) };
},
```

- [ ] **Step 7: Run tests and verify pass**

Run:

```bash
npx vitest run tests/infra/workbench-formal-task-store.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/infra/workbench-project-types.ts src/infra/workbench-formal-task-store.ts tests/infra/workbench-formal-task-store.test.ts
git commit -m "feat: persist manager group ownership"
```

---

### Task 4: Admin Manager-Group APIs And Permissions UI

**Files:**
- Modify: `src/web/assignment-workbench.ts`
- Modify: `src/web/admin-workbench-pages.ts`
- Test: `tests/web/admin-permissions-page.test.ts`
- Test: `tests/web/assignment-workbench.test.ts`

- [ ] **Step 1: Write failing UI and API tests**

Extend `tests/web/admin-permissions-page.test.ts`:

```ts
  it("permissions page exposes manager group management", () => {
    const html = renderAdminPermissionsPage({ userLabel: "管理员" });
    expect(html).toContain("主管组");
    expect(html).toContain("/api/workbench/admin/manager-groups");
    expect(html).toContain("managerGroupListMount");
    expect(html).toContain("createManagerGroupBtn");
  });
```

Add to the admin section of `tests/web/assignment-workbench.test.ts`:

```ts
  it("admin can create manager groups and enforce single membership", async () => {
    vi.stubEnv("WORKBENCH_ADMIN_USER_IDS", "admin-1");
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_FILE", join(tmpdir(), `test-manager-groups-${Date.now()}.json`));
    const cookie = await loginCookie("admin-1", "manager");

    const createReq = stubReq({
      url: "/api/workbench/admin/manager-groups",
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "明思项目主管组", description: "项目任务共享", portfolioEnabled: true }),
    });
    const { res: createRes, captured: createCaptured } = stubRes();
    expect(await handleAssignmentHttp(createReq, createRes)).toBe(true);
    const created = JSON.parse(createCaptured().body) as { ok: boolean; group: { groupId: string } };
    expect(created.ok).toBe(true);

    const addReq = stubReq({
      url: "/api/workbench/admin/manager-groups/members",
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ groupId: created.group.groupId, userId: "mgr-a", enabled: true }),
    });
    const { res: addRes, captured: addCaptured } = stubRes();
    expect(await handleAssignmentHttp(addReq, addRes)).toBe(true);
    expect(JSON.parse(addCaptured().body).ok).toBe(true);

    const listReq = stubReq({
      url: "/api/workbench/admin/manager-groups",
      method: "GET",
      headers: { cookie },
    });
    const { res: listRes, captured: listCaptured } = stubRes();
    expect(await handleAssignmentHttp(listReq, listRes)).toBe(true);
    const listed = JSON.parse(listCaptured().body) as { groups: Array<{ memberUserIds: string[] }> };
    expect(listed.groups[0].memberUserIds).toContain("mgr-a");
  });
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run tests/web/admin-permissions-page.test.ts tests/web/assignment-workbench.test.ts -t "manager group|permissions page exposes manager group"
```

Expected: FAIL because the page and API routes do not exist.

- [ ] **Step 3: Add Admin API routes**

In `src/web/assignment-workbench.ts`, import:

```ts
import {
  addWorkbenchManagerGroupMember,
  createWorkbenchManagerGroup,
  listWorkbenchManagerGroups,
  removeWorkbenchManagerGroupMember,
  updateWorkbenchManagerGroup,
} from "../security/workbench-manager-groups";
```

Add routes near existing admin manager routes:

```ts
  if (isGetOrHead && url.pathname === "/api/workbench/admin/manager-groups") {
    const session = requireSession(req, res, "admin");
    if (!session) return true;
    const store = getFormalTaskStore();
    const groups = listWorkbenchManagerGroups().map((group) => ({
      ...group,
      taskCount: store.countTasksForManagerGroup(group.groupId),
      projectCount: store.countProjectsForManagerGroup(group.groupId),
      members: group.memberUserIds.map((userId) => ({
        userId,
        name: withPeopleDirectoryStore((s) => s.getContact(userId)?.name?.trim()) ?? "",
      })),
    }));
    writeJson(res, 200, { ok: true, groups });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/admin/manager-groups") {
    const session = requireSession(req, res, "admin");
    if (!session) return true;
    readJsonBody(req).then((body) => {
      const groupId = String(body.groupId ?? "").trim();
      const patch = {
        name: String(body.name ?? "").trim(),
        description: String(body.description ?? "").trim(),
        status: body.status === "inactive" ? "inactive" as const : "active" as const,
        portfolioEnabled: body.portfolioEnabled === true,
      };
      const group = groupId
        ? updateWorkbenchManagerGroup(groupId, patch)
        : createWorkbenchManagerGroup(patch);
      writeJson(res, 200, { ok: true, group });
    }).catch((err) => {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : "manager group save failed" });
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/admin/manager-groups/members") {
    const session = requireSession(req, res, "admin");
    if (!session) return true;
    readJsonBody(req).then((body) => {
      const groupId = String(body.groupId ?? "").trim();
      const userId = String(body.userId ?? "").trim();
      const group = body.enabled === false
        ? removeWorkbenchManagerGroupMember(groupId, userId)
        : addWorkbenchManagerGroupMember(groupId, userId);
      writeJson(res, 200, { ok: true, group });
    }).catch((err) => {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : "manager group member save failed" });
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/admin/manager-groups/migrate") {
    const session = requireSession(req, res, "admin");
    if (!session) return true;
    readJsonBody(req).then((body) => {
      const result = getFormalTaskStore().migrateManagerObjectsToGroup({
        managerUserId: String(body.managerUserId ?? "").trim(),
        managerGroupId: String(body.groupId ?? "").trim(),
      });
      writeJson(res, 200, { ok: true, ...result });
    }).catch((err) => {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : "manager group migration failed" });
    });
    return true;
  }
```

Add store counters in Task 3 implementation if they were not added:

```ts
countTasksForManagerGroup(managerGroupId: string): number {
  const row = db.prepare("SELECT COUNT(*) AS total FROM tasks WHERE manager_group_id = ?").get(managerGroupId.trim()) as { total?: number } | undefined;
  return Number(row?.total ?? 0);
},

countProjectsForManagerGroup(managerGroupId: string): number {
  const row = db.prepare("SELECT COUNT(*) AS total FROM projects WHERE manager_group_id = ?").get(managerGroupId.trim()) as { total?: number } | undefined;
  return Number(row?.total ?? 0);
},
```

- [ ] **Step 4: Add Admin UI section**

In `src/web/admin-workbench-pages.ts`, add a third list card under existing manager/portfolio cards:

```html
<section class="admin-perm-list-card">
  <div class="admin-perm-list-card__head">
    <h4>主管组</h4>
    <span class="admin-perm-count" id="managerGroupCount">0</span>
  </div>
  <div class="admin-perm-list-card__body" id="managerGroupListMount">加载中…</div>
</section>
```

Add a compact form in the left panel:

```html
<div class="admin-perm-action">
  <div class="admin-perm-action__title">主管组</div>
  <div class="admin-perm-action__hint">创建组后，将人员加入同一组即可共享主管工作台权限。</div>
  <label>组名 <input id="managerGroupName" type="text" placeholder="如：商务部主管组" /></label>
  <label>说明 <input id="managerGroupDesc" type="text" placeholder="可选" /></label>
  <label><input id="managerGroupPortfolio" type="checkbox" /> 启用项目管理能力</label>
  <button class="btn btn-primary btn-sm" id="createManagerGroupBtn" type="button">新建主管组</button>
</div>
```

Add client functions:

```js
async function loadManagerGroups() {
  var res = await fetch('/api/workbench/admin/manager-groups');
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
  var rows = data.groups || [];
  var mount = document.getElementById('managerGroupListMount');
  var count = document.getElementById('managerGroupCount');
  if (count) count.textContent = String(rows.length);
  if (!rows.length) {
    mount.innerHTML = '<div class="empty-state" style="padding:12px 0;margin:0;">暂无主管组</div>';
    return;
  }
  mount.innerHTML = rows.map(function (g) {
    return '<div class="admin-perm-row">'
      + '<span class="admin-perm-av">' + esc(permInitial(g.name)) + '</span>'
      + '<div><div class="admin-perm-row__name">' + esc(g.name) + '</div>'
      + '<div class="admin-perm-row__id">' + esc(g.groupId) + ' · 成员 ' + esc(String((g.memberUserIds || []).length)) + ' · 任务 ' + esc(String(g.taskCount || 0)) + '</div></div>'
      + '<span class="admin-perm-tag ' + (g.status === 'inactive' ? 'is-env' : 'is-dynamic') + '">' + (g.status === 'inactive' ? '停用' : '启用') + '</span>'
      + '</div>';
  }).join('');
}

async function createManagerGroup() {
  var name = (document.getElementById('managerGroupName').value || '').trim();
  if (!name) {
    setFb('permFeedback', '请填写主管组名称', 'err');
    return;
  }
  var res = await fetch('/api/workbench/admin/manager-groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: name,
      description: (document.getElementById('managerGroupDesc').value || '').trim(),
      portfolioEnabled: document.getElementById('managerGroupPortfolio').checked
    })
  });
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
  setFb('permFeedback', '已创建主管组：' + name, 'ok');
  await loadManagerGroups();
}
```

Wire the button and initial load:

```js
document.getElementById('createManagerGroupBtn').addEventListener('click', function () {
  void createManagerGroup().catch(function (e) {
    setFb('permFeedback', String(e && e.message ? e.message : e), 'err');
  });
});

void Promise.all([loadManagers(), loadPortfolioManagers(), loadManagerGroups()]).catch(function (e) {
  setFb('permFeedback', String(e && e.message ? e.message : e), 'err');
});
```

- [ ] **Step 5: Run tests and verify pass**

Run:

```bash
npx vitest run tests/web/admin-permissions-page.test.ts tests/web/assignment-workbench.test.ts -t "manager group|permissions page exposes manager group"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/assignment-workbench.ts src/web/admin-workbench-pages.ts tests/web/admin-permissions-page.test.ts tests/web/assignment-workbench.test.ts
git commit -m "feat: manage supervisor groups from admin"
```

---

### Task 5: Manager Workbench Task And Project Scope

**Files:**
- Modify: `src/web/assignment-workbench.ts`
- Modify: `src/web/workbench-project-api.ts`
- Test: `tests/web/assignment-workbench.test.ts`

- [ ] **Step 1: Write failing cross-manager group tests**

Add to `tests/web/assignment-workbench.test.ts`:

```ts
  it("manager group members can list and open each other's group tasks", async () => {
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_FILE", join(tmpdir(), `test-manager-groups-${Date.now()}.json`));
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "");
    const { createWorkbenchManagerGroup, addWorkbenchManagerGroupMember } = await import("../../src/security/workbench-manager-groups");
    const group = createWorkbenchManagerGroup({ name: "明思项目主管组" });
    addWorkbenchManagerGroupMember(group.groupId, "mgr-a");
    addWorkbenchManagerGroupMember(group.groupId, "mgr-b");
    await seedPublishedTask({ planId: "plan-group-visible", managerUserId: "mgr-a", assigneeUserId: "emp-a" });
    createWorkbenchFormalTaskStore().migrateManagerObjectsToGroup({ managerUserId: "mgr-a", managerGroupId: group.groupId });
    const cookie = await loginCookie("mgr-b", "manager");

    const listReq = stubReq({ url: "/api/workbench/manager/tasks", method: "GET", headers: { cookie } });
    const { res: listRes, captured: listCaptured } = stubRes();
    expect(await handleAssignmentHttp(listReq, listRes)).toBe(true);
    const listed = JSON.parse(listCaptured().body) as { tasks: Array<{ planId: string }> };
    expect(listed.tasks.some((t) => t.planId === "plan-group-visible")).toBe(true);

    const detailReq = stubReq({ url: "/api/workbench/task/plan-group-visible", method: "GET", headers: { cookie } });
    const { res: detailRes, captured: detailCaptured } = stubRes();
    expect(await handleAssignmentHttp(detailReq, detailRes)).toBe(true);
    expect(detailCaptured().statusCode).toBe(200);
  });

  it("different manager groups cannot open each other's tasks", async () => {
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_FILE", join(tmpdir(), `test-manager-groups-${Date.now()}.json`));
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "");
    const { createWorkbenchManagerGroup, addWorkbenchManagerGroupMember } = await import("../../src/security/workbench-manager-groups");
    const a = createWorkbenchManagerGroup({ name: "明思项目主管组" });
    const b = createWorkbenchManagerGroup({ name: "商务部主管组" });
    addWorkbenchManagerGroupMember(a.groupId, "mgr-a");
    addWorkbenchManagerGroupMember(b.groupId, "mgr-b");
    await seedPublishedTask({ planId: "plan-group-private", managerUserId: "mgr-a", assigneeUserId: "emp-a" });
    createWorkbenchFormalTaskStore().migrateManagerObjectsToGroup({ managerUserId: "mgr-a", managerGroupId: a.groupId });
    const cookie = await loginCookie("mgr-b", "manager");

    const detailReq = stubReq({ url: "/api/workbench/task/plan-group-private", method: "GET", headers: { cookie } });
    const { res, captured } = stubRes();
    expect(await handleAssignmentHttp(detailReq, res)).toBe(true);
    expect(captured().statusCode).toBe(403);
  });
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run tests/web/assignment-workbench.test.ts -t "manager group members|different manager groups"
```

Expected: FAIL because HTTP handlers still compare `detail.task.managerUserId` directly to `session.userId`.

- [ ] **Step 3: Add shared authorization helper**

In `src/web/assignment-workbench.ts`, import:

```ts
import {
  canAccessManagerOwnedObject,
  resolveWorkbenchManagerScope,
  type WorkbenchManagerScope,
} from "../security/workbench-manager-scope";
```

Add near request helpers:

```ts
function resolveSessionManagerScope(session: { userId: string }): WorkbenchManagerScope {
  return resolveWorkbenchManagerScope(session.userId);
}

function canSessionManageTask(
  session: { role: string; userId: string },
  task: { managerUserId: string; managerGroupId?: string },
): boolean {
  if (session.role === "admin") return true;
  if (session.role !== "manager") return false;
  return canAccessManagerOwnedObject(task, resolveSessionManagerScope(session));
}

function managerScopeForSession(session: { userId: string }): { managerUserId: string; managerGroupId?: string } {
  const scope = resolveSessionManagerScope(session);
  return { managerUserId: scope.managerUserId, managerGroupId: scope.managerGroupId };
}
```

Replace direct checks like:

```ts
if (session.role === "manager" && detail.task.managerUserId !== session.userId) {
```

with:

```ts
if (session.role === "manager" && !canSessionManageTask(session, detail.task)) {
```

Replace manager task list call:

```ts
const tasks = enrichManagerTasksForApi(session.userId, projectId ? { projectId } : undefined);
```

with:

```ts
const tasks = enrichManagerTasksForApi(
  managerScopeForSession(session),
  projectId ? { projectId } : undefined,
);
```

- [ ] **Step 4: Update project API helpers**

Modify signatures in `src/web/workbench-project-api.ts`:

```ts
import type { WorkbenchManagerTaskScope } from "../infra/workbench-formal-task-store";

export function enrichManagerTasksForApi(
  managerScope: WorkbenchManagerTaskScope,
  filter?: { projectId?: string },
): ManagerTaskApiRow[] {
  const store = getFormalTaskStore();
  const projects = store.listProjectsForManagerScope(managerScope);
  const projectNameById = new Map(projects.map((p) => [p.projectId, p.name]));
  const pid = String(filter?.projectId ?? "").trim();
  const tasks = store.listManagerTasks(managerScope, pid ? { projectId: pid } : undefined);
  return tasks.map((t) => enrichOneManagerTask(typeof managerScope === "string" ? managerScope : managerScope.managerUserId, t, projectNameById));
}
```

Update `buildManagerProjectsListResponse` and `buildManagerProjectDetailResponse` similarly:

```ts
export function buildManagerProjectsListResponse(managerScope: WorkbenchManagerTaskScope) {
  const store = getFormalTaskStore();
  const projects = store.listProjectsForManagerScope(managerScope);
  const tasks = store.listManagerTasks(managerScope);
  // existing rollup code unchanged
}

export function buildManagerProjectDetailResponse(
  managerScope: WorkbenchManagerTaskScope,
  projectId: string,
) {
  const store = getFormalTaskStore();
  const pid = projectId.trim();
  if (pid === UNASSIGNED_PROJECT_BUCKET) {
    const tasks = enrichManagerTasksForApi(managerScope, { projectId: UNASSIGNED_PROJECT_BUCKET });
    const ownerUserId = typeof managerScope === "string" ? managerScope : managerScope.managerUserId;
    return { project: { projectId: UNASSIGNED_PROJECT_BUCKET, name: "未归类", ownerUserId, status: "active" as const, aliases: [], createdAt: "", updatedAt: "" }, tasks };
  }
  const project = store.getProjectForManagerScope(pid, managerScope);
  if (!project) return null;
  const tasks = enrichManagerTasksForApi(managerScope, { projectId: pid });
  return { project, tasks };
}
```

- [ ] **Step 5: Update action calls to pass owner manager where side effects need it**

For reassign/stop/reminder endpoints, keep notification ownership as the task's original manager but authorize by scope:

```ts
const detailForAuth = store.getTaskDetail(planId);
if (!detailForAuth) { /* existing 404 */ }
if (session.role === "manager" && !canSessionManageTask(session, detailForAuth.task)) {
  writeJson(res, 403, { ok: false, error: "Task is outside current manager scope" });
  return;
}
const managerUserIdForReassign = detailForAuth.task.managerUserId;
```

Use the same pattern for `stopTask`, `stopSubtask`, project assignment, and reminder routes.

- [ ] **Step 6: Run targeted tests**

Run:

```bash
npx vitest run tests/web/assignment-workbench.test.ts -t "manager group members|different manager groups|project portfolio API"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/web/assignment-workbench.ts src/web/workbench-project-api.ts tests/web/assignment-workbench.test.ts
git commit -m "feat: scope manager workbench by group"
```

---

### Task 6: Agent Tools, Publish, And Project Tools

**Files:**
- Modify: `src/agent/tools/list-managed-tasks.ts`
- Modify: `src/agent/tools/get-task-detail.ts`
- Modify: `src/agent/tools/reassign-task.ts`
- Modify: `src/agent/tools/send-subtask-reminder.ts`
- Modify: `src/agent/tools/publish-task.ts`
- Modify: `src/agent/tools/project-portfolio-tools.ts`
- Modify: `src/agent/v2/tools.ts`
- Test: `tests/agent/tools/manager-groups.test.ts`

- [ ] **Step 1: Write failing tool tests**

Create `tests/agent/tools/manager-groups.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkbenchFormalTaskStore } from "../../../src/infra/workbench-formal-task-store";
import type { PlanSession } from "../../../src/infra/plan-session-store";
import { addWorkbenchManagerGroupMember, createWorkbenchManagerGroup } from "../../../src/security/workbench-manager-groups";
import { buildListManagedTasksHandler } from "../../../src/agent/tools/list-managed-tasks";
import { buildGetTaskDetailHandler } from "../../../src/agent/tools/get-task-detail";

describe("manager group agent tools", () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "agent-manager-groups-"));
    vi.stubEnv("WORKBENCH_SQLITE_PATH", join(dir, "workbench.sqlite"));
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_FILE", join(dir, "groups.json"));
  });

  function publish(planId: string, managerUserId: string, managerGroupId: string): void {
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: `hash-${planId}`,
      planId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: managerUserId,
      knownFacts: [],
      conversationHistory: [],
      latestDraft: { title: `任务 ${planId}`, tasks: [{ id: "task_1", title: "事项" }] },
      latestAssignment: { assignments: [{ taskId: "task_1", primary: { userId: "emp-a" } }] },
    };
    store.publishFromSession({
      planId,
      session,
      managerUserId,
      managerGroupId,
      initiatorDepartment: "项目部",
      actorUserId: managerUserId,
    });
  }

  it("list_managed_tasks returns group tasks for a group member", () => {
    const group = createWorkbenchManagerGroup({ name: "明思项目主管组" });
    addWorkbenchManagerGroupMember(group.groupId, "mgr-a");
    addWorkbenchManagerGroupMember(group.groupId, "mgr-b");
    publish("plan-agent-group", "mgr-a", group.groupId);
    const result = buildListManagedTasksHandler({ taskStore: createWorkbenchFormalTaskStore() })({ actorUserId: "mgr-b" }) as {
      ok: boolean;
      tasks: Array<{ planId: string }>;
    };
    expect(result.ok).toBe(true);
    expect(result.tasks.some((t) => t.planId === "plan-agent-group")).toBe(true);
  });

  it("get_task_detail allows same group and denies other group", () => {
    const a = createWorkbenchManagerGroup({ name: "明思项目主管组" });
    const b = createWorkbenchManagerGroup({ name: "商务部主管组" });
    addWorkbenchManagerGroupMember(a.groupId, "mgr-a");
    addWorkbenchManagerGroupMember(a.groupId, "mgr-b");
    addWorkbenchManagerGroupMember(b.groupId, "biz-a");
    publish("plan-agent-detail", "mgr-a", a.groupId);
    const handler = buildGetTaskDetailHandler({ taskStore: createWorkbenchFormalTaskStore() });
    expect(handler({ actorUserId: "mgr-b", actorRole: "manager", planId: "plan-agent-detail" })).toMatchObject({ ok: true });
    expect(handler({ actorUserId: "biz-a", actorRole: "manager", planId: "plan-agent-detail" })).toMatchObject({ ok: false, reason: "task_not_owned" });
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npx vitest run tests/agent/tools/manager-groups.test.ts
```

Expected: FAIL because tools still use actor user id directly.

- [ ] **Step 3: Update list and detail tools**

In `src/agent/tools/list-managed-tasks.ts`:

```ts
import { resolveWorkbenchManagerScope } from "../../security/workbench-manager-scope";

// inside handler
const scope = resolveWorkbenchManagerScope(actorUserId);
const tasks = taskStore.listManagerTasks({
  managerUserId: scope.managerUserId,
  managerGroupId: scope.managerGroupId,
});
return { ok: true, actorUserId, managerGroupId: scope.managerGroupId ?? "", tasks };
```

In `src/agent/tools/get-task-detail.ts`:

```ts
import { canAccessManagerOwnedObject, resolveWorkbenchManagerScope } from "../../security/workbench-manager-scope";

// replace manager direct check
if (actorRole === "manager") {
  const scope = resolveWorkbenchManagerScope(actorUserId);
  if (!canAccessManagerOwnedObject(detail.task, scope)) {
    return { ok: false, reason: "task_not_owned", hint: "该任务不在你的管理范围" };
  }
}
```

- [ ] **Step 4: Update mutating tools**

In `src/agent/tools/reassign-task.ts`, authorize with manager scope, then call store methods with the task's owner manager:

```ts
const detail = taskStore.getTaskDetail(planId);
if (!detail) return { ok: false, reason: "task_not_found" };
const scope = resolveWorkbenchManagerScope(actorUserId);
if (!canAccessManagerOwnedObject(detail.task, scope)) {
  return { ok: false, reason: "task_not_owned", hint: "该任务不在你的管理范围" };
}
const managerUserIdForMutation = detail.task.managerUserId;
```

Use `managerUserIdForMutation` for existing store mutation calls. Apply the same authorization pattern in `send-subtask-reminder.ts`.

- [ ] **Step 5: Update publish and project tools**

In `src/agent/tools/publish-task.ts`, pass group id:

```ts
const scope = resolveWorkbenchManagerScope(trustedActor);
published = deps.publishFromSession({
  planId,
  session,
  managerUserId: trustedActor,
  managerGroupId: scope.managerGroupId ?? null,
  initiatorDepartment,
  actorUserId: trustedActor,
  actorName,
  projectId: projectId ?? null,
});
```

In `src/agent/tools/project-portfolio-tools.ts`, resolve scope once:

```ts
const scope = resolveWorkbenchManagerScope(actor);
const managerScope = { managerUserId: scope.managerUserId, managerGroupId: scope.managerGroupId };
const projects = taskStore.listProjectsForManagerScope(managerScope);
```

For create:

```ts
const project = taskStore.createProject({
  ownerUserId: actor,
  managerGroupId: scope.managerGroupId ?? null,
  name,
  description,
  aliases,
});
```

For get/set active project validation:

```ts
const proj = taskStore.getProjectForManagerScope(pid, managerScope);
```

Mirror these changes in `src/agent/v2/tools.ts` where v2 wires handlers or implements the same tool logic.

- [ ] **Step 6: Run tests**

Run:

```bash
npx vitest run tests/agent/tools/manager-groups.test.ts tests/agent/tools/registry.test.ts tests/agent/role-routing.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/agent/tools/list-managed-tasks.ts src/agent/tools/get-task-detail.ts src/agent/tools/reassign-task.ts src/agent/tools/send-subtask-reminder.ts src/agent/tools/publish-task.ts src/agent/tools/project-portfolio-tools.ts src/agent/v2/tools.ts tests/agent/tools/manager-groups.test.ts
git commit -m "feat: make agent tools manager-group aware"
```

---

### Task 7: Dashboards, Performance Scope, And Notifications

**Files:**
- Modify: `src/agent/weekly-dashboard/weekly-dashboard-facts.ts`
- Modify: `src/web/weekly-dashboard-api.ts`
- Modify: `src/agent/performance/performance-scope.ts`
- Modify: `src/web/performance-dashboard-api.ts`
- Modify: `src/agent/reminders/reminder-send.ts`
- Modify: `src/integrations/dingtalk/workbench-notify.ts` if message payload needs multiple managers
- Test: `tests/agent/weekly-dashboard/weekly-dashboard-facts.test.ts`
- Test: `tests/web/performance-dashboard.test.ts`
- Test: `tests/agent/reminders/reminder-send.test.ts`

- [ ] **Step 1: Write failing dashboard and notification tests**

In `tests/agent/weekly-dashboard/weekly-dashboard-facts.test.ts`, add:

```ts
it("loads weekly facts by manager group scope", () => {
  const store = createWorkbenchFormalTaskStore();
  const session = buildSession("plan-weekly-group", "mgr-a", "emp-a");
  store.publishFromSession({
    planId: "plan-weekly-group",
    session,
    managerUserId: "mgr-a",
    managerGroupId: "mgrgrp:mingsi",
    initiatorDepartment: "项目部",
    actorUserId: "mgr-a",
  });
  const facts = buildWeeklyDashboardFacts({
    taskStore: store,
    managerUserId: "mgr-b",
    managerGroupId: "mgrgrp:mingsi",
    now: new Date("2026-06-03T02:00:00.000Z"),
  });
  expect(facts.tasks.some((t) => t.planId === "plan-weekly-group")).toBe(true);
});
```

In `tests/web/performance-dashboard.test.ts`, add a unit test for the performance scope helper:

```ts
import { addWorkbenchManagerGroupMember, createWorkbenchManagerGroup } from "../../src/security/workbench-manager-groups";
import { resolvePerformanceScope } from "../../src/agent/performance/performance-scope";

it("manager performance scope carries managerGroupId", () => {
  vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
  vi.stubEnv("WORKBENCH_MANAGER_GROUPS_FILE", join(tmpdir(), `performance-groups-${Date.now()}.json`));
  const group = createWorkbenchManagerGroup({ name: "明思项目主管组" });
  addWorkbenchManagerGroupMember(group.groupId, "mgr-b");
  const scope = resolvePerformanceScope({ userId: "mgr-b", role: "manager" });
  expect(scope).toEqual({ kind: "manager", managerUserId: "mgr-b", managerGroupId: group.groupId });
});
```

In `tests/agent/reminders/reminder-send.test.ts`, change the helper signature from:

```ts
function seedSubtask(dueAt: string, managerGroupId?: string) {
```

Replace the `taskStore.publishFromSession` call inside that helper with:

```ts
taskStore.publishFromSession({
  planId,
  session,
  managerUserId: "mgr-1",
  managerGroupId: managerGroupId ?? null,
  actorUserId: "mgr-1",
});
```

Then add:

```ts
it("notifies all active manager group members for employee feedback", async () => {
  process.env.WORKBENCH_MANAGER_GROUPS_ENABLED = "1";
  process.env.WORKBENCH_MANAGER_GROUPS_FILE = join(tmpdir(), `reminder-groups-${Date.now()}.json`);
  const { createWorkbenchManagerGroup, addWorkbenchManagerGroupMember } = await import(
    "../../../src/security/workbench-manager-groups"
  );
  const group = createWorkbenchManagerGroup({ name: "明思项目主管组" });
  addWorkbenchManagerGroupMember(group.groupId, "mgr-1");
  addWorkbenchManagerGroupMember(group.groupId, "mgr-2");
  const { taskStore, peopleStore, sid } = seedSubtask("2026-05-20", group.groupId);
  peopleStore.upsertContact({
    userId: "mgr-2",
    name: "Mgr2",
    departmentIds: ["1"],
    departmentNames: ["管理部"],
    active: true,
    isAdmin: false,
    isBoss: false,
    isSenior: false,
    lastSyncedAt: new Date().toISOString(),
  });
  const sentTo: string[] = [];
  const notifier: WorkbenchPublishNotifier = {
    ...mockNotifier,
    notifyManagerSubtaskOverdue: async (payload) => {
      sentTo.push(payload.managerUserId);
      return { enabled: true, success: [{ userId: payload.managerUserId, robotMessageKey: `mock-${payload.managerUserId}` }], failed: [] };
    },
  };
  const policy = loadReminderPolicy();
  const result = await sendManagerOverdueAlert(
    { subtaskId: sid, overdueSince: "2026-05-20T10:00:00.000Z" },
    { taskStore, peopleStore, notifier, policy },
  );
  expect(result.ok).toBe(true);
  expect(sentTo.sort()).toEqual(["mgr-1", "mgr-2"]);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run tests/agent/weekly-dashboard/weekly-dashboard-facts.test.ts tests/web/performance-dashboard.test.ts tests/agent/reminders/reminder-send.test.ts
```

Expected: FAIL because dashboard/performance/reminder code does not accept `managerGroupId`.

- [ ] **Step 3: Add group scope to weekly dashboard**

Update `src/agent/weekly-dashboard/weekly-dashboard-facts.ts` input:

```ts
export interface BuildWeeklyDashboardFactsInput {
  taskStore: ReturnType<typeof createWorkbenchFormalTaskStore>;
  managerUserId: string;
  managerGroupId?: string;
  week?: string;
  span?: number;
  now?: Date;
  feedCursor?: string;
  feedLimit?: number;
}
```

Replace task loads:

```ts
const managerScope = {
  managerUserId: input.managerUserId,
  managerGroupId: input.managerGroupId,
};
const allTaskSummaries = input.taskStore.listManagerTasks(
  managerScope,
  projectFilter ? { projectId: projectFilter } : undefined,
);
```

Update `src/web/weekly-dashboard-api.ts`:

```ts
const scope = resolveWorkbenchManagerScope(input.managerUserId);
const facts = buildWeeklyDashboardFacts({
  ...input,
  managerGroupId: scope.managerGroupId,
});
```

- [ ] **Step 4: Add group scope to performance**

Update `src/agent/performance/performance-scope.ts`:

```ts
export type PerformanceScope =
  | { kind: "all" }
  | { kind: "manager"; managerUserId: string; managerGroupId?: string };

export function resolvePerformanceScope(session: { userId: string; role: string }): PerformanceScope {
  if (session.role === "admin") return { kind: "all" };
  const scope = resolveWorkbenchManagerScope(session.userId);
  return { kind: "manager", managerUserId: session.userId, managerGroupId: scope.managerGroupId };
}
```

Update `src/web/performance-dashboard-api.ts`:

```ts
return taskStore.loadPerformanceDataset({
  ...(scope.kind === "manager" ? { managerUserId: scope.managerUserId, managerGroupId: scope.managerGroupId } : {}),
  ...(projectId ? { projectId } : {}),
});
```

Update `loadPerformanceDataset` in `src/infra/workbench-formal-task-store.ts` to accept `managerGroupId?: string` and use `t.manager_group_id = ?` when present.

- [ ] **Step 5: Add manager-group notification recipients**

Add a helper in `src/security/workbench-manager-groups.ts`:

```ts
export function listWorkbenchManagerGroupMembers(groupId: string): string[] {
  const gid = String(groupId ?? "").trim();
  const group = listWorkbenchManagerGroups().find((g) => g.groupId === gid && g.status === "active");
  return group ? [...group.memberUserIds] : [];
}
```

In manager notification code paths, replace single manager recipient with:

```ts
const managerRecipients = task.managerGroupId
  ? listWorkbenchManagerGroupMembers(task.managerGroupId)
  : [task.managerUserId];
const deliveredManagers: string[] = [];
const failedManagers: Array<{ managerUserId: string; reason?: string }> = [];
for (const managerUserId of managerRecipients) {
  const notifyResult = await deps.notifier.notifyManagerSubtaskOverdue({
    managerUserId,
    taskNo: task.taskNo,
    taskTitle: task.title,
    subtaskId: subtask.subtaskId,
    subtaskTitle: subtask.title,
    assigneeUserId: subtask.assigneeUserId,
    assigneeDisplayName: assigneeName,
    subject,
    markdown,
    detailUrl,
    sourceId,
  });
  if (notifyResult.success.length > 0) {
    deliveredManagers.push(managerUserId);
  } else {
    failedManagers.push({ managerUserId, reason: notifyResult.skippedReason ?? notifyResult.failed[0]?.reason });
  }
}
```

Keep event payload fields:

```ts
managerUserId: task.managerUserId,
actorUserId: input.actorUserId,
managerGroupId: task.managerGroupId ?? "",
```

- [ ] **Step 6: Run tests**

Run:

```bash
npx vitest run tests/agent/weekly-dashboard/weekly-dashboard-facts.test.ts tests/web/performance-dashboard.test.ts tests/agent/reminders/reminder-send.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/agent/weekly-dashboard/weekly-dashboard-facts.ts src/web/weekly-dashboard-api.ts src/agent/performance/performance-scope.ts src/web/performance-dashboard-api.ts src/agent/reminders/reminder-send.ts src/security/workbench-manager-groups.ts tests/agent/weekly-dashboard/weekly-dashboard-facts.test.ts tests/web/performance-dashboard.test.ts tests/agent/reminders/reminder-send.test.ts
git commit -m "feat: apply manager groups to dashboards and notifications"
```

---

### Task 8: Documentation, Config, And Full Verification

**Files:**
- Modify: `.env.example`
- Modify: `docs/deploy-aliyun-dingtalk.md`

- [ ] **Step 1: Document environment variables**

Add to `.env.example`:

```env
# Manager groups let multiple supervisors share one manager workbench scope.
# Keep disabled for existing instances until Admin has created/migrated groups.
WORKBENCH_MANAGER_GROUPS_ENABLED=0
WORKBENCH_MANAGER_GROUPS_FILE=data/workbench-manager-groups.json
```

Add to `docs/deploy-aliyun-dingtalk.md` in the workbench env section:

````md
### 主管组（mingsibot 试点）

`WORKBENCH_MANAGER_GROUPS_ENABLED=1` 后，Admin 可在「权限中心」维护多个主管组。
普通主管最多属于一个主管组；组内成员共享正式任务、项目、Dashboard 和主管操作权限；组间隔离。
建议仅在 `mingsibot` 开启：

```env
WORKBENCH_MANAGER_GROUPS_ENABLED=1
WORKBENCH_MANAGER_GROUPS_FILE=/app/data/workbench-manager-groups.json
```

开启后先创建主管组并迁入历史个人任务/项目，再让业务主管使用。
````

- [ ] **Step 2: Run focused test suite**

Run:

```bash
npx vitest run tests/security/workbench-manager-groups.test.ts tests/security/workbench-manager-scope.test.ts tests/security/workbench-manager-whitelist.test.ts tests/infra/workbench-formal-task-store.test.ts tests/web/admin-permissions-page.test.ts tests/web/assignment-workbench.test.ts tests/agent/tools/manager-groups.test.ts tests/agent/weekly-dashboard/weekly-dashboard-facts.test.ts tests/web/performance-dashboard.test.ts tests/agent/reminders/reminder-send.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run broader safety checks**

Run:

```bash
npm run typecheck
npm run lint:inline-pages
npx vitest run tests/web/manager-projects-portfolio.test.ts tests/web/task-detail-page.test.ts tests/agent/tools/registry.test.ts tests/agent/role-routing.test.ts tests/security/workbench-role-resolver.test.ts
```

Expected: PASS.

- [ ] **Step 4: Inspect scoped diff**

Run:

```bash
git status --short
git diff --stat HEAD
git diff --name-only HEAD
```

Expected: only manager-group source, tests, env example, and deploy docs are changed since the last implementation commit.

- [ ] **Step 5: Commit docs and final verification**

```bash
git add .env.example docs/deploy-aliyun-dingtalk.md
git commit -m "docs: document manager group rollout"
```

- [ ] **Step 6: Manual acceptance on mingsibot before deployment**

Use a local or staging instance with:

```env
WORKBENCH_MANAGER_GROUPS_ENABLED=1
WORKBENCH_MANAGER_GROUPS_FILE=data/workbench-manager-groups.json
WORKBENCH_TEST_LOGIN_ENABLED=1
```

Manual checks:

- Admin creates `明思项目主管组` and `商务部主管组`.
- Admin adds two members to `明思项目主管组`.
- Admin cannot add the same member to `商务部主管组` until removed from the first group.
- A member of `明思项目主管组` publishes a task.
- Another member of `明思项目主管组` can list, open, reassign, remind, stop, and adjust project ownership for that task.
- A member of `商务部主管组` cannot list or open that task.
- Audit/event rows show the real operator user id for the action.
- With `WORKBENCH_MANAGER_GROUPS_ENABLED=0`, existing manager tests and UI behavior remain personal-scope.

---

## Final Integration Checklist

- [ ] Every manager-group member is also recognized as a manager by `resolveWorkbenchRole`.
- [ ] Normal managers with no group keep the old personal workbench scope.
- [ ] Group-owned tasks/projects are authorized by `manager_group_id`, not by the original publisher.
- [ ] Group members can perform all manager actions on group tasks.
- [ ] Different groups receive 403 or an empty list.
- [ ] Admin UI is the source for creating groups and assigning members.
- [ ] The same regular manager cannot belong to two groups.
- [ ] `mingsibot` can enable the feature without changing micro-light defaults.
- [ ] Tests and typecheck pass before deploy.
