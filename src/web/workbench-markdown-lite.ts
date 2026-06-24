/**
 * Minimal assistant-message Markdown → HTML: **escape first**, then apply a small
 * controlled grammar (no raw HTML passthrough). Intentionally dependency-free.
 */

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replaceAll("\n", " ");
}

/** Only http(s) / mailto; blocks javascript:, data:, vbscript:, etc. */
function sanitizeHref(raw: string): string | null {
  const u = raw.trim();
  if (!u) return null;
  const lower = u.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:")
  ) {
    return null;
  }
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u)) {
    return u;
  }
  return null;
}

function isTableSeparatorLine(line: string): boolean {
  const t = line.trim();
  if (!t.includes("|")) return false;
  return /^(\s*\|)?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(t);
}

function isProbableTableRow(line: string): boolean {
  const t = line.trim();
  return t.includes("|") && /\|.+\|/.test(t);
}

function splitTableRow(line: string): string[] {
  let l = line.trim();
  if (l.startsWith("|")) l = l.slice(1);
  if (l.endsWith("|")) l = l.slice(0, -1);
  return l.split("|").map((c) => c.trim());
}

function formatNonCodeSegment(text: string): string {
  // Links [label](url) — left-to-right, non-nested
  let out = "";
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("[", i);
    if (open === -1) {
      out += applyBoldItalic(text.slice(i));
      break;
    }
    out += applyBoldItalic(text.slice(i, open));
    const closeBracket = text.indexOf("]", open + 1);
    if (closeBracket === -1) {
      out += applyBoldItalic(text.slice(open));
      break;
    }
    if (text[closeBracket + 1] !== "(") {
      out += applyBoldItalic(text.slice(open, open + 1));
      i = open + 1;
      continue;
    }
    const closeParen = text.indexOf(")", closeBracket + 2);
    if (closeParen === -1) {
      out += applyBoldItalic(text.slice(open));
      break;
    }
    const label = text.slice(open + 1, closeBracket);
    const urlRaw = text.slice(closeBracket + 2, closeParen);
    const safe = sanitizeHref(urlRaw);
    if (safe) {
      out += `<a class="msg-md-a" href="${escapeAttr(safe)}" rel="noopener noreferrer">${applyBoldItalic(label)}</a>`;
      i = closeParen + 1;
    } else {
      out += applyBoldItalic(text.slice(open, closeParen + 1));
      i = closeParen + 1;
    }
  }
  return out;
}

function applyBoldItalic(text: string): string {
  // **bold** first
  let t = text;
  t = t.replace(/\*\*(.+?)\*\*/g, (_m, inner: string) => `<strong class="msg-md-strong">${inner}</strong>`);
  // _italic_ (underscore)
  t = t.replace(/(^|[^\\])_([^_]+)_/g, (_m, pre: string, inner: string) => `${pre}<em class="msg-md-em">${inner}</em>`);
  // *italic* — avoid ** already consumed; single asterisk pairs
  t = t.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, (_m, inner: string) => `<em class="msg-md-em">${inner}</em>`);
  return t;
}

function applyInlineFormatting(text: string): string {
  let i = 0;
  let out = "";
  while (i < text.length) {
    const bi = text.indexOf("`", i);
    if (bi === -1) {
      out += formatNonCodeSegment(text.slice(i));
      break;
    }
    out += formatNonCodeSegment(text.slice(i, bi));
    const bj = text.indexOf("`", bi + 1);
    if (bj === -1) {
      out += formatNonCodeSegment(text.slice(bi));
      break;
    }
    const codeEsc = text.slice(bi + 1, bj);
    out += `<code class="msg-md-code">${codeEsc}</code>`;
    i = bj + 1;
  }
  return out;
}

function applyInlineToParagraphBlock(text: string): string {
  return text.split("\n").map((ln) => applyInlineFormatting(ln)).join("<br />");
}

function renderFencedBlock(lines: string[], start: number): { html: string; nextI: number } {
  let i = start + 1;
  const body: string[] = [];
  while (i < lines.length) {
    if (/^\s*```/.test(lines[i]!)) {
      i++;
      return {
        html: `<pre class="msg-md-pre"><code>${body.join("\n")}</code></pre>`,
        nextI: i,
      };
    }
    body.push(lines[i]!);
    i++;
  }
  return {
    html: `<pre class="msg-md-pre"><code>${body.join("\n")}</code></pre>`,
    nextI: i,
  };
}

function renderTableBlock(lines: string[], start: number): { html: string; nextI: number } {
  const header = splitTableRow(lines[start]!);
  let i = start + 2;
  const rows: string[][] = [];
  while (i < lines.length) {
    const ln = lines[i]!;
    if (ln.trim() === "") break;
    if (!ln.includes("|")) break;
    rows.push(splitTableRow(ln));
    i++;
  }
  const thead = `<tr>${header.map((c) => `<th>${applyInlineFormatting(c)}</th>`).join("")}</tr>`;
  const tbody = rows
    .map((r) => `<tr>${r.map((c) => `<td>${applyInlineFormatting(c)}</td>`).join("")}</tr>`)
    .join("");
  return {
    html: `<div class="msg-md-table-wrap"><table class="msg-md-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`,
    nextI: i,
  };
}

function renderBlockGroup(blockLines: string[]): string {
  if (blockLines.length === 0) return "";

  if (blockLines.every((l) => /^\s*> ?/.test(l))) {
    const inner = blockLines.map((l) => l.replace(/^\s*> ?/, "")).join("\n");
    return `<blockquote class="msg-md-bq">${applyInlineToParagraphBlock(inner)}</blockquote>`;
  }

  if (blockLines.every((l) => /^\s*[-*]\s+/.test(l))) {
    const items = blockLines.map((l) => {
      const content = l.replace(/^\s*[-*]\s+/, "");
      return `<li class="msg-md-li">${applyInlineFormatting(content)}</li>`;
    });
    return `<ul class="msg-md-ul">${items.join("")}</ul>`;
  }

  if (blockLines.every((l) => /^\s*\d+\.\s+/.test(l))) {
    const items = blockLines.map((l) => {
      const content = l.replace(/^\s*\d+\.\s+/, "");
      return `<li class="msg-md-li">${applyInlineFormatting(content)}</li>`;
    });
    return `<ol class="msg-md-ol">${items.join("")}</ol>`;
  }

  if (blockLines.length === 1) {
    const m = /^(#{1,3})\s+(.+)$/.exec(blockLines[0]!);
    if (m) {
      const level = m[1]!.length;
      const tag = `h${level}`;
      return `<${tag} class="msg-md-h msg-md-h${level}">${applyInlineFormatting(m[2]!)}</${tag}>`;
    }
  }

  const inner = applyInlineToParagraphBlock(blockLines.join("\n"));
  return `<p class="msg-md-p">${inner}</p>`;
}

function renderEscapedMarkdown(esc: string): string {
  const lines = esc.split("\n");
  const parts: string[] = [];
  let i = 0;

  const skipBlanks = (): void => {
    while (i < lines.length && lines[i]!.trim() === "") i++;
  };

  while (true) {
    skipBlanks();
    if (i >= lines.length) break;
    const line = lines[i]!;

    if (/^\s*```/.test(line)) {
      const { html, nextI } = renderFencedBlock(lines, i);
      parts.push(html);
      i = nextI;
      continue;
    }

    if (isProbableTableRow(line) && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1]!)) {
      const { html, nextI } = renderTableBlock(lines, i);
      parts.push(html);
      i = nextI;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      parts.push('<hr class="msg-md-hr" />');
      i++;
      continue;
    }

    const blockLines: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "") {
      const ln = lines[i]!;
      if (/^\s*```/.test(ln)) break;
      if (isProbableTableRow(ln) && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1]!)) {
        break;
      }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(ln)) {
        if (blockLines.length > 0) break;
        parts.push('<hr class="msg-md-hr" />');
        i++;
        continue;
      }
      // Standalone header lines get their own block regardless of what follows
      if (/^#{1,3}\s+./.test(ln) && blockLines.length === 0) {
        const m = /^(#{1,3})\s+(.*)$/.exec(ln);
        if (m) {
          const level = m[1]!.length;
          const tag = `h${level}`;
          parts.push(`<${tag} class="msg-md-h msg-md-h${level}">${applyInlineToParagraphBlock(m[2]!)}</${tag}>`);
          i++;
          continue;
        }
      }
      blockLines.push(ln);
      i++;
    }
    if (blockLines.length > 0) {
      parts.push(renderBlockGroup(blockLines));
    }
  }

  return parts.join("");
}

/**
 * Escape HTML on the full document, then render a small Markdown subset.
 * Raw HTML from the model is never passed through unescaped.
 * `<br>` from the model is normalized to newlines before escape.
 */
function normalizeAssistantMarkdownRaw(raw: string): string {
  return String(raw ?? "").replace(/<br\s*\/?>/gi, "\n");
}

export function formatWorkbenchAssistantHtml(raw: string): string {
  const esc = escapeHtml(normalizeAssistantMarkdownRaw(raw));
  return renderEscapedMarkdown(esc);
}
