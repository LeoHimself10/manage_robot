import { describe, expect, it } from "vitest";
import { formatWorkbenchAssistantHtml } from "../../src/web/workbench-markdown-lite";

describe("formatWorkbenchAssistantHtml", () => {
  it("escapes HTML and preserves paragraphs", () => {
    const html = formatWorkbenchAssistantHtml("Hello <script>x</script>\n\nSecond");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("</p><p");
  });
});
