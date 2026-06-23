import { describe, expect, it } from "vitest";

import {
  personBriefsToMap,
  resolvePersonBriefForEmployee,
} from "../../../src/agent/daily-report-digest/daily-report-project-view-person-briefs";

describe("daily-report-project-view-person-briefs", () => {
  it("personBriefsToMap indexes by name", () => {
    const map = personBriefsToMap([
      { name: "张三", brief: "完成样机调试" },
      { name: "李四", brief: "更新 DHF 文档" },
    ]);
    expect(map.get("张三")).toBe("完成样机调试");
    expect(map.get("李四")).toBe("更新 DHF 文档");
  });

  it("resolvePersonBriefForEmployee matches name then userid", () => {
    const map = personBriefsToMap([{ name: "王五", brief: "推进试产" }]);
    expect(resolvePersonBriefForEmployee("王五", "uid1", map)).toBe("推进试产");
    expect(resolvePersonBriefForEmployee("未知", "uid1", map)).toBeUndefined();
  });
});
