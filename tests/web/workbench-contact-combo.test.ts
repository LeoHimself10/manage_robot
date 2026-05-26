import { describe, expect, it } from "vitest";
import { parseAssigneeCellDisplay } from "../../src/web/workbench-contact-combo";

describe("workbench-contact-combo", () => {
  it("parseAssigneeCellDisplay extracts userId suffix", () => {
    expect(parseAssigneeCellDisplay("李四 (u9)")).toEqual({
      display: "李四",
      userId: "u9",
    });
    expect(parseAssigneeCellDisplay("王五")).toEqual({
      display: "王五",
      userId: "",
    });
    expect(parseAssigneeCellDisplay("  赵六 (uid-1)  ")).toEqual({
      display: "赵六",
      userId: "uid-1",
    });
  });
});
