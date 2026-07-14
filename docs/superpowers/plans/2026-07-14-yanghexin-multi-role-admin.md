# 杨贺新多角色管理员权限 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在当前开发分支和本地开发配置中，让钉钉成员“杨贺新”同时具备管理员、主管、售后主管和质量专员能力，并验证全部约定页面可访问且私密评论仍仅对会话双方可见。

**Architecture:** 复用现有 `workbench-capabilities` 与 `quality-capabilities` 的多名单叠加机制，不新增超级管理员角色，不改变服务端授权模型。先修正质量专员已可访问“质量意见”但侧栏未显示入口的表现层缺口，并用通用测试身份锁定多角色组合和私密评论边界；再将通讯录唯一匹配到的真实 `userId` 以集合合并方式写入仓库外的本地 `.env`，最后运行自动化与本地页面验证。

**Tech Stack:** TypeScript、Node.js 22、Vitest、SQLite、现有工作台 HTTP/HTML 渲染层、钉钉通讯录同步数据。

## Global Constraints

- 只修改分支 `feat/quality-tracking-v03` 与本地开发配置；不得修改生产 `/etc/manage-robot*.env`、生产数据卷、容器或部署状态。
- 权限判断使用钉钉通讯录中唯一匹配“杨贺新”的真实 `userId`；零个或多个匹配时立即停止，不猜测账号。
- 真实 `userId` 只允许进入仓库外、未被 Git 跟踪的本地 `.env`；不得进入文档、示例配置、测试、日志或提交历史。
- 更新四组名单时必须进行集合合并并保留全部既有成员：`WORKBENCH_ADMIN_USER_IDS`、`WORKBENCH_MANAGER_USER_IDS`、`QUALITY_AFTERSALES_MANAGER_USER_IDS`、`QUALITY_SPECIALIST_USER_IDS`。
- 管理员身份不得绕过私密质量评论授权；仅评论人和该对话对应的质量专员可查看和回复。
- 不新增角色、不放宽服务端授权；唯一允许的生产代码改动是让质量专员侧栏展示服务端本来已经允许访问的“质量意见”入口。

---

### Task 1: 锁定工作台管理员与主管双角色行为

**Files:**
- Modify: `tests/security/workbench-capabilities.test.ts`
- Test: `tests/security/workbench-capabilities.test.ts`

**Interfaces:**
- Consumes: `resolveWorkbenchCapabilities(userId: string): WorkbenchCapabilities`、`defaultLoginViewRole(userId: string): WorkbenchRole`。
- Produces: 对同一用户同时拥有管理员主角色、主管附加能力、管理员访问权、主管操作权以及默认主管视图的回归保证。

- [ ] **Step 1: 将现有双角色断言补全为页面切换所需的完整能力断言**

在 `admin also on manager whitelist gets canManage and canAccessAdmin` 用例中保留既有断言并增加：

```ts
expect(caps.canExecuteAsManager).toBe(true);
expect(defaultLoginViewRole("dual-user")).toBe("manager");
```

在 `dual admin+manager defaults login view to manager` 用例中增加会话刷新断言：

```ts
const refreshed = refreshSessionFromWhitelist({
  userId: "dual-user",
  primaryRole: "admin",
  role: "admin",
});
expect(refreshed.session).toMatchObject({
  userId: "dual-user",
  primaryRole: "admin",
  role: "admin",
});
```

- [ ] **Step 2: 运行双角色单元测试**

Run: `npx vitest run tests/security/workbench-capabilities.test.ts`

Expected: 全部测试通过；这是一项现有能力的特征测试，不需要修改 `src/security/workbench-capabilities.ts`。

- [ ] **Step 3: 提交双角色回归测试**

```bash
git add tests/security/workbench-capabilities.test.ts
git commit -m "test: lock multi-role admin workbench access"
```

---

### Task 2: 锁定售后主管与质量专员组合权限及导航

**Files:**
- Modify: `tests/quality/quality-permission-matrix.test.ts`
- Modify: `tests/web/quality-access.test.ts`
- Modify: `src/web/workbench-shell.ts`
- Test: `tests/quality/quality-permission-matrix.test.ts`
- Test: `tests/web/quality-access.test.ts`
- Test: `tests/web/quality-specialist-page.test.ts`

**Interfaces:**
- Consumes: `handleQualityHttp(...)`、`renderWorkbenchPage(...)`、`resolveQualityCapabilities(userId: string): QualityCapabilities`。
- Produces: 通用 `multi-role-user` 同时具备质量追踪、质量意见、通报入口和质量专员全链路动作的回归保证；质量专员侧栏展示服务端已授权的质量意见入口；普通管理员仍无质量权限。

- [ ] **Step 1: 在质量权限矩阵中配置通用多角色测试身份**

将 `beforeEach` 中的质量名单改为：

```ts
vi.stubEnv("QUALITY_AFTERSALES_MANAGER_USER_IDS", "after-1,multi-role-user");
vi.stubEnv("QUALITY_SPECIALIST_USER_IDS", "quality-1,multi-role-user");
```

并将报告关系文件内容改为：

```ts
writeFileSync(
  join(directory, "reports.json"),
  JSON.stringify({ "quality-1": ["report-1"] }),
);
```

- [ ] **Step 2: 增加组合身份与普通管理员对照断言**

在 `tests/quality/quality-permission-matrix.test.ts` 增加：

```ts
it("组合身份同时进入质量追踪和本人质量意见，普通管理员仍不能旁路", () => {
  expect(call("/workbench/quality", {
    userId: "multi-role-user",
    role: "admin",
  }).status).toBe(200);
  expect(call("/workbench/quality/opinions", {
    userId: "multi-role-user",
    role: "admin",
  }).status).toBe(200);
  expect(call("/workbench/quality", {
    userId: "admin-1",
    role: "admin",
  }).status).toBe(403);
  expect(call("/workbench/quality/opinions", {
    userId: "admin-1",
    role: "admin",
  }).status).toBe(403);
});
```

- [ ] **Step 3: 先增加质量专员和组合身份的质量导航断言**

在 `tests/web/quality-access.test.ts` 增加一个用例，临时配置相同的两个质量名单并断言：

```ts
it("质量专员和组合身份都看到质量追踪与质量意见入口", () => {
  vi.stubEnv(
    "QUALITY_AFTERSALES_MANAGER_USER_IDS",
    "after-1,multi-role-user",
  );
  vi.stubEnv(
    "QUALITY_SPECIALIST_USER_IDS",
    "quality-1,multi-role-user",
  );
  const specialistHtml = renderWorkbenchPage({
    role: "employee",
    activeNav: "emp-new",
    title: "员工",
    pageTitle: "员工",
    sessionUserId: "quality-1",
    mainHtml: "",
  });
  const combinedHtml = renderWorkbenchPage({
    role: "admin",
    activeNav: "adm-ops",
    title: "管理员",
    pageTitle: "管理员",
    sessionUserId: "multi-role-user",
    mainHtml: "",
  });

  for (const html of [specialistHtml, combinedHtml]) {
    expect(html).toContain('href="/workbench/quality"');
    expect(html).toContain('href="/workbench/quality/opinions"');
  }
});
```

- [ ] **Step 4: 运行导航测试并确认先失败**

Run: `npx vitest run tests/web/quality-access.test.ts`

Expected: 新用例失败，缺少 `href="/workbench/quality/opinions"`；服务端入口测试仍证明质量专员访问 `/workbench/quality/opinions` 返回 200。

- [ ] **Step 5: 让侧栏权限与现有服务端权限保持一致**

在 `src/web/workbench-shell.ts` 的 `buildQualityRail` 中，将质量意见入口条件从：

```ts
caps.canAccessOpinions
```

改为：

```ts
caps.canAccessOpinions || caps.roles.includes("quality_specialist")
```

完整分支保持为：

```ts
caps.canAccessOpinions || caps.roles.includes("quality_specialist")
  ? railLink(
    "/workbench/quality/opinions",
    "质量意见",
    "quality-opinions",
    params.activeNav,
    params.role,
  )
  : ""
```

- [ ] **Step 6: 运行质量组合权限测试**

Run: `npx vitest run tests/quality/quality-permission-matrix.test.ts tests/web/quality-access.test.ts tests/web/quality-specialist-page.test.ts`

Expected: 全部通过；页面模型同时保留“新建质量异常”“分配原主责”“指定节点退回”“关闭质量事件”“重开质量事件”。

- [ ] **Step 7: 提交质量组合权限回归测试与导航修正**

```bash
git add src/web/workbench-shell.ts tests/quality/quality-permission-matrix.test.ts tests/web/quality-access.test.ts
git commit -m "fix: expose quality opinions to specialists"
```

---

### Task 3: 验证私密评论不存在管理员旁路

**Files:**
- Modify: `tests/web/quality-private-comments-api.test.ts`
- Test: `tests/web/quality-private-comments-api.test.ts`

**Interfaces:**
- Consumes: `/api/workbench/quality/opinions/threads/:threadId/messages` 的现有服务端双方关系校验。
- Produces: 同时属于管理员、售后主管和另一质量专员的用户，也不能读取不属于自己的私密对话。

- [ ] **Step 1: 为旁路测试配置多角色用户**

将该测试的 `beforeEach` 中质量名单改为：

```ts
vi.stubEnv(
  "QUALITY_SPECIALIST_USER_IDS",
  "quality-1,multi-role-user",
);
vi.stubEnv(
  "QUALITY_AFTERSALES_MANAGER_USER_IDS",
  "after-1,multi-role-user",
);
vi.stubEnv("WORKBENCH_ADMIN_USER_IDS", "admin-1,multi-role-user");
```

- [ ] **Step 2: 扩展越权访问拒绝断言**

将 `不同下级、售后和管理员不能读取他人的会话` 的用户列表扩展为：

```ts
for (const userId of [
  "report-2",
  "after-1",
  "admin-1",
  "multi-role-user",
]) {
  const result = await call(
    `/api/workbench/quality/opinions/threads/${threadId}/messages`,
    userId,
  );
  expect(result.status).toBe(403);
  expect(JSON.stringify(result.json)).not.toContain("report-1");
}
```

- [ ] **Step 3: 运行私密评论接口测试**

Run: `npx vitest run tests/web/quality-private-comments-api.test.ts`

Expected: 全部通过，`multi-role-user` 返回 403，证明管理员和质量角色组合不构成私密评论旁路。

- [ ] **Step 4: 提交私密评论回归测试**

```bash
git add tests/web/quality-private-comments-api.test.ts
git commit -m "test: prevent multi-role private comment bypass"
```

---

### Task 4: 唯一解析杨贺新身份并合并本地配置

**Files:**
- Modify locally, never commit: `/Users/yanghexin/Desktop/质量追踪/manage_robot-source-with-env-20260707-144428/.env`
- Read: 本地 `WORKBENCH_SQLITE_PATH` 指向的 SQLite `dingtalk_contacts` 表；若本地库没有同步数据，则只读查询已授权开发数据源。

**Interfaces:**
- Consumes: `dingtalk_contacts(user_id, name, active)` 中 `name = '杨贺新' AND active = 1` 的唯一结果。
- Produces: 本地 `.env` 四个逗号分隔集合均包含同一个真实 `userId`，且原有成员完整保留。

- [ ] **Step 1: 查询唯一通讯录匹配并仅输出匹配数量**

使用 Node 22 的 `node:sqlite` 读取本地开发库；命令只输出计数，不输出具体 `userId`：

```bash
node --env-file=/Users/yanghexin/Desktop/质量追踪/manage_robot-source-with-env-20260707-144428/.env --input-type=module -e '
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.WORKBENCH_SQLITE_PATH);
const rows = db.prepare("SELECT user_id FROM dingtalk_contacts WHERE name = ? AND active = 1").all("杨贺新");
console.log(JSON.stringify({ exactActiveMatches: rows.length }));
db.close();
if (rows.length !== 1) process.exit(2);
'
```

Expected: `{"exactActiveMatches":1}`。若不是 1，停止本任务且不修改任何名单。

- [ ] **Step 2: 在本地读取唯一结果供当前执行使用**

在不写入文件、不复制到文档和不回显到用户消息的前提下，读取唯一行的 `user_id`，把它仅作为本次 `apply_patch` 的运行时数据。

- [ ] **Step 3: 用 `apply_patch` 对四个逗号分隔名单做集合合并**

编辑仓库外 `.env`。对 `WORKBENCH_ADMIN_USER_IDS`、`WORKBENCH_MANAGER_USER_IDS`、`QUALITY_AFTERSALES_MANAGER_USER_IDS`、`QUALITY_SPECIALIST_USER_IDS` 四个键，分别把等号右侧写成“修改前逗号分隔集合”与“Step 2 唯一解析值”的稳定去重并集；原有成员顺序保持不变，唯一解析值不存在时才追加在末尾。补丁中必须写入真实并集，不得写说明文字或示例占位值。

- [ ] **Step 4: 验证四组集合包含同一身份且未丢失原成员**

运行一个不打印敏感值的 Node 校验：读取修改前记录的四组集合大小与修改后集合，断言每组旧集合都是新集合子集、四组都包含唯一联系人 `userId`，并只输出：

```text
admin=true manager=true aftersales=true specialist=true preserved=true
```

- [ ] **Step 5: 验证真实身份未进入 Git**

Run: `git status --short && git diff -- . ':!docs/superpowers/plans/2026-07-14-yanghexin-multi-role-admin.md'`

Expected: `.env` 不出现在 Git 状态或 diff 中；任何已跟踪文件都不含真实 `userId`。

---

### Task 5: 本地身份、页面和接口验收

**Files:**
- Read only: `src/web/assignment-workbench.ts`
- Read only: `src/web/quality-http.ts`
- Read only: `src/web/quality-tracking-page.ts`
- Local runtime data only: `.local-data/` 或脚本现有临时目录。

**Interfaces:**
- Consumes: 本地 `.env`、工作台测试登录、`/api/workbench/me`、管理员/主管/员工页面、质量追踪和质量意见页面。
- Produces: 对真实开发身份的页面可见性、视图切换、质量操作控件和浏览器控制台验收记录。

- [ ] **Step 1: 启动隔离的本地工作台**

加载仓库外 `.env`，覆盖所有会产生外部副作用的开关后启动现有本地开发入口：

```bash
env \
  DOTENV_CONFIG_PATH=/Users/yanghexin/Desktop/质量追踪/manage_robot-source-with-env-20260707-144428/.env \
  QUALITY_SOURCE_SYNC_ENABLED=0 \
  WORKBENCH_DINGTALK_NOTIFY_ENABLED=0 \
  DINGTALK_CONTACT_SYNC_ENABLED=0 \
  npm run dev:manager-chat:keep
```

Expected: 本地地址启动成功；不得调用现网通知、待办或质量来源同步。

- [ ] **Step 2: 使用真实开发身份登录并验证能力接口**

通过本地测试登录选择运行时解析的杨贺新 `userId`，请求 `/api/workbench/me`，断言：

```json
{
  "primaryRole": "admin",
  "alsoManager": true,
  "canAccessAdmin": true,
  "canManage": true
}
```

- [ ] **Step 3: 验证工作台三种视图和约定页面**

依次验证管理员、主管、员工视图可以切换且下列页面返回 200 并正确渲染：

```text
/workbench/admin/ops
/workbench/admin/permissions
/workbench/manager/tasks
/workbench/employee/tasks
/workbench/quality
/workbench/quality/opinions
```

- [ ] **Step 4: 验证质量页面双重操作能力**

在 `/workbench/quality` 核对售后主管与质量专员控件同时存在：

```text
新建质量异常
分配原主责
指定节点退回
关闭质量事件
重开质量事件
```

在 `/workbench/quality/opinions` 核对页面只显示当前身份作为质量专员或评论人实际参与的线程；不得出现第三方会话。

- [ ] **Step 5: 检查浏览器错误并停止本地服务**

Expected: 浏览器控制台无未处理异常、资源 404 或权限接口 500。停止本地进程并确认没有部署、重启或修改任何现网资源。

---

### Task 6: 全量回归与完成检查

**Files:**
- Verify: all tracked changes in the current worktree

**Interfaces:**
- Consumes: Tasks 1–5 的测试与本地配置。
- Produces: 可交付的开发分支验证结论；本地 `.env` 继续保持未跟踪和不提交。

- [ ] **Step 1: 运行定向安全与质量回归**

Run:

```bash
npx vitest run \
  tests/security/workbench-capabilities.test.ts \
  tests/security/quality-capabilities.test.ts \
  tests/quality/quality-permission-matrix.test.ts \
  tests/web/quality-access.test.ts \
  tests/web/quality-specialist-page.test.ts \
  tests/web/quality-private-comments-api.test.ts
```

Expected: 全部通过。

- [ ] **Step 2: 运行类型检查**

Run: `npm run typecheck`

Expected: exit code 0。

- [ ] **Step 3: 运行完整测试**

Run: `npm test`

Expected: exit code 0，无失败测试。

- [ ] **Step 4: 检查补丁格式和敏感值边界**

Run: `git diff --check && git status --short`

Expected: 无空白错误；只出现本计划规定的侧栏修正与测试变更；仓库外 `.env` 不出现。

- [ ] **Step 5: 提交最终验证所需的剩余已跟踪变更**

若前面任务已分别提交且没有剩余已跟踪变更，则跳过提交；否则只提交计划内文件：

```bash
git add \
  src/web/workbench-shell.ts \
  tests/security/workbench-capabilities.test.ts \
  tests/quality/quality-permission-matrix.test.ts \
  tests/web/quality-access.test.ts \
  tests/web/quality-private-comments-api.test.ts
git commit -m "test: verify yanghexin multi-role access boundaries"
```

- [ ] **Step 6: 复核未部署现网**

确认本次没有执行 `docker`、`ssh`、生产服务重启、生产环境变量编辑或部署命令；交付说明仅报告开发分支与本地验证结果。
