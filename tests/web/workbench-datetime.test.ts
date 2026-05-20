import { describe, expect, it } from "vitest";
import { formatWorkbenchDateTime } from "../../src/web/workbench-datetime.js";

describe("formatWorkbenchDateTime", () => {
  it("formats valid ISO to yyyy-MM-dd HH:mm", () => {
    const out = formatWorkbenchDateTime("2026-05-20T08:30:00.000Z");
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(out).not.toBe("—");
  });

  it("returns em dash for empty or invalid", () => {
    expect(formatWorkbenchDateTime("")).toBe("—");
    expect(formatWorkbenchDateTime("not-a-date")).toBe("—");
  });
});
