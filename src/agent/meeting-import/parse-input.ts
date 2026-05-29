import { createHash } from "node:crypto";
import { fetchUrlContent } from "../../integrations/url-fetch/fetch-url-content";
import { validateUrlForFetch } from "../../security/url-fetch-guard";
import { parseRosterFile } from "../assignment/roster-parser";
import type { MeetingImportActionItem } from "./types";
import { extractActionItemsFromText } from "./extract-action-items";

export interface ParseMeetingInputResult {
  text: string;
  warnings: string[];
  sourceTextHash: string;
}

export async function parseMeetingDocumentInput(input: {
  pastedText?: string;
  docUrl?: string;
  file?: { filename: string; mimeType?: string; buffer: Buffer };
}): Promise<ParseMeetingInputResult> {
  const warnings: string[] = [];
  const parts: string[] = [];

  const pasted = String(input.pastedText ?? "").trim();
  if (pasted) parts.push(pasted);

  const url = String(input.docUrl ?? "").trim();
  if (url) {
    const guard = await validateUrlForFetch(url);
    if (!guard.ok) {
      warnings.push(guard.reason ?? "url_not_allowed");
      if (guard.hint) warnings.push(guard.hint);
    } else {
      const fetched = await fetchUrlContent({ url });
      if (fetched.ok) {
        parts.push(String(fetched.text ?? "").trim());
      } else {
        warnings.push(fetched.reason ?? "fetch_failed");
        if (fetched.hint) warnings.push(fetched.hint);
      }
    }
  }

  if (input.file?.buffer?.length) {
    const parsed = await parseRosterFile({
      filename: input.file.filename,
      mimeType: input.file.mimeType,
      buffer: input.file.buffer,
    });
    if (parsed.ok) {
      parts.push(parsed.text.trim());
    } else {
      warnings.push(parsed.message);
    }
  }

  const text = parts.filter(Boolean).join("\n\n").trim();
  const sourceTextHash = createHash("sha256").update(text).digest("hex");
  return { text, warnings, sourceTextHash };
}

export async function parseMeetingDocumentToItems(input: {
  pastedText?: string;
  docUrl?: string;
  file?: { filename: string; mimeType?: string; buffer: Buffer };
  meetingTitle?: string;
  meetingDate?: string;
}): Promise<{
  items: MeetingImportActionItem[];
  warnings: string[];
  sourceTextHash: string;
  text: string;
}> {
  const parsed = await parseMeetingDocumentInput(input);
  if (!parsed.text) {
    return { items: [], warnings: [...parsed.warnings, "empty_content"], sourceTextHash: parsed.sourceTextHash, text: "" };
  }
  const items = await extractActionItemsFromText({
    text: parsed.text,
    meetingTitle: input.meetingTitle,
    meetingDate: input.meetingDate,
  });
  return { items, warnings: parsed.warnings, sourceTextHash: parsed.sourceTextHash, text: parsed.text };
}
