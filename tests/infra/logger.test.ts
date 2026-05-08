import { describe, expect, it, vi } from "vitest";
import { logStructured } from "../../src/infra/logger";

describe("logStructured", () => {
  it("emits a single JSON line with iso timestamp and payload fields", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logStructured({ traceId: "t-1", event: "demo_draft_ready", tokens: 100 });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0][0] as string;
    const obj = JSON.parse(line) as Record<string, unknown>;
    expect(typeof obj.ts).toBe("string");
    expect(obj.traceId).toBe("t-1");
    expect(obj.event).toBe("demo_draft_ready");
    expect(obj.tokens).toBe(100);
    spy.mockRestore();
  });
});
