import { describe, expect, it } from "vitest";
import { summarizePriorDemoForPrompt } from "../../src/infra/session-digest";

describe("summarizePriorDemoForPrompt", () => {
  it("summarizes NEEDS_MORE_INFO outcomes", () => {
    const digest = summarizePriorDemoForPrompt({
      status: "NEEDS_MORE_INFO",
      questions: ["请给批次号"],
      missingFields: ["batch"],
    });
    expect(digest).toContain("NEEDS_MORE_INFO");
    expect(digest).toContain("请给批次号");
    expect(digest).toContain("上轮上下文");
  });
});
