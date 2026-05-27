import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanSession } from "../../src/infra/plan-session-store";
import { runManagerOrchestratorTurn } from "../../src/agent/manager-orchestrator-turn";
import { runOrchestrator } from "../../src/agent/orchestrator";
import { detectFalseSplit } from "../../src/agent/draft-mutation/false-split";

vi.mock("../../src/agent/orchestrator", () => ({
  runOrchestrator: vi.fn(),
}));

vi.mock("../../src/agent/draft-mutation/false-split", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/agent/draft-mutation/false-split")>();
  return {
    ...actual,
    detectFalseSplit: vi.fn(actual.detectFalseSplit),
  };
});

const mockedRunOrchestrator = vi.mocked(runOrchestrator);
const mockedDetectFalseSplit = vi.mocked(detectFalseSplit);

function baseSession(): PlanSession {
  const now = new Date().toISOString();
  return {
    chatKeyHash: "hash-main",
    planId: "plan-1",
    createdAt: now,
    updatedAt: now,
    conversationHistory: [],
    knownFacts: [],
  };
}

describe("runManagerOrchestratorTurn", () => {
  beforeEach(() => {
    vi.stubEnv("DINGTALK_ROLE_ROUTING_ENABLED", "0");
    vi.stubEnv("ASSIGNMENT_PHASE_ENABLED", "0");
    vi.stubEnv("DINGTALK_PLANID_ROTATE_ENABLED", "0");
    mockedRunOrchestrator.mockReset();
    mockedDetectFalseSplit.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("retries orchestrator when false-split is detected (workbench parity)", async () => {
    mockedDetectFalseSplit
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    mockedRunOrchestrator
      .mockResolvedValueOnce({
        traceId: "t1",
        messages: ["first"],
        toolInvocationNames: [],
        toolCallsTotal: 0,
      })
      .mockResolvedValueOnce({
        traceId: "t2",
        messages: ["second"],
        toolInvocationNames: [],
        toolCallsTotal: 0,
      });

    const employeeRepo = {
      list: () => [{ userId: "u1", displayName: "张三" }],
    } as ReturnType<
      typeof import("../../src/integrations/repos/employee-profile-repo").createEmployeeProfileRepo
    >;

    const result = await runManagerOrchestratorTurn({
      userMessage: "把子任务再拆细一点",
      session: baseSession(),
      employeeRepo,
      clientConfig: {
        apiKey: "k",
        baseUrl: "https://example.com",
        model: "qwen-test",
        timeoutMs: 1000,
        maxTokens: 1000,
      },
      senderStaffId: "mgr-1",
      workbenchRole: "manager",
    });

    expect(mockedRunOrchestrator).toHaveBeenCalledTimes(2);
    expect(result.orchResult.traceId).toBe("t2");
  });

  it("clears latestAssignment after start_new_task scope switch", async () => {
    mockedRunOrchestrator.mockImplementation(async (_msg, config) => {
      config.onSessionMutated?.({
        ...baseSession(),
        planId: "plan-bci-new",
        latestAssignment: undefined,
        latestDraft: undefined,
      });
      return {
        traceId: "t-scope",
        messages: ["已开启新任务。"],
        toolInvocationNames: ["start_new_task"],
        toolCallsTotal: 1,
      };
    });

    const session = baseSession();
    session.latestAssignment = {
      planId: "plan-1",
      assignments: [{ taskId: "task_1", primary: { displayName: "朱锐" } }],
    };

    const employeeRepo = {
      list: () => [{ userId: "u1", displayName: "张三" }],
    } as ReturnType<
      typeof import("../../src/integrations/repos/employee-profile-repo").createEmployeeProfileRepo
    >;

    const result = await runManagerOrchestratorTurn({
      userMessage: "开启新任务",
      session,
      employeeRepo,
      clientConfig: {
        apiKey: "k",
        baseUrl: "https://example.com",
        model: "qwen-test",
        timeoutMs: 1000,
        maxTokens: 1000,
      },
      senderStaffId: "mgr-1",
      workbenchRole: "manager",
    });

    expect(result.session.latestAssignment).toBeUndefined();
    expect(result.latestAssignment).toBeUndefined();
  });
});
