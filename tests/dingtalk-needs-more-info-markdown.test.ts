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

  it("prepends assistant message without bullets and dedupes exact duplicates", () => {
    expect(formatNeedsMoreInfoDingTalkMarkdown(["你好"], "你好")).toBe("你好");
    expect(
      formatNeedsMoreInfoDingTalkMarkdown(
        ["补充现象", "补充范围"],
        "请补充关键信息。"
      )
    ).toBe("请补充关键信息。\n\n补充现象\n\n补充范围");
    expect(formatNeedsMoreInfoDingTalkMarkdown(["补充现象"])).toBe("补充现象");
  });
});
