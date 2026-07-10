# Admin Task Filter Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make partial business-number and department filters return matching company tasks, verify the behavior, and deploy the shared image to both production organizations.

**Architecture:** Keep the admin page and HTTP API contract unchanged. Correct the two comparisons in the formal-task-store prepared query, cover them at the storage boundary where the defect originates, then rebuild the shared Docker image and recreate both isolated containers from their existing env files and data volumes.

**Tech Stack:** TypeScript, Node.js SQLite, Vitest, Docker, PowerShell/SSH

## Global Constraints

- Business number and department use case-insensitive substring matching.
- Status remains an exact match; assignee and title keyword behavior remain unchanged.
- Empty filters remain unrestricted and multiple filters remain AND-combined.
- Do not change page layout, permissions, API parameters, response schema, or task-status semantics.
- Preserve unrelated working-tree files.

---

### Task 1: Add the regression test and fix the query

**Files:**
- Modify: `tests/infra/workbench-formal-task-store.test.ts`
- Modify: `src/infra/workbench-formal-task-store.ts:686-706`

**Interfaces:**
- Consumes: `createWorkbenchFormalTaskStore()` and `store.listAdminTasks(filter)`.
- Produces: unchanged `listAdminTasks(filter)` signature with corrected partial-match behavior.

- [x] **Step 1: Write the failing test**

Add one test under `workbench-formal-task-store mapping` that publishes two tasks with distinct departments and titles, then asserts partial task-number and department filters and their intersection:

```ts
it("filters admin tasks by partial task number and department", () => {
  const store = createWorkbenchFormalTaskStore();
  const publish = (planId: string, department: string, title: string) =>
    store.publishFromSession({
      planId,
      session: {
        chatKeyHash: `hash-${planId}`,
        planId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        senderStaffId: "manager-1",
        knownFacts: [],
        conversationHistory: [],
        latestDraft: { title, tasks: [{ id: "task-1", title: `${title}子任务` }] },
        latestAssignment: {
          assignments: [{ taskId: "task-1", primary: { userId: `employee-${planId}` } }],
        },
      },
      managerUserId: "manager-1",
      initiatorDepartment: department,
      actorUserId: "manager-1",
    });

  const research = publish("plan-admin-filter-research", "医疗研发中心", "研发验证");
  publish("plan-admin-filter-sales", "华东销售部", "销售跟进");
  const taskNoFragment = research.task.taskNo.slice(-4);

  expect(store.listAdminTasks({ taskNo: taskNoFragment }).map((row) => row.planId)).toEqual([
    "plan-admin-filter-research",
  ]);
  expect(store.listAdminTasks({ department: "研发" }).map((row) => row.planId)).toEqual([
    "plan-admin-filter-research",
  ]);
  expect(
    store.listAdminTasks({ department: "研发", keyword: "验证" }).map((row) => row.planId),
  ).toEqual(["plan-admin-filter-research"]);
  expect(store.listAdminTasks({ department: "研发", keyword: "销售" })).toEqual([]);
});
```

- [x] **Step 2: Run the focused test to verify RED**

Run: `npx vitest run tests/infra/workbench-formal-task-store.test.ts -t "filters admin tasks by partial task number and department"`

Expected: FAIL because `taskNoFragment` and `研发` do not equal the stored full values.

- [x] **Step 3: Implement the minimal SQL correction**

Change only the two exact comparisons in `qAdminTasks`:

```sql
AND (? = '' OR lower(t.initiator_department) LIKE '%' || lower(?) || '%')
AND (? = '' OR lower(t.task_no) LIKE '%' || lower(?) || '%')
```

Keep the existing parameter order and every other condition unchanged.

- [x] **Step 4: Verify GREEN and nearby behavior**

Run:

```powershell
npx vitest run tests/infra/workbench-formal-task-store.test.ts tests/agent/tools/admin-list-all-tasks.test.ts tests/web/admin-permissions-page.test.ts
npm run typecheck
npm run lint:inline-pages
```

Expected: all tests and checks pass with exit code 0.

- [ ] **Step 5: Commit the fix**

```powershell
git add -- tests/infra/workbench-formal-task-store.test.ts src/infra/workbench-formal-task-store.ts docs/superpowers/plans/2026-07-10-admin-task-filter-fix.md
git commit -m "fix: enable partial admin task filters"
```

### Task 2: Publish and deploy both production instances

**Files:**
- No source files changed.

**Interfaces:**
- Consumes: committed branch `feat/draft-full-memory-mutate`, ECS checkout `/opt/manage_robot`, image `manage-robot:dingtalk`.
- Produces: healthy `manage-robot-dingtalk` on port 8080 and `manage-robot-mingsibot` on port 8081.

- [ ] **Step 1: Push the verified commit**

Run: `git push origin feat/draft-full-memory-mutate`

Expected: the remote branch advances to the local fix commit.

- [ ] **Step 2: Pull and build while both old containers remain available**

Over SSH to `root@47.243.199.153` with `C:\Users\EDY\Downloads\hh.pem`, run:

```bash
set -euo pipefail
cd /opt/manage_robot
git pull --ff-only
docker build -t manage-robot:dingtalk .
```

Expected: Git reaches the pushed commit and Docker build succeeds before either container is stopped.

- [ ] **Step 3: Recreate the 微光 container and check health**

Run remotely:

```bash
docker stop manage-robot-dingtalk
docker rm manage-robot-dingtalk
docker run -d --name manage-robot-dingtalk --restart unless-stopped \
  --env-file /etc/manage-robot.env \
  -v /opt/manage_robot/data:/app/data \
  -p 8080:8080 \
  manage-robot:dingtalk
for i in $(seq 1 30); do curl -sf http://127.0.0.1:8080/health && break; sleep 2; done
curl -sf http://127.0.0.1:8080/health
```

Expected: final curl exits 0.

- [ ] **Step 4: Recreate the 明思 container and check health**

Run remotely:

```bash
docker stop manage-robot-mingsibot
docker rm manage-robot-mingsibot
docker run -d --name manage-robot-mingsibot --restart unless-stopped \
  --env-file /etc/manage-robot-mingsibot.env \
  -v /opt/manage_robot-mingsibot/data:/app/data \
  -p 8081:8081 \
  manage-robot:dingtalk
for i in $(seq 1 30); do curl -sf http://127.0.0.1:8081/health && break; sleep 2; done
curl -sf http://127.0.0.1:8081/health
```

Expected: final curl exits 0.

- [ ] **Step 5: Verify public endpoints and container state**

Run remotely:

```bash
docker ps --filter name=manage-robot-dingtalk --filter name=manage-robot-mingsibot
curl -sf https://managebot.vivolightsales.com/health
curl -sf https://mingsibot.vivolightsales.com/health
docker logs --tail 30 manage-robot-dingtalk
docker logs --tail 30 manage-robot-mingsibot
```

Expected: both containers are `Up`, both public health checks exit 0, and neither log tail contains a startup-fatal error.
