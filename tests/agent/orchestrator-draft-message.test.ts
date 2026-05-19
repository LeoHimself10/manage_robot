import { describe, expect, it } from "vitest";
import { synthesizeMessageFromDraft } from "../../src/agent/orchestrator-draft-message";

describe("synthesizeMessageFromDraft", () => {
  it("builds short summary when model omits message", () => {
    const msg = synthesizeMessageFromDraft({
      title: "U盘稳定性排查",
      objective: "一周内完成根因分析",
      tasks: [{ id: "task_1", title: "复现", timeNode: { dueAt: "2026-05-25" } }],
    });
    expect(msg).toContain("U盘稳定性排查");
    expect(msg).toContain("子任务");
    expect(msg).toContain("2026-05-25");
  });
});
