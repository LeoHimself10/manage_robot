import { describe, expect, it, vi } from "vitest";
import { buildReadUrlHandler } from "../../../src/agent/tools/read-url";

describe("read_url tool", () => {
  it("returns quota exhausted after max calls", async () => {
    const prev = process.env.READ_URL_PER_ORCHESTRATOR_MAX;
    process.env.READ_URL_PER_ORCHESTRATOR_MAX = "2";
    let count = 0;
    const handler = buildReadUrlHandler({
      getCallCount: () => count,
      incrementCallCount: () => {
        count += 1;
      },
    });

    const fetchImpl = vi.fn(async () =>
      new Response("<html><body><p>ok</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    try {
      const first = await handler({ url: "https://example.com/a" });
      const second = await handler({ url: "https://example.com/b" });
      const third = await handler({ url: "https://example.com/c" });
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(third).toMatchObject({ ok: false, reason: "read_url_quota_exhausted" });
    } finally {
      vi.unstubAllGlobals();
      if (prev === undefined) delete process.env.READ_URL_PER_ORCHESTRATOR_MAX;
      else process.env.READ_URL_PER_ORCHESTRATOR_MAX = prev;
    }
  });

  it("rejects empty url", async () => {
    const handler = buildReadUrlHandler();
    const result = await handler({ url: "  " });
    expect(result).toMatchObject({ ok: false, reason: "empty_url" });
  });
});
