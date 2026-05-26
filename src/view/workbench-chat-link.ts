function readPublicBaseUrl(): string | null {
  const u = process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL?.trim();
  if (!u) return null;
  return u.replace(/\/+$/, "");
}

export interface ManagerChatDeepLinkInput {
  threadId?: "main" | string;
  threadKind?: "main" | "side";
}

/** Public workbench chat URL for manager planning assistant. */
export function buildManagerChatDeepLink(input: ManagerChatDeepLinkInput = {}): string | null {
  const base = readPublicBaseUrl();
  if (!base) return null;
  const kind = input.threadKind ?? (input.threadId === "main" || !input.threadId ? "main" : "side");
  if (kind === "main" || input.threadId === "main" || !input.threadId) {
    return `${base}/workbench/manager/chat?thread=main`;
  }
  const threadId = String(input.threadId ?? "").trim();
  if (!threadId) return `${base}/workbench/manager/chat?thread=main`;
  return `${base}/workbench/manager/chat?thread=side&threadId=${encodeURIComponent(threadId)}`;
}

export function appendWorkbenchChatLinkFooter(markdown: string, link: string | null): string {
  if (!link) return markdown;
  const trimmed = markdown.trim();
  const footer = `\n\n---\n[在工作台继续编辑草案](${link})`;
  return trimmed ? `${trimmed}${footer}` : footer.trimStart();
}
