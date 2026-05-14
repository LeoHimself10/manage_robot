import { describe, expect, it } from "vitest";
import {
  inferConversationTitleFromSession,
  truncateConversationPreview,
} from "../../src/infra/conversation-present";
import type { PlanSession } from "../../src/infra/plan-session-store";

function baseSession(overrides: Partial<PlanSession>): PlanSession {
  return {
    chatKeyHash: "h",
    planId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    knownFacts: [],
    conversationHistory: [],
    ...overrides,
  };
}

describe("conversation-present", () => {
  it("truncateConversationPreview collapses whitespace and caps length", () => {
    expect(truncateConversationPreview("  hello world  ", 5)).toBe("hello…");
  });

  it("inferConversationTitleFromSession prefers first user message", () => {
    const s = baseSession({
      conversationHistory: [{ role: "user", content: "  产线停线需要根因分析  " }],
    });
    expect(inferConversationTitleFromSession(s)).toContain("产线停线");
  });

  it("inferConversationTitleFromSession falls back to draft title", () => {
    const s = baseSession({
      conversationHistory: [{ role: "assistant", content: "hi" }],
      latestDraft: { title: "CAPA 草案标题" },
    });
    expect(inferConversationTitleFromSession(s)).toContain("CAPA");
  });

  it("inferConversationTitleFromSession falls back to short id", () => {
    const s = baseSession({
      planId: "11111111-2222-3333-4444-555555555555",
      conversationHistory: [],
    });
    expect(inferConversationTitleFromSession(s)).toContain("11111111");
  });
});
