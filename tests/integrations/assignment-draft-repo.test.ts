import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createAssignmentDraftRepo } from "../../src/integrations/repos/assignment-draft-repo";

describe("assignment-draft-repo", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("save writes draft to disk and load returns it", () => {
    dir = mkdtempSync(join(tmpdir(), "draft-test-"));
    const repo = createAssignmentDraftRepo(dir);
    const draft = { planId: "p1", traceId: "t1", promptVersion: "v1" };
    repo.save(draft);
    const loaded = repo.load("p1");
    expect(loaded).toBeDefined();
    expect(loaded!.planId).toBe("p1");
    expect(loaded!.traceId).toBe("t1");
    expect(loaded!.promptVersion).toBe("v1");
  });

  it("load returns undefined for missing planId", () => {
    dir = mkdtempSync(join(tmpdir(), "draft-test-"));
    const repo = createAssignmentDraftRepo(dir);
    expect(repo.load("nonexistent")).toBeUndefined();
  });
});
