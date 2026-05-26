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

/** Micro-app homepage path in DingTalk (应用首页), default /workbench. */
function readWorkbenchH5AppHomePath(): string {
  const raw = process.env.WORKBENCH_H5_APP_HOME_PATH?.trim() || "/workbench";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash.replace(/\/+$/, "") || "/workbench";
}

/**
 * h5_app_open `path` is joined against the micro-app homepage URL. A leading `/workbench/...`
 * on a homepage ending with `/` yields `//workbench/...` (ERR_HTTP_RESPONSE_CODE_FAILURE).
 * Pass a path relative to the configured app home (e.g. `manager/chat?thread=main`).
 */
export function toH5AppOpenPath(pageUrl: string): string {
  const parsed = new URL(pageUrl);
  const homePath = readWorkbenchH5AppHomePath();
  let rel = parsed.pathname;
  if (homePath !== "/" && rel.startsWith(`${homePath}/`)) {
    rel = rel.slice(homePath.length + 1);
  } else if (rel.startsWith("/")) {
    rel = rel.slice(1);
  }
  return rel ? `${rel}${parsed.search}` : parsed.search.replace(/^\?/, "") || "manager/chat";
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
      const params = new URLSearchParams({
        appId: agentId,
        corpId,
        appType: "2",
        path: toH5AppOpenPath(pageUrl),
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
