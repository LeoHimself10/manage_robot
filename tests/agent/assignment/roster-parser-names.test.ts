import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractNamesFromRosterText } from "../../../src/agent/assignment/roster-parser";

describe("extractNamesFromRosterText", () => {
  it("extracts ## headings from sample roster fixture (canonical 杨楚榛)", () => {
    const text = readFileSync(
      join(process.cwd(), "fixtures/sample-roster-杨楚臻-杨贺新-陈哲治-测试.md"),
      "utf8",
    );
    const names = extractNamesFromRosterText(text);
    expect(names).toEqual(["杨楚榛", "杨贺新", "陈哲治"]);
  });

  it("dedupes and skips overlong headings", () => {
    const text = [
      "## 张三",
      "## 张三",
      "## 这是一段明显不是人名的超长标题用来测试过滤逻辑应该被跳过",
      "## 李四",
    ].join("\n");
    expect(extractNamesFromRosterText(text)).toEqual(["张三", "李四"]);
  });

  it("respects ROSTER_MATCH_MAX_NAMES", () => {
    const prev = process.env.ROSTER_MATCH_MAX_NAMES;
    process.env.ROSTER_MATCH_MAX_NAMES = "2";
    try {
      const text = "## A\n## B\n## C\n";
      expect(extractNamesFromRosterText(text)).toEqual(["A", "B"]);
    } finally {
      if (prev === undefined) delete process.env.ROSTER_MATCH_MAX_NAMES;
      else process.env.ROSTER_MATCH_MAX_NAMES = prev;
    }
  });
});
