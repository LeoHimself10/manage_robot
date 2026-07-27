import { describe, expect, it, vi } from "vitest";
import {
  isProjectViewDigestSendWindow,
  createDailyReportProjectViewDigestScheduler,
  selectProjectViewContextsForDigestRecipient,
} from "../../../src/agent/daily-report-digest/daily-report-project-view-digest-scheduler";
import {
  parseDailyReportDigestConfig,
  type DailyReportDigestConfig,
} from "../../../src/agent/daily-report-digest/daily-report-config";
import { createProjectViewDigestStateStore } from "../../../src/agent/daily-report-digest/daily-report-project-view-digest-state";
import {
  parseProjectViewConfig,
  resolveProjectViewDigestRecipients,
} from "../../../src/agent/daily-report-digest/daily-report-project-views";

const FILTER = {
  workModuleContains: "半导体激光",
  costProjectContains: "静脉",
};

describe("resolveProjectViewDigestRecipients", () => {
  it("excludes configured and env user ids when set", () => {
    const view = parseProjectViewConfig(
      {
        id: "v1",
        label: "测试",
        viewers: ["01451725613871", "641871342"],
        filters: FILTER,
        digest: { enabled: true, excludeUserIds: ["641871342"] },
      },
      "微光",
    )!;
    expect(resolveProjectViewDigestRecipients(view, [])).toEqual(["01451725613871"]);
    expect(resolveProjectViewDigestRecipients(view, ["01451725613871"])).toEqual([]);
  });

  it("defaults to all viewers when no exclude", () => {
    const view = parseProjectViewConfig(
      {
        id: "v1",
        label: "测试",
        viewers: ["01451725613871", "641871342"],
        filters: FILTER,
        digest: { enabled: true },
      },
      "微光",
    )!;
    expect(resolveProjectViewDigestRecipients(view, [])).toEqual([
      "01451725613871",
      "641871342",
    ]);
  });
});

describe("isProjectViewDigestSendWindow", () => {
  const config = parseDailyReportDigestConfig({ timezone: "Asia/Shanghai" }).config;

  it("returns true Tue 08:02", () => {
    expect(
      isProjectViewDigestSendWindow(new Date("2026-06-09T08:02:00+08:00"), config),
    ).toBe(true);
  });

  it("returns false Mon 08:02", () => {
    expect(
      isProjectViewDigestSendWindow(new Date("2026-06-08T08:02:00+08:00"), config),
    ).toBe(false);
  });
});

describe("project view digest scheduler", () => {
  it("limits a recipient to the project views they subscribed to", () => {
    const contexts = [
      { view: { id: "vein" } },
      { view: { id: "oct" } },
    ] as any;
    expect(
      selectProjectViewContextsForDigestRecipient(contexts, ["vein"]).map((context) => context.view.id),
    ).toEqual(["vein"]);
  });

  it("skips when env digest disabled", async () => {
    delete process.env.DAILY_REPORT_PROJECT_VIEW_DIGEST_ENABLED;
    process.env.DAILY_REPORT_PROJECT_VIEWS_ENABLED = "1";

    const send = vi.fn();
    const config: DailyReportDigestConfig = {
      ...parseDailyReportDigestConfig({
        timezone: "Asia/Shanghai",
        webhook: { accessToken: "t" },
        orgs: [
          {
            label: "微光",
            appKey: "k",
            appSecret: "s",
            employees: [],
            projectViews: [
              {
                id: "v1",
                label: "测试",
                viewers: ["641871342"],
                filters: FILTER,
                digest: { enabled: true },
              },
            ],
          },
        ],
      }).config,
      enabled: false,
      scanIntervalMs: 60_000,
    };

    const scheduler = createDailyReportProjectViewDigestScheduler({ config });
    await scheduler.runDigestSend(new Date("2026-06-09T08:02:00+08:00"));
    scheduler.close();
    expect(send).not.toHaveBeenCalled();
  });
});
