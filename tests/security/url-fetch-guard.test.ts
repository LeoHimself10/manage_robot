import { describe, expect, it } from "vitest";
import { validateUrlForFetch } from "../../src/security/url-fetch-guard";

describe("validateUrlForFetch", () => {
  it("accepts public https URLs", async () => {
    const result = await validateUrlForFetch("https://example.com/path");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url.hostname).toBe("example.com");
  });

  it("rejects non-http protocols", async () => {
    const result = await validateUrlForFetch("file:///etc/passwd");
    expect(result).toMatchObject({ ok: false, reason: "blocked_protocol" });
  });

  it("rejects localhost", async () => {
    const result = await validateUrlForFetch("http://localhost:8080/");
    expect(result).toMatchObject({ ok: false, reason: "blocked_host" });
  });

  it("rejects private IPv4 literals", async () => {
    const result = await validateUrlForFetch("http://192.168.1.10/doc");
    expect(result).toMatchObject({ ok: false, reason: "blocked_host" });
  });

  it("respects READ_URL_ALLOWED_HOSTS whitelist", async () => {
    const prev = process.env.READ_URL_ALLOWED_HOSTS;
    process.env.READ_URL_ALLOWED_HOSTS = "example.com";
    try {
      const ok = await validateUrlForFetch("https://example.com/a");
      const bad = await validateUrlForFetch("https://other.com/a");
      expect(ok.ok).toBe(true);
      expect(bad).toMatchObject({ ok: false, reason: "host_not_allowed" });
    } finally {
      if (prev === undefined) delete process.env.READ_URL_ALLOWED_HOSTS;
      else process.env.READ_URL_ALLOWED_HOSTS = prev;
    }
  });
});
