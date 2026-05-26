import { describe, expect, it } from "vitest";
import { resolveMessageDisplayContent } from "../../src/view/resolve-message-display-content";
import type { PlanSession } from "../../src/infra/plan-session-store";

describe("resolveMessageDisplayContent", () => {
  it("prefers displayContent when present", () => {
    const session: PlanSession = {
      chatKeyHash: "h",
      planId: "p",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      knownFacts: [],
      conversationHistory: [],
    };
    const out = resolveMessageDisplayContent(
      { role: "assistant", content: "raw", displayContent: "full **table**" },
      session,
      0,
      [{ role: "assistant", content: "raw", displayContent: "full **table**" }],
    );
    expect(out).toBe("full **table**");
  });
});
