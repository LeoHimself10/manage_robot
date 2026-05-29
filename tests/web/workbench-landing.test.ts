import { describe, expect, it } from "vitest";

import { renderWorkbenchRootLandingHtml } from "../../src/web/workbench-landing";

describe("renderWorkbenchRootLandingHtml", () => {
  it("serves DingTalk auto-login entry (not a role menu)", () => {
    const html = renderWorkbenchRootLandingHtml();
    expect(html).toContain("任务规划工作台");
    expect(html).toContain("workbench-dd-login.js");
    expect(html).toContain("__wbTryDingTalkLogin");
    expect(html).not.toContain("wb-login-link-card");
    expect(html).not.toContain("/workbench/manager/chat");
    expect(html).not.toContain("/workbench/employee?view=new");
  });
});
