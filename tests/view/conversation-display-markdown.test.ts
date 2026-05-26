import { describe, expect, it } from "vitest";
import { buildAssistantDisplayMarkdown } from "../../src/view/conversation-display-markdown";

describe("buildAssistantDisplayMarkdown", () => {
  it("appends structured task table when draft has tasks", () => {
    const md = buildAssistantDisplayMarkdown({
      modelMessage: "草案说明",
      currentDraft: {
        tasks: [
          {
            id: "task_1",
            title: "子任务一",
            objective: "目标",
            deliverables: ["交付物"],
            completionCriteria: ["标准"],
            timeNode: { dueAt: "2026-06-30" },
          },
        ],
      },
      shouldRenderRichSection: true,
      appendStructuredTaskTable: true,
    });
    expect(md).toContain("### 结构化任务表");
    expect(md).toContain("子任务一");
  });

  it("strips broken inline pipe table from model message", () => {
    const md = buildAssistantDisplayMarkdown({
      modelMessage: "| # | 任务 | | 1 | 某任务 |",
      currentDraft: { tasks: [{ id: "task_1", title: "OK" }] },
      shouldRenderRichSection: true,
      appendStructuredTaskTable: true,
    });
    expect(md).toContain("### 结构化任务表");
  });
});
