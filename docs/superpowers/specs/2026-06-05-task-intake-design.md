# 任务快录入库（task-intake）设计

> 快照日期：2026-06-05；分支 `feat/task-intake`。本文为现网开发依据。

## 背景与目标

老板要求：**把已经拆好的任务通过工作台快速录入正式任务库**。现有主链路 orchestrator 虽然能"对话→草案→发布"，但倾向于**重新拆解 / 追问**；会议入库（meeting-import）则强制 Portfolio + 项目，且其核心价值（从乱纪要抽取、归并父任务、关系推断）恰恰是"重新结构化"——老板**不想要**。

本功能提供一个**并列的工作台向导** `任务快录入库`：用户粘贴已拆好的任务清单 → LLM **忠实映射**为「一个父任务 + N 子任务」（不重拆、不改写措辞）→ 预览微调 → 录入。

- FR-TI-1：任何主管可用，**不挂 Portfolio 门禁**。
- FR-TI-2：LLM 只做字段归一化 + 姓名抽取，**N 进 N 出**，禁止增删/合并/润色。
- FR-TI-3：项目归档**可选**，由用户在预览页手动选择（非 Portfolio 主管无项目下拉，落未归类）。
- FR-TI-4：录入两分支——**全部子任务有负责人 → 直接发布为正式 SQLite 任务**；**有缺负责人 → 整张草案暂存到主管主线程，深链 Excel 草案编辑器点将后再发布**。
- FR-TI-5：会议入库（meeting-import）**零改动**。

## 非目标（首版不做）

- 追加子任务到已有父任务（会议入库已有该能力；本功能首版只新建父任务）。
- 钉钉对话入口（首版仅工作台向导）。
- 与 meeting-import 共享发布管道（**先各自独立，稳定后再合并**——见"后续"）。

## 架构与数据流

```
[粘贴框 + 可选父任务标题 + 可选项目下拉]
        │  POST /api/workbench/manager/task-intake/preview
        ▼
忠实结构化（structure-input.ts；单次约束式 LLM，LLM 不可用时走确定性行切分 fallback）
   text → { parentTitle, parentDescription, subtasks[] }
        ▼
姓名 → userId 解析（复用 meeting-import 的 resolveAssigneeByName + people-directory）
        ▼
[预览表格：可改字段/补负责人/确认父任务标题/选项目]
        │  POST /api/workbench/manager/task-intake/commit
        ▼
commit-task-intake.ts：
   全部选中行有 assigneeUserId → publishFromSession（正式任务）
   否则 → stageDraft 回调写入主线程 session（latestDraft/latestAssignment）+ 返回深链
```

## 模块与文件

| 文件 | 职责 | 复用 |
|---|---|---|
| `src/agent/task-intake/types.ts` | 结构化/预览/commit/结果 类型 | — |
| `src/agent/task-intake/task-intake-llm.ts` | LLM wrapper + `__setTaskIntakeLlmForTest` + policy | 镜像 meeting-import-llm |
| `src/agent/task-intake/structure-input.ts` | 忠实结构化（LLM + 行切分 fallback） | callTaskIntakeLlm |
| `src/agent/task-intake/resolve-assignees.ts` | 姓名→userId | **import** meeting-import `resolveAssigneeByName` |
| `src/agent/task-intake/commit-task-intake.ts` | 两分支（发布 / 暂存草案） | `buildPublishTaskHandler` / `publish-helpers` |
| `src/web/task-intake-api.ts` | preview / commit 处理器 | — |
| `src/web/manager-task-intake-page.ts` | 向导页 | `renderWorkbenchPage` |
| `assignment-workbench.ts` / `workbench-shell.ts` | 路由 + 侧栏（**不挂 portfolio**） | — |
| `tests/web/task-intake.test.ts`、`tests/agent/task-intake/*.test.ts` | 测试 | — |

## 忠实结构化提示词（核心纪律）

System 关键约束：
1. 用户已把任务拆好；你只做**忠实映射**，不得重拆。
2. 用户列了几条就输出几条 subtasks，**禁止增删/合并/拆分**。
3. 标题**原样保留**，不得改写润色。
4. 仅归类字段：`objective`/`deliverables`/`completionCriteria`/`dueAt`/`assigneeName`，缺失留空。
5. **不得编造**负责人或日期。
6. 严格输出 JSON：`{ parentTitle, parentDescription, subtasks:[{title,objective?,deliverables?,completionCriteria?,dueAt?,assigneeName?}] }`。

LLM 不可用 / 解析失败 → 行切分 fallback（去 bullet 符号，每非空行一条 subtask，仅填 title），并在 warnings 提示"未启用 AI，已按行拆分，请核对"。**不编造字段。**

## 录入分支（commit-task-intake）

- 构造 session draft：`{ title:parentTitle, description:parentDescription, tasks:[{id:task_N,title,objective,deliverables,completionCriteria,timeNode:{dueAt}}], stagedBy:"prepare_publish_task", staged* }`；assignment 仅含有 userId 的行。
- **全覆盖**（每个选中行都有 `assigneeUserId`）：`buildPublishTaskHandler` → `publishFromSession({...,projectId})`；返回 `{ mode:"published", task:{taskNo,title}, subtaskCount }`。
- **非全覆盖**：调用注入的 `stageDraft({draft,assignment})`（web 层写入 `findMainThreadSession` + `planSessionStore.save`），返回 `{ mode:"staged", stagedDeepLink:"/workbench/manager/chat?thread=main&openDraftEditor=1", subtaskCount }`。
- 空（无选中行）→ `{ mode:"empty" }`。

## 访问控制

- 页面 `/workbench/manager/task-intake`：`requireSession(manager)` + `allowsManagerSession`，**不重定向**非 portfolio。
- API preview/commit：`requireSession(manager)`，**无** `requirePortfolioManager`。
- 侧栏 `mgr-task-intake`：所有主管可见（与 `portfolioEnabled` 无关）。
- env `TASK_INTAKE_ENABLED`（默认 `1`）；为 `0` 时页面/接口/侧栏隐藏。

## 错误处理

- LLM 空/乱 → fallback + warning，不编造。
- 姓名未匹配 → 该行 `needsConfirm`，按缺负责人；批次因此走暂存分支。
- 防重：发布走 `createRecentPublishStore`。
- 截止：纯日期 = 北京时间 18:00（沿用发布链路 `due-at-parse`）。

## 测试

- `structure-input`：mock LLM 下 N 进 N 出、不合并；LLM 空时行切分 fallback 条数正确、不编造字段。
- `resolve-assignees`：精确命中 / 模糊命中 needsConfirm / 无命中。
- `commit-task-intake`：全覆盖→`publishFromSession` 被调用且 `mode:"published"`；缺负责人→`stageDraft` 被调用且不发布、`mode:"staged"`。
- HTTP `task-intake.test.ts`：普通（非 portfolio）主管 preview/commit 可用；员工 403/重定向；`TASK_INTAKE_ENABLED=0` 时页面重定向。

## 交付定义对照（AGENTS.md）

- FR 编号与验收：见上 FR-TI-1..5。
- 状态机/迁移：无新表、无迁移；复用现有 `tasks/subtasks` 发布与主线程 session。
- 审计字段：发布复用 `publish_task` 既有事件；暂存复用 `manager_workbench_draft_revise` 同级 session 持久化（新增 `TASK_INTAKE_STAGED` revisionEvent）。
- 测试更新：见"测试"。

## 后续（合并方向）

`commit-task-intake` 与 `commit-meeting-import` 的发布循环稳定后，抽 `src/agent/task-publish/publish-grouped-rows.ts` 共享，由两者复用，并以 meeting-import M1–M4 eval 防回归。
