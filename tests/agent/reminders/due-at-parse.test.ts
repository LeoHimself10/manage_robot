import { describe, expect, it } from "vitest";
import {
  DEFAULT_DUE_TIMEZONE,
  dueAtYmdInTz,
  formatDueAtForStorage,
  parseDueAtMs,
} from "../../../src/agent/reminders/due-at-parse";

describe("due-at-parse", () => {
  it("date-only defaults to 18:00 Asia/Shanghai", () => {
    const ms = parseDueAtMs("2026-05-22");
    expect(ms).toBeDefined();
    expect(new Date(ms!).toISOString()).toBe("2026-05-22T10:00:00.000Z");
    expect(dueAtYmdInTz("2026-05-22")).toBe("2026-05-22");
  });

  it("formatDueAtForStorage normalizes date-only to ISO", () => {
    expect(formatDueAtForStorage("2026-05-22")).toBe("2026-05-22T10:00:00.000Z");
  });

  it("preserves explicit ISO timestamps", () => {
    const raw = "2026-05-22T23:59:59Z";
    const ms = parseDueAtMs(raw);
    expect(ms).toBe(Date.parse(raw));
    expect(formatDueAtForStorage(raw)).toBe(new Date(raw).toISOString());
  });

  it("returns undefined for empty or 待确认", () => {
    expect(parseDueAtMs("")).toBeUndefined();
    expect(parseDueAtMs("待确认")).toBeUndefined();
  });

  it("uses configured timezone for ymd", () => {
    const ymd = dueAtYmdInTz("2026-05-22T10:00:00.000Z", DEFAULT_DUE_TIMEZONE);
    expect(ymd).toBe("2026-05-22");
  });
});
