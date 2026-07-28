import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseDailyReportDigestConfig } from "../../../src/agent/daily-report-digest/daily-report-config";
import {
  buildAnalyzeEmployeeLogHoursHandler,
  buildGetEmployeeDailyReportsHandler,
} from "../../../src/agent/tools/competency-eval-tools";
import { buildToolRegistry } from "../../../src/agent/tools/registry";

const MOCK_CONFIG = parseDailyReportDigestConfig({
  timezone: "Asia/Shanghai",
  reportDayCutoffHour: 17,
  reportDayCutoffMinute: 0,
  orgs: [
    {
      label: "明思",
      appKey: "ak1",
      appSecret: "as1",
      templateName: "日报",
      employees: [{ userid: "u_a", name: "张三" }],
    },
  ],
}).config;

describe("competency-eval tools", () => {
  let dataDir = "";

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "competency-eval-tools-"));
    vi.stubEnv("COMPETENCY_EVAL_DATA_DIR", dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (dataDir) {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("get_employee_daily_reports rejects a user outside configured organisations", async () => {
    const handler = buildGetEmployeeDailyReportsHandler({
      actorUserId: "actor1",
      reportConfig: MOCK_CONFIG,
      contactDirectory: {
        search: vi.fn().mockResolvedValue([]),
        listAll: vi.fn().mockResolvedValue([]),
        invalidate: vi.fn(),
      },
    });

    const result = (await handler({
      userId: "unknown_user",
      startYmd: "2026-06-01",
      endYmd: "2026-06-07",
    })) as { ok: boolean; reason?: string };

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_in_configured_org");
  });

  it("registry competency_eval profile exposes expected tools when actor set", () => {
    const registry = buildToolRegistry({
      employeeRepo: { list: () => [] },
      toolProfile: "competency_eval",
      competencyEvalActorUserId: "actor1",
    });

    expect(Object.keys(registry).sort()).toEqual([
      "analyze_employee_log_hours",
      "get_current_time",
      "get_employee_daily_reports",
      "search_employees",
    ]);
  });

  it("analyze_employee_log_hours lets the model choose grouping and filters", async () => {
    const fetchReports = vi.fn().mockResolvedValue({
      ok: true,
      reports: [],
      truncated: false,
      totalChars: 0,
      workHours: {
        totalHours: 16,
        reportCount: 2,
        coveredReportCount: 2,
        loggedItemCount: 3,
        unparsedHourFieldCount: 0,
        byProject: [],
        byWorkModule: [],
        byTaskType: [],
        items: [
          {
            date: "2026-06-08",
            templateName: "研发日志",
            slot: "①",
            hours: 6.5,
            project: "OCT 中国注册",
            workModule: "OCT",
            taskType: "解决问题",
          },
          {
            date: "2026-06-09",
            templateName: "研发日志",
            slot: "①",
            hours: 8,
            project: "OCT 中国注册",
            workModule: "OCT",
            taskType: "文件输出",
          },
          {
            date: "2026-06-09",
            templateName: "研发日志",
            slot: "②",
            hours: 1.5,
            project: "公共事务",
            workModule: "团队管理",
            taskType: "管理",
          },
        ],
      },
    });
    const handler = buildAnalyzeEmployeeLogHoursHandler({
      actorUserId: "actor1",
      fetchReports,
    });

    const result = await handler({
      userId: "u_a",
      startYmd: "2026-06-01",
      endYmd: "2026-06-30",
      groupBy: ["project", "taskType"],
      projectContains: "OCT",
    }) as {
      ok: boolean;
      matchedHours: number;
      groups: Array<{
        dimensions: { project?: string; taskType?: string };
        hours: number;
      }>;
    };

    expect(result.ok).toBe(true);
    expect(result.matchedHours).toBe(14.5);
    expect(result.groups).toEqual([
      {
        dimensions: { project: "OCT 中国注册", taskType: "文件输出" },
        hours: 8,
        sharePct: 55.2,
        itemCount: 1,
      },
      {
        dimensions: { project: "OCT 中国注册", taskType: "解决问题" },
        hours: 6.5,
        sharePct: 44.8,
        itemCount: 1,
      },
    ]);
  });

  it("falls back to a real template dimension instead of inventing project data", async () => {
    const fetchReports = vi.fn().mockResolvedValue({
      ok: true,
      reports: [],
      truncated: false,
      totalChars: 0,
      workHours: {
        totalHours: 8,
        reportCount: 1,
        coveredReportCount: 1,
        loggedItemCount: 1,
        unparsedHourFieldCount: 0,
        availableDimensions: ["workModule", "taskType"],
        byProject: [],
        byWorkModule: [],
        byTaskType: [],
        items: [{
          date: "2026-07-28",
          templateName: "总经办日志",
          slot: "①",
          hours: 8,
          workModule: "智能体工程-企业",
          taskType: "解决问题",
        }],
      },
    });
    const handler = buildAnalyzeEmployeeLogHoursHandler({
      actorUserId: "actor1",
      fetchReports,
    });

    const result = await handler({
      userId: "u_a",
      groupBy: ["project"],
    }) as {
      groupBy: string[];
      availableDimensions: string[];
      unsupportedDimensions: string[];
      groups: Array<{ dimensions: Record<string, string> }>;
    };

    expect(result.availableDimensions).not.toContain("project");
    expect(result.unsupportedDimensions).toEqual(["project"]);
    expect(result.groupBy).toEqual(["workModule"]);
    expect(result.groups[0].dimensions).toEqual({
      workModule: "智能体工程-企业",
    });
  });
});
