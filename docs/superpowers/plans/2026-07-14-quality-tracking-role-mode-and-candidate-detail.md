# 质量追踪角色模式与异常候选详情 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为双角色用户提供售后主管/质量专员切换，并让异常候选在通报前可查看触发依据和关联反馈。

**Architecture:** 保持 `/workbench/quality` 和既有 candidates API。路由将两项角色能力传入页面；页面据此渲染固定模式或切换器，候选详情复用既有草稿创建与编辑表单。

**Tech Stack:** TypeScript、Node HTTP、内联浏览器 JavaScript、Vitest。

## Global Constraints

- 不新增质量事件表、候选表、接口或权限。
- 模式切换不能扩大服务端授权。
- 候选记录不可编辑；用户只编辑由候选来源生成的质量事件草稿。
- 保留现有通报、分派、退回、关闭审批链路。

---

## File structure

- Modify `src/web/quality-http.ts`：传递 `canReport` 和 `isSpecialist`。
- Modify `src/web/quality-tracking-page.ts`：渲染角色模式、候选详情对话框及客户端交互。
- Modify `src/web/quality-tracking-styles.ts`：添加局部样式。
- Create `tests/web/quality-tracking-page.test.ts`：页面静态渲染回归测试。

### Task 1: 为角色能力和候选详情建立失败测试

**Files:**

- Create: `tests/web/quality-tracking-page.test.ts`
- Modify: `src/web/quality-tracking-page.ts`

**Interfaces:**

- Consumes: `renderQualityTrackingPage({ role, userId, canReport, isSpecialist })`。
- Produces: `data-quality-mode`、`data-quality-mode-switch`、`qualityCandidateDetailDialog`、`qualityCandidateFacts`。

- [ ] **Step 1: 写入失败测试**

```ts
import { describe, expect, it } from "vitest";
import { renderQualityTrackingPage } from "../../src/web/quality-tracking-page";

describe("renderQualityTrackingPage", () => {
  it("renders an aftersales default mode switch for dual-role users", () => {
    const html = renderQualityTrackingPage({ role: "manager", userId: "yang", canReport: true, isSpecialist: true });
    expect(html).toContain('data-quality-mode="aftersales"');
    expect(html).toContain('data-quality-mode-switch="aftersales"');
    expect(html).toContain('data-quality-mode-switch="specialist"');
  });
  it("renders only the specialist event view for a specialist", () => {
    const html = renderQualityTrackingPage({ role: "manager", userId: "specialist", canReport: false, isSpecialist: true });
    expect(html).toContain('data-quality-mode="specialist"');
    expect(html).toContain("待分配");
    expect(html).not.toContain("异常候选");
  });
  it("renders the candidate-detail entry point", () => {
    const html = renderQualityTrackingPage({ role: "manager", userId: "after", canReport: true });
    expect(html).toContain("查看详情并编辑通报");
    expect(html).toContain('id="qualityCandidateDetailDialog"');
    expect(html).toContain('id="qualityCandidateFacts"');
  });
});
```

- [ ] **Step 2: 验证失败**

Run: `npx vitest run tests/web/quality-tracking-page.test.ts`

Expected: FAIL，因 `isSpecialist` 参数和对应标记尚不存在。

- [ ] **Step 3: 最小化实现静态结构**

向 `renderQualityTrackingPage` 增加 `isSpecialist?: boolean`，计算 `hasAftersales`、`hasSpecialist` 和默认模式。双角色显示两个 `data-quality-mode-switch` 按钮；根节点写入默认 `data-quality-mode`。增加候选详情 dialog，包含 `qualityCandidateFacts` 和确认编辑按钮；仅质量专员不渲染候选、来源和新建通报入口。

- [ ] **Step 4: 验证通过**

Run: `npx vitest run tests/web/quality-tracking-page.test.ts`

Expected: PASS，3 tests passed。

- [ ] **Step 5: 提交**

Run: `git add tests/web/quality-tracking-page.test.ts src/web/quality-tracking-page.ts && git commit -m "feat: add quality tracking role modes"`

### Task 2: 将独立角色能力传入追踪页

**Files:**

- Modify: `src/web/quality-http.ts:817-833`
- Test: `tests/web/quality-tracking-page.test.ts`

**Interfaces:**

- Consumes: `resolveQualityCapabilities(session.userId).roles`。
- Produces: `renderQualityTrackingPage({ canReport, isSpecialist })`。

- [ ] **Step 1: 确认页面测试覆盖双角色参数**

保留 Task 1 中 `canReport: true, isSpecialist: true` 的测试；它定义了路由需要提供的完整能力组合。

- [ ] **Step 2: 修改路由调用**

将追踪页调用改为传递：`canReport: caps.roles.includes("aftersales_manager")` 和 `isSpecialist: caps.roles.includes("quality_specialist")`。不改 `canAccessTracking`、`actorFor` 或任何 API 鉴权。

- [ ] **Step 3: 验证类型检查**

Run: `npm run typecheck`

Expected: exit code 0。

- [ ] **Step 4: 提交**

Run: `git add src/web/quality-http.ts && git commit -m "feat: expose quality specialist page capability"`

### Task 3: 实现模式切换和候选详情到草稿的交互

**Files:**

- Modify: `src/web/quality-tracking-page.ts`
- Modify: `src/web/quality-tracking-styles.ts`
- Test: `tests/web/quality-tracking-page.test.ts`

**Interfaces:**

- Consumes: `item.explanation.decision.triggers[]` 的 `label`、`facts`、`sourceKeys`，以及 `item.sourceKeys`。
- Consumes: 既有 `createDraftFromSources(keys)`、`openEvent(eventId)`、`loadCurrent()`。
- Produces: `openCandidateDetail(item)`、`renderCandidateFacts(item)`、`applyMode(mode)`。

- [ ] **Step 1: 扩展失败测试**

在候选测试追加：

```ts
expect(html).toContain("function openCandidateDetail(item)");
expect(html).toContain("function applyMode(mode)");
expect(html).toContain("trigger.facts");
```

- [ ] **Step 2: 验证失败**

Run: `npx vitest run tests/web/quality-tracking-page.test.ts`

Expected: FAIL，候选详情与模式切换客户端函数尚不存在。

- [ ] **Step 3: 最小化客户端实现**

加入 `applyMode(mode)`：更新根节点模式、激活对应切换按钮、显示 `data-quality-mode-only` 区块、把 tab 设为售后主管的 `candidates` 或质量专员的 `events`，然后调用 `loadCurrent()`。

候选列表从 `item.explanation.decision.triggers` 显示首个触发规则及其 `facts`。详情 dialog 显示每条规则、事实和 `sourceKeys`；“查看详情并编辑通报”先打开详情；确认按钮调用既有 `createDraftFromSources(item.sourceKeys)` 并打开既有草稿编辑 dialog。保留“忽略”。

- [ ] **Step 4: 添加局部样式**

在 `QUALITY_TRACKING_STYLES` 添加 `.qt-mode-switch`、`.qt-candidate-facts`、`.qt-candidate-detail`，复用现有按钮、卡片、标签页视觉变量；不改全局 shell 样式。

- [ ] **Step 5: 验证通过**

Run: `npx vitest run tests/web/quality-tracking-page.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

Run: `git add src/web/quality-tracking-page.ts src/web/quality-tracking-styles.ts tests/web/quality-tracking-page.test.ts && git commit -m "feat: inspect quality candidates before reporting"`

### Task 4: 全量验证

**Files:**

- Verify: `src/web/quality-http.ts`
- Verify: `src/web/quality-tracking-page.ts`
- Verify: `src/web/quality-tracking-styles.ts`
- Verify: `tests/web/quality-tracking-page.test.ts`

- [ ] **Step 1: 页面测试**

Run: `npx vitest run tests/web/quality-tracking-page.test.ts`

Expected: PASS。

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`

Expected: exit code 0。

- [ ] **Step 3: 完整测试**

Run: `npm test`

Expected: exit code 0。

- [ ] **Step 4: 改动检查**

Run: `git diff --check && git status --short`

Expected: 无空白错误；只报告本功能文件以及开始前已存在的用户改动。
