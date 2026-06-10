import { describe, expect, it } from "vitest";
import { stabilizeNewGroupSuggestions } from "../../../src/agent/task-intake/suggest-targets";

describe("stabilizeNewGroupSuggestions", () => {
  const subtasks = [
    { itemId: "ti_1" },
    { itemId: "ti_2" },
    { itemId: "ti_3" },
    { itemId: "ti_4" },
  ];

  it("collapses multiple new groups into one when parent title is explicit", () => {
    const suggestions = [
      { itemId: "ti_1", newGroupId: "ng_1", newGroupTitle: "组A", confidence: 0.9 },
      { itemId: "ti_2", newGroupId: "ng_2", newGroupTitle: "组B", confidence: 0.88 },
      { itemId: "ti_3", newGroupId: "ng_2", newGroupTitle: "组B", confidence: 0.88 },
      { itemId: "ti_4", newGroupId: "ng_3", newGroupTitle: "组C", confidence: 0.87 },
    ];
    const out = stabilizeNewGroupSuggestions({
      suggestions,
      subtasks,
      parentTitle: "6月内容交付跟进",
      parentDescription: "本批内容交付事项",
    });
    expect(out.every((s) => s.newGroupId === "ng_1")).toBe(true);
    expect(out.every((s) => s.newGroupTitle === "6月内容交付跟进")).toBe(true);
    expect(out[0]?.newGroupDescription).toBe("本批内容交付事项");
  });

  it("does not collapse when an existing task match is present", () => {
    const suggestions = [
      { itemId: "ti_1", targetPlanId: "plan-old", confidence: 0.9 },
      { itemId: "ti_2", newGroupId: "ng_2", newGroupTitle: "组B", confidence: 0.88 },
    ];
    const out = stabilizeNewGroupSuggestions({
      suggestions,
      subtasks: subtasks.slice(0, 2),
      parentTitle: "6月内容交付跟进",
    });
    expect(out[0]?.targetPlanId).toBe("plan-old");
    expect(out[1]?.newGroupId).toBe("ng_2");
  });

  it("leaves suggestions unchanged for generic parent title", () => {
    const suggestions = [
      { itemId: "ti_1", newGroupId: "ng_1", confidence: 0.9 },
      { itemId: "ti_2", newGroupId: "ng_2", confidence: 0.9 },
    ];
    const out = stabilizeNewGroupSuggestions({
      suggestions,
      subtasks: subtasks.slice(0, 2),
      parentTitle: "新建任务",
    });
    expect(out).toEqual(suggestions);
  });
});
