import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  WORKBENCH_DRAFT_REVISION_TAG,
  buildWorkbenchDraftRevisionUserMessage,
  runWorkbenchDraftRevision,
} from "../../../src/agent/workbench/draft-revision";
import * as orchestratorMod from "../../../src/agent/orchestrator";

describe("workbench draft revision", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("buildWorkbenchDraftRevisionUserMessage tags and embeds JSON", () => {
    const msg = buildWorkbenchDraftRevisionUserMessage({
      draft: { title: "T", tasks: [{ id: "task_1", title: "A" }] },
      assignment: { assignments: [] },
    });
    expect(msg).toContain(WORKBENCH_DRAFT_REVISION_TAG);
    expect(msg).toContain('"task_1"');
    expect(msg).toContain("禁止 tool_calls");
  });

  it("runWorkbenchDraftRevision passes workbenchDraftRevision and disableTools", async () => {
    const draft = {
      title: "T",
      description: "D",
      tasks: [
        {
          id: "task_1",
          title: "子任务",
          objective: "目标",
          deliverables: ["x"],
          completionCriteria: ["y"],
          timeNode: { dueAt: "2026-07-01" },
        },
      ],
    };
    const spy = vi.spyOn(orchestratorMod, "runOrchestrator").mockResolvedValue({
      traceId: "tr-1",
      message: "已更新",
      draft,
      toolCalls: [],
      iterations: 1,
      totalTokens: 100,
    } as unknown as orchestratorMod.OrchestratorResult);

    const session = {
      planId: "plan-1",
      chatKey: "wb:main:u1",
      chatKeyHash: "h1",
      latestDraft: draft,
      latestAssignment: { assignments: [] },
    };

    const result = await runWorkbenchDraftRevision({
      session: session as never,
      draft,
      assignment: { assignments: [] },
      orchestratorConfig: {
        clientConfig: {
          apiKey: "k",
          model: "m",
          baseUrl: "https://x",
          timeoutMs: 5000,
          maxRetries: 0,
          temperature: 0,
          maxTokens: 2000,
        },
        employeeRepo: { list: () => [], getByUserId: () => undefined } as never,
        toolProfile: "manager",
        promptProfile: "planner",
      },
    });

    expect(result.ok).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
    const cfg = spy.mock.calls[0][1];
    expect(cfg?.workbenchDraftRevision).toBe(true);
    expect(cfg?.disableTools).toBe(true);
    expect(cfg?.maxToolIterations).toBe(2);
  });

  it("returns 503 when orchestrator returns empty tasks", async () => {
    vi.spyOn(orchestratorMod, "runOrchestrator").mockResolvedValue({
      traceId: "tr-2",
      message: "失败",
      draft: { title: "T", tasks: [] },
      toolCalls: [],
      iterations: 1,
      totalTokens: 50,
    } as unknown as orchestratorMod.OrchestratorResult);

    const draft = {
      title: "T",
      tasks: [{ id: "task_1", title: "A", objective: "O", deliverables: ["d"], completionCriteria: ["c"], timeNode: { dueAt: "2026-07-01" } }],
    };

    const result = await runWorkbenchDraftRevision({
      session: { planId: "p", latestDraft: draft } as never,
      draft,
      orchestratorConfig: {
        clientConfig: {
          apiKey: "k",
          model: "m",
          baseUrl: "https://x",
          timeoutMs: 5000,
          maxRetries: 0,
          temperature: 0,
          maxTokens: 2000,
        },
        employeeRepo: { list: () => [] } as never,
        toolProfile: "manager",
        promptProfile: "planner",
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(503);
  });
});
