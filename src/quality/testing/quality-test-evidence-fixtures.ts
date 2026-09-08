import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

type SeedEvidenceRow = {
  evidence_id: string;
  event_id: string;
  event_no: string;
};

function evidenceRootDir(environment: NodeJS.ProcessEnv): string {
  return environment.QUALITY_EVIDENCE_DIR?.trim()
    || join(environment.QUALITY_FILE_DIR?.trim() || "data/quality-files", "evidence");
}

export function qualityTestEvidenceStorageKey(evidenceId: string): string {
  return `quality-test-seed-${createHash("sha256").update(evidenceId).digest("hex")}`;
}

/**
 * Materialize only the deterministic evidence rows owned by the isolated test
 * seeds. Production evidence and arbitrary missing files are deliberately not
 * repaired here.
 */
export function ensureQualityTestEvidenceFixtures(
  db: DatabaseSync,
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const rows = db.prepare(`
    SELECT q.evidence_id,e.id AS event_id,e.event_no
    FROM quality_evidence q
    JOIN quality_events e ON e.id=q.event_id
    WHERE e.is_test=1
      AND q.evidence_id='evidence:' || e.id || ':employee'
      AND q.original_name='隔离测试证据.txt'
      AND q.mime_type='text/plain'
      AND q.uploaded_by LIKE 'QUALITY_TEST_%'
    ORDER BY q.evidence_id
  `).all() as SeedEvidenceRow[];
  if (rows.length === 0) return 0;

  const rootDir = evidenceRootDir(environment);
  mkdirSync(rootDir, { recursive: true });
  for (const row of rows) {
    const content = Buffer.from(`${row.event_no} 隔离测试证据`, "utf8");
    const sha256 = createHash("sha256").update(content).digest("hex");
    const storageKey = qualityTestEvidenceStorageKey(row.evidence_id);
    const path = join(rootDir, storageKey);
    const current = existsSync(path) ? readFileSync(path) : null;
    if (!current || createHash("sha256").update(current).digest("hex") !== sha256) {
      writeFileSync(path, content, { mode: 0o600 });
    }
    db.prepare(`
      UPDATE quality_evidence
      SET storage_key=?,size_bytes=?,sha256=?
      WHERE evidence_id=? AND event_id=?
    `).run(storageKey, content.byteLength, sha256, row.evidence_id, row.event_id);
  }
  return rows.length;
}
