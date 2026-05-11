import { describe, expect, it } from "vitest";

import { renderWorkbenchRootLandingHtml } from "../../src/web/workbench-landing";

describe("renderWorkbenchRootLandingHtml", () => {
  it("includes workbench paths and health probe hint", () => {
    const html = renderWorkbenchRootLandingHtml();
    expect(html).toContain("任务规划工作台");
    expect(html).toContain("/workbench/manager");
    expect(html).toContain("/health");
    expect(html).toContain("token");
  });
});
