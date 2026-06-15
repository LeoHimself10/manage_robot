import { describe, expect, it, vi } from "vitest";
import type { PlanSession } from "../../../src/infra/plan-session-store";
import {
  buildV2DraftRetryUserMessage,
  buildV2PatchRetryUserMessage,
  detectV2MissingDraftMutation,
  detectV2MissingPatch,
  mergeV2GraphResults,
  needsV2PublishRetry,
  needsV2RosterAssignRetry,
  pickV2Retry,
  pickV2RetryUserMessage,
} from "../../../src/agent/v2/turn-requirements";
import type { V2GraphRunResult } from "../../../src/agent/v2/graph";

function baseSession(overrides: Partial<PlanSession> = {}): PlanSession {
  return {
    chatKeyHash: "h",
    planId: "plan-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    conversationHistory: [],
    knownFacts: [],
    ...overrides,
  };
}

function emptyGraphResult(overrides: Partial<V2GraphRunResult> = {}): V2GraphRunResult {
  return {
    traceId: "t1",
    finalMessage: "ok",
    toolInvocationNames: [],
    toolCallsTotal: 0,
    observabilityFlags: [],
    timing: { totalMs: 1, llmMsTotal: 1, toolsMsTotal: 0, iterations: [] },
    ...overrides,
  };
}

describe("v2 turn-requirements", () => {
  describe("needsV2PublishRetry", () => {
    it("returns true for 确认发放 without publish_task", () => {
      expect(
        needsV2PublishRetry({
          userMessage: "确认发放",
          session: baseSession(),
          toolInvocationNames: [],
          outboundMarkdown: "好的",
          assignCoverage: { total: 0, covered: 0 },
          missingTaskIds: [],
        }),
      ).toBe(true);
    });

    it("returns false when allowPublishRetry is false", () => {
      expect(
        needsV2PublishRetry({
          userMessage: "确认发放",
          session: baseSession(),
          toolInvocationNames: [],
          outboundMarkdown: "好的",
          assignCoverage: { total: 0, covered: 0 },
          missingTaskIds: [],
          retryOpts: { allowPublishRetry: false },
        }),
      ).toBe(false);
    });
  });

  describe("detectV2MissingPatch", () => {
    it("detects row patch intent without update_draft_task", () => {
      expect(
        detectV2MissingPatch({
          userMessage: "任务2改成2026-05-28前完成，负责人换成杨贺新，只改这一行。",
          toolInvocationNames: [],
        }),
      ).toBe(true);
    });

    it("returns false when update_draft_task was called", () => {
      expect(
        detectV2MissingPatch({
          userMessage: "任务2改成2026-05-28前完成，负责人换成杨贺新，只改这一行。",
          toolInvocationNames: ["update_draft_task"],
        }),
      ).toBe(false);
    });
  });

  describe("needsV2RosterAssignRetry", () => {
    it("returns true with candidatePool and partial coverage", () => {
      vi.stubEnv("ASSIGNMENT_PHASE_ENABLED", "1");
      expect(
        needsV2RosterAssignRetry({
          userMessage: "按花名册把子任务分给姚雪峰和杨贺新",
          session: baseSession({
            candidatePool: {
              source: "roster",
              entries: [{ userId: "u1", displayName: "姚雪峰", fileNotes: "硬件" }],
              unresolved: [],
              updatedAt: new Date().toISOString(),
            },
          }),
          toolInvocationNames: ["set_candidate_pool"],
          outboundMarkdown: "已分派",
          assignCoverage: { total: 3, covered: 1 },
          missingTaskIds: ["task_2", "task_3"],
        }),
      ).toBe(true);
      vi.unstubAllEnvs();
    });
  });

  describe("pickV2RetryUserMessage priority", () => {
    it("roster assign retry beats split retry when pool exists", () => {
      vi.stubEnv("ASSIGNMENT_PHASE_ENABLED", "1");
      const msg = pickV2RetryUserMessage({
        userMessage: "按花名册把任务2拆成2条并分给姚雪峰",
        session: baseSession({
          candidatePool: {
            source: "roster",
            entries: [{ userId: "u1", displayName: "姚雪峰", fileNotes: "硬件" }],
            unresolved: [],
            updatedAt: new Date().toISOString(),
          },
          latestDraft: {
            title: "t",
            tasks: [
              { id: "task_1", title: "a" },
              { id: "task_2", title: "b" },
            ],
          },
        }),
        preTurnDraft: {
          tasks: [
            { id: "task_1", title: "a" },
            { id: "task_2", title: "b" },
          ],
        },
        persistedDraft: {
          tasks: [
            { id: "task_1", title: "a" },
            { id: "task_2", title: "b" },
          ],
        },
        toolInvocationNames: [],
        outboundMarkdown: "已拆并分派",
        assignCoverage: { total: 2, covered: 0 },
        missingTaskIds: ["task_1", "task_2"],
      });
      expect(msg).toContain("[roster_assign_retry_required]");
      vi.unstubAllEnvs();
    });

    it("publish retry beats assign retry", () => {
      const msg = pickV2RetryUserMessage({
        userMessage: "确认发放",
        session: baseSession({
          latestDraft: {
            title: "t",
            description: "d",
            tasks: [{ id: "task_1", title: "a", objective: "o", deliverables: ["d"], completionCriteria: ["c"] }],
            stagedBy: "prepare_publish_task",
          },
        }),
        preTurnDraft: { tasks: [{ id: "task_1" }] },
        persistedDraft: { tasks: [{ id: "task_1" }] },
        toolInvocationNames: [],
        outboundMarkdown: "已发放",
        assignCoverage: { total: 1, covered: 0 },
        missingTaskIds: ["task_1"],
      });
      expect(msg).toContain("[publishStagingAction]");
    });

    it("split retry when row split intent but no add_draft_subtask", () => {
      const msg = pickV2RetryUserMessage({
        userMessage: "把任务2拆成2条",
        session: baseSession({
          latestDraft: {
            title: "t",
            tasks: [
              { id: "task_1", title: "a" },
              { id: "task_2", title: "b" },
            ],
          },
        }),
        preTurnDraft: {
          tasks: [
            { id: "task_1", title: "a" },
            { id: "task_2", title: "b" },
          ],
        },
        persistedDraft: {
          tasks: [
            { id: "task_1", title: "a" },
            { id: "task_2", title: "b" },
          ],
        },
        toolInvocationNames: [],
        outboundMarkdown: "已拆成两条",
        assignCoverage: { total: 0, covered: 0 },
        missingTaskIds: [],
      });
      expect(msg).toContain("[split_retry_required]");
    });

    it("patch retry when row patch intent but no tools", () => {
      const msg = pickV2RetryUserMessage({
        userMessage: "任务2改成2026-05-28前完成，负责人换成杨贺新，只改这一行。",
        session: baseSession({
          latestDraft: {
            title: "t",
            tasks: [
              { id: "task_1", title: "a" },
              { id: "task_2", title: "b" },
            ],
          },
        }),
        preTurnDraft: {
          tasks: [
            { id: "task_1", title: "a" },
            { id: "task_2", title: "b" },
          ],
        },
        persistedDraft: {
          tasks: [
            { id: "task_1", title: "a" },
            { id: "task_2", title: "b" },
          ],
        },
        toolInvocationNames: [],
        outboundMarkdown: "已改好",
        assignCoverage: { total: 0, covered: 0 },
        missingTaskIds: [],
      });
      expect(msg).toBe(buildV2PatchRetryUserMessage({
        originalUserMessage: "任务2改成2026-05-28前完成，负责人换成杨贺新，只改这一行。",
        taskIndexMap: [
          { n: 1, id: "task_1", title: "a" },
          { n: 2, id: "task_2", title: "b" },
        ],
      }));
    });

    it("draft retry after post-clarify supplement without tools", () => {
      const session = baseSession({
        conversationHistory: [
          { role: "assistant", content: "请补充型号批次与期望完成时间？" },
        ],
      });
      expect(
        detectV2MissingDraftMutation({
          userMessage: "型号A100，批次B2026-03，2周内完成，请拆成4条子任务并给出草案。",
          session,
          preTurnDraft: undefined,
          postTurnDraft: undefined,
          toolInvocationNames: [],
        }),
      ).toBe(true);

      const msg = pickV2RetryUserMessage({
        userMessage: "型号A100，批次B2026-03，2周内完成，请拆成4条子任务并给出草案。",
        session,
        toolInvocationNames: [],
        outboundMarkdown: "好的我会拆",
        assignCoverage: { total: 0, covered: 0 },
        missingTaskIds: [],
      });
      expect(msg).toBe(buildV2DraftRetryUserMessage(
        "型号A100，批次B2026-03，2周内完成，请拆成4条子任务并给出草案。",
      ));
    });

    it("draft retry when post-clarify supplement has fewer than minTasks", () => {
      const session = baseSession({
        conversationHistory: [
          { role: "assistant", content: "请补充型号批次与期望完成时间？" },
        ],
      });
      const longMsg =
        "型号A100，批次B2026-03，希望一个月内完成根因分析和改进建议，请拆成至少4条子任务并给出正式草案表格，每条须含可验收交付物、明确截止节点与负责人建议。";
      expect(
        detectV2MissingDraftMutation({
          userMessage: longMsg,
          session,
          preTurnDraft: undefined,
          postTurnDraft: { tasks: [{ id: "task_1", title: "a" }] },
          toolInvocationNames: [],
        }),
      ).toBe(true);
    });

    it("general assign retry does not duplicate roster path", () => {
      vi.stubEnv("ASSIGNMENT_PHASE_ENABLED", "1");
      const msg = pickV2RetryUserMessage({
        userMessage: "把子任务都指派给合适的人",
        session: baseSession({
          candidatePool: {
            source: "roster",
            entries: [{ userId: "u1", displayName: "姚雪峰", fileNotes: "硬件" }],
            unresolved: [],
            updatedAt: new Date().toISOString(),
          },
          latestDraft: {
            title: "t",
            tasks: [{ id: "task_1", title: "a", objective: "o", deliverables: ["d"], completionCriteria: ["c"] }],
          },
        }),
        preTurnDraft: { tasks: [{ id: "task_1" }] },
        persistedDraft: { tasks: [{ id: "task_1" }] },
        toolInvocationNames: [],
        outboundMarkdown: "已指派",
        assignCoverage: { total: 1, covered: 0 },
        missingTaskIds: ["task_1"],
      });
      expect(msg).toContain("[roster_assign_retry_required]");
      expect(msg).not.toContain("[assign_retry_required]");
      vi.unstubAllEnvs();
    });
  });

  describe("pickV2Retry — Rule 1 skip matrix (gateReason)", () => {
    it("whole_table_redraft gate blocks split retry", () => {
      const result = pickV2Retry({
        userMessage: "把任务2拆成2条",
        session: baseSession({
          latestDraft: {
            title: "t",
            tasks: [
              { id: "task_1", title: "a" },
              { id: "task_2", title: "b" },
            ],
          },
        }),
        preTurnDraft: {
          tasks: [
            { id: "task_1", title: "a" },
            { id: "task_2", title: "b" },
          ],
        },
        persistedDraft: {
          tasks: [
            { id: "task_1", title: "a" },
            { id: "task_2", title: "b" },
          ],
        },
        toolInvocationNames: [],
        outboundMarkdown: "已拆成两条",
        assignCoverage: { total: 0, covered: 0 },
        missingTaskIds: [],
        gateReason: "auto:whole_table_redraft",
      });
      // split should be blocked → falls through to no match
      expect(result?.kind).not.toBe("split");
    });

    it("row_split_forced gate blocks assign retry", () => {
      vi.stubEnv("ASSIGNMENT_PHASE_ENABLED", "1");
      const result = pickV2Retry({
        userMessage: "按花名册把子任务分给姚雪峰和杨贺新",
        session: baseSession({
          candidatePool: {
            source: "roster",
            entries: [{ userId: "u1", displayName: "姚雪峰", fileNotes: "硬件" }],
            unresolved: [],
            updatedAt: new Date().toISOString(),
          },
        }),
        toolInvocationNames: [],
        outboundMarkdown: "已分派",
        assignCoverage: { total: 3, covered: 1 },
        missingTaskIds: ["task_2", "task_3"],
        gateReason: "row_split_forced",
      });
      expect(result?.kind).not.toBe("roster_assign");
      expect(result?.kind).not.toBe("assign");
      vi.unstubAllEnvs();
    });

    it("no gateReason → no blocking (backward compat)", () => {
      vi.stubEnv("ASSIGNMENT_PHASE_ENABLED", "1");
      const result = pickV2Retry({
        userMessage: "按花名册把子任务分给姚雪峰",
        session: baseSession({
          candidatePool: {
            source: "roster",
            entries: [{ userId: "u1", displayName: "姚雪峰", fileNotes: "硬件" }],
            unresolved: [],
            updatedAt: new Date().toISOString(),
          },
        }),
        toolInvocationNames: [],
        outboundMarkdown: "已分派",
        assignCoverage: { total: 3, covered: 1 },
        missingTaskIds: ["task_2", "task_3"],
      });
      expect(result?.kind).toBe("roster_assign");
      vi.unstubAllEnvs();
    });

    it("pickV2Retry returns {message, kind} tuple", () => {
      vi.stubEnv("ASSIGNMENT_PHASE_ENABLED", "1");
      const result = pickV2Retry({
        userMessage: "确认发放",
        session: baseSession({
          latestDraft: {
            title: "t",
            description: "d",
            tasks: [{ id: "task_1", title: "a" }],
            stagedBy: "prepare_publish_task",
          },
        }),
        preTurnDraft: { tasks: [{ id: "task_1" }] },
        persistedDraft: { tasks: [{ id: "task_1" }] },
        toolInvocationNames: [],
        outboundMarkdown: "已发放",
        assignCoverage: { total: 1, covered: 0 },
        missingTaskIds: ["task_1"],
      });
      expect(result).toBeDefined();
      expect(result?.kind).toBeDefined();
      expect(typeof result?.message).toBe("string");
      expect(result?.message.length).toBeGreaterThan(0);
      vi.unstubAllEnvs();
    });
  });

  describe("mergeV2GraphResults", () => {
    it("merges tool calls and prefers successful publish from second run", () => {
      const merged = mergeV2GraphResults(
        emptyGraphResult({ toolInvocationNames: ["prepare_publish_task"], finalMessage: "a" }),
        emptyGraphResult({
          toolInvocationNames: ["publish_task"],
          finalMessage: "b",
          publishResult: { ok: true },
        }),
      );
      expect(merged.toolInvocationNames).toEqual(["prepare_publish_task", "publish_task"]);
      expect(merged.finalMessage).toBe("b");
      expect(merged.publishResult).toEqual({ ok: true });
      expect(merged.observabilityFlags).toContain("v2_turn_requirement_retry");
    });
  });
});
