function readPublicBaseUrl(): string | null {
  const u = process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL?.trim();
  if (!u) return null;
  return u.replace(/\/+$/, "");
}

export interface ManagerChatDeepLinkInput {
  threadId?: "main" | string;
  threadKind?: "main" | "side";
  /** Deep-link into Excel draft editor on chat page load. */
  openDraftEditor?: boolean;
}

function appendOpenDraftEditorParam(url: string, openDraftEditor?: boolean): string {
  if (!openDraftEditor) return url;
  const parsed = new URL(url);
  parsed.searchParams.set("openDraftEditor", "1");
  return parsed.toString();
}

/** Public workbench chat URL for manager planning assistant. */
export function buildManagerChatDeepLink(input: ManagerChatDeepLinkInput = {}): string | null {
  const base = readPublicBaseUrl();
  if (!base) return null;
  const kind = input.threadKind ?? (input.threadId === "main" || !input.threadId ? "main" : "side");
  let url: string;
  if (kind === "main" || input.threadId === "main" || !input.threadId) {
    url = `${base}/workbench/manager/chat?thread=main`;
  } else {
    const threadId = String(input.threadId ?? "").trim();
    url = !threadId
      ? `${base}/workbench/manager/chat?thread=main`
      : `${base}/workbench/manager/chat?thread=side&threadId=${encodeURIComponent(threadId)}`;
  }
  return appendOpenDraftEditorParam(url, input.openDraftEditor);
}

/**
 * Wrap a HTTPS workbench URL so DingTalk opens it inside the client (H5 微应用 / 工作台容器),
 * not the system external browser.
 */
export function wrapUrlForDingtalkClient(pageUrl: string): string {
  const disabled = String(process.env.DINGTALK_WORKBENCH_APPLINK ?? "1").trim().toLowerCase();
  if (disabled === "0" || disabled === "false" || disabled === "no") {
    return pageUrl;
  }

  const corpId =
    process.env.DINGTALK_CORP_ID?.trim() || process.env.DINGTALK_CORP_ID_ALT?.trim() || "";
  const agentId = process.env.DINGTALK_AGENT_ID?.trim() || "";

  if (corpId && agentId) {
    try {
      const parsed = new URL(pageUrl);
      const pathWithQuery = `${parsed.pathname}${parsed.search}`;
      const params = new URLSearchParams({
        appId: agentId,
        corpId,
        appType: "2",
        path: pathWithQuery,
      });
      return `https://applink.dingtalk.com/page/h5_app_open?${params.toString()}`;
    } catch {
      // fall through to page/link
    }
  }

  const encoded = encodeURIComponent(pageUrl);
  return `https://applink.dingtalk.com/page/link?url=${encoded}&target=fullScreen&targetDesktop=workbench`;
}

/** Outbound DingTalk bot markdown link — opens workbench chat inside DingTalk web app. */
export function buildManagerChatDeepLinkForDingtalkOutbound(
  input: ManagerChatDeepLinkInput = {},
): string | null {
  const direct = buildManagerChatDeepLink({ ...input, openDraftEditor: true });
  if (!direct) return null;
  return wrapUrlForDingtalkClient(direct);
}

export function appendWorkbenchChatLinkFooter(markdown: string, link: string | null): string {
  if (!link) return markdown;
  const trimmed = markdown.trim();
  const footer = `\n\n---\n[在工作台继续编辑草案](${link})`;
  return trimmed ? `${trimmed}${footer}` : footer.trimStart();
}
