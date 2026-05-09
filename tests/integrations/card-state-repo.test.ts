import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createCardStateRepo } from "../../src/integrations/repos/card-state-repo";

describe("card-state-repo", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("upsert writes card state and get returns it", () => {
    dir = mkdtempSync(join(tmpdir(), "card-test-"));
    const repo = createCardStateRepo(dir);
    repo.upsert("ot1", { status: "open", assignee: "u1" });
    const result = repo.get("ot1");
    expect(result).toBeDefined();
    expect(result!.status).toBe("open");
    expect(result!.assignee).toBe("u1");
  });

  it("get returns undefined for missing outTrackId", () => {
    dir = mkdtempSync(join(tmpdir(), "card-test-"));
    const repo = createCardStateRepo(dir);
    expect(repo.get("nonexistent")).toBeUndefined();
  });
});
