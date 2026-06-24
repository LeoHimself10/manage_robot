import { describe, expect, it } from "vitest";
import { isRdDailyTemplate } from "../../../src/agent/daily-report-digest/daily-report-rd-template-gate";

describe("isRdDailyTemplate", () => {
  it("accepts three R&D template name variants", () => {
    expect(isRdDailyTemplate("研发中心日志（总结及计划）模板")).toBe(true);
    expect(isRdDailyTemplate("研发管理者日志模板")).toBe(true);
    expect(isRdDailyTemplate("研发试用期日志模版")).toBe(true);
    expect(isRdDailyTemplate("研发试用期日志模板")).toBe(true);
  });

  it("rejects medical affairs and empty", () => {
    expect(isRdDailyTemplate("医学事务部日志")).toBe(false);
    expect(isRdDailyTemplate("")).toBe(false);
  });
});
