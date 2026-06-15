import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanSession } from "../../../src/infra/plan-session-store";
import {
  decideTurnToolChoice,
  hasConcreteChangePayload,
  serializeTurnToolChoice,
} from "../../../src/agent/v2/tool-choice-gate";
import { classifyRowSplitIntent } from "../../../src/agent/v2/intent-classifier";

vi.mock("../../../src/agent/v2/intent-classifier", () => ({
  classifyRowSplitIntent: vi.fn(async () => "other" as const),
}));

const mockedClassify = vi.mocked(classifyRowSplitIntent);

function makeSession(overrides: Partial<PlanSession> = {}): PlanSession {
  return {
    chatKeyHash: "h",
    planId: "p1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    conversationHistory: [],
    knownFacts: [],
    ...overrides,
  };
}

function draftWithTasks(n: number): Record<string, unknown> {
  return {
    title: "草案",
    tasks: Array.from({ length: n }, (_, i) => ({ id: `task_${i + 1}`, title: `子任务${i + 1}` })),
  };
}

const ACTOR = "u-manager-1";
const CLASSIFIER = { apiKey: "k", baseUrl: "https://example.com/v1" };

describe("decideTurnToolChoice — decision table", () => {
  beforeEach(() => {
    mockedClassify.mockReset();
    mockedClassify.mockResolvedValue("other");
  });

  it("PATCH/R6: row patch intent + draft≥2 + concrete value → required", async () => {
    const result = await decideTurnToolChoice({
      userMessage: "任务2改成 2026-05-28、负责人换成杨贺新，只改这一行",
      session: makeSession({ latestDraft: draftWithTasks(2) }),
      toolProfile: "manager",
      trustedActorUserId: ACTOR,
      thinkingEnabled: false,
      classifierConfig: CLASSIFIER,
    });
    expect(result.toolChoice).toBe("required");
    expect(result.reason).toBe("patch_required");
    expect(result.frontier).toEqual([
      "update_draft_task",
      "bulk_assign_tasks",
      "search_employees",
    ]);
    expect(mockedClassify).not.toHaveBeenCalled();
  });

  it("publish confirm + staged draft → forced publish_task", async () => {
    const result = await decideTurnToolChoice({
      userMessage: "确认发放",
      session: makeSession({ latestDraft: draftWithTasks(3) }),
      toolProfile: "manager",
      trustedActorUserId: ACTOR,
      thinkingEnabled: false,
      classifierConfig: CLASSIFIER,
    });
    expect(result.toolChoice).toEqual({ type: "function", function: { name: "publish_task" } });
    expect(result.reason).toBe("publish_forced");
    expect(result.frontier).toEqual(["publish_task"]);
  });

  it("U5: assignee intent + roster/pool + coverage<full → forced assign_from_roster", async () => {
    const result = await decideTurnToolChoice({
      userMessage: "按这份名单分配给大家",
      session: makeSession({
        latestDraft: draftWithTasks(3),
        candidatePool: {
          source: "uploaded",
          entries: [
            { userId: "e1", displayName: "张三" },
            { userId: "e2", displayName: "李四" },
          ],
        } as PlanSession["candidatePool"],
      }),
      toolProfile: "manager",
      trustedActorUserId: ACTOR,
      assignCoverage: { covered: 0, total: 3 },
      thinkingEnabled: false,
      classifierConfig: CLASSIFIER,
    });
    expect(result.toolChoice).toEqual({
      type: "function",
      function: { name: "assign_from_roster" },
    });
    expect(result.reason).toBe("roster_assign_forced");
    expect(result.frontier).toEqual(["assign_from_roster"]);
  });

  it("U5: full coverage → auto (no force)", async () => {
    const result = await decideTurnToolChoice({
      userMessage: "按这份名单分配给大家",
      session: makeSession({
        latestDraft: draftWithTasks(2),
        candidatePool: {
          source: "uploaded",
          entries: [{ userId: "e1", displayName: "张三" }],
        } as PlanSession["candidatePool"],
      }),
      toolProfile: "manager",
      trustedActorUserId: ACTOR,
      assignCoverage: { covered: 2, total: 2 },
      thinkingEnabled: false,
      classifierConfig: CLASSIFIER,
    });
    expect(result.toolChoice).toBe("auto");
  });

  it("row split (LLM) + draft → forced split_draft_task", async () => {
    mockedClassify.mockResolvedValue("split");
    const result = await decideTurnToolChoice({
      userMessage: "把任务2拆成2个小任务",
      session: makeSession({ latestDraft: draftWithTasks(5) }),
      toolProfile: "manager",
      trustedActorUserId: ACTOR,
      thinkingEnabled: false,
      classifierConfig: CLASSIFIER,
    });
    expect(mockedClassify).toHaveBeenCalledWith("把任务2拆成2个小任务", CLASSIFIER);
    expect(result.toolChoice).toEqual({
      type: "function",
      function: { name: "split_draft_task" },
    });
    expect(result.reason).toBe("row_split_forced");
    expect(result.frontier).toEqual(["split_draft_task"]);
  });
});

describe("decideTurnToolChoice — negative guards", () => {
  beforeEach(() => {
    mockedClassify.mockReset();
    mockedClassify.mockResolvedValue("other");
  });

  const patchMsg = "任务2改成 2026-05-28，负责人换成杨贺新";

  it("whole-table redraft intent → auto", async () => {
    const result = await decideTurnToolChoice({
      userMessage: "整表重新拆解，任务2改成 2026-05-28",
      session: makeSession({ latestDraft: draftWithTasks(3) }),
      toolProfile: "manager",
      trustedActorUserId: ACTOR,
      thinkingEnabled: false,
      classifierConfig: CLASSIFIER,
    });
    expect(result.toolChoice).toBe("auto");
    expect(result.reason).toBe("auto:whole_table_redraft");
    expect(mockedClassify).not.toHaveBeenCalled();
  });

  it("row split intent but classifier returns other → auto:no_match", async () => {
    mockedClassify.mockResolvedValue("other");
    const result = await decideTurnToolChoice({
      userMessage: "任务2拆成两个",
      session: makeSession({ latestDraft: draftWithTasks(3) }),
      toolProfile: "manager",
      trustedActorUserId: ACTOR,
      thinkingEnabled: false,
      classifierConfig: CLASSIFIER,
    });
    expect(result.toolChoice).toBe("auto");
    expect(result.reason).toBe("auto:no_match");
  });

  it("patch intent takes priority over row split classifier", async () => {
    mockedClassify.mockResolvedValue("split");
    const result = await decideTurnToolChoice({
      userMessage: "任务2改成 2026-05-28、负责人换成杨贺新",
      session: makeSession({ latestDraft: draftWithTasks(3) }),
      toolProfile: "manager",
      trustedActorUserId: ACTOR,
      thinkingEnabled: false,
      classifierConfig: CLASSIFIER,
    });
    expect(result.reason).toBe("patch_required");
    expect(mockedClassify).not.toHaveBeenCalled();
  });

  it("missing trustedActorUserId → auto", async () => {
    const result = await decideTurnToolChoice({
      userMessage: patchMsg,
      session: makeSession({ latestDraft: draftWithTasks(2) }),
      toolProfile: "manager",
      thinkingEnabled: false,
      classifierConfig: CLASSIFIER,
    });
    expect(result.toolChoice).toBe("auto");
    expect(result.reason).toBe("auto:no_trusted_actor");
  });

  it("thinking enabled → auto", async () => {
    const result = await decideTurnToolChoice({
      userMessage: patchMsg,
      session: makeSession({ latestDraft: draftWithTasks(2) }),
      toolProfile: "manager",
      trustedActorUserId: ACTOR,
      thinkingEnabled: true,
      classifierConfig: CLASSIFIER,
    });
    expect(result.toolChoice).toBe("auto");
    expect(result.reason).toBe("auto:thinking_enabled");
  });

  it("target tool not in profile (publish on planner) → auto", async () => {
    const result = await decideTurnToolChoice({
      userMessage: "确认发放",
      session: makeSession({ latestDraft: draftWithTasks(2) }),
      toolProfile: "planner",
      trustedActorUserId: ACTOR,
      thinkingEnabled: false,
      classifierConfig: CLASSIFIER,
    });
    expect(result.toolChoice).toBe("auto");
    expect(result.reason).toBe("auto:publish_tool_not_in_profile");
  });

  it("patch intent but missing concrete value → auto:no_concrete_value", async () => {
    const result = await decideTurnToolChoice({
      userMessage: "任务2改一下负责人",
      session: makeSession({ latestDraft: draftWithTasks(2) }),
      toolProfile: "manager",
      trustedActorUserId: ACTOR,
      thinkingEnabled: false,
      classifierConfig: CLASSIFIER,
    });
    expect(result.toolChoice).toBe("auto");
    expect(result.reason).toBe("auto:no_concrete_value");
  });

  it("patch intent but draft has <2 tasks → auto", async () => {
    const result = await decideTurnToolChoice({
      userMessage: "任务1改成 2026-05-28",
      session: makeSession({ latestDraft: draftWithTasks(1) }),
      toolProfile: "manager",
      trustedActorUserId: ACTOR,
      thinkingEnabled: false,
      classifierConfig: CLASSIFIER,
    });
    expect(result.toolChoice).toBe("auto");
  });

  it("publish confirm but no staged draft → auto", async () => {
    const result = await decideTurnToolChoice({
      userMessage: "确认发放",
      session: makeSession(),
      toolProfile: "manager",
      trustedActorUserId: ACTOR,
      thinkingEnabled: false,
      classifierConfig: CLASSIFIER,
    });
    expect(result.toolChoice).toBe("auto");
  });

  it("split tool not in profile → auto:split_tool_not_in_profile", async () => {
    mockedClassify.mockResolvedValue("split");
    const result = await decideTurnToolChoice({
      userMessage: "split task 2 into two",
      session: makeSession({ latestDraft: draftWithTasks(3) }),
      toolProfile: "planner",
      trustedActorUserId: ACTOR,
      thinkingEnabled: false,
      classifierConfig: CLASSIFIER,
    });
    expect(result.toolChoice).toBe("auto");
    expect(result.reason).toBe("auto:split_tool_not_in_profile");
  });
});

describe("decideTurnToolChoice — URL forcing (U1)", () => {
  beforeEach(() => {
    mockedClassify.mockReset();
    mockedClassify.mockResolvedValue("other");
  });

  it("external http URL in message → forced read_url", async () => {
    const result = await decideTurnToolChoice({
      userMessage: "请帮我看一下这个链接 https://example.com/doc 然后给我出草案",
      session: makeSession(),
      toolProfile: "manager",
      trustedActorUserId: ACTOR,
      thinkingEnabled: false,
      classifierConfig: CLASSIFIER,
    });
    expect(result.toolChoice).toEqual({ type: "function", function: { name: "read_url" } });
    expect(result.reason).toBe("url_read_forced");
    expect(result.frontier).toEqual(["read_url"]);
    expect(mockedClassify).not.toHaveBeenCalled();
  });

  it("external https URL → forced read_url", async () => {
    const result = await decideTurnToolChoice({
      userMessage: "看下 https://docs.qq.com/sheet/xxx 里的名单",
      session: makeSession(),
      toolProfile: "manager",
      trustedActorUserId: ACTOR,
      thinkingEnabled: false,
      classifierConfig: CLASSIFIER,
    });
    expect(result.reason).toBe("url_read_forced");
  });

  it("localhost URL → not forced (falls through to other logic)", async () => {
    const result = await decideTurnToolChoice({
      userMessage: "看下 http://localhost:3000/test",
      session: makeSession(),
      toolProfile: "manager",
      trustedActorUserId: ACTOR,
      thinkingEnabled: false,
      classifierConfig: CLASSIFIER,
    });
    expect(result.reason).not.toBe("url_read_forced");
  });

  it("read_url not in profile (employee) → auto (no force)", async () => {
    const result = await decideTurnToolChoice({
      userMessage: "看下 https://example.com/doc",
      session: makeSession(),
      toolProfile: "employee",
      trustedActorUserId: ACTOR,
      thinkingEnabled: false,
      classifierConfig: CLASSIFIER,
    });
    // employee profile does not include read_url → gate falls through to auto
    expect(result.toolChoice).toBe("auto");
  });

  it("no URL in message → no url_read_forced", async () => {
    const result = await decideTurnToolChoice({
      userMessage: "请帮我出一份草案",
      session: makeSession(),
      toolProfile: "manager",
      trustedActorUserId: ACTOR,
      thinkingEnabled: false,
      classifierConfig: CLASSIFIER,
    });
    expect(result.reason).not.toBe("url_read_forced");
  });
});

describe("hasConcreteChangePayload", () => {
  it("matches explicit ISO date", () => {
    expect(hasConcreteChangePayload("任务2改成 2026-05-28")).toBe(true);
  });
  it("matches relative deadline (下周)", () => {
    expect(hasConcreteChangePayload("任务2截止改成下周三")).toBe(true);
  });
  it("matches person name after 换成", () => {
    expect(hasConcreteChangePayload("负责人换成杨贺新")).toBe(true);
  });
  it("matches person name after 改成", () => {
    expect(hasConcreteChangePayload("负责人改成王伟")).toBe(true);
  });
  it("no value (bare 改一下) → false", () => {
    expect(hasConcreteChangePayload("任务2改一下")).toBe(false);
  });
  it("clue followed by non-name fragment → false", () => {
    expect(hasConcreteChangePayload("负责人改一下")).toBe(false);
  });
  it("empty → false", () => {
    expect(hasConcreteChangePayload("")).toBe(false);
  });
});

describe("serializeTurnToolChoice", () => {
  it("serializes auto / required / forced", () => {
    expect(serializeTurnToolChoice("auto")).toBe("auto");
    expect(serializeTurnToolChoice("required")).toBe("required");
    expect(
      serializeTurnToolChoice({ type: "function", function: { name: "publish_task" } }),
    ).toBe("forced:publish_task");
  });
});
