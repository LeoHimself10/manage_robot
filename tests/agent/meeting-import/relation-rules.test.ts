import { describe, expect, it } from "vitest";
import {
  defaultSelectedForRelation,
  levenshteinSimilarity,
  rulePrefilterRelation,
  titleContains,
} from "../../../src/agent/meeting-import/relation-rules";

describe("meeting-import relation-rules", () => {
  it("detects duplicate by exact normalized title", () => {
    const hit = rulePrefilterRelation({
      itemTitle: "提交注册资料",
      itemExcerpt: "提交注册资料",
      subtasks: [
        {
          taskNo: "T001",
          taskTitle: "注册申报",
          subtaskId: "st-1",
          title: "提交注册资料",
        },
      ],
    });
    expect(hit.relationKind).toBe("duplicate");
    expect(defaultSelectedForRelation(hit.relationKind)).toBe(false);
  });

  it("detects contained relationship", () => {
    expect(titleContains("邮件沟通", "完成供应商书面反馈含邮件沟通")).toBe(true);
    const hit = rulePrefilterRelation({
      itemTitle: "邮件沟通",
      itemExcerpt: "邮件沟通",
      subtasks: [
        {
          taskNo: "T002",
          taskTitle: "供应商沟通",
          subtaskId: "st-2",
          title: "完成供应商书面反馈含邮件沟通",
        },
      ],
    });
    expect(hit.relationKind).toBe("contained");
  });

  it("returns none when no overlap", () => {
    const hit = rulePrefilterRelation({
      itemTitle: "全新任务",
      itemExcerpt: "完全不同的工作",
      subtasks: [
        {
          taskNo: "T003",
          taskTitle: "其他",
          subtaskId: "st-3",
          title: "OCT 测试报告",
        },
      ],
    });
    expect(hit.relationKind).toBe("none");
    expect(levenshteinSimilarity("abc", "xyz")).toBeLessThan(0.5);
  });
});
