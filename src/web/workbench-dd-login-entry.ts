/**
 * Browser bundle entry for /workbench DingTalk free login.
 * Built with: npm run build:workbench-login
 */
import * as dd from "dingtalk-jsapi";

declare global {
  interface Window {
    __WB_CONFIGURED_CORP_ID?: string;
    __WB_TEST_LOGIN_ENABLED?: boolean;
    __wbTryDingTalkLogin?: () => Promise<void>;
    /** Legacy DingTalk container global; older webviews may expose this API surface. */
    dd?: legacyDingTalkContainer & Record<string, unknown>;
  }
}

type legacyDingTalkContainer = {
  corpId?: string;
  runtime?: {
    permission?: {
      requestAuthCode?: (opts: {
        corpId: string;
        onSuccess: (res: { code?: string; authCode?: string }) => void;
        onFail: (err: { errorMessage?: string; message?: string }) => void;
      }) => void;
    };
  };
  getAuthCode?: (opts: {
    corpId: string;
    success: (res: { authCode?: string; code?: string }) => void;
    fail: (err: { errorMessage?: string; message?: string }) => void;
  }) => void;
  requestAuthCode?: (opts: {
    corpId: string;
    onSuccess: (res: { code?: string; authCode?: string }) => void;
    onFail: (err: { errorMessage?: string; message?: string }) => void;
  }) => void;
};

type JsapiConfigPayload = {
  corpId: string;
  agentId: string;
  timeStamp: string;
  nonceStr: string;
  signature: string;
};

type DingTalkCore = typeof dd & {
  config?: (p: Record<string, unknown>) => void;
  ready?: (cb: () => void) => void;
  error?: (cb: (err: unknown) => void) => void;
};

function setSsoHint(msg: string): void {
  const el = document.getElementById("ssoHint");
  if (el) el.textContent = msg;
}

function setResult(msg: string): void {
  const el = document.getElementById("result");
  if (el) el.textContent = msg;
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function getQueryValue(...names: string[]): string {
  try {
    const search = new URLSearchParams(window.location.search);
    for (const name of names) {
      const value = search.get(name)?.trim();
      if (value) return value;
    }
  } catch {
    // ignore malformed location/search in unusual webviews
  }
  return "";
}

function readWorkbenchNextPath(): string {
  const next = getQueryValue("next");
  if (
    next &&
    next.startsWith("/workbench/") &&
    !next.startsWith("//") &&
    !next.includes("\\") &&
    !next.includes("//")
  ) {
    return next;
  }
  if (window.location.pathname && window.location.pathname !== "/workbench") {
    return `${window.location.pathname}${window.location.search}`;
  }
  return "";
}

function isLikelyDingTalkWebview(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  return (
    ua.includes("dingtalk") ||
    ua.includes("aliapp") ||
    Boolean(window.dd) ||
    Boolean((dd as unknown as Record<string, unknown>).env)
  );
}

async function resolveCorpId(configured: string): Promise<string> {
  const trimmed = configured.trim();
  if (trimmed) return trimmed;

  const queryCorpId = getQueryValue("corpId", "corp_id", "corpid");
  if (queryCorpId) return queryCorpId;

  try {
    const res = await dd.getCurrentCorpId({});
    const id = res?.corpId ? String(res.corpId).trim() : "";
    if (id) return id;
  } catch {
    // fall through to legacy APIs
  }

  const legacy = window.dd?.corpId;
  if (legacy && String(legacy).trim()) return String(legacy).trim();

  return "";
}

async function authCodeViaNpmSdk(corpId: string): Promise<string> {
  const res = await dd.getAuthCode({ corpId });
  const code = String(res?.authCode || (res as { code?: string })?.code || "").trim();
  if (!code) throw new Error("getAuthCode returned empty");
  return code;
}

function authCodeViaLegacyRuntime(corpId: string): Promise<string> {
  const w = window.dd;
  return new Promise((resolve, reject) => {
    if (!w?.runtime?.permission?.requestAuthCode) {
      reject(new Error("runtime.permission.requestAuthCode is unavailable"));
      return;
    }
    w.runtime.permission.requestAuthCode({
      corpId,
      onSuccess: (res) => resolve(String(res.code || res.authCode || "").trim()),
      onFail: (err) =>
        reject(new Error(err?.errorMessage || err?.message || "requestAuthCode failed")),
    });
  });
}

function authCodeViaLegacyGetAuthCode(corpId: string): Promise<string> {
  const w = window.dd;
  return new Promise((resolve, reject) => {
    if (typeof w?.getAuthCode !== "function") {
      reject(new Error("dd.getAuthCode is unavailable"));
      return;
    }
    w.getAuthCode({
      corpId,
      success: (res) => resolve(String(res.authCode || res.code || "").trim()),
      fail: (err) => reject(new Error(err?.errorMessage || err?.message || "getAuthCode failed")),
    });
  });
}

function authCodeViaLegacyRequestAuthCode(corpId: string): Promise<string> {
  const w = window.dd;
  return new Promise((resolve, reject) => {
    if (typeof w?.requestAuthCode !== "function") {
      reject(new Error("dd.requestAuthCode is unavailable"));
      return;
    }
    w.requestAuthCode({
      corpId,
      onSuccess: (res) => resolve(String(res.code || res.authCode || "").trim()),
      onFail: (err) =>
        reject(new Error(err?.errorMessage || err?.message || "requestAuthCode failed")),
    });
  });
}

async function fetchJsapiConfigPayload(pageUrl: string): Promise<{
  payload: JsapiConfigPayload | null;
  serverError: string;
}> {
  try {
    const res = await fetch(
      `/api/workbench/auth/jsapi-config?url=${encodeURIComponent(pageUrl)}`,
    );
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      corpId?: string;
      agentId?: string;
      timeStamp?: string;
      nonceStr?: string;
      signature?: string;
    };
    if (!res.ok || !data.ok) {
      return {
        payload: null,
        serverError: typeof data.error === "string" ? data.error : `HTTP ${res.status}`,
      };
    }
    const payload: JsapiConfigPayload = {
      corpId: String(data.corpId ?? "").trim(),
      agentId: String(data.agentId ?? "").trim(),
      timeStamp: String(data.timeStamp ?? "").trim(),
      nonceStr: String(data.nonceStr ?? "").trim(),
      signature: String(data.signature ?? "").trim(),
    };
    if (!payload.corpId || !payload.agentId || !payload.signature) {
      return { payload: null, serverError: "JSAPI config response is incomplete" };
    }
    return { payload, serverError: "" };
  } catch (e) {
    return { payload: null, serverError: errMsg(e) };
  }
}

async function applyDdConfig(payload: JsapiConfigPayload): Promise<void> {
  const api = dd as DingTalkCore;
  if (
    typeof api.config !== "function" ||
    typeof api.ready !== "function" ||
    typeof api.error !== "function"
  ) {
    throw new Error("dd.config is unavailable");
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const once = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    api.error?.((err: unknown) => {
      once(() => reject(err instanceof Error ? err : new Error(errMsg(err))));
    });
    api.ready?.(() => once(() => resolve()));
    api.config?.({
      agentId: payload.agentId,
      corpId: payload.corpId,
      timeStamp: payload.timeStamp,
      nonceStr: payload.nonceStr,
      signature: payload.signature,
      type: 0,
      jsApiList: ["getAuthCode", "getCurrentCorpId", "runtime.permission.requestAuthCode"],
    });
  });
}

async function resolveAuthCode(corpId: string): Promise<string> {
  const attempts: Array<() => Promise<string>> = [
    () => authCodeViaNpmSdk(corpId),
    () => authCodeViaLegacyRuntime(corpId),
    () => authCodeViaLegacyGetAuthCode(corpId),
    () => authCodeViaLegacyRequestAuthCode(corpId),
  ];
  let lastErr: unknown;
  for (const fn of attempts) {
    try {
      const code = await fn();
      if (code) return code;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("无法获取 authCode");
}

async function tryDingTalkLogin(): Promise<void> {
  const testLoginEnabled = window.__WB_TEST_LOGIN_ENABLED === true;
  if (!isLikelyDingTalkWebview()) {
    if (testLoginEnabled) {
      setSsoHint("当前不是钉钉容器，已跳过自动免登。可用下方入口进入对应页面。");
      setResult("在钉钉工作台打开 /workbench 后会自动免登。");
    } else {
      setSsoHint("请在钉钉工作台中打开本应用。");
      setResult("当前页面需在钉钉内访问以完成自动登录。");
    }
    return;
  }

  const configured = window.__WB_CONFIGURED_CORP_ID ?? "";
  const pageUrl = typeof location !== "undefined" ? location.href.split("#")[0] : "";
  let corpId = "";
  let serverJsapiHint = "";

  if (pageUrl) {
    const { payload, serverError } = await fetchJsapiConfigPayload(pageUrl);
    serverJsapiHint = serverError;
    if (payload) {
      try {
        setSsoHint(testLoginEnabled ? "正在进行钉钉 JSAPI 鉴权（dd.config）…" : "正在验证钉钉身份…");
        await applyDdConfig(payload);
        corpId = payload.corpId;
      } catch (err) {
        setSsoHint(
          testLoginEnabled
            ? `JSAPI 鉴权失败：${errMsg(err)}。将尝试兼容免登路径。`
            : "身份验证遇到问题，正在尝试其他方式…",
        );
      }
    }
  }

  if (!corpId) corpId = await resolveCorpId(configured);

  if (!corpId) {
    const extra =
      testLoginEnabled &&
      serverJsapiHint &&
      !serverJsapiHint.includes("fetch") &&
      serverJsapiHint.length < 220
        ? ` 服务端返回：${serverJsapiHint}`
        : "";
    setSsoHint(
      testLoginEnabled
        ? "未获取到 corpId。请配置 DINGTALK_CORP_ID 和 DINGTALK_AGENT_ID，或临时用 /workbench?corpId=dingxxxx 兜底。" +
            extra
        : "暂时无法连接钉钉账号，请稍后重试或联系管理员。",
    );
    setResult(
      testLoginEnabled
        ? "若在钉钉内仍失败：请核对微应用 AgentId、应用首页 URL 与当前页面 URL 一致，并确认已开通免登/JSAPI 权限。"
        : "请确认您从钉钉工作台打开本应用，且网络连接正常。",
    );
    return;
  }

  setSsoHint("正在登录…");
  let authCode = "";
  try {
    authCode = await resolveAuthCode(corpId);
  } catch (err) {
    setResult(`免登失败：${errMsg(err)}`);
    return;
  }

  if (!authCode) {
    setResult("免登失败：无法获取 authCode");
    return;
  }

  try {
    const res = await fetch("/api/workbench/auth/dingtalk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authCode, next: readWorkbenchNextPath() }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      redirectTo?: string;
    };
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    setResult("登录成功，正在跳转…");
    window.location.href = data.redirectTo || "/workbench";
  } catch (err) {
    setResult(`免登失败：${errMsg(err)}`);
  }
}

window.__wbTryDingTalkLogin = tryDingTalkLogin;
