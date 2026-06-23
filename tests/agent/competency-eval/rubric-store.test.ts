import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteRubric,
  getRubric,
  listRubrics,
  saveUploadedRubric,
} from "../../../src/agent/competency-eval/rubric-store";

describe("rubric-store", () => {
  let dataDir = "";

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "competency-eval-rubric-"));
    vi.stubEnv("COMPETENCY_EVAL_DATA_DIR", dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (dataDir) {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  const sampleMd = `# 测试标准

## 1）维度一

说明

## 2）维度二

说明
`;

  it("save md → list → get → delete", async () => {
    const saved = await saveUploadedRubric({
      userId: "user1",
      filename: "standard.md",
      buffer: Buffer.from(sampleMd, "utf8"),
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    expect(saved.rubric.title).toBe("测试标准");
    expect(saved.rubric.dimensions).toHaveLength(2);

    const list = listRubrics("user1");
    expect(list).toHaveLength(1);
    expect(list[0].rubricId).toBe(saved.rubric.rubricId);
    expect(list[0].dimensionCount).toBe(2);

    const got = getRubric("user1", saved.rubric.rubricId);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.sourceMarkdown).toContain("维度一");
    expect(got.extracted.rubricId).toBe(saved.rubric.rubricId);
    expect(got.extracted.dimensions).toHaveLength(2);

    expect(deleteRubric("user1", saved.rubric.rubricId)).toBe(true);
    expect(listRubrics("user1")).toHaveLength(0);
  });

  it("rejects unsupported file type", async () => {
    const result = await saveUploadedRubric({
      userId: "user1",
      filename: "doc.txt",
      buffer: Buffer.from("plain text rubric without headings", "utf8"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unsupported_type");
  });

  it("enforces max rubrics limit", async () => {
    const first = await saveUploadedRubric({
      userId: "user1",
      filename: "a.md",
      buffer: Buffer.from(sampleMd, "utf8"),
      maxRubrics: 1,
    });
    expect(first.ok).toBe(true);

    const second = await saveUploadedRubric({
      userId: "user1",
      filename: "b.md",
      buffer: Buffer.from(sampleMd, "utf8"),
      maxRubrics: 1,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("max_rubrics_reached");
    expect(listRubrics("user1")).toHaveLength(1);
  });
});
