import { describe, expect, it } from "vitest";

import {
  renderConversationCenterPage,
  renderEmployeePage,
  renderInProgressPage,
  renderManagerPage,
} from "../../src/web/workbench-pages";

describe("workbench page renderers", () => {
  it("renders manager page with task filters section", () => {
    const html = renderManagerPage({ userName: "主管A", tasks: [] });

    expect(html).toContain("分配与追踪中心");
    expect(html).toContain("筛选");
  });

  it("renders employee page with personal task label", () => {
    const html = renderEmployeePage({ userName: "员工A", tasks: [] });

    expect(html).toContain("我的任务");
    expect(html).toContain("员工A");
  });

  it("renders conversation center with two modes", () => {
    const html = renderConversationCenterPage();

    expect(html).toContain("开启新任务");
    expect(html).toContain("编辑进行中任务");
  });

  it("renders in-progress page with session queue label", () => {
    const html = renderInProgressPage({ userName: "主管A", sessions: [] });

    expect(html).toContain("进行中任务");
    expect(html).toContain("主管A");
  });
});
