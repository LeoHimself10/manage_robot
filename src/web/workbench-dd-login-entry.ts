/**
 * Browser bundle entry for /workbench DingTalk free login.
 * Built with: npm run build:workbench-login
 */
import * as dd from "dingtalk-jsapi";

declare global {
  interface Window {
    __WB_CONFIGURED_CORP_ID?: string;
    __wbTryDingTalkLogin?: () => Promise<void>;
    /** Legacy container global (may coexist with npm SDK). */
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

async function resolveCorpId(configured: string): Promise<string> {
  const trimmed = configured.trim();
  if (trimmed) return trimmed;

  try {
    const res = await dd.getCurrentCorpId({});
    const id = res?.corpId ? String(res.corpId).trim() : "";
    if (id) return id;
  } catch {
    // ignore — fall through to legacy
  }

  const legacy = window.dd?.corpId;
  if (legacy && String(legacy).trim()) return String(legacy).trim();

  return "";
}

async function authCodeViaNpmSdk(corpId: string): Promise<string> {
  const res = await dd.getAuthCode({ corpId });
  const code = res?.authCode ? String(res.authCode).trim() : "";
  if (!code) throw new Error("getAuthCode returned empty");
  return code;
}

function authCodeViaLegacyRuntime(corpId: string): Promise<string> {
  const w = window.dd;
  return new Promise((resolve, reject) => {
    if (!w?.runtime?.permission?.requestAuthCode) {
      reject(new Error("requestAuthCode is unavailable"));
      return;
    }
    w.runtime.permission.requestAuthCode({
      corpId,
      onSuccess: (res) => {
        resolve(String(res.code || res.authCode || "").trim());
      },
      onFail: (err) => {
        reject(new Error(err?.errorMessage || err?.message || "requestAuthCode failed"));
      },
    });
  });
}

function authCodeViaLegacyGetAuthCode(corpId: string): Promise<string> {
  const w = window.dd;
  return new Promise((resolve, reject) => {
    if (typeof w?.getAuthCode !== "function") {
      reject(new Error("getAuthCode is unavailable"));
      return;
    }
    w.getAuthCode({
      corpId,
      success: (res) => resolve(String(res.authCode || res.code || "").trim()),
      fail: (err) =>
        reject(new Error(err?.errorMessage || err?.message || "getAuthCode failed")),
    });
  });
}

function authCodeViaLegacyRequestAuthCode(corpId: string): Promise<string> {
  const w = window.dd;
  return new Promise((resolve, reject) => {
    if (typeof w?.requestAuthCode !== "function") {
      reject(new Error("requestAuthCode (legacy) is unavailable"));
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
  const configured = window.__WB_CONFIGURED_CORP_ID ?? "";

  const corpId = await resolveCorpId(configured);
  if (!corpId) {
    setSsoHint("未获取到 corpId：请在钉钉内打开，或在服务端配置 DINGTALK_CORP_ID 作为兜底。");
    setResult("请确认应用在钉钉容器中打开，或联系管理员配置企业 corpId。");
    return;
  }

  setSsoHint("检测到钉钉环境，正在自动免登...");
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
      body: JSON.stringify({ authCode }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; redirectTo?: string };
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    setResult("免登成功，正在跳转...");
    window.location.href = data.redirectTo || "/workbench";
  } catch (err) {
    setResult(`免登失败：${errMsg(err)}`);
  }
}

window.__wbTryDingTalkLogin = tryDingTalkLogin;
