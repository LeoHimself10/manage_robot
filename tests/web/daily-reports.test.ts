import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildDailyReportsHttpPayload } from "../../src/web/daily-reports-api";
import { renderEmployeeWorkbenchPage } from "../../src/web/employee-workbench-pages";
import { renderDailyReportsPage } from "../../src/web/daily-reports-page";
import { isDailyReportsPageEnabled } from "../../src/agent/daily-report-digest/daily-reports-page-flag";

const CONFIG = {
  title: "每日日报汇总",
  timezone: "Asia/Shanghai",
  webhook: { accessToken: "tok123", secret: "SECabc" },
  orgs: [
    {
      label: "明思",
      appKey: "ak-ming",
      appSecret: "as-ming",
      employees: [
        { userid: "u_a", name: "张三" },
        { userid: "u_b", name: "李四" },
      ],
    },
    {
      label: "微光",
      appKey: "ak-wei",
      appSecret: "as-wei",
      employees: [{ userid: "u_c", name: "王五" }],
    },
  ],
};

function jsonRes(obj: unknown) {
  return { ok: true, status: 200, json: async () => obj } as unknown as Response;
}

function fakeFetch(reportsByUserid: Record<string, Array<Record<string, unknown>>>) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (u.includes("oauth2/accessToken")) {
      return jsonRes({ accessToken: `tok-${body.appKey}`, expireIn: 7200 });
    }
    if (u.includes("topapi/report/list")) {
      return jsonRes({
        errcode: 0,
        result: { data_list: reportsByUserid[body.userid] ?? [], has_more: false, next_cursor: 0 },
      });
    }
    return jsonRes({ errcode: 404 });
  }) as unknown as typeof fetch;
}

describe("daily-reports-api", () => {
  let configPath = "";

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "daily-reports-api-"));
    configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify(CONFIG), "utf8");
    process.env.DAILY_REPORT_DIGEST_CONFIG_FILE = configPath;
  });

  afterEach(() => {
    delete process.env.DAILY_REPORT_DIGEST_CONFIG_FILE;
  });

  it("builds a structured payload for a given date with submitted + missing", async () => {
    const fetchImpl = fakeFetch({
      u_a: [
        {
          creator_id: "u_a",
          creator_name: "张三",
          template_name: "日报",
          create_time: Date.parse("2026-06-08T10:00:00+08:00"),
          contents: [{ key: "今日工作", value: "完成了 A 模块" }],
        },
      ],
    });
    const payload = await buildDailyReportsHttpPayload({ date: "2026-06-08", view: "company", fetchImpl });

    expect(payload.ok).toBe(true);
    expect(payload.date).toBe("2026-06-08");
    expect(payload.view).toBe("company");
    expect(payload.orgs).toHaveLength(2);
    expect(payload.projectGroups).toBeUndefined();
    expect(payload.submittedCount).toBe(1);
    expect(payload.missingCount).toBe(2);
    const mingsi = payload.orgs!.find((o) => o.label === "明思")!;
    expect(mingsi.submitted[0]!.name).toBe("张三");
    expect(mingsi.submitted[0]!.reports[0]!.contents[0]!.value).toBe("完成了 A 模块");
    expect(mingsi.missing.map((m) => m.userid)).toEqual(["u_b"]);
  });

  it("returns projectGroups when view=project", async () => {
    const fetchImpl = fakeFetch({});
    const payload = await buildDailyReportsHttpPayload({ date: "2026-06-08", view: "project", fetchImpl });
    expect(payload.ok).toBe(true);
    expect(payload.view).toBe("project");
    expect(payload.projectGroups).toHaveLength(3);
    expect(payload.orgs).toBeUndefined();
    expect(payload.projectGroups!.map((g) => g.id)).toEqual(["intracranial", "brain", "ops"]);
  });

  it("rejects an invalid date format", async () => {
    const payload = await buildDailyReportsHttpPayload({ date: "06/08", fetchImpl: fakeFetch({}) });
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("非法日期");
  });

  it("returns configured:false when no config file is set", async () => {
    delete process.env.DAILY_REPORT_DIGEST_CONFIG_FILE;
    const payload = await buildDailyReportsHttpPayload({ date: "2026-06-08" });
    expect(payload.ok).toBe(false);
    expect(payload.configured).toBe(false);
  });
});

describe("daily-reports-page render", () => {
  it("renders the manager page with date input and unified API", () => {
    process.env.DAILY_REPORTS_PAGE_ENABLED = "1";
    const html = renderDailyReportsPage({
      role: "manager",
      activeNav: "mgr-daily-reports",
      userLabel: "测试",
    });
    expect(html).toContain('id="drDate"');
    expect(html).toContain('id="drContent"');
    expect(html).toContain('data-view="project"');
    expect(html).toContain('data-view="company"');
    expect(html).toContain("/api/workbench/daily-reports");
    expect(html).toContain('data-wb-nav="mgr-daily-reports"');
  });

  it("shows roster controls only for admin-capable users", () => {
    process.env.DAILY_REPORTS_PAGE_ENABLED = "1";
    const adminHtml = renderDailyReportsPage({
      role: "admin",
      activeNav: "adm-daily-reports",
      canManageRoster: true,
      canManageProjectGroups: true,
    });
    const mgrHtml = renderDailyReportsPage({
      role: "manager",
      activeNav: "mgr-daily-reports",
      canManageProjectGroups: true,
    });
    const empHtml = renderDailyReportsPage({
      role: "employee",
      activeNav: "emp-daily-reports",
      canManageRoster: false,
      canExecuteAsManager: false,
    });
    expect(adminHtml).toContain('id="drmToggle"');
    expect(adminHtml).toContain('id="dpgToggle"');
    expect(mgrHtml).not.toContain('id="drmToggle"');
    expect(mgrHtml).toContain('id="dpgToggle"');
    expect(empHtml).not.toContain('id="drmToggle"');
    expect(empHtml).not.toContain('id="dpgToggle"');
    expect(empHtml).not.toContain('id="navManager"');
    expect(empHtml).toContain("dr-role-employee");
  });

  it("pure employee workbench shell omits manager nav button", () => {
    process.env.DAILY_REPORTS_PAGE_ENABLED = "1";
    const html = renderEmployeeWorkbenchPage({ canExecuteAsManager: false });
    expect(html).not.toContain('id="navManager"');
  });
});

describe("isDailyReportsPageEnabled", () => {
  afterEach(() => {
    delete process.env.DAILY_REPORTS_PAGE_ENABLED;
  });

  it("defaults to off and turns on for truthy values", () => {
    delete process.env.DAILY_REPORTS_PAGE_ENABLED;
    expect(isDailyReportsPageEnabled()).toBe(false);
    process.env.DAILY_REPORTS_PAGE_ENABLED = "1";
    expect(isDailyReportsPageEnabled()).toBe(true);
    process.env.DAILY_REPORTS_PAGE_ENABLED = "0";
    expect(isDailyReportsPageEnabled()).toBe(false);
  });
});
