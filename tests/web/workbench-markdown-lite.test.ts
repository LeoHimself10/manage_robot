import { describe, expect, it } from "vitest";
import { formatWorkbenchAssistantHtml } from "../../src/web/workbench-markdown-lite";

describe("formatWorkbenchAssistantHtml", () => {
  it("escapes HTML and preserves paragraphs", () => {
    const html = formatWorkbenchAssistantHtml("Hello <script>x</script>\n\nSecond");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toMatch(/msg-md-p/);
    expect(html).toContain("Second");
  });

  it("renders headings, bold, lists, and horizontal rules", () => {
    const html = formatWorkbenchAssistantHtml("### Title\n\n#### Detail\n\n###### Note\n\n**bold** line\n\n- one\n- two\n\n---\n\nend");
    expect(html).toContain("msg-md-h3");
    expect(html).toContain('<h4 class="msg-md-h msg-md-h4">Detail</h4>');
    expect(html).toContain('<h6 class="msg-md-h msg-md-h6">Note</h6>');
    expect(html).toContain("<strong");
    expect(html).toContain("msg-md-ul");
    expect(html).toContain("msg-md-hr");
    expect(html).toContain("end");
  });

  it("renders fenced code, tables, and safe links", () => {
    const md = [
      "```",
      "code <x>",
      "```",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "[ok](https://example.com/path)",
    ].join("\n");
    const html = formatWorkbenchAssistantHtml(md);
    expect(html).toContain("msg-md-pre");
    expect(html).toContain("&lt;x&gt;");
    expect(html).toContain("msg-md-table");
    expect(html).toContain('href="https://example.com/path"');
  });

  it("does not emit anchor for javascript: URLs", () => {
    const html = formatWorkbenchAssistantHtml("[bad](javascript:alert(1))");
    expect(html).not.toContain("href=");
    expect(html).toContain("javascript:alert(1)");
  });

  it("escapes script-like content instead of executing (XSS regression)", () => {
    const html = formatWorkbenchAssistantHtml('<script>alert(1)</script>');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("&lt;script&gt;");
  });

  it("converts br tags to line breaks instead of leaking literal br", () => {
    const html = formatWorkbenchAssistantHtml("第一行<br>第二行<br/>第三行");
    expect(html).not.toContain("<br>");
    expect(html).not.toContain("&lt;br");
    expect(html).toContain("第一行");
    expect(html).toContain("第二行");
    expect(html).toContain("第三行");
  });
});
