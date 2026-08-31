import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { PlanSession } from "../../../src/infra/plan-session-store";
import { buildReplaceDraftHandler } from "../../../src/agent/v2/replace-draft-tool";
import { buildV2SystemPrompt, V2_AGENT_PROMPT_VERSION } from "../../../src/agent/v2/prompt";
import { buildV2ContextBlock } from "../../../src/agent/v2/context";
import { readOrchestratorEngine } from "../../../src/agent/v2/manager-turn-v2";

describe("v2 replace_draft", () => {
  it("replaces session.latestDraft with full tasks[]", () => {
    const session: PlanSession = {
      chatKeyHash: "h",
      planId: "p1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      conversationHistory: [],
      knownFacts: [],
      latestDraft: {
        title: "旧",
        description: "旧",
        tasks: [{ id: "task_1", title: "旧任务", objective: "o", deliverables: ["d"], completionCriteria: ["c"] }],
      },
    };
    const handler = buildReplaceDraftHandler({ currentSession: session });
    const result = handler({
      title: "新CAPA",
      description: "背景",
      tasks: [
        {
          id: "task_1",
          title: "围堵",
          objective: "产线围堵",
          deliverables: ["围堵记录"],
          completionCriteria: ["记录签字"],
          timeNode: { dueAt: "2026-07-01" },
        },
        {
          id: "task_2",
          title: "分析",
          objective: "根因",
          deliverables: ["8D"],
          completionCriteria: ["8D关闭"],
          timeNode: { dueAt: "2026-07-01" },
        },
      ],
    }) as { ok: boolean; taskCount?: number };

    expect(result.ok).toBe(true);
    expect(result.taskCount).toBe(2);
    const tasks = (session.latestDraft as { tasks: unknown[] }).tasks;
    expect(tasks).toHaveLength(2);
    expect((tasks[0] as { title: string }).title).toBe("围堵");
  });

  it("preserves immutable quality handoff context and restores exact outcome mappings", () => {
    const session: PlanSession = {
      chatKeyHash: "quality-h",
      planId: "quality-p1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      conversationHistory: [],
      knownFacts: [],
      latestDraft: {
        title: "质量事件草案",
        description: "不可变质量背景",
        qualityTaskPackage: {
          requiredDeliverables: [{
            deliverableId: "deliverable-a",
            name: "原因排查与验证记录",
            selected: true,
          }],
        },
        qualityHandoff: {
          qualityEventId: "quality-event-a",
          requiredDeliverableIds: ["deliverable-a"],
        },
        tasks: [{
          id: "task_1",
          title: "原因排查与验证记录",
          objective: "形成完整记录",
          deliverables: ["原因排查与验证记录"],
          completionCriteria: ["可复核"],
          qualityDeliverableIds: ["deliverable-a"],
        }],
      },
    };
    const handler = buildReplaceDraftHandler({ currentSession: session });

    const result = handler({
      title: "质量事件拆解方案",
      description: "重新拆成执行链路",
      tasks: [{
        id: "task_1",
        title: "复现与根因定位",
        objective: "完成复现和原因确认",
        deliverables: ["原因排查与验证记录"],
        completionCriteria: ["记录可复核"],
        timeNode: { dueAt: "2026-09-10" },
      }],
    }) as { ok: boolean };

    expect(result.ok).toBe(true);
    const draft = session.latestDraft as Record<string, unknown>;
    expect(draft.qualityHandoff).toEqual({
      qualityEventId: "quality-event-a",
      requiredDeliverableIds: ["deliverable-a"],
    });
    expect(draft.qualityTaskPackage).toMatchObject({
      requiredDeliverables: [{ deliverableId: "deliverable-a" }],
    });
    expect((draft.tasks as Array<Record<string, unknown>>)[0].qualityDeliverableIds)
      .toEqual(["deliverable-a"]);
  });
});

describe("v2 prompt", () => {
  it("is compact and has no mode tree", () => {
    const prompt = buildV2SystemPrompt({ managerFollowup: true });
    expect(prompt).toContain(V2_AGENT_PROMPT_VERSION);
    expect(prompt).not.toMatch(/CLARIFY\s*\/\s*QUERY\s*\/\s*DRAFT/);
    expect(prompt).toContain("replace_draft");
    expect(prompt).toContain("业务红线");
    expect(prompt).toContain("pool 建好 ≠ 指派完成");
    expect(prompt).toContain("澄清后大段补充");
    expect(prompt).toContain("单行 patch");
    expect(prompt.length).toBeLessThan(4500);
  });
});

describe("v2 context", () => {
  it("injects fact-only session context without action hints when no user message", () => {
    const block = buildV2ContextBlock({
      planId: "plan-x",
      latestDraft: { title: "T", description: "D", tasks: [] },
      currentTimeIso: "2026-06-10T00:00:00.000Z",
    });
    expect(block).toContain("planId: plan-x");
    expect(block).not.toMatch(/actionHints:/);
  });

  it("injects rosterAssignAction when candidatePool and assign intent", () => {
    const session: PlanSession = {
      chatKeyHash: "h",
      planId: "plan-x",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      conversationHistory: [],
      knownFacts: [],
      candidatePool: {
        source: "roster",
        entries: [{ userId: "u1", displayName: "姚雪峰", fileNotes: "硬件排查" }],
        unresolved: [],
        updatedAt: new Date().toISOString(),
      },
      latestDraft: {
        title: "T",
        description: "D",
        tasks: [{ id: "task_1", title: "a", objective: "o", deliverables: ["d"], completionCriteria: ["c"] }],
      },
    };
    const block = buildV2ContextBlock({
      planId: session.planId,
      latestDraft: session.latestDraft as Record<string, unknown>,
      candidatePool: {
        source: "roster",
        entries: [{ userId: "u1", displayName: "姚雪峰", fileNotes: "硬件排查" }],
      },
      session,
      userMessage: "按花名册把子任务分给姚雪峰和杨贺新",
    });
    expect(block).toContain("rosterAssignAction");
    expect(block).toContain("bulk_assign_tasks");
  });

  it("injects patchAction for single-row patch intent", () => {
    const session: PlanSession = {
      chatKeyHash: "h",
      planId: "plan-x",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      conversationHistory: [],
      knownFacts: [],
      latestDraft: {
        title: "T",
        description: "D",
        tasks: [
          { id: "task_1", title: "a", objective: "o", deliverables: ["d"], completionCriteria: ["c"] },
          { id: "task_2", title: "b", objective: "o", deliverables: ["d"], completionCriteria: ["c"] },
        ],
      },
    };
    const block = buildV2ContextBlock({
      planId: session.planId,
      latestDraft: session.latestDraft as Record<string, unknown>,
      session,
      userMessage: "任务2改成2026-05-28前完成，负责人换成杨贺新，只改这一行。",
    });
    expect(block).toContain("patchAction");
    expect(block).toContain("update_draft_task");
  });

  it("injects actionHints for assign intent when session and userMessage provided", () => {
    const session: PlanSession = {
      chatKeyHash: "h",
      planId: "plan-x",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      conversationHistory: [],
      knownFacts: [],
      latestDraft: {
        title: "T",
        description: "D",
        tasks: [{ id: "task_1", title: "a", objective: "o", deliverables: ["d"], completionCriteria: ["c"] }],
      },
    };
    const block = buildV2ContextBlock({
      planId: session.planId,
      latestDraft: session.latestDraft as Record<string, unknown>,
      session,
      userMessage: "把子任务都指派给合适的人",
    });
    expect(block).toContain("actionHints:");
    expect(block).toContain("assignAction");
    expect(block).toContain("taskIndexMap");
  });
});

describe("readOrchestratorEngine", () => {
  beforeEach(() => {
    vi.stubEnv("ORCHESTRATOR_ENGINE", "legacy");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to legacy", () => {
    expect(readOrchestratorEngine()).toBe("legacy");
  });

  it("reads v2", () => {
    vi.stubEnv("ORCHESTRATOR_ENGINE", "v2");
    expect(readOrchestratorEngine()).toBe("v2");
  });
});
