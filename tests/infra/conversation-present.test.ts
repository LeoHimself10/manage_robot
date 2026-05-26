import { describe, expect, it } from "vitest";
import {
  MAIN_THREAD_TITLE,
  buildThreadListItem,
  formatSideThreadDefaultTitle,
  inferSideThreadTitle,
} from "../../src/infra/conversation-present";
import type { PlanSession } from "../../src/infra/plan-session-store";

function baseSession(partial: Partial<PlanSession> = {}): PlanSession {
  return {
    chatKeyHash: "hash",
    planId: "plan-1",
    createdAt: "2026-05-25T06:00:00.000Z",
    updatedAt: "2026-05-25T06:00:00.000Z",
    knownFacts: [],
    conversationHistory: [],
    ...partial,
  };
}

describe("conversation-present thread titles", () => {
  it("buildThreadListItem uses fixed title for main thread", () => {
    const item = buildThreadListItem(
      baseSession({
        threadKind: "main",
        threadId: "main",
        conversationId: "conv-1",
      }),
    );
    expect(item.title).toBe(MAIN_THREAD_TITLE);
    expect(item.pinned).toBe(true);
    expect(item.badge).toBe("主线程");
  });

  it("inferSideThreadTitle uses first user message when present", () => {
    const title = inferSideThreadTitle(
      baseSession({
        threadKind: "side",
        threadLabel: formatSideThreadDefaultTitle(new Date("2026-05-25T06:00:00.000Z")),
        conversationHistory: [{ role: "user", content: "帮我规划 Q2 质量复盘" }],
      }),
    );
    expect(title).toBe("帮我规划 Q2 质量复盘");
  });

  it("buildThreadListItem side uses default label before user message", () => {
    const label = "新规划会话 · 05-25 14:30";
    const item = buildThreadListItem(
      baseSession({
        threadKind: "side",
        threadId: "side-uuid",
        threadLabel: label,
      }),
    );
    expect(item.title).toBe(label);
    expect(item.badge).toBe("侧会话");
  });

  it("inferSideThreadTitle prefers user-renamed label over first message", () => {
    const title = inferSideThreadTitle(
      baseSession({
        threadKind: "side",
        threadLabel: "我的专项规划",
        conversationHistory: [{ role: "user", content: "帮我规划 Q2 质量复盘" }],
      }),
    );
    expect(title).toBe("我的专项规划");
  });

  it("buildThreadListItem exposes hasDraft when latestDraft has tasks", () => {
    const item = buildThreadListItem(
      baseSession({
        threadKind: "side",
        threadId: "side-2",
        latestDraft: { tasks: [{ id: "t1", title: "子任务" }] },
      }),
    );
    expect(item.hasDraft).toBe(true);
  });
});
