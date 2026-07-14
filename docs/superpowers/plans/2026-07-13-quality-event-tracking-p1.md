# Quality Event Tracking P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 `manage-robot` 模块化单体中交付质量追踪一期基础闭环：售后主管手工创建事件，质量专员复判并派发，主责部门负责人承接或驳回、提交初步分析，质量专员确认或退回正式期限，且全程可审计、幂等并受乐观锁保护。

**Architecture:** 新能力放在独立的 `src/quality` 领域、应用和基础设施目录中，共用宿主 HTTP 进程与工作台 SQLite 文件，但只新建 `quality_*` 表，不修改 `tasks/subtasks`。`src/web/quality/quality-router.ts` 通过宿主提供的 session 解析回调接入现有工作台，业务命令只依赖 repository、时钟、ID 生成器和工作日历端口。

**Tech Stack:** Node.js 22、TypeScript ESM、`node:sqlite` `DatabaseSync`、Zod 4、Vitest 4、现有无框架 `node:http` 工作台。

## Global Constraints

- 正式需求基线：`docs/superpowers/specs/2026-07-10-quality-event-tracking-design.md`。
- 分阶段工程基线：`docs/superpowers/plans/2026-07-10-quality-event-tracking-phased-plan.md`。
- 本计划仅实现 P1；不实现钉钉台账同步、Qwen 分类、纠错知识库、证据上传、task-intake 关联、通知 outbox、scheduler、看板和终审页面。
- 质量异常事件只能由 `AFTERSALES_MANAGER` 创建；质量专员和 admin 都不能仅凭自身角色代替售后主管创建。
- `QUALITY_MODULE_ENABLED` 默认 `0`；关闭时质量页面与 API 统一返回 404，现有工作台行为不变。
- 客户端提交业务动作和 `version`，不能直接提交目标状态、SLA 标签或服务端审计字段。
- 所有成功事件写操作必须在同一 SQLite 事务内更新业务数据、追加 `quality_event_transitions` 并使事件 `version` 恰好加一；角色和部门配置写入各自的历史记录，不伪造事件 version。
- 所有 HTTP 写接口必须带 `Idempotency-Key`；同 actor、route、key、request hash 重放首次响应，不同 hash 返回 `QUALITY_IDEMPOTENCY_CONFLICT`。
- 时间以 ISO 8601 UTC 持久化和传输；工作日历按 `Asia/Shanghai` 判断有效日期。
- P1 本地演示用 stub 分类完成器把 `SUBMITTED` 推进 `PENDING_REVIEW`；该完成器只在 `scripts/local-quality-dev.ts` 中装配，不暴露生产 HTTP 接口。P3 接入 AI worker 时替换该装配点。
- 新功能执行时先用 `superpowers:using-git-worktrees` 在 `.worktrees/` 创建隔离分支，不在当前分支或 `main` 直接实现。
- 每个任务严格按测试先行：先观察指定失败，再写最小实现，通过局部测试后提交。

## File Map

| File | Responsibility |
|---|---|
| `src/quality/domain/types.ts` | P1 状态、动作、角色、事件、审计和错误类型 |
| `src/quality/domain/event-state-machine.ts` | 纯状态迁移矩阵与领域不变量 |
| `src/quality/domain/allowed-actions.ts` | 根据角色、状态和 active 主责计算动作 |
| `src/quality/domain/work-calendar.ts` | 版本化工作日历解析和工作小时累计 |
| `src/quality/domain/sla-policy.ts` | 承接及初步分析 SLA 截止时间 |
| `src/quality/infra/quality-config.ts` | 默认关闭的配置解析与校验 |
| `src/quality/infra/quality-schema.ts` | P1 `quality_*` 幂等迁移 |
| `src/quality/infra/quality-db.ts` | SQLite 连接、迁移和事务封装 |
| `src/quality/infra/quality-event-repo.ts` | 事件聚合、时间线、幂等和乐观锁 repository |
| `src/security/workbench-quality-role-directory.ts` | 质量角色历史目录及原子持久化 |
| `src/security/workbench-capabilities.ts` | 在现有能力对象上并入质量角色 |
| `src/quality/application/ports.ts` | 应用层依赖接口和命令返回合同 |
| `src/quality/application/execute-quality-command.ts` | 幂等命令事务模板 |
| `src/quality/application/quality-command-helpers.ts` | 统一构造 append-only 审计记录 |
| `src/quality/application/create-quality-event.ts` | 售后主管创建与重复台账行处理 |
| `src/quality/application/complete-classification-intake.ts` | 系统/stub 完成分类入口 |
| `src/quality/application/review-classification.ts` | 质量专员人工复判 |
| `src/quality/application/dispatch-quality-event.ts` | 主责/协作派发与承接 SLA |
| `src/quality/application/respond-to-dispatch.ts` | 主责负责人承接或驳回 |
| `src/quality/application/submit-initial-analysis.ts` | 初步分析和建议期限 |
| `src/quality/application/decide-due-date.ts` | 质量专员期限确认或退回 |
| `src/quality/quality-module.ts` | 默认关闭的惰性 composition root 与测试重置 |
| `src/web/quality/quality-api-contracts.ts` | Zod 请求合同 |
| `src/web/quality/quality-api-errors.ts` | 统一 HTTP 错误映射 |
| `src/web/quality/quality-router.ts` | P1 查询、写入及管理 API |
| `src/web/assignment-workbench.ts` | 把质量路由接入现有 session |
| `scripts/local-quality-dev.ts` | 五身份、本地日历、部门和 stub 分类演示 |
| `config/quality-work-calendar.example.json` | Asia/Shanghai 版本化日历样例 |
| `docs/quality-event-tracking-p1.md` | P1 范围、身份和 API 操作手册 |
| `tests/quality/support/**` | 内存数据库、固定时钟和真实 session HTTP 测试工具 |
| `tests/quality/**` | 领域、基础设施、应用、Web 和演示闭环测试 |

---

### Task 1: P1 Domain Contract and Default-Off Configuration

**FR / AC:** FR-004、FR-020..024 的共享数据合同；AC-018。

**Files:**
- Create: `src/quality/domain/types.ts`
- Create: `src/quality/infra/quality-config.ts`
- Create: `tests/quality/infra/quality-config.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `QualityEventStatus`, `QualityEventAction`, `QualityAuditAction`, `QualityRole`, `QualityActor`, `QualityEvent`, `QualityTransition`, `QualityError`, `QualityConfig`, `resolveQualityConfig(env)`.
- Consumes: no P1 quality code.

- [ ] **Step 1: Write the failing configuration tests**

```ts
import { describe, expect, it } from "vitest";
import { resolveQualityConfig } from "../../../src/quality/infra/quality-config";

describe("resolveQualityConfig", () => {
  it("is disabled by default and uses the workbench sqlite", () => {
    expect(resolveQualityConfig({})).toMatchObject({
      enabled: false,
      sqlitePath: "./data/workbench/workbench.sqlite",
      timezone: "Asia/Shanghai",
    });
  });

  it("rejects a non-Asia/Shanghai calendar timezone", () => {
    expect(() =>
      resolveQualityConfig({
        QUALITY_MODULE_ENABLED: "1",
        QUALITY_WORK_CALENDAR_TIMEZONE: "UTC",
      }),
    ).toThrowError("QUALITY_CONFIG_INVALID");
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing-module failure**

Run: `npx vitest run tests/quality/infra/quality-config.test.ts`

Expected: FAIL with `Cannot find module '../../../src/quality/infra/quality-config'`.

- [ ] **Step 3: Add the exact P1 domain types**

```ts
export type QualityEventStatus =
  | "SUBMITTED"
  | "PENDING_REVIEW"
  | "DEFERRED"
  | "DISPATCHED"
  | "REJECTED_BACK"
  | "ACCEPTED_PENDING_ANALYSIS"
  | "PENDING_DUE_CONFIRMATION"
  | "IN_PROGRESS"
  | "PENDING_QUALITY_REVIEW"
  | "PENDING_AFTERSALES_REVIEW"
  | "CLOSED"
  | "NOTIFIED";

export type QualityEventAction =
  | "AI_FINISHED"
  | "AI_FAILED"
  | "DEFER"
  | "RESUME"
  | "DISPATCH"
  | "REDISPATCH"
  | "ACCEPT"
  | "REJECT"
  | "SUBMIT_INITIAL_ANALYSIS"
  | "APPROVE_DUE"
  | "RETURN_DUE"
  | "OWNER_CONFIRM"
  | "QUALITY_APPROVE"
  | "QUALITY_RETURN"
  | "AFTERSALES_APPROVE"
  | "AFTERSALES_RETURN"
  | "ESCALATE"
  | "RESOLVE_ESCALATION"
  | "NOTIFICATION_SUCCEEDED";

export type QualityAuditAction =
  | QualityEventAction
  | "EVENT_CREATED"
  | "DUPLICATE_SUBMISSION"
  | "CLASSIFICATION_REVIEWED"
  | "QUALITY_ROLE_CHANGED"
  | "DEPARTMENT_OWNER_CHANGED";

export type QualityRole = "AFTERSALES_MANAGER" | "QUALITY_SPECIALIST";
export type QualityRiskLevel = "HIGH" | "MEDIUM" | "LOW";

export interface QualityActor {
  userId: string;
  qualityRoles: QualityRole[];
  isAdmin: boolean;
}

export interface QualityEvent {
  id: string;
  eventNo: string;
  ledgerRowKey: string | null;
  status: QualityEventStatus;
  title: string;
  description: string;
  faultCode: string | null;
  deviceModel: string | null;
  deviceSn: string | null;
  softwareVersion: string | null;
  catheterBatch: string | null;
  impact: string | null;
  feedbackAt: string | null;
  feedbackUserId: string | null;
  feedbackName: string | null;
  submittedBy: string;
  submittedAt: string;
  categoryMajor: string | null;
  riskLevel: QualityRiskLevel | null;
  internalAssigneeUserId: string | null;
  acceptSlaDueAt: string | null;
  analysisSlaDueAt: string | null;
  formalDueAt: string | null;
  deferReviewAt: string | null;
  closedAt: string | null;
  notifiedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface QualityTransition {
  id: string;
  eventId: string;
  fromStatus: QualityEventStatus | null;
  toStatus: QualityEventStatus;
  action: QualityAuditAction;
  actorId: string;
  actorRole: QualityRole | "PRIMARY_OWNER" | "SYSTEM";
  reason: string | null;
  payload: Record<string, unknown>;
  requestId: string;
  createdAt: string;
}

export class QualityError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
```

- [ ] **Step 4: Implement configuration parsing and document env values**

```ts
export interface QualityConfig {
  enabled: boolean;
  sqlitePath: string;
  dataDir: string;
  workCalendarFile: string;
  timezone: "Asia/Shanghai";
}

export function resolveQualityConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): QualityConfig {
  const timezone = env.QUALITY_WORK_CALENDAR_TIMEZONE?.trim() || "Asia/Shanghai";
  if (timezone !== "Asia/Shanghai") {
    throw new Error("QUALITY_CONFIG_INVALID: timezone must be Asia/Shanghai");
  }
  return {
    enabled: env.QUALITY_MODULE_ENABLED?.trim() === "1",
    sqlitePath:
      env.WORKBENCH_SQLITE_PATH?.trim() || "./data/workbench/workbench.sqlite",
    dataDir: env.QUALITY_DATA_DIR?.trim() || "data/quality",
    workCalendarFile:
      env.QUALITY_WORK_CALENDAR_FILE?.trim()
      || "config/quality-work-calendar.json",
    timezone,
  };
}
```

Append to `.env.example`:

```dotenv
# Quality event tracking is hidden unless explicitly enabled.
QUALITY_MODULE_ENABLED=0
QUALITY_DATA_DIR=data/quality
QUALITY_WORK_CALENDAR_FILE=config/quality-work-calendar.json
QUALITY_WORK_CALENDAR_TIMEZONE=Asia/Shanghai
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run tests/quality/infra/quality-config.test.ts && npm run typecheck`

Expected: 2 tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit**

```bash
git add .env.example src/quality/domain/types.ts src/quality/infra/quality-config.ts tests/quality/infra/quality-config.test.ts
git commit -m "feat(quality): add P1 domain contracts and config"
```

---

### Task 2: State Machine, Invariants, and Allowed Actions

**FR / AC:** FR-020..024；AC-006 的角色/分派部分、AC-009、AC-016。

**Files:**
- Create: `src/quality/domain/event-state-machine.ts`
- Create: `src/quality/domain/allowed-actions.ts`
- Create: `tests/quality/domain/event-state-machine.test.ts`
- Create: `tests/quality/domain/allowed-actions.test.ts`

**Interfaces:**
- Consumes: `QualityEvent`, `QualityEventAction`, `QualityActor`, `QualityRole`.
- Produces: `transitionQualityEvent(input): QualityTransitionResult`, `allowedQualityActions(input): QualityEventAction[]`.

- [ ] **Step 1: Write a table-driven failing transition test**

```ts
import { describe, expect, it } from "vitest";
import { transitionQualityEvent } from "../../../src/quality/domain/event-state-machine";
import type { QualityEvent } from "../../../src/quality/domain/types";

const base = {
  id: "qe-1",
  eventNo: "QE-20260713-0001",
  ledgerRowKey: null,
  title: "导管漏液",
  description: "测试描述",
  faultCode: null,
  deviceModel: null,
  deviceSn: null,
  softwareVersion: null,
  catheterBatch: null,
  impact: null,
  feedbackAt: null,
  feedbackUserId: null,
  feedbackName: null,
  submittedBy: "after-1",
  submittedAt: "2026-07-13T01:00:00.000Z",
  categoryMajor: "硬件",
  riskLevel: "HIGH",
  internalAssigneeUserId: null,
  acceptSlaDueAt: null,
  analysisSlaDueAt: null,
  formalDueAt: null,
  deferReviewAt: null,
  closedAt: null,
  notifiedAt: null,
  version: 3,
  createdAt: "2026-07-13T01:00:00.000Z",
  updatedAt: "2026-07-13T01:00:00.000Z",
} satisfies Omit<QualityEvent, "status">;

describe("transitionQualityEvent", () => {
  it.each([
    ["SUBMITTED", "AI_FAILED", "PENDING_REVIEW"],
    ["PENDING_REVIEW", "DISPATCH", "DISPATCHED"],
    ["REJECTED_BACK", "REDISPATCH", "DISPATCHED"],
    ["DISPATCHED", "ACCEPT", "ACCEPTED_PENDING_ANALYSIS"],
    ["DISPATCHED", "REJECT", "REJECTED_BACK"],
    ["ACCEPTED_PENDING_ANALYSIS", "SUBMIT_INITIAL_ANALYSIS", "PENDING_DUE_CONFIRMATION"],
    ["PENDING_DUE_CONFIRMATION", "APPROVE_DUE", "IN_PROGRESS"],
    ["PENDING_DUE_CONFIRMATION", "RETURN_DUE", "ACCEPTED_PENDING_ANALYSIS"],
  ] as const)("%s + %s -> %s", (status, action, expected) => {
    const result = transitionQualityEvent({
      event: { ...base, status },
      action,
      actor: { userId: "actor", qualityRoles: ["QUALITY_SPECIALIST"], isAdmin: false },
      actorRole:
        action === "AI_FAILED"
          ? "SYSTEM"
          : action === "ACCEPT"
            || action === "REJECT"
            || action === "SUBMIT_INITIAL_ANALYSIS"
            ? "PRIMARY_OWNER"
            : "QUALITY_SPECIALIST",
      payload:
        action === "APPROVE_DUE"
          ? { formalDueAt: "2026-07-20T10:00:00.000Z" }
          : action === "DISPATCH" || action === "REDISPATCH"
            ? { primaryDepartmentId: "rd", collaboratorDepartmentIds: ["qa-lab"] }
            : action === "SUBMIT_INITIAL_ANALYSIS"
              ? {
                  analysis: "密封圈尺寸偏差",
                  solutionPlan: "复测库存并更换",
                  internalAssigneeUserId: "engineer-1",
                  proposedDueAt: "2026-07-20T10:00:00.000Z",
                }
          : action === "REJECT"
            ? { reason: "不属于本部门" }
            : {},
      now: "2026-07-13T02:00:00.000Z",
    });
    expect(result.event.status).toBe(expected);
    expect(result.event.version).toBe(4);
    expect(result.audit.fromStatus).toBe(status);
  });

  it("rejects a due date at or before the decision time", () => {
    expect(() =>
      transitionQualityEvent({
        event: { ...base, status: "PENDING_DUE_CONFIRMATION" },
        action: "APPROVE_DUE",
        actor: { userId: "quality-1", qualityRoles: ["QUALITY_SPECIALIST"], isAdmin: false },
        actorRole: "QUALITY_SPECIALIST",
        payload: { formalDueAt: "2026-07-13T01:00:00.000Z" },
        now: "2026-07-13T02:00:00.000Z",
      }),
    ).toThrowError("QUALITY_VALIDATION_FAILED");
  });
});
```

- [ ] **Step 2: Run the state-machine test and confirm it fails**

Run: `npx vitest run tests/quality/domain/event-state-machine.test.ts`

Expected: FAIL with missing `event-state-machine` module.

- [ ] **Step 3: Implement one transition table and invariant checks**

```ts
import {
  QualityError,
  type QualityActor,
  type QualityEvent,
  type QualityEventAction,
  type QualityRole,
  type QualityTransition,
} from "./types";

const TRANSITION_RULES: Partial<
  Record<QualityEvent["status"], Partial<Record<QualityEventAction, QualityEvent["status"]>>>
> = {
  SUBMITTED: { AI_FINISHED: "PENDING_REVIEW", AI_FAILED: "PENDING_REVIEW" },
  PENDING_REVIEW: { DEFER: "DEFERRED", DISPATCH: "DISPATCHED" },
  DEFERRED: { RESUME: "PENDING_REVIEW" },
  DISPATCHED: { ACCEPT: "ACCEPTED_PENDING_ANALYSIS", REJECT: "REJECTED_BACK" },
  REJECTED_BACK: { REDISPATCH: "DISPATCHED" },
  ACCEPTED_PENDING_ANALYSIS: {
    SUBMIT_INITIAL_ANALYSIS: "PENDING_DUE_CONFIRMATION",
  },
  PENDING_DUE_CONFIRMATION: {
    APPROVE_DUE: "IN_PROGRESS",
    RETURN_DUE: "ACCEPTED_PENDING_ANALYSIS",
  },
  IN_PROGRESS: { OWNER_CONFIRM: "PENDING_QUALITY_REVIEW" },
  PENDING_QUALITY_REVIEW: {
    QUALITY_APPROVE: "PENDING_AFTERSALES_REVIEW",
    QUALITY_RETURN: "IN_PROGRESS",
  },
  PENDING_AFTERSALES_REVIEW: {
    AFTERSALES_APPROVE: "CLOSED",
    AFTERSALES_RETURN: "IN_PROGRESS",
  },
  CLOSED: { NOTIFICATION_SUCCEEDED: "NOTIFIED" },
};

export interface QualityTransitionInput {
  event: QualityEvent;
  action: QualityEventAction;
  actor: QualityActor;
  actorRole: QualityRole | "PRIMARY_OWNER" | "SYSTEM";
  payload: Record<string, unknown>;
  now: string;
}

export interface QualityTransitionResult {
  event: QualityEvent;
  audit: Omit<QualityTransition, "id" | "requestId">;
}

export function transitionQualityEvent(input: QualityTransitionInput): QualityTransitionResult {
  const nextStatus = TRANSITION_RULES[input.event.status]?.[input.action];
  if (!nextStatus) {
    throw new QualityError(
      "QUALITY_INVALID_TRANSITION",
      `QUALITY_INVALID_TRANSITION: ${input.event.status} cannot ${input.action}`,
    );
  }
  const requiredRole: Partial<Record<QualityEventAction, QualityTransitionInput["actorRole"]>> = {
    AI_FINISHED: "SYSTEM",
    AI_FAILED: "SYSTEM",
    DEFER: "QUALITY_SPECIALIST",
    RESUME: "QUALITY_SPECIALIST",
    DISPATCH: "QUALITY_SPECIALIST",
    REDISPATCH: "QUALITY_SPECIALIST",
    ACCEPT: "PRIMARY_OWNER",
    REJECT: "PRIMARY_OWNER",
    SUBMIT_INITIAL_ANALYSIS: "PRIMARY_OWNER",
    APPROVE_DUE: "QUALITY_SPECIALIST",
    RETURN_DUE: "QUALITY_SPECIALIST",
    OWNER_CONFIRM: "PRIMARY_OWNER",
    QUALITY_APPROVE: "QUALITY_SPECIALIST",
    QUALITY_RETURN: "QUALITY_SPECIALIST",
    AFTERSALES_APPROVE: "AFTERSALES_MANAGER",
    AFTERSALES_RETURN: "AFTERSALES_MANAGER",
    NOTIFICATION_SUCCEEDED: "SYSTEM",
  };
  if (requiredRole[input.action] && requiredRole[input.action] !== input.actorRole) {
    throw new QualityError("QUALITY_FORBIDDEN", "QUALITY_FORBIDDEN: actor role cannot act");
  }
  if (
    input.actorRole === "QUALITY_SPECIALIST"
    && !input.actor.qualityRoles.includes("QUALITY_SPECIALIST")
  ) {
    throw new QualityError("QUALITY_FORBIDDEN", "QUALITY_FORBIDDEN: quality role missing");
  }
  if (
    input.actorRole === "AFTERSALES_MANAGER"
    && !input.actor.qualityRoles.includes("AFTERSALES_MANAGER")
  ) {
    throw new QualityError("QUALITY_FORBIDDEN", "QUALITY_FORBIDDEN: aftersales role missing");
  }
  if (input.action === "DISPATCH" || input.action === "REDISPATCH") {
    const primary = typeof input.payload.primaryDepartmentId === "string"
      ? input.payload.primaryDepartmentId.trim()
      : "";
    const collaborators = Array.isArray(input.payload.collaboratorDepartmentIds)
      ? input.payload.collaboratorDepartmentIds.map(String)
      : [];
    if (!primary || collaborators.includes(primary) || new Set(collaborators).size !== collaborators.length) {
      throw new QualityError(
        "QUALITY_VALIDATION_FAILED",
        "QUALITY_VALIDATION_FAILED: exactly one distinct primary department is required",
      );
    }
  }
  if (input.action === "SUBMIT_INITIAL_ANALYSIS") {
    for (const field of ["analysis", "solutionPlan", "internalAssigneeUserId", "proposedDueAt"]) {
      if (typeof input.payload[field] !== "string" || !input.payload[field].trim()) {
        throw new QualityError(
          "QUALITY_VALIDATION_FAILED",
          `QUALITY_VALIDATION_FAILED: ${field} is required`,
        );
      }
    }
  }
  const reason = typeof input.payload.reason === "string" ? input.payload.reason.trim() : "";
  if (input.action === "REJECT" && !reason) {
    throw new QualityError("QUALITY_VALIDATION_FAILED", "QUALITY_VALIDATION_FAILED: reason");
  }
  const formalDueAt =
    input.action === "APPROVE_DUE" && typeof input.payload.formalDueAt === "string"
      ? input.payload.formalDueAt
      : input.event.formalDueAt;
  if (
    input.action === "APPROVE_DUE"
    && (!formalDueAt || Date.parse(formalDueAt) <= Date.parse(input.now))
  ) {
    throw new QualityError(
      "QUALITY_VALIDATION_FAILED",
      "QUALITY_VALIDATION_FAILED: formalDueAt must be in the future",
    );
  }
  const event: QualityEvent = {
    ...input.event,
    status: nextStatus,
    formalDueAt,
    version: input.event.version + 1,
    updatedAt: input.now,
  };
  return {
    event,
    audit: {
      eventId: event.id,
      fromStatus: input.event.status,
      toStatus: event.status,
      action: input.action,
      actorId: input.actor.userId,
      actorRole: input.actorRole,
      reason: reason || null,
      payload: input.payload,
      createdAt: input.now,
    },
  };
}
```

- [ ] **Step 4: Add failing allowed-action tests and implement role filtering**

```ts
import { expect, it } from "vitest";
import { allowedQualityActions } from "../../../src/quality/domain/allowed-actions";

it("gives dispatch only to a quality specialist", () => {
  expect(
    allowedQualityActions({
      status: "PENDING_REVIEW",
      actor: { userId: "q1", qualityRoles: ["QUALITY_SPECIALIST"], isAdmin: false },
      activePrimaryOwnerUserId: null,
    }),
  ).toContain("DISPATCH");
  expect(
    allowedQualityActions({
      status: "PENDING_REVIEW",
      actor: { userId: "admin", qualityRoles: [], isAdmin: true },
      activePrimaryOwnerUserId: null,
    }),
  ).toEqual([]);
});

it("gives accept and reject only to the active primary owner", () => {
  expect(
    allowedQualityActions({
      status: "DISPATCHED",
      actor: { userId: "owner-1", qualityRoles: [], isAdmin: false },
      activePrimaryOwnerUserId: "owner-1",
    }),
  ).toEqual(["ACCEPT", "REJECT"]);
});
```

Implementation:

```ts
import type {
  QualityActor,
  QualityEventAction,
  QualityEventStatus,
} from "./types";

export function allowedQualityActions(input: {
  status: QualityEventStatus;
  actor: QualityActor;
  activePrimaryOwnerUserId: string | null;
}): QualityEventAction[] {
  const isQuality = input.actor.qualityRoles.includes("QUALITY_SPECIALIST");
  const isAftersales = input.actor.qualityRoles.includes("AFTERSALES_MANAGER");
  const isOwner = input.activePrimaryOwnerUserId === input.actor.userId;
  if (input.status === "PENDING_REVIEW" && isQuality) return ["DEFER", "DISPATCH"];
  if (input.status === "REJECTED_BACK" && isQuality) return ["REDISPATCH"];
  if (input.status === "DISPATCHED" && isOwner) return ["ACCEPT", "REJECT"];
  if (input.status === "ACCEPTED_PENDING_ANALYSIS" && isOwner) {
    return ["SUBMIT_INITIAL_ANALYSIS"];
  }
  if (input.status === "PENDING_DUE_CONFIRMATION" && isQuality) {
    return ["APPROVE_DUE", "RETURN_DUE"];
  }
  if (input.status === "PENDING_AFTERSALES_REVIEW" && isAftersales) {
    return ["AFTERSALES_APPROVE", "AFTERSALES_RETURN"];
  }
  return [];
}
```

- [ ] **Step 5: Run both domain test files**

Run: `npx vitest run tests/quality/domain/event-state-machine.test.ts tests/quality/domain/allowed-actions.test.ts`

Expected: all cases PASS.

- [ ] **Step 6: Commit**

```bash
git add src/quality/domain/event-state-machine.ts src/quality/domain/allowed-actions.ts tests/quality/domain
git commit -m "feat(quality): add event state machine"
```

---

### Task 3: Asia/Shanghai Work Calendar and Frozen SLA Deadlines

**FR / AC:** FR-022；AC-008；为 AC-007 的后续 SLA 扫描冻结截止时间，扫描器不在 P1。

**Files:**
- Create: `src/quality/domain/work-calendar.ts`
- Create: `src/quality/domain/sla-policy.ts`
- Create: `config/quality-work-calendar.example.json`
- Create: `tests/quality/domain/work-calendar.test.ts`
- Create: `tests/quality/domain/sla-policy.test.ts`

**Interfaces:**
- Produces: `parseWorkCalendar(raw): WorkCalendar`, `addWorkingHours(startIso, hours, calendar): string`, `computeAcceptSlaDueAt`, `computeAnalysisSlaDueAt`.
- Consumes: `QualityRiskLevel`.

- [ ] **Step 1: Write failing weekend, holiday, and makeup-day tests**

```ts
import { describe, expect, it } from "vitest";
import {
  addWorkingHours,
  parseWorkCalendar,
} from "../../../src/quality/domain/work-calendar";

const standardCalendar = parseWorkCalendar({
  version: "2026.1",
  timezone: "Asia/Shanghai",
  defaultWorkingWeekdays: [1, 2, 3, 4, 5],
  holidays: [],
  makeupWorkdays: [],
});

const exceptionCalendar = parseWorkCalendar({
  version: "2026.1",
  timezone: "Asia/Shanghai",
  defaultWorkingWeekdays: [1, 2, 3, 4, 5],
  holidays: ["2026-07-14"],
  makeupWorkdays: ["2026-07-18"],
});

describe("addWorkingHours", () => {
  it("skips an entire weekend", () => {
    expect(addWorkingHours("2026-07-17T08:00:00.000Z", 24, standardCalendar))
      .toBe("2026-07-20T08:00:00.000Z");
  });

  it("skips a configured holiday and counts a makeup Saturday", () => {
    expect(addWorkingHours("2026-07-13T08:00:00.000Z", 48, exceptionCalendar))
      .toBe("2026-07-16T08:00:00.000Z");
    expect(addWorkingHours("2026-07-17T08:00:00.000Z", 24, exceptionCalendar))
      .toBe("2026-07-18T08:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run and confirm missing calendar module**

Run: `npx vitest run tests/quality/domain/work-calendar.test.ts`

Expected: FAIL with missing `work-calendar` module.

- [ ] **Step 3: Implement date classification and hour accumulation**

```ts
import { QualityError } from "./types";

export interface WorkCalendar {
  version: string;
  timezone: "Asia/Shanghai";
  defaultWorkingWeekdays: number[];
  holidays: Set<string>;
  makeupWorkdays: Set<string>;
}

export function parseWorkCalendar(raw: Record<string, unknown>): WorkCalendar {
  if (raw.timezone !== "Asia/Shanghai") {
    throw new QualityError("QUALITY_CONFIG_INVALID", "calendar timezone must be Asia/Shanghai");
  }
  const weekdays = Array.isArray(raw.defaultWorkingWeekdays)
    ? raw.defaultWorkingWeekdays.map(Number)
    : [];
  if (weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
    throw new QualityError("QUALITY_CONFIG_INVALID", "invalid working weekday");
  }
  return {
    version: String(raw.version),
    timezone: "Asia/Shanghai",
    defaultWorkingWeekdays: weekdays,
    holidays: new Set(Array.isArray(raw.holidays) ? raw.holidays.map(String) : []),
    makeupWorkdays: new Set(
      Array.isArray(raw.makeupWorkdays) ? raw.makeupWorkdays.map(String) : [],
    ),
  };
}

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function shanghaiDateParts(date: Date): { key: string; weekday: number } {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  const utcWeekday = shifted.getUTCDay();
  return {
    key: `${year}-${month}-${day}`,
    weekday: utcWeekday === 0 ? 7 : utcWeekday,
  };
}

function nextShanghaiMidnight(date: Date): Date {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate() + 1,
    ) - SHANGHAI_OFFSET_MS,
  );
}

function isWorkingInstant(date: Date, calendar: WorkCalendar): boolean {
  const { key, weekday } = shanghaiDateParts(date);
  if (calendar.makeupWorkdays.has(key)) return true;
  if (calendar.holidays.has(key)) return false;
  return calendar.defaultWorkingWeekdays.includes(weekday);
}

export function addWorkingHours(
  startIso: string,
  hours: number,
  calendar: WorkCalendar,
): string {
  if (!Number.isInteger(hours) || hours <= 0) {
    throw new QualityError("QUALITY_CONFIG_INVALID", "working hours must be positive integer");
  }
  let cursor = new Date(startIso);
  let remainingMs = hours * 60 * 60 * 1000;
  while (remainingMs > 0) {
    const boundary = nextShanghaiMidnight(cursor);
    if (!isWorkingInstant(cursor, calendar)) {
      cursor = boundary;
      continue;
    }
    const availableMs = boundary.getTime() - cursor.getTime();
    const consumedMs = Math.min(availableMs, remainingMs);
    cursor = new Date(cursor.getTime() + consumedMs);
    remainingMs -= consumedMs;
  }
  return cursor.toISOString();
}
```

- [ ] **Step 4: Add SLA policy tests and implementation**

```ts
import { expect, it } from "vitest";
import { parseWorkCalendar } from "../../../src/quality/domain/work-calendar";
import {
  computeAcceptSlaDueAt,
  computeAnalysisSlaDueAt,
} from "../../../src/quality/domain/sla-policy";

const weekdays = parseWorkCalendar({
  version: "2026.1",
  timezone: "Asia/Shanghai",
  defaultWorkingWeekdays: [1, 2, 3, 4, 5],
  holidays: [],
  makeupWorkdays: [],
});

it("freezes accept at 24 working hours", () => {
  expect(computeAcceptSlaDueAt("2026-07-13T01:00:00.000Z", weekdays))
    .toBe("2026-07-14T01:00:00.000Z");
});

it.each([["HIGH", 24], ["MEDIUM", 48], ["LOW", 48]] as const)(
  "uses %s risk policy",
  (risk, expectedHours) => {
    const result = computeAnalysisSlaDueAt("2026-07-13T01:00:00.000Z", risk, weekdays);
    const expected = new Date(Date.parse("2026-07-13T01:00:00.000Z") + expectedHours * 3600000);
    expect(result).toBe(expected.toISOString());
  },
);
```

Implementation:

```ts
import type { QualityRiskLevel } from "./types";
import { addWorkingHours, type WorkCalendar } from "./work-calendar";

export function computeAcceptSlaDueAt(now: string, calendar: WorkCalendar): string {
  return addWorkingHours(now, 24, calendar);
}

export function computeAnalysisSlaDueAt(
  now: string,
  risk: QualityRiskLevel,
  calendar: WorkCalendar,
): string {
  return addWorkingHours(now, risk === "HIGH" ? 24 : 48, calendar);
}
```

- [ ] **Step 5: Add the versioned example calendar**

```json
{
  "version": "2026.1",
  "timezone": "Asia/Shanghai",
  "defaultWorkingWeekdays": [1, 2, 3, 4, 5],
  "holidays": [],
  "makeupWorkdays": []
}
```

- [ ] **Step 6: Run tests and commit**

Run: `npx vitest run tests/quality/domain/work-calendar.test.ts tests/quality/domain/sla-policy.test.ts`

Expected: all tests PASS.

```bash
git add src/quality/domain/work-calendar.ts src/quality/domain/sla-policy.ts config/quality-work-calendar.example.json tests/quality/domain
git commit -m "feat(quality): add work calendar and SLA policy"
```

---

### Task 4: Idempotent SQLite Migrations and Transaction Boundary

**FR / AC:** P1-01；FR-020..024 的持久化基础；AC-017、AC-018。

**Files:**
- Create: `src/quality/infra/quality-schema.ts`
- Create: `src/quality/infra/quality-db.ts`
- Create: `tests/quality/infra/quality-schema.test.ts`

**Interfaces:**
- Produces: `P1_QUALITY_MIGRATIONS`, `applyQualityMigrations(db, migrations?)`, `openQualityDb(config)`, `QualityDb.transaction(fn)`.
- Consumes: `QualityConfig`.

- [ ] **Step 1: Write failing migration tests**

```ts
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  P1_QUALITY_MIGRATIONS,
  applyQualityMigrations,
} from "../../../src/quality/infra/quality-schema";

describe("quality schema", () => {
  it("applies P1 migration exactly once and preserves host tables", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE tasks(id TEXT PRIMARY KEY)");
    applyQualityMigrations(db);
    applyQualityMigrations(db);
    const applied = db.prepare(
      "SELECT COUNT(*) AS count FROM quality_schema_migrations",
    ).get() as { count: number };
    expect(applied.count).toBe(P1_QUALITY_MIGRATIONS.length);
    expect(db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'",
    ).get()).toBeTruthy();
    db.close();
  });

  it("rolls back a failed migration without recording its version", () => {
    const db = new DatabaseSync(":memory:");
    expect(() =>
      applyQualityMigrations(db, [
        { version: 1, description: "broken", sql: "CREATE TABLE x(id TEXT); INVALID SQL" },
      ]),
    ).toThrow();
    expect(db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='x'",
    ).get()).toBeUndefined();
    db.close();
  });
});
```

- [ ] **Step 2: Run and confirm missing schema module**

Run: `npx vitest run tests/quality/infra/quality-schema.test.ts`

Expected: FAIL with missing `quality-schema` module.

- [ ] **Step 3: Add the exact P1 schema**

In `quality-schema.ts`, wrap the immediately following SQL block in a `String.raw` template literal assigned to `const P1_SQL`, then use that constant as the only item in `P1_QUALITY_MIGRATIONS`:

```sql
CREATE TABLE IF NOT EXISTS quality_events (
  id TEXT PRIMARY KEY,
  event_no TEXT NOT NULL UNIQUE,
  ledger_row_key TEXT,
  status TEXT NOT NULL CHECK(status IN (
    'SUBMITTED','PENDING_REVIEW','DEFERRED','DISPATCHED','REJECTED_BACK',
    'ACCEPTED_PENDING_ANALYSIS','PENDING_DUE_CONFIRMATION','IN_PROGRESS',
    'PENDING_QUALITY_REVIEW','PENDING_AFTERSALES_REVIEW','CLOSED','NOTIFIED'
  )),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 5000),
  fault_code TEXT,
  device_model TEXT,
  device_sn TEXT,
  software_version TEXT,
  catheter_batch TEXT,
  impact TEXT,
  feedback_at TEXT,
  feedback_user_id TEXT,
  feedback_name TEXT,
  submitted_by TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  category_major TEXT,
  risk_level TEXT CHECK(risk_level IS NULL OR risk_level IN ('HIGH','MEDIUM','LOW')),
  internal_assignee_user_id TEXT,
  accept_sla_due_at TEXT,
  analysis_sla_due_at TEXT,
  formal_due_at TEXT,
  defer_review_at TEXT,
  closed_at TEXT,
  notified_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_quality_events_active_ledger
ON quality_events(ledger_row_key)
WHERE ledger_row_key IS NOT NULL
  AND status NOT IN ('CLOSED', 'NOTIFIED');

CREATE INDEX IF NOT EXISTS idx_quality_events_status_updated
ON quality_events(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_quality_events_due
ON quality_events(formal_due_at)
WHERE status NOT IN ('CLOSED', 'NOTIFIED');

CREATE TABLE IF NOT EXISTS quality_department_owners (
  department_id TEXT NOT NULL,
  department_name TEXT NOT NULL,
  leader_user_id TEXT NOT NULL,
  active INTEGER NOT NULL CHECK(active IN (0, 1)),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(department_id, effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_quality_department_owner_active
ON quality_department_owners(department_id)
WHERE active = 1;

CREATE TABLE IF NOT EXISTS quality_event_departments (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES quality_events(id),
  assignment_version INTEGER NOT NULL,
  department_id TEXT NOT NULL,
  department_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('PRIMARY','COLLABORATOR')),
  leader_user_id_snapshot TEXT NOT NULL,
  active INTEGER NOT NULL CHECK(active IN (0, 1)),
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_quality_event_primary_active
ON quality_event_departments(event_id)
WHERE active = 1 AND role = 'PRIMARY';

CREATE UNIQUE INDEX IF NOT EXISTS uq_quality_event_department_version
ON quality_event_departments(event_id, assignment_version, department_id);

CREATE TABLE IF NOT EXISTS quality_classification_reviews (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES quality_events(id),
  decision TEXT NOT NULL CHECK(decision IN ('ACCEPT','CORRECT','MANUAL')),
  category_major TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK(risk_level IN ('HIGH','MEDIUM','LOW')),
  evidence_template_ids_json TEXT NOT NULL,
  correction_reason TEXT,
  reviewed_by TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  event_version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS quality_initial_analyses (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES quality_events(id),
  analysis TEXT NOT NULL,
  solution_plan TEXT NOT NULL,
  internal_assignee_user_id TEXT NOT NULL,
  internal_assignee_name TEXT,
  proposed_due_at TEXT NOT NULL,
  version INTEGER NOT NULL,
  active INTEGER NOT NULL CHECK(active IN (0, 1)),
  submitted_by TEXT NOT NULL,
  submitted_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_quality_initial_analysis_active
ON quality_initial_analyses(event_id)
WHERE active = 1;

CREATE TABLE IF NOT EXISTS quality_due_change_requests (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES quality_events(id),
  kind TEXT NOT NULL CHECK(kind IN ('INITIAL','CHANGE')),
  old_due_at TEXT,
  proposed_due_at TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED')),
  requested_by TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  decision_reason TEXT
);

CREATE TABLE IF NOT EXISTS quality_event_transitions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES quality_events(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  reason TEXT,
  payload_json TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quality_transitions_event_created
ON quality_event_transitions(event_id, created_at, id);

CREATE TABLE IF NOT EXISTS quality_idempotency_keys (
  actor_id TEXT NOT NULL,
  route TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(actor_id, route, key)
);
```

- [ ] **Step 4: Implement transactional migration application**

```ts
import type { DatabaseSync } from "node:sqlite";

export interface QualityMigration {
  version: number;
  description: string;
  sql: string;
}

export const P1_QUALITY_MIGRATIONS: QualityMigration[] = [
  { version: 1, description: "quality P1 core tables", sql: P1_SQL },
];

export function applyQualityMigrations(
  db: DatabaseSync,
  migrations: QualityMigration[] = P1_QUALITY_MIGRATIONS,
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS quality_schema_migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = db.prepare(
    "SELECT 1 FROM quality_schema_migrations WHERE version = ?",
  );
  const record = db.prepare(
    "INSERT INTO quality_schema_migrations(version, description, applied_at) VALUES (?, ?, ?)",
  );
  for (const migration of migrations) {
    if (applied.get(migration.version)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      record.run(migration.version, migration.description, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
```

`quality-db.ts`:

```ts
import { DatabaseSync } from "node:sqlite";
import type { QualityConfig } from "./quality-config";
import { applyQualityMigrations } from "./quality-schema";

export interface QualityDb {
  raw: DatabaseSync;
  transaction<T>(work: () => T): T;
  close(): void;
}

export function openQualityDb(config: QualityConfig): QualityDb {
  if (!config.enabled) throw new Error("QUALITY_MODULE_DISABLED");
  const raw = new DatabaseSync(config.sqlitePath);
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec("PRAGMA busy_timeout = 8000");
  raw.exec("PRAGMA journal_mode = WAL");
  applyQualityMigrations(raw);
  return {
    raw,
    transaction<T>(work: () => T): T {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const result = work();
        raw.exec("COMMIT");
        return result;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
    close: () => raw.close(),
  };
}
```

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/quality/infra/quality-schema.test.ts && npm run typecheck`

Expected: migration tests PASS and TypeScript exits 0.

```bash
git add src/quality/infra/quality-schema.ts src/quality/infra/quality-db.ts tests/quality/infra/quality-schema.test.ts
git commit -m "feat(quality): add P1 sqlite migrations"
```

---

### Task 5: Repository, Optimistic Locking, Timeline, and Idempotency

**FR / AC:** BR-001、P1-04；AC-002、AC-017。

**Files:**
- Create: `src/quality/application/ports.ts`
- Create: `src/quality/infra/quality-event-repo.ts`
- Create: `tests/quality/infra/quality-event-repo.test.ts`

**Interfaces:**
- Produces: `QualityEventRepository`, `QualityEventTransaction`, `IdempotencyRecord`, `createSqliteQualityEventRepository(db)`.
- Consumes: `QualityDb`, domain types.

- [ ] **Step 1: Define the repository contract used by every command**

```ts
import type {
  QualityEvent,
  QualityTransition,
} from "../domain/types";

export interface IdempotencyRecord {
  actorId: string;
  route: string;
  key: string;
  requestHash: string;
  responseStatus: number;
  responseJson: string;
  expiresAt: string;
  createdAt: string;
}

export interface DepartmentOwner {
  departmentId: string;
  departmentName: string;
  leaderUserId: string;
}

export interface DepartmentAssignmentInput extends DepartmentOwner {
  role: "PRIMARY" | "COLLABORATOR";
}

export interface PendingInitialDueRequest {
  id: string;
  eventId: string;
  proposedDueAt: string;
  requestedBy: string;
}

export interface QualityEventTransaction {
  findEventById(id: string): QualityEvent | null;
  findActiveEventByLedgerRowKey(ledgerRowKey: string): QualityEvent | null;
  insertEvent(event: QualityEvent): void;
  updateEvent(event: QualityEvent, expectedVersion: number): void;
  appendTransition(transition: QualityTransition): void;
  findActiveDepartmentOwner(departmentId: string): DepartmentOwner | null;
  replaceActiveDepartments(input: {
    eventId: string;
    assignmentVersion: number;
    assignments: DepartmentAssignmentInput[];
    actorId: string;
    now: string;
    ids: string[];
  }): void;
  findActivePrimaryOwner(eventId: string): DepartmentOwner | null;
  listActiveDepartmentAssignments(eventId: string): DepartmentAssignmentInput[];
  upsertDepartmentOwner(input: DepartmentOwner & {
    actorId: string;
    now: string;
  }): void;
  insertClassificationReview(input: {
    id: string;
    eventId: string;
    decision: "ACCEPT" | "CORRECT" | "MANUAL";
    categoryMajor: string;
    riskLevel: "HIGH" | "MEDIUM" | "LOW";
    evidenceTemplateIds: string[];
    correctionReason: string | null;
    reviewedBy: string;
    reviewedAt: string;
    eventVersion: number;
  }): void;
  insertInitialAnalysis(input: {
    id: string;
    eventId: string;
    analysis: string;
    solutionPlan: string;
    internalAssigneeUserId: string;
    internalAssigneeName: string | null;
    proposedDueAt: string;
    version: number;
    submittedBy: string;
    submittedAt: string;
  }): void;
  insertInitialDueRequest(input: {
    id: string;
    eventId: string;
    proposedDueAt: string;
    requestedBy: string;
  }): void;
  findPendingInitialDueRequest(eventId: string): PendingInitialDueRequest | null;
  decideInitialDueRequest(input: {
    eventId: string;
    status: "APPROVED" | "REJECTED";
    decidedBy: string;
    decidedAt: string;
    decisionReason: string | null;
  }): void;
  getIdempotency(actorId: string, route: string, key: string): IdempotencyRecord | null;
  saveIdempotency(record: IdempotencyRecord): void;
}

export interface QualityEventRepository {
  transaction<T>(work: (tx: QualityEventTransaction) => T): T;
  findEventById(id: string): QualityEvent | null;
  listTimeline(eventId: string): QualityTransition[];
  upsertDepartmentOwner(input: DepartmentOwner & {
    actorId: string;
    now: string;
  }): void;
}

export interface QualityClock {
  now(): string;
}

export interface QualityIdFactory {
  next(prefix: "event" | "transition" | "review" | "analysis" | "due" | "department"): string;
}
```

- [ ] **Step 2: Write failing duplicate, stale-version, rollback, and replay tests**

```ts
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { QualityEvent } from "../../../src/quality/domain/types";
import { applyQualityMigrations } from "../../../src/quality/infra/quality-schema";
import { createSqliteQualityEventRepository } from "../../../src/quality/infra/quality-event-repo";

function eventFixture(overrides: Partial<QualityEvent> = {}): QualityEvent {
  return {
    id: "e1",
    eventNo: "QE-20260713-0001",
    ledgerRowKey: null,
    status: "SUBMITTED",
    title: "导管漏液",
    description: "客户现场反馈漏液",
    faultCode: null,
    deviceModel: null,
    deviceSn: null,
    softwareVersion: null,
    catheterBatch: null,
    impact: null,
    feedbackAt: null,
    feedbackUserId: null,
    feedbackName: null,
    submittedBy: "after-1",
    submittedAt: "2026-07-13T01:00:00.000Z",
    categoryMajor: null,
    riskLevel: null,
    internalAssigneeUserId: null,
    acceptSlaDueAt: null,
    analysisSlaDueAt: null,
    formalDueAt: null,
    deferReviewAt: null,
    closedAt: null,
    notifiedAt: null,
    version: 1,
    createdAt: "2026-07-13T01:00:00.000Z",
    updatedAt: "2026-07-13T01:00:00.000Z",
    ...overrides,
  };
}

describe("quality event repository", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    applyQualityMigrations(db);
  });

  it("finds one active event per ledger row", () => {
    const repo = createSqliteQualityEventRepository(db);
    repo.transaction((tx) => tx.insertEvent(eventFixture({
      id: "e1",
      ledgerRowKey: "row-1",
      version: 1,
    })));
    expect(repo.transaction((tx) => tx.findActiveEventByLedgerRowKey("row-1"))?.id)
      .toBe("e1");
  });

  it("throws QUALITY_VERSION_CONFLICT and keeps the first write", () => {
    const repo = createSqliteQualityEventRepository(db);
    repo.transaction((tx) => tx.insertEvent(eventFixture({ id: "e1", version: 1 })));
    const current = repo.findEventById("e1")!;
    repo.transaction((tx) => tx.updateEvent({ ...current, version: 2 }, 1));
    expect(() =>
      repo.transaction((tx) => tx.updateEvent({ ...current, title: "stale", version: 2 }, 1)),
    ).toThrowError("QUALITY_VERSION_CONFLICT");
    expect(repo.findEventById("e1")?.title).not.toBe("stale");
  });

  it("rolls back event and audit together", () => {
    const repo = createSqliteQualityEventRepository(db);
    expect(() =>
      repo.transaction((tx) => {
        tx.insertEvent(eventFixture({ id: "e1", version: 1 }));
        throw new Error("forced");
      }),
    ).toThrowError("forced");
    expect(repo.findEventById("e1")).toBeNull();
  });
});
```

- [ ] **Step 3: Run and confirm missing repository module**

Run: `npx vitest run tests/quality/infra/quality-event-repo.test.ts`

Expected: FAIL with missing `quality-event-repo` module.

- [ ] **Step 4: Implement row mapping and guarded update**

```ts
function updateEvent(tx: DatabaseSync, event: QualityEvent, expectedVersion: number): void {
  if (event.version !== expectedVersion + 1) {
    throw new QualityError(
      "QUALITY_VALIDATION_FAILED",
      "QUALITY_VALIDATION_FAILED: version must increment exactly once",
    );
  }
  const result = tx.prepare(`
    UPDATE quality_events
    SET status = ?, title = ?, description = ?, category_major = ?, risk_level = ?,
        internal_assignee_user_id = ?, accept_sla_due_at = ?, analysis_sla_due_at = ?,
        formal_due_at = ?, version = version + 1, updated_at = ?
    WHERE id = ? AND version = ?
  `).run(
    event.status,
    event.title,
    event.description,
    event.categoryMajor,
    event.riskLevel,
    event.internalAssigneeUserId,
    event.acceptSlaDueAt,
    event.analysisSlaDueAt,
    event.formalDueAt,
    event.updatedAt,
    event.id,
    expectedVersion,
  );
  if (result.changes !== 1) {
    throw new QualityError(
      "QUALITY_VERSION_CONFLICT",
      "QUALITY_VERSION_CONFLICT: stale event version",
      { eventId: event.id, expectedVersion },
    );
  }
}
```

Implement all Task 5 interface methods with prepared statements and parameter binding. `transaction(work)` must use `BEGIN IMMEDIATE`, `COMMIT`, and `ROLLBACK`; `appendTransition` only inserts; `listTimeline` orders by `created_at, id`; `replaceActiveDepartments` revokes current rows before inserting the new assignment version and relies on the partial unique index to enforce one active primary.

- [ ] **Step 5: Implement idempotency comparison as a shared pure helper**

```ts
export function resolveIdempotentReplay(
  existing: IdempotencyRecord | null,
  requestHash: string,
): { status: number; body: string } | null {
  if (!existing) return null;
  if (existing.requestHash !== requestHash) {
    throw new QualityError(
      "QUALITY_IDEMPOTENCY_CONFLICT",
      "QUALITY_IDEMPOTENCY_CONFLICT: key reused with different body",
    );
  }
  return { status: existing.responseStatus, body: existing.responseJson };
}
```

Add tests asserting same hash returns the stored status/body and a different hash throws `QUALITY_IDEMPOTENCY_CONFLICT`.

- [ ] **Step 6: Run repository tests and commit**

Run: `npx vitest run tests/quality/infra/quality-event-repo.test.ts && npm run typecheck`

Expected: duplicate, optimistic lock, rollback, timeline and idempotency cases PASS.

```bash
git add src/quality/application/ports.ts src/quality/infra/quality-event-repo.ts tests/quality/infra/quality-event-repo.test.ts
git commit -m "feat(quality): add transactional event repository"
```

---

### Task 6: Quality Roles, Capability Union, and Permission History

**FR / AC:** P1-05；角色矩阵；AC-016。

**Files:**
- Create: `src/security/workbench-quality-role-directory.ts`
- Create: `tests/security/workbench-quality-role-directory.test.ts`
- Modify: `src/security/workbench-capabilities.ts`
- Modify: `tests/security/workbench-capabilities.test.ts`

**Interfaces:**
- Produces: `listActiveQualityRoles(userId)`, `setWorkbenchQualityRole(input)`, extended `WorkbenchCapabilities`.
- Consumes: `QUALITY_DATA_DIR`; existing `resolveWorkbenchCapabilities`.

- [ ] **Step 1: Write failing role history and capability-union tests**

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  listActiveQualityRoles,
  setWorkbenchQualityRole,
} from "../../src/security/workbench-quality-role-directory";

let qualityDir = "";
beforeEach(() => {
  qualityDir = mkdtempSync(join(tmpdir(), "quality-role-test-"));
  process.env.QUALITY_DATA_DIR = qualityDir;
});
afterEach(() => {
  delete process.env.QUALITY_DATA_DIR;
  rmSync(qualityDir, { recursive: true, force: true });
});

it("keeps history while returning only active quality roles", () => {
  setWorkbenchQualityRole({
    userId: "after-1",
    role: "AFTERSALES_MANAGER",
    enabled: true,
    updatedBy: "admin-1",
    now: "2026-07-13T01:00:00.000Z",
  });
  setWorkbenchQualityRole({
    userId: "after-1",
    role: "AFTERSALES_MANAGER",
    enabled: false,
    updatedBy: "admin-1",
    now: "2026-07-14T01:00:00.000Z",
  });
  expect(listActiveQualityRoles("after-1")).toEqual([]);
  const saved = JSON.parse(readFileSync(
    join(process.env.QUALITY_DATA_DIR!, "roles.json"),
    "utf8",
  ));
  expect(saved.events).toHaveLength(2);
});
```

Add to `workbench-capabilities.test.ts`:

```ts
it("unions admin and quality roles without granting approval by admin alone", () => {
  process.env.WORKBENCH_ADMIN_USER_IDS = "admin-1,admin-without-quality";
  setWorkbenchQualityRole({
    userId: "admin-1",
    role: "QUALITY_SPECIALIST",
    enabled: true,
    updatedBy: "admin-1",
    now: "2026-07-13T01:00:00.000Z",
  });
  expect(resolveWorkbenchCapabilities("admin-1")).toMatchObject({
    canAccessAdmin: true,
    qualityRoles: ["QUALITY_SPECIALIST"],
    canAccessQuality: true,
    canManageQualityConfig: true,
  });
  expect(resolveWorkbenchCapabilities("admin-without-quality")).toMatchObject({
    qualityRoles: [],
    canAccessQuality: true,
    canManageQualityConfig: true,
  });
  delete process.env.WORKBENCH_ADMIN_USER_IDS;
});
```

- [ ] **Step 2: Run the two test files and observe failure**

Run: `npx vitest run tests/security/workbench-quality-role-directory.test.ts tests/security/workbench-capabilities.test.ts`

Expected: FAIL because the directory module and capability fields do not exist.

- [ ] **Step 3: Implement an append-history JSON directory with atomic replacement**

Persist `data/quality/roles.json` in this exact shape:

```ts
interface QualityRoleDirectoryFile {
  version: 1;
  assignments: Array<{
    userId: string;
    role: QualityRole;
    active: boolean;
    effectiveFrom: string;
    effectiveTo: string | null;
    updatedBy: string;
    updatedAt: string;
  }>;
  events: Array<{
    id: string;
    userId: string;
    role: QualityRole;
    enabled: boolean;
    updatedBy: string;
    createdAt: string;
  }>;
  idempotency: Array<{
    actorId: string;
    route: "admin/quality-roles";
    key: string;
    requestHash: string;
    resultJson: string;
    createdAt: string;
    expiresAt: string;
  }>;
}
```

Use these mutation contracts:

```ts
export interface QualityRoleMutationInput {
  userId: string;
  role: QualityRole;
  enabled: boolean;
  updatedBy: string;
  now: string;
  idempotency?: {
    key: string;
    requestHash: string;
  };
}

export interface QualityRoleMutationResult {
  before: boolean;
  after: boolean;
  changed: boolean;
}
```

`setWorkbenchQualityRole` closes the current active assignment when removing or replacing it, appends a new assignment only when enabling an inactive role, and appends a permission event for a real change. When `idempotency` is present, it first looks up `(updatedBy, "admin/quality-roles", key)`: the same hash returns `resultJson` without another event; a different hash throws `QUALITY_IDEMPOTENCY_CONFLICT`. A new mutation appends assignment/history/idempotency together, writes `roles.json.tmp`, then calls `renameSync(tmp, target)`. Malformed JSON must fail closed to no active quality roles and emit the existing structured logger event `quality_role_directory_invalid`; it must not grant access.

- [ ] **Step 4: Extend the existing capability object without changing current role routing**

```ts
export interface WorkbenchCapabilities {
  primaryRole: WorkbenchRole;
  alsoManager: boolean;
  canAccessAdmin: boolean;
  canManage: boolean;
  canExecuteAsManager: boolean;
  qualityRoles: QualityRole[];
  canAccessQuality: boolean;
  canManageQualityConfig: boolean;
}

export function resolveWorkbenchCapabilities(userId: string): WorkbenchCapabilities {
  const primaryRole = resolveWorkbenchRole(userId);
  const alsoManager = primaryRole !== "manager" && isAlsoWorkbenchManager(userId);
  const canManage = primaryRole === "manager" || alsoManager;
  const qualityRoles = listActiveQualityRoles(userId);
  return {
    primaryRole,
    alsoManager,
    canAccessAdmin: primaryRole === "admin",
    canManage,
    canExecuteAsManager: canManage,
    qualityRoles,
    canAccessQuality: primaryRole === "admin" || qualityRoles.length > 0,
    canManageQualityConfig: primaryRole === "admin",
  };
}
```

No route may authorize a business action from `canAccessQuality`; it must check `qualityRoles` or active primary owner separately.

- [ ] **Step 5: Run security regression and commit**

Run: `npx vitest run tests/security/workbench-quality-role-directory.test.ts tests/security/workbench-capabilities.test.ts && npm run typecheck`

Expected: new quality cases and all existing capability cases PASS.

```bash
git add src/security/workbench-quality-role-directory.ts src/security/workbench-capabilities.ts tests/security/workbench-quality-role-directory.test.ts tests/security/workbench-capabilities.test.ts
git commit -m "feat(quality): add quality role capabilities"
```

---

### Task 7: Application Commands for the Complete P1 Manual Flow

**FR / AC:** FR-004、FR-020..024；AC-001 的事件创建部分（AI job 在 P3）、AC-002、AC-006 的非通知部分、AC-009、AC-016、AC-017。

**Files:**
- Create: `src/quality/application/execute-quality-command.ts`
- Create: `src/quality/application/quality-command-helpers.ts`
- Create: `src/quality/application/create-quality-event.ts`
- Create: `src/quality/application/complete-classification-intake.ts`
- Create: `src/quality/application/review-classification.ts`
- Create: `src/quality/application/dispatch-quality-event.ts`
- Create: `src/quality/application/respond-to-dispatch.ts`
- Create: `src/quality/application/submit-initial-analysis.ts`
- Create: `src/quality/application/decide-due-date.ts`
- Create: `tests/quality/support/quality-test-harness.ts`
- Create: `tests/quality/application/quality-workflow.test.ts`

**Interfaces:**
- Consumes: Task 2 transitions, Task 3 SLA, Task 5 repository, `QualityClock`, `QualityIdFactory`.
- Produces: one command function per file and `executeQualityCommand`.

- [ ] **Step 1: Add the shared command metadata and idempotent executor**

Append to `src/quality/application/ports.ts`:

```ts
import type { WorkCalendar } from "../domain/work-calendar";

export interface QualityCommandDeps {
  repository: QualityEventRepository;
  clock: QualityClock;
  ids: QualityIdFactory;
  calendar: WorkCalendar;
}

export interface QualityCommandMeta {
  actor: QualityActor;
  actorRole: QualityRole | "PRIMARY_OWNER" | "SYSTEM";
  requestId: string;
  route: string;
  idempotencyKey: string;
  requestHash: string;
  responseStatus: number;
}

export interface QualityCommandResponse<T> {
  status: number;
  data: T;
  requestId: string;
  replayed: boolean;
}
```

Update the existing type-only import in `ports.ts` to include `QualityActor` and `QualityRole` from `../domain/types`.

Create `quality-command-helpers.ts`:

```ts
import type {
  QualityActor,
  QualityAuditAction,
  QualityEvent,
  QualityEventStatus,
  QualityRole,
  QualityTransition,
} from "../domain/types";
import type { QualityCommandDeps } from "./ports";

export function makeAudit(input: {
  deps: QualityCommandDeps;
  event: QualityEvent;
  fromStatus: QualityEventStatus | null;
  action: QualityAuditAction;
  actor: QualityActor;
  actorRole: QualityRole | "PRIMARY_OWNER" | "SYSTEM";
  requestId: string;
  now: string;
  reason?: string | null;
  payload?: Record<string, unknown>;
}): QualityTransition {
  return {
    id: input.deps.ids.next("transition"),
    eventId: input.event.id,
    fromStatus: input.fromStatus,
    toStatus: input.event.status,
    action: input.action,
    actorId: input.actor.userId,
    actorRole: input.actorRole,
    reason: input.reason ?? null,
    payload: input.payload ?? {},
    requestId: input.requestId,
    createdAt: input.now,
  };
}
```

Create `execute-quality-command.ts`:

```ts
import { QualityError } from "../domain/types";
import type {
  QualityCommandMeta,
  QualityCommandResponse,
  QualityEventRepository,
  QualityEventTransaction,
} from "./ports";

export function executeQualityCommand<T>(input: {
  repository: QualityEventRepository;
  meta: QualityCommandMeta;
  now: string;
  work(tx: QualityEventTransaction): T;
}): QualityCommandResponse<T> {
  return input.repository.transaction((tx) => {
    const existing = tx.getIdempotency(
      input.meta.actor.userId,
      input.meta.route,
      input.meta.idempotencyKey,
    );
    if (existing) {
      if (existing.requestHash !== input.meta.requestHash) {
        throw new QualityError(
          "QUALITY_IDEMPOTENCY_CONFLICT",
          "idempotency key reused with a different request",
        );
      }
      return {
        status: existing.responseStatus,
        data: JSON.parse(existing.responseJson) as T,
        requestId: input.meta.requestId,
        replayed: true,
      };
    }
    const data = input.work(tx);
    tx.saveIdempotency({
      actorId: input.meta.actor.userId,
      route: input.meta.route,
      key: input.meta.idempotencyKey,
      requestHash: input.meta.requestHash,
      responseStatus: input.meta.responseStatus,
      responseJson: JSON.stringify(data),
      expiresAt: new Date(Date.parse(input.now) + 24 * 3600 * 1000).toISOString(),
      createdAt: input.now,
    });
    return {
      status: input.meta.responseStatus,
      data,
      requestId: input.meta.requestId,
      replayed: false,
    };
  });
}
```

- [ ] **Step 2: Write a failing workflow test with the authoritative role split**

```ts
import { describe, expect, it } from "vitest";
import { createQualityTestHarness } from "../support/quality-test-harness";

describe("P1 quality workflow", () => {
  it("requires aftersales creation, quality dispatch, owner analysis, and quality due approval", () => {
    const h = createQualityTestHarness();
    const created = h.create({
      actor: h.aftersales,
      title: "导管漏液",
      description: "客户现场发现漏液",
      ledgerRowKey: null,
    });
    expect(created.event.status).toBe("SUBMITTED");

    const pending = h.completeClassification(created.event.id, "AI_FAILED");
    expect(pending.event.status).toBe("PENDING_REVIEW");

    const reviewed = h.review({
      actor: h.quality,
      eventId: created.event.id,
      version: pending.event.version,
      decision: "MANUAL",
      categoryMajor: "硬件",
      riskLevel: "HIGH",
      evidenceTemplateIds: [],
      correctionReason: "P1 人工降级复判",
    });
    expect(reviewed.event.version).toBe(pending.event.version + 1);

    const dispatched = h.dispatch({
      actor: h.quality,
      eventId: created.event.id,
      version: reviewed.event.version,
      primaryDepartmentId: "rd",
      collaboratorDepartmentIds: ["qa-lab"],
    });
    expect(dispatched.event.status).toBe("DISPATCHED");
    expect(dispatched.event.acceptSlaDueAt).toBeTruthy();

    expect(() => h.accept({
      actor: h.collaboratorOwner,
      eventId: created.event.id,
      version: dispatched.event.version,
    })).toThrowError("QUALITY_FORBIDDEN");

    const accepted = h.accept({
      actor: h.primaryOwner,
      eventId: created.event.id,
      version: dispatched.event.version,
    });
    expect(accepted.event.status).toBe("ACCEPTED_PENDING_ANALYSIS");

    const analysis = h.submitAnalysis({
      actor: h.primaryOwner,
      eventId: created.event.id,
      version: accepted.event.version,
      analysis: "密封圈尺寸偏差",
      solutionPlan: "复测库存并更换密封圈",
      internalAssigneeUserId: "engineer-1",
      proposedDueAt: "2026-07-20T10:00:00.000Z",
    });
    expect(analysis.event.status).toBe("PENDING_DUE_CONFIRMATION");

    const approved = h.decideDue({
      actor: h.quality,
      eventId: created.event.id,
      version: analysis.event.version,
      decision: "APPROVE",
    });
    expect(approved.event.status).toBe("IN_PROGRESS");
    expect(approved.event.formalDueAt).toBe("2026-07-20T10:00:00.000Z");
    expect(h.timeline(created.event.id).map((item) => item.action)).toEqual([
      "EVENT_CREATED",
      "AI_FAILED",
      "CLASSIFICATION_REVIEWED",
      "DISPATCH",
      "ACCEPT",
      "SUBMIT_INITIAL_ANALYSIS",
      "APPROVE_DUE",
    ]);
  });

  it("does not let quality specialist or admin create an event", () => {
    const h = createQualityTestHarness();
    expect(() => h.create({
      actor: h.quality,
      title: "非法发起",
      description: "质量专员不能替代售后主管",
      ledgerRowKey: null,
    })).toThrowError("QUALITY_FORBIDDEN");
    expect(() => h.create({
      actor: h.admin,
      title: "非法发起",
      description: "admin 只有只读和配置权限",
      ledgerRowKey: null,
    })).toThrowError("QUALITY_FORBIDDEN");
  });

  it("returns the existing event for a duplicate active ledger row", () => {
    const h = createQualityTestHarness();
    const first = h.create({
      actor: h.aftersales,
      title: "第一次",
      description: "来源相同",
      ledgerRowKey: "ledger-row-1",
    });
    const duplicate = h.create({
      actor: h.aftersales,
      title: "第二次",
      description: "不应新建",
      ledgerRowKey: "ledger-row-1",
    });
    expect(duplicate.event.id).toBe(first.event.id);
    expect(duplicate.duplicate).toBe(true);
  });
});
```

`quality-test-harness.ts` opens an in-memory migrated database, uses a fixed clock starting at `2026-07-13T02:00:00.000Z`, deterministic incrementing IDs, a Monday-Friday calendar, seeds `rd -> owner-rd` and `qa-lab -> owner-lab`, and exposes thin wrappers around the real command functions. It creates these actors exactly:

```ts
const aftersales = {
  userId: "after-1",
  qualityRoles: ["AFTERSALES_MANAGER"],
  isAdmin: false,
} satisfies QualityActor;
const quality = {
  userId: "quality-1",
  qualityRoles: ["QUALITY_SPECIALIST"],
  isAdmin: false,
} satisfies QualityActor;
const primaryOwner = {
  userId: "owner-rd",
  qualityRoles: [],
  isAdmin: false,
} satisfies QualityActor;
const collaboratorOwner = {
  userId: "owner-lab",
  qualityRoles: [],
  isAdmin: false,
} satisfies QualityActor;
const admin = {
  userId: "admin-1",
  qualityRoles: [],
  isAdmin: true,
} satisfies QualityActor;
```

- [ ] **Step 3: Run the workflow test and confirm missing commands**

Run: `npx vitest run tests/quality/application/quality-workflow.test.ts`

Expected: FAIL on the first missing application command import.

- [ ] **Step 4: Implement create and internal classification completion**

`createQualityEvent`:

```ts
export interface CreateQualityEventInput {
  ledgerRowKey?: string | null;
  title: string;
  description: string;
  faultCode?: string | null;
  deviceModel?: string | null;
  deviceSn?: string | null;
  softwareVersion?: string | null;
  catheterBatch?: string | null;
  impact?: string | null;
  feedbackAt?: string | null;
  feedbackUserId?: string | null;
  feedbackName?: string | null;
}

function buildSubmittedEvent(input: {
  id: string;
  fields: CreateQualityEventInput;
  actorId: string;
  now: string;
}): QualityEvent {
  const suffix = input.id.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase();
  return {
    id: input.id,
    eventNo: `QE-${input.now.slice(0, 10).replaceAll("-", "")}-${suffix}`,
    ledgerRowKey: input.fields.ledgerRowKey?.trim() || null,
    status: "SUBMITTED",
    title: input.fields.title.trim(),
    description: input.fields.description.trim(),
    faultCode: input.fields.faultCode?.trim() || null,
    deviceModel: input.fields.deviceModel?.trim() || null,
    deviceSn: input.fields.deviceSn?.trim() || null,
    softwareVersion: input.fields.softwareVersion?.trim() || null,
    catheterBatch: input.fields.catheterBatch?.trim() || null,
    impact: input.fields.impact?.trim() || null,
    feedbackAt: input.fields.feedbackAt ?? null,
    feedbackUserId: input.fields.feedbackUserId?.trim() || null,
    feedbackName: input.fields.feedbackName?.trim() || null,
    submittedBy: input.actorId,
    submittedAt: input.now,
    categoryMajor: null,
    riskLevel: null,
    internalAssigneeUserId: null,
    acceptSlaDueAt: null,
    analysisSlaDueAt: null,
    formalDueAt: null,
    deferReviewAt: null,
    closedAt: null,
    notifiedAt: null,
    version: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function createQualityEvent(
  deps: QualityCommandDeps,
  input: CreateQualityEventInput,
  meta: QualityCommandMeta,
): QualityCommandResponse<{ event: QualityEvent; duplicate: boolean }> {
  if (!meta.actor.qualityRoles.includes("AFTERSALES_MANAGER")) {
    throw new QualityError("QUALITY_FORBIDDEN", "aftersales manager role required");
  }
  const now = deps.clock.now();
  return executeQualityCommand({
    repository: deps.repository,
    meta,
    now,
    work(tx) {
      const duplicate = input.ledgerRowKey
        ? tx.findActiveEventByLedgerRowKey(input.ledgerRowKey)
        : null;
      if (duplicate) {
        const next = { ...duplicate, version: duplicate.version + 1, updatedAt: now };
        tx.updateEvent(next, duplicate.version);
        tx.appendTransition(makeAudit({
          deps, event: next, fromStatus: duplicate.status,
          action: "DUPLICATE_SUBMISSION", actor: meta.actor,
          actorRole: "AFTERSALES_MANAGER", requestId: meta.requestId, now,
        }));
        return { event: next, duplicate: true };
      }
      const id = deps.ids.next("event");
      const event = buildSubmittedEvent({
        id,
        fields: input,
        actorId: meta.actor.userId,
        now,
      });
      tx.insertEvent(event);
      tx.appendTransition(makeAudit({
        deps, event, fromStatus: null, action: "EVENT_CREATED",
        actor: meta.actor, actorRole: "AFTERSALES_MANAGER",
        requestId: meta.requestId, now,
      }));
      return { event, duplicate: false };
    },
  });
}
```

`completeClassificationIntake` is not routed from public HTTP in P1:

```ts
export function completeClassificationIntake(
  deps: QualityCommandDeps,
  input: {
    eventId: string;
    outcome: "AI_FINISHED" | "AI_FAILED";
    requestId: string;
  },
): { event: QualityEvent } {
  const now = deps.clock.now();
  return deps.repository.transaction((tx) => {
    const event = tx.findEventById(input.eventId);
    if (!event) {
      throw new QualityError("QUALITY_EVENT_NOT_FOUND", "quality event not found");
    }
    const actor: QualityActor = {
      userId: "quality-system",
      qualityRoles: [],
      isAdmin: false,
    };
    const result = transitionQualityEvent({
      event,
      action: input.outcome,
      actor,
      actorRole: "SYSTEM",
      payload: { mode: "P1_MANUAL_FALLBACK" },
      now,
    });
    tx.updateEvent(result.event, event.version);
    tx.appendTransition({
      ...result.audit,
      id: deps.ids.next("transition"),
      requestId: input.requestId,
    });
    return { event: result.event };
  });
}
```

- [ ] **Step 5: Implement manual classification review**

`reviewClassification` enforces `QUALITY_SPECIALIST`, status `PENDING_REVIEW`, non-empty `categoryMajor`, and `CORRECT` or `MANUAL` requires `correctionReason`. In one transaction it inserts `quality_classification_reviews`, updates `categoryMajor/riskLevel/version`, and appends a same-status `CLASSIFICATION_REVIEWED` audit:

```ts
export interface ReviewClassificationInput {
  eventId: string;
  version: number;
  decision: "ACCEPT" | "CORRECT" | "MANUAL";
  categoryMajor: string;
  riskLevel: QualityRiskLevel;
  evidenceTemplateIds: string[];
  correctionReason?: string;
}

const next: QualityEvent = {
  ...event,
  categoryMajor: input.categoryMajor.trim(),
  riskLevel: input.riskLevel,
  version: event.version + 1,
  updatedAt: now,
};
tx.insertClassificationReview({
  id: deps.ids.next("review"),
  eventId: event.id,
  decision: input.decision,
  categoryMajor: next.categoryMajor,
  riskLevel: input.riskLevel,
  evidenceTemplateIds: [...new Set(input.evidenceTemplateIds)].sort(),
  correctionReason: input.correctionReason?.trim() || null,
  reviewedBy: meta.actor.userId,
  reviewedAt: now,
  eventVersion: next.version,
});
tx.updateEvent(next, input.version);
tx.appendTransition(makeAudit({
  deps, event: next, fromStatus: event.status,
  action: "CLASSIFICATION_REVIEWED", actor: meta.actor,
  actorRole: "QUALITY_SPECIALIST", requestId: meta.requestId, now,
}));
```

- [ ] **Step 6: Implement dispatch and owner response**

`dispatchQualityEvent`:

```ts
export interface DispatchQualityEventInput {
  eventId: string;
  version: number;
  primaryDepartmentId: string;
  collaboratorDepartmentIds: string[];
}

const primary = tx.findActiveDepartmentOwner(input.primaryDepartmentId);
if (!primary) {
  throw new QualityError("QUALITY_OWNER_NOT_CONFIGURED", "primary owner is not configured");
}
const collaboratorIds = [...new Set(input.collaboratorDepartmentIds)];
if (collaboratorIds.includes(input.primaryDepartmentId)) {
  throw new QualityError(
    "QUALITY_VALIDATION_FAILED",
    "primary department cannot also be collaborator",
  );
}
const collaborators = collaboratorIds.map((id) => {
  const owner = tx.findActiveDepartmentOwner(id);
  if (!owner) {
    throw new QualityError("QUALITY_OWNER_NOT_CONFIGURED", `owner missing for ${id}`);
  }
  return owner;
});
if (!event.categoryMajor || !event.riskLevel) {
  throw new QualityError("QUALITY_VALIDATION_FAILED", "classification review required");
}
const action = event.status === "REJECTED_BACK" ? "REDISPATCH" : "DISPATCH";
const transitioned = transitionQualityEvent({
  event: {
    ...event,
    acceptSlaDueAt: computeAcceptSlaDueAt(now, deps.calendar),
  },
  action,
  actor: meta.actor,
  actorRole: "QUALITY_SPECIALIST",
  payload: {
    primaryDepartmentId: primary.departmentId,
    collaboratorDepartmentIds: collaborators.map((item) => item.departmentId),
  },
  now,
});
tx.replaceActiveDepartments({
  eventId: event.id,
  assignmentVersion: event.version + 1,
  assignments: [
    { ...primary, role: "PRIMARY" },
    ...collaborators.map((item) => ({ ...item, role: "COLLABORATOR" as const })),
  ],
  actorId: meta.actor.userId,
  now,
  ids: [primary, ...collaborators].map(() => deps.ids.next("department")),
});
```

`respondToDispatch` uses this input, loads the active primary owner and rejects any different user. `ACCEPT` computes and freezes `analysisSlaDueAt` from the confirmed risk; `REJECT` requires a non-empty reason. Both use `transitionQualityEvent`, `updateEvent`, and `appendTransition` in the same idempotent transaction.

```ts
export interface RespondToDispatchInput {
  eventId: string;
  version: number;
  decision: "ACCEPT" | "REJECT";
  reason?: string;
}
```

- [ ] **Step 7: Implement initial analysis and due decision**

`submitInitialAnalysis` requires active primary owner, four non-empty fields, and `proposedDueAt > now`. It inserts one active analysis and one `INITIAL/PENDING` due request, sets `internalAssigneeUserId`, then transitions with `SUBMIT_INITIAL_ANALYSIS`.

```ts
export interface SubmitInitialAnalysisInput {
  eventId: string;
  version: number;
  analysis: string;
  solutionPlan: string;
  internalAssigneeUserId: string;
  internalAssigneeName?: string;
  proposedDueAt: string;
}
```

The transition payload is exactly:

```ts
{
  analysis: input.analysis.trim(),
  solutionPlan: input.solutionPlan.trim(),
  internalAssigneeUserId: input.internalAssigneeUserId.trim(),
  proposedDueAt: input.proposedDueAt,
}
```

`decideDueDate` requires `QUALITY_SPECIALIST` and status `PENDING_DUE_CONFIRMATION`. It reads the pending initial due request through a new `findPendingInitialDueRequest(eventId)` repository method. For `APPROVE`, call `APPROVE_DUE` with its `proposedDueAt` and mark the request `APPROVED`; for `RETURN`, require reason, call `RETURN_DUE`, and mark it `REJECTED`. Do not accept a client-provided formal due date.

Exact decision input:

```ts
export interface DecideDueDateInput {
  eventId: string;
  version: number;
  decision: "APPROVE" | "RETURN";
  reason?: string;
}
```

- [ ] **Step 8: Add reject, due-return, stale-version, and idempotent-replay cases**

The workflow test must additionally assert:

```ts
const rejected = h.reject({
  actor: h.primaryOwner,
  eventId,
  version,
  reason: "应由生产部主责",
});
expect(rejected.event.status).toBe("REJECTED_BACK");

const returned = h.decideDue({
  actor: h.quality,
  eventId,
  version,
  decision: "RETURN",
  reason: "计划缺少验证周期",
});
expect(returned.event.status).toBe("ACCEPTED_PENDING_ANALYSIS");

expect(() => h.accept({ actor: h.primaryOwner, eventId, version: staleVersion }))
  .toThrowError("QUALITY_VERSION_CONFLICT");

const first = h.accept({ actor: h.primaryOwner, eventId, version, key: "accept-1" });
const replay = h.accept({ actor: h.primaryOwner, eventId, version, key: "accept-1" });
expect(replay.event.version).toBe(first.event.version);
expect(h.timeline(eventId).filter((item) => item.action === "ACCEPT")).toHaveLength(1);
```

- [ ] **Step 9: Run application tests and commit**

Run: `npx vitest run tests/quality/application/quality-workflow.test.ts && npm run typecheck`

Expected: happy path, reject/redispatch, due return, role denial, stale version and replay cases PASS.

```bash
git add src/quality/application tests/quality/application tests/quality/support
git commit -m "feat(quality): add P1 workflow commands"
```

---

### Task 8: Zod API Contracts, Error Mapping, Router, and Workbench Integration

**FR / AC:** P1-06；FR-004、FR-020..024；AC-016、AC-017、AC-018。

**Files:**
- Create: `src/quality/quality-module.ts`
- Create: `src/web/quality/quality-api-contracts.ts`
- Create: `src/web/quality/quality-api-errors.ts`
- Create: `src/web/quality/quality-router.ts`
- Create: `tests/quality/support/workbench-http-test-client.ts`
- Create: `tests/quality/web/quality-api.test.ts`
- Modify: `src/web/assignment-workbench.ts`
- Modify: `src/web/assignment-workbench-session-types.ts` only if an exported session type is needed by the router; do not duplicate it.

**Interfaces:**
- Consumes: existing `WorkbenchSession`, `resolveWorkbenchCapabilities`, Task 7 commands.
- Produces: `getQualityModule()`, `__resetQualityModuleForTest()`, `handleQualityHttp(req, res, deps): boolean`.

- [ ] **Step 1: Write the exact Zod request schemas**

```ts
import { z } from "zod";

const version = z.number().int().positive();
const id = z.string().trim().min(1).max(200);

export const createQualityEventSchema = z.object({
  ledgerRowKey: z.string().trim().min(1).max(500).nullable().optional(),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(5000),
  faultCode: z.string().trim().max(100).nullable().optional(),
  deviceModel: z.string().trim().max(200).nullable().optional(),
  deviceSn: z.string().trim().max(200).nullable().optional(),
  softwareVersion: z.string().trim().max(100).nullable().optional(),
  catheterBatch: z.string().trim().max(200).nullable().optional(),
  impact: z.string().trim().max(2000).nullable().optional(),
  feedbackAt: z.string().datetime().nullable().optional(),
  feedbackUserId: z.string().trim().max(200).nullable().optional(),
  feedbackName: z.string().trim().max(200).nullable().optional(),
}).strict();

export const reviewClassificationSchema = z.object({
  version,
  decision: z.enum(["ACCEPT", "CORRECT", "MANUAL"]),
  categoryMajor: z.string().trim().min(1).max(100),
  riskLevel: z.enum(["HIGH", "MEDIUM", "LOW"]),
  evidenceTemplateIds: z.array(id).max(100),
  correctionReason: z.string().trim().min(1).max(2000).optional(),
}).strict();

export const dispatchQualityEventSchema = z.object({
  version,
  primaryDepartmentId: id,
  collaboratorDepartmentIds: z.array(id).max(50),
}).strict();

export const respondToDispatchSchema = z.object({
  version,
  reason: z.string().trim().min(1).max(2000).optional(),
}).strict();

export const submitInitialAnalysisSchema = z.object({
  version,
  analysis: z.string().trim().min(1).max(10000),
  solutionPlan: z.string().trim().min(1).max(10000),
  internalAssigneeUserId: id,
  proposedDueAt: z.string().datetime(),
}).strict();

export const decideDueDateSchema = z.object({
  version,
  decision: z.enum(["APPROVE", "RETURN"]),
  reason: z.string().trim().min(1).max(2000).optional(),
}).strict();

export const changeQualityRoleSchema = z.object({
  userId: id,
  role: z.enum(["AFTERSALES_MANAGER", "QUALITY_SPECIALIST"]),
  enabled: z.boolean(),
}).strict();

export const upsertDepartmentOwnerSchema = z.object({
  departmentId: id,
  departmentName: z.string().trim().min(1).max(200),
  leaderUserId: id,
}).strict();
```

Add schema refinements: `CORRECT/MANUAL` require `correctionReason`; `RETURN` and reject route require `reason`.

- [ ] **Step 2: Write failing HTTP tests**

Create `tests/quality/support/workbench-http-test-client.ts`:

```ts
import type { IncomingMessage, ServerResponse } from "node:http";

export interface HttpResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json: any;
}

export async function invokeWorkbench(
  handler: (req: IncomingMessage, res: ServerResponse) => boolean,
  input: {
    method: string;
    url: string;
    cookie?: string;
    headers?: Record<string, string>;
    json?: Record<string, unknown>;
  },
): Promise<HttpResult> {
  const rawBody = input.json === undefined ? "" : JSON.stringify(input.json);
  const headers: Record<string, string> = {
    host: "localhost",
    ...(input.json === undefined ? {} : { "content-type": "application/json" }),
    ...(input.cookie ? { cookie: input.cookie } : {}),
    ...(input.headers ?? {}),
  };
  const req = {
    url: input.url,
    method: input.method,
    headers,
    async *[Symbol.asyncIterator]() {
      if (rawBody) yield Buffer.from(rawBody);
    },
  } as IncomingMessage;
  const captured: Omit<HttpResult, "json"> = {
    status: 200,
    headers: {},
    body: "",
  };
  let finish!: () => void;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const res = {
    writeHead(status: number, responseHeaders?: Record<string, string | string[]>): void {
      captured.status = status;
      captured.headers = { ...captured.headers, ...(responseHeaders ?? {}) };
    },
    setHeader(name: string, value: string | string[]): void {
      captured.headers[name] = value;
    },
    getHeader(name: string): string | string[] | undefined {
      return captured.headers[name];
    },
    end(chunk?: string | Buffer): void {
      captured.body = chunk === undefined ? "" : String(chunk);
      finish();
    },
  } as ServerResponse;
  if (!handler(req, res)) throw new Error(`route not handled: ${input.url}`);
  await done;
  return {
    ...captured,
    json: captured.body ? JSON.parse(captured.body) : null,
  };
}

export async function login(
  handler: (req: IncomingMessage, res: ServerResponse) => boolean,
  userId: string,
): Promise<string> {
  const response = await invokeWorkbench(handler, {
    method: "POST",
    url: "/api/workbench/login",
    json: { userId, role: "auto" },
  });
  const value = response.headers["Set-Cookie"] ?? response.headers["set-cookie"];
  const cookie = Array.isArray(value) ? value[0] : value;
  if (!cookie) throw new Error(`login did not set cookie for ${userId}`);
  return cookie.split(";", 1)[0];
}
```

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAssignmentHttp, __resetWorkbenchStoresForTest } from "../../../src/web/assignment-workbench";
import {
  __resetQualityModuleForTest,
  getQualityModule,
} from "../../../src/quality/quality-module";
import { setWorkbenchQualityRole } from "../../../src/security/workbench-quality-role-directory";
import { invokeWorkbench, login } from "../support/workbench-http-test-client";

describe("quality P1 API", () => {
  let root = "";
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "quality-api-test-"));
    vi.stubEnv("QUALITY_MODULE_ENABLED", "1");
    vi.stubEnv("WORKBENCH_SQLITE_PATH", join(root, "workbench.sqlite"));
    vi.stubEnv("QUALITY_DATA_DIR", join(root, "quality"));
    vi.stubEnv(
      "QUALITY_WORK_CALENDAR_FILE",
      join(process.cwd(), "config", "quality-work-calendar.example.json"),
    );
    vi.stubEnv("WORKBENCH_TEST_LOGIN_ENABLED", "1");
    vi.stubEnv("WORKBENCH_SESSION_SECRET", "quality-test-session-secret-at-least-32");
    vi.stubEnv("WORKBENCH_ADMIN_USER_IDS", "admin-1");
    const now = "2026-07-13T01:00:00.000Z";
    setWorkbenchQualityRole({
      userId: "after-1", role: "AFTERSALES_MANAGER", enabled: true,
      updatedBy: "admin-1", now,
    });
    setWorkbenchQualityRole({
      userId: "quality-1", role: "QUALITY_SPECIALIST", enabled: true,
      updatedBy: "admin-1", now,
    });
    const repository = getQualityModule().repository;
    repository.upsertDepartmentOwner({
      departmentId: "rd", departmentName: "研发部", leaderUserId: "owner-rd",
      actorId: "admin-1", now,
    });
    repository.upsertDepartmentOwner({
      departmentId: "qa-lab", departmentName: "质量实验室", leaderUserId: "owner-lab",
      actorId: "admin-1", now,
    });
  });

  afterEach(() => {
    __resetQualityModuleForTest();
    __resetWorkbenchStoresForTest();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it("hides the module when disabled", async () => {
    process.env.QUALITY_MODULE_ENABLED = "0";
    const cookie = await login(handleAssignmentHttp, "after-1");
    const response = await invokeWorkbench(handleAssignmentHttp, {
      method: "GET",
      url: "/api/workbench/quality/v1/events/missing",
      cookie,
    });
    expect(response.status).toBe(404);
    expect(response.json.error.code).toBe("QUALITY_MODULE_DISABLED");
  });

  it("requires Idempotency-Key for every write", async () => {
    const cookie = await login(handleAssignmentHttp, "after-1");
    const response = await invokeWorkbench(handleAssignmentHttp, {
      method: "POST",
      url: "/api/workbench/quality/v1/events",
      cookie,
      json: { title: "漏液", description: "现场反馈漏液" },
    });
    expect(response.status).toBe(400);
    expect(response.json.error.code).toBe("QUALITY_BAD_REQUEST");
  });

  it("creates only as aftersales and replays the same key once", async () => {
    const cookie = await login(handleAssignmentHttp, "after-1");
    const input = {
      method: "POST",
      url: "/api/workbench/quality/v1/events",
      cookie,
      headers: { "idempotency-key": "create-1" },
      json: { title: "漏液", description: "现场反馈漏液" },
    } as const;
    const first = await invokeWorkbench(handleAssignmentHttp, input);
    const replay = await invokeWorkbench(handleAssignmentHttp, input);
    expect(first.status).toBe(201);
    expect(first.json.data.event.status).toBe("SUBMITTED");
    expect(replay.json.data.event.id).toBe(first.json.data.event.id);
    expect(replay.json.data.event.version).toBe(first.json.data.event.version);

    const qualityCookie = await login(handleAssignmentHttp, "quality-1");
    const forbidden = await invokeWorkbench(handleAssignmentHttp, {
      ...input,
      cookie: qualityCookie,
      headers: { "idempotency-key": "create-quality-1" },
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.json.error.code).toBe("QUALITY_FORBIDDEN");
  });

});
```

The helper uses the existing `/api/workbench/login` route to obtain a real session cookie and never bypasses `requireSession`.

- [ ] **Step 3: Run the API test and confirm route failure**

Run: `npx vitest run tests/quality/web/quality-api.test.ts`

Expected: FAIL because quality URLs are not handled or the quality module import is missing.

- [ ] **Step 4: Add one lazy composition root**

`quality-module.ts` must:

```ts
export interface QualityModule {
  repository: QualityEventRepository;
  create(input: CreateQualityEventInput, meta: QualityCommandMeta): QualityCommandResponse<{
    event: QualityEvent;
    duplicate: boolean;
  }>;
  completeClassification(
    eventId: string,
    outcome: "AI_FINISHED" | "AI_FAILED",
    requestId: string,
  ): { event: QualityEvent };
  review(input: ReviewClassificationInput, meta: QualityCommandMeta): QualityCommandResponse<{
    event: QualityEvent;
  }>;
  dispatch(input: DispatchQualityEventInput, meta: QualityCommandMeta): QualityCommandResponse<{
    event: QualityEvent;
  }>;
  respond(
    input: RespondToDispatchInput,
    meta: QualityCommandMeta,
  ): QualityCommandResponse<{ event: QualityEvent }>;
  submitAnalysis(
    input: SubmitInitialAnalysisInput,
    meta: QualityCommandMeta,
  ): QualityCommandResponse<{ event: QualityEvent }>;
  decideDue(
    input: DecideDueDateInput,
    meta: QualityCommandMeta,
  ): QualityCommandResponse<{ event: QualityEvent }>;
  close(): void;
}
```

`getQualityModule()` resolves config, throws `QUALITY_MODULE_DISABLED` before opening SQLite, reads and validates the calendar JSON, opens one SQLite connection, creates the repository, and wires a UTC clock plus `randomUUID()` ID factory. `__resetQualityModuleForTest()` closes and clears the singleton. It must not start workers or timers.

- [ ] **Step 5: Implement exact error-to-HTTP mapping**

```ts
const STATUS_BY_CODE: Record<string, number> = {
  QUALITY_BAD_REQUEST: 400,
  QUALITY_FORBIDDEN: 403,
  QUALITY_MODULE_DISABLED: 404,
  QUALITY_EVENT_NOT_FOUND: 404,
  QUALITY_VERSION_CONFLICT: 409,
  QUALITY_DUPLICATE_ACTIVE_EVENT: 409,
  QUALITY_INVALID_TRANSITION: 409,
  QUALITY_IDEMPOTENCY_CONFLICT: 409,
  QUALITY_VALIDATION_FAILED: 422,
  QUALITY_OWNER_NOT_CONFIGURED: 422,
  QUALITY_CONFIG_INVALID: 422,
  QUALITY_INTERNAL_ERROR: 500,
};

export function qualityErrorResponse(error: unknown, requestId: string): {
  status: number;
  body: Record<string, unknown>;
} {
  const qualityError = error instanceof QualityError
    ? error
    : new QualityError("QUALITY_INTERNAL_ERROR", "质量模块内部错误");
  return {
    status: STATUS_BY_CODE[qualityError.code] ?? 500,
    body: {
      ok: false,
      error: {
        code: qualityError.code,
        message: qualityError.message,
        fieldErrors: qualityError.details.fieldErrors ?? {},
      },
      requestId,
    },
  };
}
```

Zod failures become `QUALITY_VALIDATION_FAILED` with flattened field errors; malformed JSON, missing JSON content type, missing idempotency key and invalid path IDs become `QUALITY_BAD_REQUEST`.

- [ ] **Step 6: Implement the router table and authorization order**

`handleQualityHttp` handles only `/api/workbench/quality/v1` and returns `false` otherwise. For a matching path it returns `true` immediately and runs an async body reader. It performs checks in this order:

1. `deps.requireSession(req, res)`.
2. `resolveQualityConfig().enabled`.
3. global quality role/admin visibility or event-scope owner visibility.
4. command-level role/owner check.
5. state, version, then field invariants.

Route table:

| Method | Path | Command |
|---|---|---|
| `GET` | `/events/:id` | event + timeline + `allowedActions` |
| `POST` | `/events` | `create`, 201 |
| `POST` | `/events/:id/classification-review` | `review`, 200 |
| `POST` | `/events/:id/dispatch` | `dispatch`, 200 |
| `POST` | `/events/:id/accept` | `respond` with `ACCEPT`, 200 |
| `POST` | `/events/:id/reject` | `respond` with `REJECT`, 200 |
| `POST` | `/events/:id/initial-analysis` | `submitAnalysis`, 200 |
| `POST` | `/events/:id/due-decision` | `decideDue`, 200 |
| `POST` | `/admin/quality-roles` | admin-only role mutation |
| `POST` | `/admin/departments` | admin-only active owner upsert |

Immediately after the create command, local stub handling is exactly:

```ts
if (
  process.env.NODE_ENV !== "production"
  && process.env.QUALITY_P1_STUB_CLASSIFIER === "1"
) {
  const current = result.replayed
    ? module.repository.findEventById(result.data.event.id)
    : result.data.event.status === "SUBMITTED"
      ? module.completeClassification(
          result.data.event.id,
          "AI_FAILED",
          `${requestId}:p1-stub`,
        ).event
      : result.data.event;
  if (!current) {
    throw new QualityError("QUALITY_EVENT_NOT_FOUND", "quality event not found");
  }
  result = { ...result, data: { ...result.data, event: current } };
}
```

No other route reads `QUALITY_P1_STUB_CLASSIFIER`, and production mode always ignores it.

Build write metadata exactly once:

```ts
function commandMeta(input: {
  actor: QualityActor;
  actorRole: QualityCommandMeta["actorRole"];
  requestId: string;
  route: string;
  idempotencyKey: string;
  rawBody: string;
  responseStatus: number;
}): QualityCommandMeta {
  return {
    actor: input.actor,
    actorRole: input.actorRole,
    requestId: input.requestId,
    route: input.route,
    idempotencyKey: input.idempotencyKey,
    requestHash: createHash("sha256")
      .update(`${input.route}\n${input.rawBody}`)
      .digest("hex"),
    responseStatus: input.responseStatus,
  };
}
```

Event-command success envelope:

```ts
writeJson(res, result.status, {
  ok: true,
  data: {
    ...result.data,
    allowedActions: allowedQualityActions({
      status: result.data.event.status,
      actor,
      activePrimaryOwnerUserId,
    }),
  },
  requestId: result.requestId,
});
```

Admin mutation responses use `{ ok: true, data: result.data, requestId }` and do not read `event` or add `allowedActions`.

For admin role mutation, pass idempotency key and request hash into `setWorkbenchQualityRole`; Task 6's role file records the key, hash and serialized result in the same atomic replacement as the role/history change. Reusing the key with different input throws `QUALITY_IDEMPOTENCY_CONFLICT`. For department owner mutation, add `upsertDepartmentOwner` to `QualityEventTransaction` and execute it through `executeQualityCommand`.

- [ ] **Step 7: Delegate from the existing workbench without exporting cookie internals**

At the start of `handleAssignmentHttp`, after constructing `url` and before unrelated routes:

```ts
if (url.pathname.startsWith("/api/workbench/quality/v1")) {
  return handleQualityHttp(req, res, {
    requireSession: () => requireSession(req, res),
    resolveCapabilities: resolveWorkbenchCapabilities,
    moduleProvider: getQualityModule,
  });
}
```

The quality router receives the normalized `WorkbenchSession`; it must not parse or mint session cookies itself. Add `__resetQualityModuleForTest()` to `__resetWorkbenchStoresForTest()` so tests never share SQLite connections.

- [ ] **Step 8: Run API and host regression tests**

Run: `npx vitest run tests/quality/web/quality-api.test.ts tests/security/workbench-capabilities.test.ts`

Expected: quality API tests PASS and existing login/session tests remain PASS.

- [ ] **Step 9: Commit**

```bash
git add src/quality/quality-module.ts src/web/quality src/web/assignment-workbench.ts src/web/assignment-workbench-session-types.ts tests/quality/web
git commit -m "feat(quality): expose P1 workbench API"
```

---

### Task 9: Local Five-Identity Harness, P1 E2E, Documentation, and Full Regression

**FR / AC:** P1-07；P1 演示；AC-001 的 P1 stub 路径、AC-006 的非通知部分、AC-009、AC-016、AC-018。

**Files:**
- Create: `scripts/local-quality-dev.ts`
- Create: `tests/quality/e2e/quality-p1-happy-path.test.ts`
- Create: `docs/quality-event-tracking-p1.md`
- Modify: `package.json`
- Modify: `vitest.setup.ts`

**Interfaces:**
- Consumes: `handleAssignmentHttp`, `getQualityModule`, quality role directory.
- Produces: `npm run dev:quality`, `npm run dev:quality:keep`, `npm run test:quality`.

- [ ] **Step 1: Add a failing API-level P1 happy-path test**

The E2E test uses real session cookies and HTTP stubs from Task 8, not direct command calls:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getQualityModule, __resetQualityModuleForTest } from "../../../src/quality/quality-module";
import { setWorkbenchQualityRole } from "../../../src/security/workbench-quality-role-directory";
import {
  __resetWorkbenchStoresForTest,
  handleAssignmentHttp,
} from "../../../src/web/assignment-workbench";
import { invokeWorkbench, login } from "../support/workbench-http-test-client";

let root = "";
const cookies = new Map<string, string>();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "quality-e2e-test-"));
  vi.stubEnv("QUALITY_MODULE_ENABLED", "1");
  vi.stubEnv("WORKBENCH_SQLITE_PATH", join(root, "workbench.sqlite"));
  vi.stubEnv("QUALITY_DATA_DIR", join(root, "quality"));
  vi.stubEnv(
    "QUALITY_WORK_CALENDAR_FILE",
    join(process.cwd(), "config", "quality-work-calendar.example.json"),
  );
  vi.stubEnv("WORKBENCH_TEST_LOGIN_ENABLED", "1");
  vi.stubEnv("WORKBENCH_SESSION_SECRET", "quality-e2e-session-secret-at-least-32");
  vi.stubEnv("WORKBENCH_ADMIN_USER_IDS", "admin-1");
  const now = "2026-07-13T01:00:00.000Z";
  setWorkbenchQualityRole({
    userId: "after-1", role: "AFTERSALES_MANAGER", enabled: true,
    updatedBy: "admin-1", now,
  });
  setWorkbenchQualityRole({
    userId: "quality-1", role: "QUALITY_SPECIALIST", enabled: true,
    updatedBy: "admin-1", now,
  });
  const repository = getQualityModule().repository;
  repository.upsertDepartmentOwner({
    departmentId: "rd", departmentName: "研发部", leaderUserId: "owner-rd",
    actorId: "admin-1", now,
  });
  repository.upsertDepartmentOwner({
    departmentId: "qa-lab", departmentName: "质量实验室", leaderUserId: "owner-lab",
    actorId: "admin-1", now,
  });
});

afterEach(() => {
  cookies.clear();
  __resetQualityModuleForTest();
  __resetWorkbenchStoresForTest();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

async function postAs(
  userId: string,
  url: string,
  json: Record<string, unknown>,
  key: string,
) {
  let cookie = cookies.get(userId);
  if (!cookie) {
    cookie = await login(handleAssignmentHttp, userId);
    cookies.set(userId, cookie);
  }
  return invokeWorkbench(handleAssignmentHttp, {
    method: "POST",
    url,
    cookie,
    headers: { "idempotency-key": key },
    json,
  });
}

function completeClassificationAsSystem(
  eventId: string,
  outcome: "AI_FINISHED" | "AI_FAILED",
) {
  return getQualityModule().completeClassification(
    eventId,
    outcome,
    `e2e-system-${eventId}`,
  );
}

it("runs create through due approval across the four business identities", async () => {
  const created = await postAs(
    "after-1",
    "/api/workbench/quality/v1/events",
    { title: "导管漏液", description: "客户现场发现漏液" },
    "e2e-create",
  );
  expect(created.status).toBe(201);
  const eventId = created.json.data.event.id;

  const pending = completeClassificationAsSystem(eventId, "AI_FAILED");
  const reviewed = await postAs(
    "quality-1",
    `/api/workbench/quality/v1/events/${eventId}/classification-review`,
    {
      version: pending.event.version,
      decision: "MANUAL",
      categoryMajor: "硬件",
      riskLevel: "HIGH",
      evidenceTemplateIds: [],
      correctionReason: "P1 人工复判",
    },
    "e2e-review",
  );
  const dispatched = await postAs(
    "quality-1",
    `/api/workbench/quality/v1/events/${eventId}/dispatch`,
    {
      version: reviewed.json.data.event.version,
      primaryDepartmentId: "rd",
      collaboratorDepartmentIds: ["qa-lab"],
    },
    "e2e-dispatch",
  );
  const accepted = await postAs(
    "owner-rd",
    `/api/workbench/quality/v1/events/${eventId}/accept`,
    { version: dispatched.json.data.event.version },
    "e2e-accept",
  );
  const analysis = await postAs(
    "owner-rd",
    `/api/workbench/quality/v1/events/${eventId}/initial-analysis`,
    {
      version: accepted.json.data.event.version,
      analysis: "密封圈尺寸偏差",
      solutionPlan: "复测库存并更换密封圈",
      internalAssigneeUserId: "engineer-1",
      proposedDueAt: "2026-07-20T10:00:00.000Z",
    },
    "e2e-analysis",
  );
  const approved = await postAs(
    "quality-1",
    `/api/workbench/quality/v1/events/${eventId}/due-decision`,
    { version: analysis.json.data.event.version, decision: "APPROVE" },
    "e2e-due",
  );
  expect(approved.json.data.event.status).toBe("IN_PROGRESS");
  expect(approved.json.data.event.formalDueAt).toBe("2026-07-20T10:00:00.000Z");
});
```

- [ ] **Step 2: Run the E2E test before adding the local harness**

Run: `npx vitest run tests/quality/e2e/quality-p1-happy-path.test.ts`

Expected: PASS for the real API sequence.

- [ ] **Step 3: Implement the local dev environment and seed data**

`scripts/local-quality-dev.ts` follows `scripts/local-task-intake-dev.ts` and defines exactly:

```ts
const AFTERSALES_ID = "quality-aftersales-dev";
const QUALITY_ID = "quality-specialist-dev";
const PRIMARY_OWNER_ID = "quality-owner-rd-dev";
const COLLABORATOR_OWNER_ID = "quality-owner-lab-dev";
const ADMIN_ID = "quality-admin-dev";
const DATA_ROOT = join(process.cwd(), "data", "local-quality-dev");
```

Before importing or opening the quality singleton, set:

```ts
process.env.QUALITY_MODULE_ENABLED = "1";
process.env.QUALITY_P1_STUB_CLASSIFIER = "1";
process.env.QUALITY_DATA_DIR = DATA_ROOT;
process.env.QUALITY_WORK_CALENDAR_FILE =
  join(process.cwd(), "config", "quality-work-calendar.example.json");
process.env.WORKBENCH_SQLITE_PATH = join(DATA_ROOT, "workbench.sqlite");
process.env.WORKBENCH_TEST_LOGIN_ENABLED = "1";
process.env.WORKBENCH_SESSION_SECRET = "local-quality-session-secret-min-32-chars";
process.env.ASSIGNMENT_WEB_SECRET = "local-quality-assignment-secret-min-32-chars";
process.env.WORKBENCH_ADMIN_USER_IDS = ADMIN_ID;
process.env.WORKBENCH_DINGTALK_NOTIFY_ENABLED = "0";
process.env.FOLLOWUP_REMINDER_ENABLED = "0";
process.env.PROGRESS_DIGEST_ENABLED = "0";
```

Unless `--keep-data` is present, remove only `DATA_ROOT`; never remove any other project data. Seed roles with `setWorkbenchQualityRole`:

```ts
setWorkbenchQualityRole({
  userId: AFTERSALES_ID,
  role: "AFTERSALES_MANAGER",
  enabled: true,
  updatedBy: ADMIN_ID,
  now,
});
setWorkbenchQualityRole({
  userId: QUALITY_ID,
  role: "QUALITY_SPECIALIST",
  enabled: true,
  updatedBy: ADMIN_ID,
  now,
});
```

Seed active owners:

```ts
module.repository.upsertDepartmentOwner({
  departmentId: "rd",
  departmentName: "研发部",
  leaderUserId: PRIMARY_OWNER_ID,
  actorId: ADMIN_ID,
  now,
});
module.repository.upsertDepartmentOwner({
  departmentId: "qa-lab",
  departmentName: "质量实验室",
  leaderUserId: COLLABORATOR_OWNER_ID,
  actorId: ADMIN_ID,
  now,
});
```

`QUALITY_P1_STUB_CLASSIFIER=1` is honored only when `process.env.NODE_ENV !== "production"`. After a non-replayed local create, the router calls the internal `completeClassification` with `AI_FAILED` and returns the refreshed `PENDING_REVIEW` event. No HTTP route exposes that system action.

- [ ] **Step 4: Start the same workbench HTTP server and print actionable URLs**

The script serves `/health` and delegates every other request to `handleAssignmentHttp`. The banner prints:

```text
=== 质量事件追踪 P1 · 本地测试 ===
登录页: http://127.0.0.1:8787/workbench
售后主管: quality-aftersales-dev
质量专员: quality-specialist-dev
主责负责人: quality-owner-rd-dev
协作负责人: quality-owner-lab-dev
管理员: quality-admin-dev
API 前缀: http://127.0.0.1:8787/api/workbench/quality/v1
```

Also print that P1 has API flow only; pages, AI, notifications and task linking begin in later phases.

- [ ] **Step 5: Add exact npm scripts and safe test defaults**

Add to `package.json`:

```json
{
  "scripts": {
    "dev:quality": "tsx scripts/local-quality-dev.ts",
    "dev:quality:keep": "tsx scripts/local-quality-dev.ts --keep-data",
    "test:quality": "vitest run tests/quality"
  }
}
```

Append to `vitest.setup.ts`:

```ts
process.env.QUALITY_MODULE_ENABLED = "0";
delete process.env.QUALITY_P1_STUB_CLASSIFIER;
```

Tests that enable quality must reset the quality singleton before and after changing env.

- [ ] **Step 6: Write the operator walkthrough**

`docs/quality-event-tracking-p1.md` includes:

1. Scope and explicit non-scope.
2. Role table stating “售后主管 is the only event creator”.
3. Start command `npm run dev:quality`.
4. Login command for each identity using a separate cookie file.
5. Curl requests for create, classification review, dispatch, accept/reject, initial analysis, due approve/return, and event detail.
6. Every write example includes `Content-Type: application/json`, a unique `Idempotency-Key`, and the current `version`.
7. Expected status sequence: `PENDING_REVIEW` in local stub mode, `DISPATCHED`, `ACCEPTED_PENDING_ANALYSIS`, `PENDING_DUE_CONFIRMATION`, `IN_PROGRESS`.
8. Reset behavior: omit `--keep-data` to replace only `data/local-quality-dev`; use `npm run dev:quality:keep` to preserve the local demo database.

The first login example is exact:

```bash
curl -sS -c /tmp/quality-aftersales.cookie \
  -H 'Content-Type: application/json' \
  -d '{"userId":"quality-aftersales-dev","role":"auto"}' \
  http://127.0.0.1:8787/api/workbench/login
```

The create example is exact:

```bash
curl -sS -b /tmp/quality-aftersales.cookie \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-create-001' \
  -d '{"title":"导管漏液","description":"客户现场发现漏液"}' \
  http://127.0.0.1:8787/api/workbench/quality/v1/events
```

- [ ] **Step 7: Run focused quality verification**

Run: `npm run test:quality`

Expected: all `tests/quality` suites PASS with no skipped P1 acceptance tests.

Run: `npm run typecheck`

Expected: TypeScript exits 0.

- [ ] **Step 8: Run the complete host regression**

Run: `npm test`

Expected: all pre-existing suites plus quality suites PASS; inline page lint and three existing browser bundles build successfully.

- [ ] **Step 9: Check migration isolation and disabled-module behavior**

Run:

```bash
npx vitest run \
  tests/quality/infra/quality-schema.test.ts \
  tests/quality/web/quality-api.test.ts \
  tests/quality/e2e/quality-p1-happy-path.test.ts
```

Expected: PASS, including preservation of host tables, 404 while disabled, and the P1 identity-separated happy path.

- [ ] **Step 10: Commit**

```bash
git add package.json vitest.setup.ts scripts/local-quality-dev.ts docs/quality-event-tracking-p1.md tests/quality/e2e
git commit -m "test(quality): add P1 local demo and regression"
```

---

## P1 Completion Gate

- `QUALITY_MODULE_ENABLED=0` leaves the current workbench and full test suite green.
- A quality specialist and an admin without `AFTERSALES_MANAGER` both receive 403 when creating an event.
- A collaborator owner receives 403 for accept/reject; only the active primary owner can act.
- The same `Idempotency-Key` and hash do not repeat transitions; a different hash with the same key returns 409.
- A stale `version` returns 409 and cannot overwrite the winning transaction.
- Weekend, configured holiday and makeup workday cases freeze the expected SLA timestamp.
- The event timeline contains creator, classification, dispatch, response, analysis and due-decision records in order.
- P1 ends at `IN_PROGRESS`; execution evidence, quality review, aftersales final review, closing and notification are not marked complete.

## P1 Traceability

| Baseline item | Implementation task | P1 verification |
|---|---|---|
| `P1-01` migration/core tables | Task 4 | migration idempotency and rollback tests |
| `P1-02` state machine/invariants | Task 2 | transition matrix and forbidden-role tests |
| `P1-03` work calendar/SLA | Task 3 | weekend, holiday, makeup-day, HIGH/MEDIUM/LOW tests |
| `P1-04` repository/optimistic lock | Task 5 | rollback, duplicate ledger, stale version, idempotency tests |
| `P1-05` permissions/departments | Tasks 6 and 8 | role history, capability union, admin mutation tests |
| `P1-06` router/API contract | Task 8 | real-session API tests and error mapping |
| `P1-07` local development entry | Task 9 | five identities, E2E flow and operator walkthrough |
| `FR-004` manual submission | Tasks 7–9 | aftersales-only create path |
| `FR-020` one primary/multiple collaborators | Tasks 2, 4, 7 | unique active primary and configured-owner checks |
| `FR-021` accept/reject | Tasks 2, 7, 8 | active primary owner only; reject reason required |
| `FR-022` accept SLA | Tasks 3, 7 | frozen 24-working-hour deadline; scanner deferred |
| `FR-023` initial analysis | Task 7 | four required fields and analysis SLA |
| `FR-024` due decision | Tasks 2, 7, 8 | quality-only approve/return; client cannot set formal due directly |
