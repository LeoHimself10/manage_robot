import { describe, expect, it, vi } from "vitest";
import {
  fetchUrlContent,
  htmlToPlainText,
} from "../../../src/integrations/url-fetch/fetch-url-content";

describe("htmlToPlainText", () => {
  it("strips tags and decodes basic entities", () => {
    const html = "<html><head><title>T</title></head><body><h1>Hello</h1><p>World &amp; Co</p></body></html>";
    expect(htmlToPlainText(html)).toContain("Hello");
    expect(htmlToPlainText(html)).toContain("World & Co");
  });
});

describe("fetchUrlContent", () => {
  it("returns extracted text from html", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("<html><head><title>Demo</title></head><body><p>Task requirements here.</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );

    const result = await fetchUrlContent({
      url: "https://example.com/spec",
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 5000,
      maxBytes: 1024 * 1024,
      maxTextChars: 5000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.title).toBe("Demo");
      expect(result.text).toContain("Task requirements here.");
    }
  });

  it("truncates long text", async () => {
    const body = `<html><body><p>${"x".repeat(100)}</p></body></html>`;
    const fetchImpl = vi.fn(async () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    const result = await fetchUrlContent({
      url: "https://example.com/long",
      fetchImpl: fetchImpl as typeof fetch,
      maxTextChars: 50,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.chars).toBe(50);
      expect(result.truncated).toBe(true);
    }
  });

  it("detects dingtalk doc login wall", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("<html><body><div>请登录钉钉文档</div></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    const result = await fetchUrlContent({
      url: "https://alidocs.dingtalk.com/i/docs/abc",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result).toMatchObject({ ok: false, reason: "login_wall_or_empty" });
  });

  it("treats empty dingtalk spa pages as login-wall content", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("<html><head><title>DingTalk AI</title></head><body><div id=\"root\"></div><script>app()</script></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    const result = await fetchUrlContent({
      url: "https://shanji.dingtalk.com/app/transcribes/demo",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result).toMatchObject({ ok: false, reason: "login_wall_or_empty" });
    if (!result.ok) expect(result.hint).toContain("钉钉");
  });
});
