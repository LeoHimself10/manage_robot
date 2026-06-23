import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseDailyReportDigestConfig } from "../../../src/agent/daily-report-digest/daily-report-config";
import { saveUploadedRubric } from "../../../src/agent/competency-eval/rubric-store";
import {
  buildGetEmployeeDailyReportsHandler,
  buildListRubricsHandler,
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

const sampleMd = `# 测试标准

## 1）维度一

说明

## 2）维度二

说明
`;

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

  it("list_rubrics returns items after save in temp dir", async () => {
    const saved = await saveUploadedRubric({
      userId: "actor1",
      filename: "standard.md",
      buffer: Buffer.from(sampleMd, "utf8"),
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const handler = buildListRubricsHandler({ actorUserId: "actor1" });
    const result = (await handler({})) as { ok: boolean; items?: Array<{ rubricId: string }> };
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items![0].rubricId).toBe(saved.rubric.rubricId);
  });

  it("get_employee_daily_reports for roster外 user returns ok:false", async () => {
    const handler = buildGetEmployeeDailyReportsHandler({
      actorUserId: "actor1",
      reportConfig: MOCK_CONFIG,
    });

    const result = (await handler({
      userId: "unknown_user",
      startYmd: "2026-06-01",
      endYmd: "2026-06-07",
    })) as { ok: boolean; reason?: string };

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_in_eval_roster");
  });

  it("registry competency_eval profile exposes expected tools when actor set", () => {
    const registry = buildToolRegistry({
      employeeRepo: { list: () => [] },
      toolProfile: "competency_eval",
      competencyEvalActorUserId: "actor1",
    });

    expect(Object.keys(registry).sort()).toEqual([
      "get_current_time",
      "get_employee_daily_reports",
      "get_rubric",
      "list_rubrics",
      "search_employees",
    ]);
  });
});
