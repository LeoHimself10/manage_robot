import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanSession } from "../../../src/infra/plan-session-store";
import {
  restoreTaskScope,
  startNewTaskScope,
} from "../../../src/infra/plan-session-store";
import { runManagerOrchestratorTurn } from "../../../src/agent/manager-orchestrator-turn";
import { runOrchestrator } from "../../../src/agent/orchestrator";
import { detectFalseSplit } from "../../../src/agent/draft-mutation/false-split";
import { buildStartNewTaskHandler } from "../../../src/agent/tools/start-new-task";
import { buildSwitchBackTaskHandler } from "../../../src/agent/tools/switch-back-task";
import { buildBulkAssignTasksHandler } from "../../../src/agent/tools/bulk-assign-tasks";
import { buildPreparePublishTaskHandler } from "../../../src/agent/tools/prepare-publish-task";
import {
  assignmentMatchesPlan,
  resolveTurnLatestAssignment,
} from "../../../src/agent/assignment/resolve-turn-assignment";
import { buildWorkbenchTurnDisplay } from "../../../src/agent/workbench/conversation-turn-display";
import { buildAssistantDisplayMarkdown } from "../../../src/view/conversation-display-markdown";
import type { OrchestratorResult } from "../../../src/agent/orchestrator";

vi.mock("../../../src/agent/orchestrator", () => ({
  runOrchestrator: vi.fn(),
}));

vi.mock("../../../src/agent/draft-mutation/false-split", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../src/agent/draft-mutation/false-split")
  >();
  return {
    ...actual,
    detectFalseSplit: vi.fn(actual.detectFalseSplit),
  };
});

const mockedRunOrchestrator = vi.mocked(runOrchestrator);
const mockedDetectFalseSplit = vi.mocked(detectFalseSplit);

const STALE_NAMES = ["贾三祥", "姚雪峰", "朱锐"] as const;
const U_ZHURUI = "014517256544";
const U_JIA = "u-jia";
const U_YAO = "u-yao";

function nowIso(): string {
  return new Date().toISOString();
}

function makeSession(overrides: Partial<PlanSession> = {}): PlanSession {
  const now = nowIso();
  return {
    chatKeyHash: "hash-conversation",
    planId: "plan-dry-eye",
    createdAt: now,
    updatedAt: now,
    conversationHistory: [],
    knownFacts: [],
    currentTaskScopeId: "scope:dry-eye",
    taskScopes: {
      "scope:dry-eye": {
        scopeId: "scope:dry-eye",
        scopeLabel: "干眼光敷仪",
        planId: "plan-dry-eye",
        createdAt: now,
        updatedAt: now,
      },
    },
    ...overrides,
  };
}

function dryEyeDraft(): Record<string, unknown> {
  return {
    title: "干眼光敷仪项目",
    description: "干眼治疗仪研发与验证",
    tasks: [
      { id: "task_1", title: "供应商评估", objective: "评估" },
      { id: "task_2", title: "样机验证", objective: "验证" },
    ],
  };
}

function dryEyeAssignment(): Record<string, unknown> {
  return {
    planId: "plan-dry-eye",
    assignments: [
      { taskId: "task_1", primary: { userId: U_JIA, displayName: "贾三祥" } },
      { taskId: "task_2", primary: { userId: U_YAO, displayName: "姚雪峰" } },
    ],
  };
}

function bciDraft(): Record<string, unknown> {
  return {
    title: "脑机接口项目",
    description: "BCI 研发规划",
    tasks: [
      { id: "task_1", title: "需求梳理", objective: "明确范围" },
      { id: "task_2", title: "原型验证", objective: "技术验证" },
    ],
  };
}

function employeeRepo() {
  return {
    list: () => [
      { userId: U_JIA, displayName: "贾三祥" },
      { userId: U_YAO, displayName: "姚雪峰" },
      { userId: U_ZHURUI, displayName: "朱锐" },
    ],
  } as ReturnType<
    typeof import("../../../src/integrations/repos/employee-profile-repo").createEmployeeProfileRepo
  >;
}

function clientConfig() {
  return {
    apiKey: "k",
    baseUrl: "https://example.com",
    model: "qwen-test",
    timeoutMs: 1000,
    maxTokens: 1000,
  } as Parameters<typeof runManagerOrchestratorTurn>[0]["clientConfig"];
}

function assertNoStaleNames(text: string): void {
  for (const name of STALE_NAMES) {
    expect(text).not.toContain(name);
  }
}

describe("assignment scope conversation simulations", () => {
  beforeEach(() => {
    vi.stubEnv("ORCHESTRATOR_ENGINE", "legacy");
    vi.stubEnv("DINGTALK_ROLE_ROUTING_ENABLED", "0");
    vi.stubEnv("ASSIGNMENT_PHASE_ENABLED", "0");
    vi.stubEnv("DINGTALK_PLANID_ROTATE_ENABLED", "0");
    mockedRunOrchestrator.mockReset();
    mockedDetectFalseSplit.mockReset();
    mockedDetectFalseSplit.mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("multi-turn: 朱锐 case (assign → start_new_task → new draft)", () => {
    it("clears assignment on scope switch and keeps new draft clean on next turn", async () => {
      let session = makeSession({
        latestDraft: dryEyeDraft() as PlanSession["latestDraft"],
        latestAssignment: dryEyeAssignment() as PlanSession["latestAssignment"],
      });

      mockedRunOrchestrator.mockImplementationOnce(async (_msg, config) => {
        const handler = buildStartNewTaskHandler({
          currentSession: config.currentSession as PlanSession,
          onSessionMutated: config.onSessionMutated,
        });
        handler({ scopeLabel: "脑机接口项目", reason: "user_start_new_task" });
        return {
          traceId: "turn-start-new",
          messages: ["已为您开启新任务「脑机接口项目」。"],
          toolInvocationNames: ["start_new_task"],
          toolCallsTotal: 1,
        };
      });

      const turnStartNew = await runManagerOrchestratorTurn({
        userMessage: "开启新任务",
        session: { ...session },
        employeeRepo: employeeRepo(),
        clientConfig: clientConfig(),
        senderStaffId: U_ZHURUI,
        workbenchRole: "manager",
      });

      expect(turnStartNew.session.latestAssignment).toBeUndefined();
      expect(turnStartNew.session.latestDraft).toBeUndefined();
      expect(turnStartNew.session.planId).not.toBe("plan-dry-eye");
      session = turnStartNew.session;

      mockedRunOrchestrator.mockResolvedValueOnce({
        traceId: "turn-bci-draft",
        messages: ["已根据您的描述生成脑机接口项目草案，请确认范围与截止时间。"],
        toolInvocationNames: [],
        toolCallsTotal: 0,
        draft: bciDraft(),
      });

      const turnDraft = await runManagerOrchestratorTurn({
        userMessage: "帮我规划脑机接口项目，拆成需求梳理和原型验证两条",
        session: { ...session },
        employeeRepo: employeeRepo(),
        clientConfig: clientConfig(),
        senderStaffId: U_ZHURUI,
        workbenchRole: "manager",
      });

      expect(turnDraft.session.latestAssignment).toBeUndefined();
      expect(turnDraft.session.latestDraft).toBeDefined();

      const display = buildWorkbenchTurnDisplay({
        orchResult: turnDraft.orchResult,
        session: turnDraft.session,
        preTurnDraft: turnDraft.preTurnDraft,
        preTurnAssignment: turnDraft.preTurnAssignment,
        preTurnPlanId: turnDraft.preRotatePlanId,
        postTurnDraft: turnDraft.session.latestDraft,
        modelName: "qwen-test",
        employees: employeeRepo().list(),
      });

      assertNoStaleNames(display.displayContent);
      expect(display.latestAssignment).toBeUndefined();

      const dingtalkMarkdown = buildAssistantDisplayMarkdown({
        modelMessage: turnDraft.orchResult.messages.join("\n"),
        currentDraft: turnDraft.draftForRender ?? turnDraft.persistedDraft,
        latestAssignment: turnDraft.latestAssignment,
        shouldRenderRichSection: true,
        assignmentSection: turnDraft.assignmentSection,
      });
      assertNoStaleNames(dingtalkMarkdown);
    });
  });

  describe("multi-turn: switch_back_task restores archived assignment", () => {
    it("does not leak new-scope preTurnAssignment when switching back", async () => {
      const session = makeSession({
        latestDraft: dryEyeDraft() as PlanSession["latestDraft"],
        latestAssignment: dryEyeAssignment() as PlanSession["latestAssignment"],
      });
      session.taskScopes!["scope:dry-eye"] = {
        ...session.taskScopes!["scope:dry-eye"],
        latestDraft: session.latestDraft,
        latestAssignment: session.latestAssignment,
      };

      startNewTaskScope(session, { scopeLabel: "脑机接口", reason: "user_start_new_task" });
      expect(session.latestAssignment).toBeUndefined();

      mockedRunOrchestrator.mockImplementationOnce(async (_msg, config) => {
        const handler = buildSwitchBackTaskHandler({
          currentSession: config.currentSession as PlanSession,
          onSessionMutated: config.onSessionMutated,
        });
        handler({ scopeLabelKeyword: "干眼" });
        return {
          traceId: "turn-switch-back",
          messages: ["已切回干眼光敷仪任务，原草案与指派已恢复。"],
          toolInvocationNames: ["switch_back_task"],
          toolCallsTotal: 1,
        };
      });

      const turn = await runManagerOrchestratorTurn({
        userMessage: "切回干眼光敷仪那个任务",
        session: { ...session },
        employeeRepo: employeeRepo(),
        clientConfig: clientConfig(),
        senderStaffId: U_ZHURUI,
        workbenchRole: "manager",
      });

      expect(turn.session.planId).toBe("plan-dry-eye");
      expect(turn.session.latestAssignment).toBeDefined();
      const names = (
        (turn.session.latestAssignment as { assignments: Array<{ primary?: { displayName?: string } }> })
          .assignments
      ).map((a) => String(a.primary?.displayName ?? ""));
      expect(names).toContain("贾三祥");
      expect(names).toContain("姚雪峰");
      expect(turn.latestAssignment).toBeDefined();
    });
  });

  describe("same-turn tool chains (regression)", () => {
    it("bulk_assign + prepare_publish still shows assignee names in display", () => {
      const now = nowIso();
      const session = makeSession({
        latestDraft: dryEyeDraft() as PlanSession["latestDraft"],
        lastEmployeeSearchHits: [
          { userId: U_JIA, displayName: "贾三祥", hitAt: now },
          { userId: U_YAO, displayName: "姚雪峰", hitAt: now },
        ],
      });
      const getContact = (userId: string) =>
        userId === U_JIA
          ? { active: true, name: "贾三祥", unionId: "union-jia" }
          : userId === U_YAO
            ? { active: true, name: "姚雪峰", unionId: "union-yao" }
            : undefined;

      const bulk = buildBulkAssignTasksHandler({ currentSession: session, getContact });
      expect(
        (bulk({
          assignments: [
            { taskId: "task_1", assigneeUserId: U_JIA },
            { taskId: "task_2", assigneeUserId: U_YAO },
          ],
        }) as { ok: boolean }).ok,
      ).toBe(true);

      const prep = buildPreparePublishTaskHandler({ currentSession: session, getContact });
      expect((prep({ planId: session.planId }) as { ok: boolean }).ok).toBe(true);

      const orchResult: OrchestratorResult = {
        traceId: "turn-bulk-prepare",
        messages: ["已完成负责人指派并生成发布预览。"],
        toolInvocationNames: ["bulk_assign_tasks", "prepare_publish_task"],
        toolCallsTotal: 2,
      };

      const display = buildWorkbenchTurnDisplay({
        orchResult,
        session,
        preTurnDraft: dryEyeDraft(),
        preTurnAssignment: undefined,
        preTurnPlanId: session.planId,
        postTurnDraft: session.latestDraft,
        modelName: "qwen-test",
        employees: employeeRepo().list(),
      });

      expect(display.displayContent).toContain("贾三祥");
      expect(display.displayContent).toContain("姚雪峰");
      expect(display.latestAssignment).toBeDefined();
    });

    it("start_new_task + draft in one orchestrator turn does not restore preTurn assignees", () => {
      const preTurnPlanId = "plan-dry-eye";
      const session = makeSession({
        planId: "plan-bci",
        latestDraft: bciDraft() as PlanSession["latestDraft"],
        latestAssignment: undefined,
      });

      const display = buildWorkbenchTurnDisplay({
        orchResult: {
          traceId: "turn-same-scope-switch",
          messages: ["已开启新任务并生成草案。"],
          toolInvocationNames: ["start_new_task"],
          toolCallsTotal: 1,
          draft: bciDraft(),
        },
        session,
        preTurnDraft: dryEyeDraft(),
        preTurnAssignment: dryEyeAssignment(),
        preTurnPlanId,
        postTurnDraft: session.latestDraft,
        modelName: "qwen-test",
        employees: employeeRepo().list(),
      });

      assertNoStaleNames(display.displayContent);
      expect(display.latestAssignment).toBeUndefined();
    });
  });

  describe("memory guard: stale assignment must not enter prompt context", () => {
    it("rejects assignment when planId mismatches session plan", () => {
      const stale = dryEyeAssignment();
      expect(assignmentMatchesPlan(stale, "plan-bci-new")).toBe(false);
      expect(assignmentMatchesPlan(stale, "plan-dry-eye")).toBe(true);
      expect(assignmentMatchesPlan({ assignments: [] }, "plan-bci-new")).toBe(true);
    });

    it("simulates orchestrator memory injection skip for cross-plan residue", () => {
      const sessionPlanId = "plan-bci-new";
      const staleAssignment = dryEyeAssignment();
      const memoryWouldInclude =
        Boolean(staleAssignment)
        && assignmentMatchesPlan(staleAssignment, sessionPlanId);
      expect(memoryWouldInclude).toBe(false);
    });
  });

  describe("resolveTurnLatestAssignment conversation edge cases", () => {
    it("allows preTurn fallback on same plan when bulk/prepare wrote assignment without planId", () => {
      const assignment = {
        assignments: [{ taskId: "task_1", primary: { displayName: "朱锐" } }],
      };
      expect(
        resolveTurnLatestAssignment({
          preTurnAssignment: assignment,
          sessionPlanId: "plan-a",
          preTurnPlanId: "plan-a",
          toolInvocationNames: ["prepare_publish_task"],
        }),
      ).toEqual(assignment);
    });

    it("clears when session holds stale assignment with explicit old planId after switch", () => {
      expect(
        resolveTurnLatestAssignment({
          sessionLatest: dryEyeAssignment(),
          preTurnAssignment: dryEyeAssignment(),
          sessionPlanId: "plan-bci-new",
          preTurnPlanId: "plan-dry-eye",
          toolInvocationNames: ["start_new_task"],
        }),
      ).toBeUndefined();
    });

    it("restoreTaskScope brings back assignment for follow-up display turn", () => {
      const session = makeSession({
        latestDraft: dryEyeDraft() as PlanSession["latestDraft"],
        latestAssignment: dryEyeAssignment() as PlanSession["latestAssignment"],
      });
      session.taskScopes!["scope:dry-eye"] = {
        ...session.taskScopes!["scope:dry-eye"],
        latestDraft: session.latestDraft,
        latestAssignment: session.latestAssignment,
      };
      startNewTaskScope(session, { scopeLabel: "临时新任务" });
      const restored = restoreTaskScope(session, { scopeLabelKeyword: "干眼" });
      expect(restored.ok).toBe(true);
      if (!restored.ok) return;

      const display = buildWorkbenchTurnDisplay({
        orchResult: {
          traceId: "turn-after-restore",
          messages: ["已切回原任务，请确认负责人是否仍合适。"],
          toolInvocationNames: ["switch_back_task"],
          toolCallsTotal: 1,
        },
        session,
        preTurnDraft: undefined,
        preTurnAssignment: undefined,
        preTurnPlanId: "plan-bci-new",
        postTurnDraft: session.latestDraft,
        modelName: "qwen-test",
        employees: employeeRepo().list(),
      });

      expect(display.displayContent).toContain("贾三祥");
      expect(display.displayContent).toContain("姚雪峰");
    });
  });

  describe("role parity: portfolio vs non-portfolio share the same resolver", () => {
    it("scope switch clears assignment regardless of portfolio flag (logic-only)", () => {
      const withPortfolio = resolveTurnLatestAssignment({
        preTurnAssignment: dryEyeAssignment(),
        sessionPlanId: "plan-bci",
        preTurnPlanId: "plan-dry-eye",
        toolInvocationNames: ["start_new_task"],
      });
      const withoutPortfolio = resolveTurnLatestAssignment({
        preTurnAssignment: dryEyeAssignment(),
        sessionPlanId: "plan-bci",
        preTurnPlanId: "plan-dry-eye",
        toolInvocationNames: ["start_new_task"],
      });
      expect(withPortfolio).toBeUndefined();
      expect(withoutPortfolio).toBeUndefined();
    });
  });
});
