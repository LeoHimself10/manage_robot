import { describe, expect, it } from "vitest";
import { adviseCapa } from "../../../src/agent/demo/capa-advisor";

describe("adviseCapa", () => {
  it("recommends CAPA assessment for customer field issues with unclear impact", () => {
    const advisory = adviseCapa({
      domain: "QUALITY",
      subtype: "CUSTOMER_COMPLAINT_OR_FIELD_ISSUE",
      background: "客户现场反馈设备间歇性报警，影响范围和批次尚未确认。",
    });

    expect(advisory.advisory).toBe("RECOMMENDED");
    expect(advisory.disclaimer).toContain("最终是否开启 CAPA");
  });

  it("recommends CAPA assessment for customer field subtype even without customer keywords", () => {
    const advisory = adviseCapa({
      domain: "QUALITY",
      subtype: "CUSTOMER_COMPLAINT_OR_FIELD_ISSUE",
      background: "设备间歇性报警，影响范围尚未确认。",
    });

    expect(advisory.advisory).toBe("RECOMMENDED");
  });

  it("returns insufficient information for very thin customer field subtype input", () => {
    const advisory = adviseCapa({
      domain: "QUALITY",
      subtype: "CUSTOMER_COMPLAINT_OR_FIELD_ISSUE",
      background: "报警",
    });

    expect(advisory.advisory).toBe("INSUFFICIENT_INFO");
    expect(advisory.promptingQuestions.length).toBeGreaterThan(0);
  });

  it("returns insufficient information for thin quality input", () => {
    const advisory = adviseCapa({
      domain: "QUALITY",
      subtype: "QUALITY_OTHER_OR_UNCERTAIN",
      background: "有个质量问题。",
    });

    expect(advisory.advisory).toBe("INSUFFICIENT_INFO");
    expect(advisory.promptingQuestions.length).toBeGreaterThan(0);
  });

  it("does not require CAPA for R&D-only tasks", () => {
    const advisory = adviseCapa({
      domain: "RD",
      subtype: "VERIFICATION_AND_VALIDATION",
      background: "制定 V&V 测试方案。",
    });

    expect(advisory.advisory).toBe("NOT_REQUIRED");
  });
});
