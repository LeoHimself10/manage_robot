import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as crypto from "node:crypto";

import {
  parseDailyReportDigestConfig,
  loadDailyReportDigestConfig,
  type DailyReportDigestConfig,
} from "../../../src/agent/daily-report-digest/daily-report-config";
import { parseProjectViewConfig } from "../../../src/agent/daily-report-digest/daily-report-project-views";
import {
  computeWebhookSign,
  buildWebhookUrl,
} from "../../../src/agent/daily-report-digest/group-robot-webhook";
import {
  isDailyReportSendWindow,
  resolveDayRangeForYmd,
  resolveReportRange,
} from "../../../src/agent/daily-report-digest/daily-report-window";
import {
  aggregateOrgDigest,
  renderDailyReportMarkdown,
} from "../../../src/agent/daily-report-digest/daily-report-build";
import { runDailyReportDigest } from "../../../src/agent/daily-report-digest/daily-report-run";
import { createDailyReportDigestScheduler } from "../../../src/agent/daily-report-digest/daily-report-scheduler";
import type { ReportEntry } from "../../../src/agent/daily-report-digest/dingtalk-report-client";

const VALID_CONFIG = {
  title: "每日日报汇总",
  timezone: "Asia/Shanghai",
  sendHour: 7,
  sendMinute: 0,
  weekdaysOnly: true,
  webhook: { accessToken: "tok123", secret: "SECabc" },
  orgs: [
    {
      label: "钉钉",
      appKey: "ak-ding",
      appSecret: "as-ding",
      employees: [
        { userid: "u_a", name: "张三" },
        { userid: "u_b", name: "李四" },
      ],
    },
    {
      label: "明思",
      appKey: "ak-ming",
      appSecret: "as-ming",
      employees: [{ userid: "u_c", name: "王五" }],
    },
  ],
};

function report(over: Partial<ReportEntry>): ReportEntry {
  return {
    creatorUserId: "u_a",
    creatorName: "张三",
    templateName: "日报",
    createTime: Date.parse("2026-06-08T10:00:00+08:00"),
    contents: [{ key: "今日工作", value: "完成了 A 模块" }],
    ...over,
  };
}

function jsonRes(obj: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => obj } as unknown as Response;
}

function makeFakeFetch(opts: {
  reportsByUserid?: Record<string, Array<Record<string, unknown>>>;
  onSend?: (body: any, url: string) => void;
  sendErrcode?: number;
}) {
  const calls: Array<{ url: string; body: any }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: u, body });
    if (u.includes("oauth2/accessToken")) {
      return jsonRes({ accessToken: `tok-${body.appKey}`, expireIn: 7200 });
    }
    if (u.includes("topapi/report/list")) {
      const list = opts.reportsByUserid?.[body.userid] ?? [];
      return jsonRes({ errcode: 0, result: { data_list: list, has_more: false, next_cursor: 0 } });
    }
    if (u.includes("topapi/attendance/getleavestatus")) {
      return jsonRes({ errcode: 0, result: { leave_status: [], has_more: false } });
    }
    if (u.includes("robot/send")) {
      opts.onSend?.(body, u);
      return jsonRes({ errcode: opts.sendErrcode ?? 0, errmsg: "ok" });
    }
    return jsonRes({ errcode: 404 }, false);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("daily-report-config", () => {
  it("parses a valid config without errors", () => {
    const { config, errors } = parseDailyReportDigestConfig(VALID_CONFIG);
    expect(errors).toEqual([]);
    expect(config.orgs).toHaveLength(2);
    expect(config.orgs[0]!.employees).toHaveLength(2);
    expect(config.webhook.accessToken).toBe("tok123");
    expect(config.sendHour).toBe(7);
    expect(config.sendMinute).toBe(0);
  });

  it("allows org with projectViews but no legacy employees (managebot)", () => {
    const view = parseProjectViewConfig(
      {
        id: "semiconductor-vein",
        label: "半导体激光·静脉项目",
        viewers: ["u1"],
        filters: {
          workModuleContains: "半导体激光",
          costProjectContains: "静脉腔内闭合系统",
        },
      },
      "微光",
    );
    const { errors } = parseDailyReportDigestConfig({
      orgs: [
        {
          label: "微光",
          appKey: "ak",
          appSecret: "as",
          employees: [],
          projectViews: [view],
        },
      ],
    });
    expect(errors).toEqual([]);
  });

  it("reports errors for missing orgs creds / employees", () => {
    delete process.env.DINGTALK_CLIENT_ID;
    delete process.env.DINGTALK_CLIENT_SECRET;
    const { errors } = parseDailyReportDigestConfig({
      orgs: [{ label: "x", appKey: "k" }],
    });
    expect(errors.some((e) => e.includes("appKey/appSecret"))).toBe(true);
    expect(errors.some((e) => e.includes("employees"))).toBe(true);
  });

  it("treats webhook as optional (page works without group push)", () => {
    const pageOnly = {
      orgs: [
        { label: "明思", appKey: "ak", appSecret: "as", employees: [{ userid: "u1" }] },
      ],
    };
    const { errors } = parseDailyReportDigestConfig(pageOnly);
    expect(errors).toEqual([]);

    // master switch on but no webhook → group push stays disabled
    process.env.DAILY_REPORT_DIGEST_ENABLED = "1";
    const loaded = loadDailyReportDigestConfig({
      filePath: "x.json",
      readFileImpl: () => JSON.stringify(pageOnly),
    });
    expect(loaded.errors).toEqual([]);
    expect(loaded.config.enabled).toBe(false);
    delete process.env.DAILY_REPORT_DIGEST_ENABLED;
  });

  it("falls back to deployed DINGTALK_CLIENT_ID/SECRET when org omits creds", () => {
    process.env.DINGTALK_CLIENT_ID = "deployed-key";
    process.env.DINGTALK_CLIENT_SECRET = "deployed-secret";
    const { config, errors } = parseDailyReportDigestConfig({
      webhook: { accessToken: "tok" },
      orgs: [
        { label: "明思", useDeployedAppCredentials: true, employees: [{ userid: "u1" }] },
        { label: "明思2", employees: [{ userid: "u2" }] },
      ],
    });
    expect(errors).toEqual([]);
    expect(config.orgs[0]!.appKey).toBe("deployed-key");
    expect(config.orgs[0]!.appSecret).toBe("deployed-secret");
    expect(config.orgs[0]!.useDeployedAppCredentials).toBe(true);
    // implicit fallback when both appKey/appSecret omitted
    expect(config.orgs[1]!.appKey).toBe("deployed-key");
    delete process.env.DINGTALK_CLIENT_ID;
    delete process.env.DINGTALK_CLIENT_SECRET;
  });

  it("errors when deployed creds requested but env is absent", () => {
    delete process.env.DINGTALK_CLIENT_ID;
    delete process.env.DINGTALK_CLIENT_SECRET;
    const { errors } = parseDailyReportDigestConfig({
      webhook: { accessToken: "tok" },
      orgs: [{ label: "明思", useDeployedAppCredentials: true, employees: [{ userid: "u1" }] }],
    });
    expect(errors.some((e) => e.includes("复用部署应用凭证失败"))).toBe(true);
  });

  it("gates enabled on the master env switch", () => {
    const read = () => JSON.stringify(VALID_CONFIG);
    delete process.env.DAILY_REPORT_DIGEST_ENABLED;
    const off = loadDailyReportDigestConfig({ filePath: "x.json", readFileImpl: read });
    expect(off.config.enabled).toBe(false);

    process.env.DAILY_REPORT_DIGEST_ENABLED = "1";
    const on = loadDailyReportDigestConfig({ filePath: "x.json", readFileImpl: read });
    expect(on.config.enabled).toBe(true);
    delete process.env.DAILY_REPORT_DIGEST_ENABLED;
  });

  it("stays disabled when the config file cannot be read", () => {
    process.env.DAILY_REPORT_DIGEST_ENABLED = "1";
    const res = loadDailyReportDigestConfig({
      filePath: "missing.json",
      readFileImpl: () => {
        throw new Error("ENOENT");
      },
    });
    expect(res.config.enabled).toBe(false);
    expect(res.errors[0]).toContain("读取配置文件失败");
    delete process.env.DAILY_REPORT_DIGEST_ENABLED;
  });
});

describe("group-robot-webhook signing", () => {
  it("computes the documented HMAC-SHA256 sign and url-encodes it", () => {
    const ts = 1700000000000;
    const secret = "SECxyz";
    const expected = encodeURIComponent(
      crypto.createHmac("sha256", secret).update(`${ts}\n${secret}`, "utf8").digest("base64"),
    );
    expect(computeWebhookSign(secret, ts)).toBe(expected);
    expect(computeWebhookSign(secret, ts)).not.toContain("+");
  });

  it("includes timestamp & sign only when a secret is set", () => {
    const ts = 1700000000000;
    const withSecret = buildWebhookUrl({ accessToken: "tok", secret: "SECxyz" }, ts);
    expect(withSecret).toContain("access_token=tok");
    expect(withSecret).toContain(`timestamp=${ts}`);
    expect(withSecret).toContain("sign=");

    const noSecret = buildWebhookUrl({ accessToken: "tok" }, ts);
    expect(noSecret).toContain("access_token=tok");
    expect(noSecret).not.toContain("sign=");
  });
});

describe("daily-report-window", () => {
  const config = parseDailyReportDigestConfig(VALID_CONFIG).config;

  it("is in window at 07:00 on a weekday (Asia/Shanghai)", () => {
    // 2026-06-09 is Tuesday; 07:00 CST == 2026-06-08T23:00:00Z
    expect(isDailyReportSendWindow(new Date("2026-06-08T23:00:00Z"), config)).toBe(true);
  });

  it("is out of window off-hour", () => {
    expect(isDailyReportSendWindow(new Date("2026-06-09T01:30:00Z"), config)).toBe(false); // 09:30
  });

  it("sends on Saturday 07:00 (Friday report); skips Sunday and Monday", () => {
    // 2026-06-13 is Saturday; 07:00 CST == 2026-06-12T23:00:00Z
    expect(isDailyReportSendWindow(new Date("2026-06-12T23:00:00Z"), config)).toBe(true);
    // 2026-06-14 Sunday
    expect(isDailyReportSendWindow(new Date("2026-06-13T23:00:00Z"), config)).toBe(false);
    // 2026-06-15 Monday
    expect(isDailyReportSendWindow(new Date("2026-06-14T23:00:00Z"), config)).toBe(false);
  });

  it("resolves yesterday's full-day range with cutoff=0 (midnight-to-midnight)", () => {
    const range = resolveReportRange(new Date("2026-06-08T23:00:00Z"), "Asia/Shanghai");
    expect(range.labelYmd).toBe("2026-06-08");
    expect(range.startTime).toBe(Date.parse("2026-06-08T00:00:00+08:00"));
    expect(range.endTime).toBe(Date.parse("2026-06-09T00:00:00+08:00") - 1);
  });
});

describe("daily-report-window 17:00 cutoff", () => {
  const CUTOFF = { cutoffHour: 17, cutoffMinute: 0 };

  it("resolveDayRangeForYmd gives [17:00, next-day 17:00) window", () => {
    const range = resolveDayRangeForYmd("2026-06-08", "Asia/Shanghai", CUTOFF);
    expect(range.labelYmd).toBe("2026-06-08");
    expect(range.startTime).toBe(Date.parse("2026-06-08T17:00:00+08:00"));
    expect(range.endTime).toBe(Date.parse("2026-06-09T17:00:00+08:00") - 1);
  });

  it("16:59 on D is still in the D-1 window (just before cutoff)", () => {
    const rangeD = resolveDayRangeForYmd("2026-06-08", "Asia/Shanghai", CUTOFF);
    const submittedAt = Date.parse("2026-06-08T16:59:00+08:00");
    expect(submittedAt).toBeGreaterThanOrEqual(
      resolveDayRangeForYmd("2026-06-07", "Asia/Shanghai", CUTOFF).startTime,
    );
    expect(submittedAt).toBeLessThanOrEqual(
      resolveDayRangeForYmd("2026-06-07", "Asia/Shanghai", CUTOFF).endTime,
    );
    // NOT in D=06-08 window
    expect(submittedAt).toBeLessThan(rangeD.startTime);
  });

  it("normal next-morning submission (D+1 09:00) counts as D", () => {
    // submitting on Jun 9 at 09:00 for Jun 8's work — should be in Jun 8 window
    const nextMorning = Date.parse("2026-06-09T09:00:00+08:00");
    const rangeJun8 = resolveDayRangeForYmd("2026-06-08", "Asia/Shanghai", CUTOFF);
    const rangeJun9 = resolveDayRangeForYmd("2026-06-09", "Asia/Shanghai", CUTOFF);
    expect(nextMorning).toBeGreaterThanOrEqual(rangeJun8.startTime);
    expect(nextMorning).toBeLessThanOrEqual(rangeJun8.endTime);
    expect(nextMorning).toBeLessThan(rangeJun9.startTime);
  });

  it("same-day early morning supplement (D 09:00) is in D-1 window, NOT D", () => {
    // submitting Jun 8 09:00 (for an earlier day) falls in Jun 7's business window
    const earlyMorning = Date.parse("2026-06-08T09:00:00+08:00");
    const rangeJun8 = resolveDayRangeForYmd("2026-06-08", "Asia/Shanghai", CUTOFF);
    const rangeJun7 = resolveDayRangeForYmd("2026-06-07", "Asia/Shanghai", CUTOFF);
    expect(earlyMorning).toBeLessThan(rangeJun8.startTime);
    expect(earlyMorning).toBeGreaterThanOrEqual(rangeJun7.startTime);
    expect(earlyMorning).toBeLessThanOrEqual(rangeJun7.endTime);
  });

  it("late supplement (D+2 09:00) is in D+1 window, Jun 8 still missing", () => {
    // submitting Jun 10 09:00 falls in Jun 9's window, not Jun 8's
    const lateSubmit = Date.parse("2026-06-10T09:00:00+08:00");
    const rangeJun8 = resolveDayRangeForYmd("2026-06-08", "Asia/Shanghai", CUTOFF);
    const rangeJun9 = resolveDayRangeForYmd("2026-06-09", "Asia/Shanghai", CUTOFF);
    expect(lateSubmit).toBeGreaterThan(rangeJun8.endTime);
    expect(lateSubmit).toBeGreaterThanOrEqual(rangeJun9.startTime);
    expect(lateSubmit).toBeLessThanOrEqual(rangeJun9.endTime);
  });

  it("resolveReportRange with cutoff=17 gives [yesterday 17:00, today 17:00)", () => {
    // now = Jun 9 08:30 CST → yesterday = Jun 8
    const range = resolveReportRange(new Date("2026-06-09T00:30:00Z"), "Asia/Shanghai", CUTOFF);
    expect(range.labelYmd).toBe("2026-06-08");
    expect(range.startTime).toBe(Date.parse("2026-06-08T17:00:00+08:00"));
    expect(range.endTime).toBe(Date.parse("2026-06-09T17:00:00+08:00") - 1);
  });
});

describe("daily-report-config cutoff parsing", () => {
  it("defaults reportDayCutoffHour to 17 when absent from JSON", () => {
    const { config } = parseDailyReportDigestConfig(VALID_CONFIG);
    expect(config.reportDayCutoffHour).toBe(17);
    expect(config.reportDayCutoffMinute).toBe(0);
  });

  it("reads custom cutoff from JSON", () => {
    const { config } = parseDailyReportDigestConfig({
      ...VALID_CONFIG,
      reportDayCutoffHour: 18,
      reportDayCutoffMinute: 30,
    });
    expect(config.reportDayCutoffHour).toBe(18);
    expect(config.reportDayCutoffMinute).toBe(30);
  });

  it("clamps out-of-range values", () => {
    const { config } = parseDailyReportDigestConfig({
      ...VALID_CONFIG,
      reportDayCutoffHour: 99,
      reportDayCutoffMinute: -5,
    });
    expect(config.reportDayCutoffHour).toBe(23);
    expect(config.reportDayCutoffMinute).toBe(0);
  });
});

describe("daily-report-build aggregation & rendering", () => {
  const org = parseDailyReportDigestConfig(VALID_CONFIG).config.orgs[0]!;

  it("splits submitted vs missing and keeps raw content", () => {
    const reports = [
      report({ creatorUserId: "u_a", creatorName: "张三" }),
      report({
        creatorUserId: "u_a",
        creatorName: "张三",
        templateName: "周报",
        createTime: Date.parse("2026-06-08T18:00:00+08:00"),
        contents: [{ key: "计划", value: "下周做 B" }],
      }),
    ];
    const digest = aggregateOrgDigest(org, reports);
    expect(digest.submitted).toHaveLength(1);
    expect(digest.submitted[0]!.reports).toHaveLength(2);
    // sorted ascending by createTime
    expect(digest.submitted[0]!.reports[0]!.templateName).toBe("日报");
    expect(digest.missing.map((m) => m.userid)).toEqual(["u_b"]);
  });

  it("records fetch errors separately from missing", () => {
    const digest = aggregateOrgDigest(org, [], { u_b: "report/list failed" });
    expect(digest.errors.map((e) => e.userid)).toEqual(["u_b"]);
    expect(digest.missing.map((m) => m.userid)).toEqual(["u_a"]);
  });

  it("renders markdown with names, content, missing list and error footnote", () => {
    const digest = aggregateOrgDigest(org, [report({ creatorUserId: "u_a" })], {
      u_b: "boom",
    });
    const out = renderDailyReportMarkdown("每日日报汇总", "6月8日（2026-06-08）", [digest]);
    expect(out.text).toContain("每日日报汇总");
    expect(out.text).toContain("张三");
    expect(out.text).toContain("完成了 A 模块");
    expect(out.text).toContain("读取失败");
    expect(out.submittedCount).toBe(1);
  });
});

describe("runDailyReportDigest", () => {
  it("fetches per org/employee and posts an aggregated markdown to the group", async () => {
    let sentBody: any;
    const { fetchImpl, calls } = makeFakeFetch({
      reportsByUserid: {
        u_a: [
          {
            creator_id: "u_a",
            creator_name: "张三",
            template_name: "日报",
            create_time: Date.parse("2026-06-08T10:00:00+08:00"),
            contents: [{ key: "今日工作", value: "完成了 A 模块" }],
          },
        ],
        // u_b missing, u_c missing
      },
      onSend: (body) => {
        sentBody = body;
      },
    });
    const config = parseDailyReportDigestConfig(VALID_CONFIG).config;
    const result = await runDailyReportDigest(config, {
      fetchImpl,
      now: new Date("2026-06-09T00:30:00Z"),
    });

    expect(result.ok).toBe(true);
    expect(result.submittedCount).toBe(1);
    expect(result.missingCount).toBe(2);
    expect(sentBody.msgtype).toBe("markdown");
    expect(sentBody.markdown.text).toContain("张三");
    expect(sentBody.markdown.text).toContain("完成了 A 模块");
    // 3 employees -> 3 report/list calls
    expect(calls.filter((c) => c.url.includes("report/list"))).toHaveLength(3);
    // 2 orgs with missing -> 2 getleavestatus calls
    expect(calls.filter((c) => c.url.includes("getleavestatus"))).toHaveLength(2);
    // token per appKey, report + leave clients each cache separately -> 4 token calls
    expect(calls.filter((c) => c.url.includes("oauth2/accessToken"))).toHaveLength(4);
  });
});

describe("daily-report-scheduler", () => {
  it("sends once in window and dedups same-day", async () => {
    const config: DailyReportDigestConfig = {
      ...parseDailyReportDigestConfig(VALID_CONFIG).config,
      enabled: true,
    };
    const sent: Date[] = [];
    const { fetchImpl } = makeFakeFetch({
      reportsByUserid: {},
      onSend: () => sent.push(new Date()),
    });
    const store = new Set<string>();
    const stateStore = {
      isSent: (ymd: string) => store.has(ymd),
      markSent: (ymd: string) => void store.add(ymd),
    };
    const scheduler = createDailyReportDigestScheduler({ config, stateStore, fetchImpl });

    const inWindow = new Date("2026-06-08T23:00:00Z"); // 07:00 CST Tue
    await scheduler.runScan(inWindow);
    await scheduler.runScan(inWindow);
    expect(sent).toHaveLength(1);
    expect(store.has("2026-06-08")).toBe(true);
  });

  it("does not send outside the window", async () => {
    const config: DailyReportDigestConfig = {
      ...parseDailyReportDigestConfig(VALID_CONFIG).config,
      enabled: true,
    };
    const sent: number[] = [];
    const { fetchImpl } = makeFakeFetch({ reportsByUserid: {}, onSend: () => sent.push(1) });
    const stateStore = { isSent: () => false, markSent: () => undefined };
    const scheduler = createDailyReportDigestScheduler({ config, stateStore, fetchImpl });
    await scheduler.runScan(new Date("2026-06-09T01:30:00Z")); // 09:30, off-window
    expect(sent).toHaveLength(0);
  });

  it("reloads configuration before each scan so roster edits do not require a restart", async () => {
    const enabledConfig: DailyReportDigestConfig = {
      ...parseDailyReportDigestConfig(VALID_CONFIG).config,
      enabled: true,
    };
    const disabledConfig: DailyReportDigestConfig = { ...enabledConfig, enabled: false };
    let currentConfig = enabledConfig;
    const sent: number[] = [];
    const { fetchImpl } = makeFakeFetch({ reportsByUserid: {}, onSend: () => sent.push(1) });
    const scheduler = createDailyReportDigestScheduler({
      loadConfig: () => currentConfig,
      stateStore: { isSent: () => false, markSent: () => undefined },
      fetchImpl,
    });

    currentConfig = disabledConfig;
    await scheduler.runScan(new Date("2026-06-08T23:00:00Z")); // 07:00 CST Tue

    expect(sent).toHaveLength(0);
  });
});
