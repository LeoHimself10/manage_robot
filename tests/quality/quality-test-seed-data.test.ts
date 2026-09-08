import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createQualityEventPerspectiveProjector } from
  "../../src/quality/presentation/quality-event-perspective";
import { listQualityTestEmployeeActors } from
  "../../src/quality/testing/quality-test-actors";

const roots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("quality isolated demo data", () => {
  it("seeds every workflow stage, three employees, AI original advice and manager final reviews idempotently", () => {
    const root = mkdtempSync(join(tmpdir(), "quality-test-seed-"));
    roots.push(root);
    const dbPath = join(root, "workbench.sqlite");
    const evidenceDir = join(root, "controlled-evidence");
    vi.stubEnv("WORKBENCH_ADMIN_USER_IDS", "admin-1");
    vi.stubEnv("QUALITY_TEST_ACTORS_ENABLED", "1");
    const run = () => execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/seed-quality-test-data.ts", "--confirm"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          WORKBENCH_SQLITE_PATH: dbPath,
          QUALITY_TEST_ACTORS_ENABLED: "1",
          WORKBENCH_ADMIN_USER_IDS: "admin-1",
          QUALITY_EVIDENCE_DIR: evidenceDir,
        },
        encoding: "utf8",
      },
    );

    expect(run()).toContain("隔离质量测试事件已就绪：12 条；测试员工：3 名");
    const firstRunDb = new DatabaseSync(dbPath, { readOnly: true });
    const seededEvidence = firstRunDb.prepare(`
      SELECT storage_key
      FROM quality_evidence
      WHERE evidence_id='evidence:quality-test-event-child-review:employee'
    `).get() as { storage_key: string };
    firstRunDb.close();
    expect(seededEvidence.storage_key).toMatch(/^quality-test-seed-[a-f0-9]{64}$/);
    const seededEvidencePath = join(evidenceDir, seededEvidence.storage_key);
    expect(readFileSync(seededEvidencePath, "utf8")).toBe("QT-DEMO-007 隔离测试证据");
    unlinkSync(seededEvidencePath);
    expect(run()).toContain("隔离质量测试事件已就绪：12 条；测试员工：3 名");
    expect(existsSync(seededEvidencePath)).toBe(true);

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const counts = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM quality_events WHERE is_test=1) AS events,
        (SELECT COUNT(*) FROM quality_source_ai_assessments WHERE source_key LIKE 'quality-test-source:%') AS ai,
        (SELECT COUNT(*) FROM quality_source_assessments WHERE source_key LIKE 'quality-test-source:%') AS final_reviews,
        (SELECT COUNT(*) FROM quality_analysis_versions WHERE event_id LIKE 'quality-test-event-%') AS analyses,
        (SELECT COUNT(*) FROM quality_task_links WHERE node_id LIKE 'quality-test-node-%') AS formal_links
    `).get() as Record<string, number>;
    const statuses = db.prepare(`
      SELECT status,COUNT(*) AS count FROM quality_events
      WHERE is_test=1 GROUP BY status ORDER BY status
    `).all() as Array<{ status: string; count: number }>;
    db.close();

    expect(counts).toEqual({
      events: 12,
      ai: 12,
      final_reviews: 12,
      analyses: 11,
      formal_links: 0,
    });
    expect(Object.fromEntries(statuses.map((row) => [row.status, row.count]))).toMatchObject({
      PENDING_ANALYSIS: 1,
      PENDING_ASSIGNMENT: 1,
      PENDING_ACCEPTANCE: 2,
      IN_PROGRESS: 5,
      PENDING_PRIMARY_REVIEW: 1,
      PENDING_QUALITY_REVIEW: 1,
      CLOSED: 1,
    });
    expect(listQualityTestEmployeeActors().map((actor) => actor.displayName)).toEqual([
      "测试员工1",
      "测试员工2",
      "测试员工3",
    ]);
    expect(new Set(listQualityTestEmployeeActors().map((actor) => actor.departmentName)))
      .toEqual(new Set(["研发中心"]));

    const projector = createQualityEventPerspectiveProjector(dbPath);
    const ma = projector.getEventDetail({
      viewerUserId: "admin-1",
      testActorRef: "aftersales",
      eventId: "quality-test-event-assignment",
    })!;
    const tong = projector.getEventDetail({
      viewerUserId: "admin-1",
      testActorRef: "quality-management",
      eventId: "quality-test-event-assignment",
    })!;
    projector.close();

    expect((ma.viewModel.assessment as any).originalSuggestion).toMatchObject({
      available: true,
      recommendedDecision: "质量异常",
      suggestedRisk: "中风险",
    });
    expect((ma.viewModel.assessment as any).finalReviews).toHaveLength(1);
    expect(tong.viewModel).not.toHaveProperty("assessment");
    expect((tong.viewModel.initialAnalysis as any).latest).toMatchObject({
      versionLabel: "V1",
      suggestedDepartment: "研发中心",
    });
  }, 20_000);
});
