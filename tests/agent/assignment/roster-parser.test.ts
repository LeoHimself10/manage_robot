import { describe, expect, it } from "vitest";
import { detectRosterKind, parseRosterFile } from "../../../src/agent/assignment/roster-parser";

describe("detectRosterKind", () => {
  it("identifies markdown by extension", () => {
    expect(detectRosterKind("roster.md")).toBe("markdown");
    expect(detectRosterKind("ROSTER.MARKDOWN")).toBe("markdown");
  });
  it("identifies docx by extension", () => {
    expect(detectRosterKind("team.docx")).toBe("docx");
  });
  it("identifies pdf by extension", () => {
    expect(detectRosterKind("members.pdf")).toBe("pdf");
  });
  it("identifies plain text", () => {
    expect(detectRosterKind("list.txt")).toBe("text");
  });
  it("returns undefined for unsupported", () => {
    expect(detectRosterKind("photo.png")).toBeUndefined();
    expect(detectRosterKind("anything.exe", "application/octet-stream")).toBeUndefined();
  });
  it("falls back to mime when extension unknown", () => {
    expect(detectRosterKind("noext", "text/markdown")).toBe("markdown");
    expect(detectRosterKind("noext", "application/pdf")).toBe("pdf");
  });
});

describe("parseRosterFile", () => {
  it("rejects empty buffers", async () => {
    const r = await parseRosterFile({ filename: "x.md", buffer: Buffer.alloc(0) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("empty_file");
  });

  it("rejects oversized files", async () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 10, "a");
    const r = await parseRosterFile({ filename: "x.md", buffer: big, maxBytes: 2 * 1024 * 1024 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("file_too_large");
  });

  it("rejects unsupported types", async () => {
    const r = await parseRosterFile({ filename: "p.png", buffer: Buffer.from("PNG") });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unsupported_type");
  });

  it("reads markdown content as utf-8 and normalizes newlines", async () => {
    const md = "# 名单\r\n- 张三 (质量)\r\n- 李四 (研发)\r\n\r\n\r\n\r\n## 备注";
    const r = await parseRosterFile({ filename: "roster.md", buffer: Buffer.from(md, "utf8") });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.kind).toBe("markdown");
      expect(r.text).toContain("# 名单");
      expect(r.text).toContain("张三");
      expect(r.text).not.toContain("\r");
      // 3+ blank lines collapsed to one blank line
      expect(r.text).not.toMatch(/\n{3,}/);
    }
  });

  it("strips BOM from utf-8 BOM markdown", async () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hello", "utf8")]);
    const r = await parseRosterFile({ filename: "x.md", buffer: buf });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text.charCodeAt(0)).not.toBe(0xfeff);
      expect(r.text).toBe("hello");
    }
  });

  it("rejects extracted-empty markdown", async () => {
    const r = await parseRosterFile({ filename: "blank.md", buffer: Buffer.from("   \n\n\t  \n", "utf8") });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("extracted_empty");
  });
});
