import { describe, expect, it } from "vitest";
import { formatNeedsMoreInfoDingTalkMarkdown } from "../src/dingtalk-needs-more-info-markdown";

describe("formatNeedsMoreInfoDingTalkMarkdown", () => {
  it("returns markdown bullets only — no automatic header line", () => {
    expect(
      formatNeedsMoreInfoDingTalkMarkdown(["请先说明现象？", "批次与数量？"])
    ).toBe("- 请先说明现象？\n- 批次与数量？");
    expect(formatNeedsMoreInfoDingTalkMarkdown(["仅一条"])).toBe("- 仅一条");
    expect(formatNeedsMoreInfoDingTalkMarkdown(["a", "b"])).not.toContain("需要补充信息");
  });
});
