import { afterEach, describe, expect, it } from "vitest";
import { redactCommonPii } from "../../src/infra/content-filter";

describe("redactCommonPii", () => {
  afterEach(() => {
    process.env.CONTENT_FILTER_DISABLED = "1";
  });

  it("masks mobile, id, and ipv4", () => {
    delete process.env.CONTENT_FILTER_DISABLED;
    const raw =
      "联系 13800138000 / 备用 13900000000 与地址 192.168.1.1 身份证号 110101199003076512";
    expect(redactCommonPii(raw)).not.toMatch(/13800138000/);
    expect(redactCommonPii(raw)).toContain("[已脱敏]");
    expect(redactCommonPii(raw)).not.toMatch(/192\.168\.1\.1/);
    expect(redactCommonPii(raw)).not.toMatch(/110101199003076512/i);
  });
});
