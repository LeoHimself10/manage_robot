/**
 * Minimal assistant-message formatting: escape HTML, preserve paragraphs and line breaks.
 * Intentionally avoids full Markdown to reduce XSS surface; no raw HTML passthrough.
 */
export function formatWorkbenchAssistantHtml(raw: string): string {
  const text = String(raw ?? "");
  const esc = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  const blocks = esc.split(/\n\n+/);
  return blocks
    .map((block) => {
      const inner = block.replace(/\n/g, "<br />");
      return `<p class="msg-md-p">${inner}</p>`;
    })
    .join("");
}
