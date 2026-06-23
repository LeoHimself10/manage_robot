import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractRubricFromText } from "../../../src/agent/competency-eval/rubric-extract";

describe("extractRubricFromText", () => {
  it("extracts title and >=6 dimensions from sample md", () => {
    const text = readFileSync(
      join(process.cwd(), "tests/fixtures/competency-eval/test-manager-rubric.md"),
      "utf8",
    );
    const out = extractRubricFromText(text);
    expect(out.title.length).toBeGreaterThan(0);
    expect(out.dimensions.length).toBeGreaterThanOrEqual(6);
    expect(out.outputColumns.length).toBeGreaterThan(0);
  });

  it("handles empty text", () => {
    const out = extractRubricFromText("");
    expect(out.dimensions).toEqual([]);
  });
});
