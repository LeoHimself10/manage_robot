import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { createQualityStore } from "../../src/quality/infra/quality-store";
import { createQualitySourceSync } from "../../src/quality/source/quality-source-sync";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("quality source sync test-data isolation", () => {
  it("never marks QUALITY_TEST_ISOLATED rows deleted when syncing the real workbook", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quality-source-test-isolation-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "workbench.sqlite");
    createQualityStore(dbPath).close();
    const sync = createQualitySourceSync({
      dbPath,
      now: () => "2026-08-27T08:00:00.000Z",
      reader: {
        readFirstSheet: async () => ({
          sheetId: "real-sheet",
          sheetName: "客户端问题反馈记录表",
          rows: [
            ["反馈时间", "反馈单号", "反馈人员", "设备型号", "设备序列号", "报损导管批次", "问题描述", "术者是否可以感知", "对术者造成的影响", "确认情况"],
            ["2026-08-27 08:00", "REAL-001", "真实反馈人", "OCT-M1", "SN-001", "B-001", "真实来源问题", "可感知", "测试影响", "已确认"],
          ],
        }),
      },
    });
    await sync.syncNow();
    const db = new DatabaseSync(dbPath);
    const snapshot = JSON.stringify({
      sourceKey: "quality-test-source:QT-DEMO-000",
      feedbackNo: "TEST-QT-DEMO-000",
      issueDescription: "隔离测试来源",
    });
    db.prepare(`
      INSERT INTO quality_source_rows(
        source_key,sheet_id,sheet_name,row_number,state,source_version,content_hash,
        normalized_json,raw_snapshot_json,previous_snapshot_json,first_seen_at,
        last_seen_at,source_updated_at,synced_at,version
      ) VALUES(?,'QUALITY_TEST_ISOLATED','隔离测试数据',9000,'ACTIVE',1,?, ?,?,NULL,?,?,?,?,1)
    `).run(
      "quality-test-source:QT-DEMO-000",
      "a".repeat(64),
      snapshot,
      snapshot,
      "2026-08-27T08:00:00.000Z",
      "2026-08-27T08:00:00.000Z",
      "2026-08-27T08:00:00.000Z",
      "2026-08-27T08:00:00.000Z",
    );
    db.close();

    await sync.syncNow();
    sync.close();

    const verify = new DatabaseSync(dbPath, { readOnly: true });
    expect(verify.prepare(`SELECT state,source_version,version
      FROM quality_source_rows WHERE source_key=?`)
      .get("quality-test-source:QT-DEMO-000"))
      .toEqual({ state: "ACTIVE", source_version: 1, version: 1 });
    verify.close();
  });
});
