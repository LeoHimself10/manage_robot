import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createQualityReadStore } from "../../src/quality/infra/quality-read-store";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("createQualityReadStore.listCandidates", () => {
  it("includes readable summaries for feedback linked to a candidate", () => {
    const dir = mkdtempSync(join(tmpdir(), "quality-read-store-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "quality.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE quality_candidates (
        id TEXT PRIMARY KEY, candidate_type TEXT, status TEXT, score REAL,
        rule_codes_json TEXT, source_keys_json TEXT, explanation_json TEXT,
        detected_at TEXT, decision_reason TEXT, version INTEGER
      );
      CREATE TABLE quality_source_rows (
        source_key TEXT PRIMARY KEY, row_number INTEGER, normalized_json TEXT,
        raw_snapshot_json TEXT
      );
    `);
    const sourceKey = `source:${randomUUID()}`;
    db.prepare(`INSERT INTO quality_source_rows(source_key,row_number,normalized_json,raw_snapshot_json)
      VALUES(?,?,?,?)`).run(
      sourceKey,
      12,
      JSON.stringify({ feedbackNo: "FB-12", deviceModel: "M-1", category: "断裂", issueDescription: "导管在术中断裂" }),
      JSON.stringify({ "问题描述": "导管在术中断裂" }),
    );
    db.prepare(`INSERT INTO quality_candidates(id,candidate_type,status,score,rule_codes_json,source_keys_json,explanation_json,detected_at,decision_reason,version)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      "candidate-1", "ANOMALY", "OPEN", null, JSON.stringify(["MODEL_CATEGORY_REPEAT"]),
      JSON.stringify([sourceKey]), "{}", "2026-07-14T16:00:00.000Z", null, 1,
    );
    db.close();

    const store = createQualityReadStore(dbPath);
    const result = store.listCandidates();
    store.close();

    expect(result.candidates[0]?.sourceRows).toEqual([{
      sourceKey,
      rowNumber: 12,
      feedbackNo: "FB-12",
      deviceModel: "M-1",
      category: "断裂",
      issueDescription: "导管在术中断裂",
    }]);
  });
});
