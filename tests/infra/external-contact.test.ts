import { describe, expect, it } from "vitest";
import { isExternalContact } from "../../src/infra/external-contact";

describe("isExternalContact", () => {
  it("detects ext_ userId prefix", () => {
    expect(isExternalContact("ext_wuchuanbin")).toBe(true);
  });

  it("detects raw_json source external_manual", () => {
    expect(
      isExternalContact("custom-id", { userId: "custom-id", rawJson: { source: "external_manual" } }),
    ).toBe(true);
  });

  it("returns false for normal dingtalk contacts", () => {
    expect(isExternalContact("641871342", { userId: "641871342", rawJson: {} })).toBe(false);
  });
});
