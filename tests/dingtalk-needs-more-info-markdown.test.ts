import { describe, expect, it } from "vitest";
import { formatNeedsMoreInfoDingTalkMarkdown } from "../src/dingtalk-needs-more-info-markdown";

describe("formatNeedsMoreInfoDingTalkMarkdown", () => {
  it("joins questions with blank lines — no list bullets or auto header", () => {
    expect(
      formatNeedsMoreInfoDingTalkMarkdown(["请先说明现象？", "批次与数量？"])
    ).toBe("请先说明现象？\n\n批次与数量？");
    expect(formatNeedsMoreInfoDingTalkMarkdown(["仅一条"])).toBe("仅一条");
    expect(formatNeedsMoreInfoDingTalkMarkdown(["a", "b"])).not.toContain("- ");
    expect(formatNeedsMoreInfoDingTalkMarkdown(["a", "b"])).not.toContain("需要补充信息");
  });
});
