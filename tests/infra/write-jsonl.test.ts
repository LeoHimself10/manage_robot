import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { appendJsonlLine } from "../../src/infra/write-jsonl";

describe("appendJsonlLine", () => {
  it("creates parent dirs and appends newline-delimited JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "jsonl-"));
    const filePath = join(dir, "nested", "a.jsonl");
    appendJsonlLine(filePath, { id: 1 });
    appendJsonlLine(filePath, { id: 2 });
    const text = readFileSync(filePath, "utf8");
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ id: 1 });
    expect(JSON.parse(lines[1])).toEqual({ id: 2 });
    rmSync(dir, { recursive: true, force: true });
  });
});
