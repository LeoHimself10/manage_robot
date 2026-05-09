import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createAssignmentEventRepo } from "../../src/integrations/repos/assignment-event-repo";

describe("assignment-event-repo", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("append writes a JSONL line to the events file", () => {
    dir = mkdtempSync(join(tmpdir(), "event-test-"));
    const eventsPath = join(dir, "events.jsonl");
    const repo = createAssignmentEventRepo(eventsPath);
    repo.append({ type: "assigned", planId: "p1" });
    const lines = readFileSync(eventsPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({ type: "assigned", planId: "p1" });
  });
});
