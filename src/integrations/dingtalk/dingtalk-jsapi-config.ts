import { createHash, randomBytes } from "node:crypto";

const TOKEN_ENDPOINT = "https://api.dingtalk.com/v1.0/oauth2/accessToken";
const JSAPI_TICKET_URL = "https://oapi.dingtalk.com/get_jsapi_ticket";

function getEnvOrEmpty(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function readDingTalkCredentials(): { appKey: string; appSecret: string } {
  const appKey = getEnvOrEmpty("DINGTALK_CLIENT_ID");
  const appSecret = getEnvOrEmpty("DINGTALK_CLIENT_SECRET");
  if (!appKey || !appSecret) {
    throw new Error("DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET is required");
  }
  return { appKey, appSecret };
}

interface TokenBody {
  accessToken?: string;
  expireIn?: number;
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
}

function pickToken(body: TokenBody): { token: string; expiresIn: number } {
  const token = String(body.accessToken ?? body.access_token ?? "").trim();
  const expiresIn = Number(body.expireIn ?? body.expires_in ?? 7200);
  if (!token) throw new Error("DingTalk token response missing access token");
  return { token, expiresIn: Number.isFinite(expiresIn) ? expiresIn : 7200 };
}

let accessTokenCache: { token: string; expiresAtMs: number } | undefined;
let jsapiTicketCache: { ticket: string; expiresAtMs: number } | undefined;

const TOKEN_SKEW_MS = 30_000;

async function getInternalAccessToken(): Promise<string> {
  const now = Date.now();
  if (
    accessTokenCache &&
    accessTokenCache.expiresAtMs - TOKEN_SKEW_MS > now
  ) {
    return accessTokenCache.token;
  }
  const creds = readDingTalkCredentials();
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appKey: creds.appKey,
      appSecret: creds.appSecret,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as TokenBody;
  if (!response.ok || (typeof body.errcode === "number" && body.errcode !== 0)) {
    throw new Error(`DingTalk accessToken failed: ${response.status} ${JSON.stringify(body)}`);
  }
  const { token, expiresIn } = pickToken(body);
  accessTokenCache = {
    token,
    expiresAtMs: now + expiresIn * 1000,
  };
  return token;
}

interface JsapiTicketBody {
  errcode?: number;
  errmsg?: string;
  ticket?: string;
  expires_in?: number;
}

async function getJsapiTicket(): Promise<string> {
  const now = Date.now();
  if (jsapiTicketCache && jsapiTicketCache.expiresAtMs - TOKEN_SKEW_MS > now) {
    return jsapiTicketCache.ticket;
  }
  const accessToken = await getInternalAccessToken();
  const url = `${JSAPI_TICKET_URL}?access_token=${encodeURIComponent(accessToken)}`;
  const response = await fetch(url, { method: "GET" });
  const body = (await response.json().catch(() => ({}))) as JsapiTicketBody;
  if (!response.ok || body.errcode !== 0 || !body.ticket) {
    throw new Error(`DingTalk jsapi_ticket failed: ${response.status} ${JSON.stringify(body)}`);
  }
  const ticket = String(body.ticket);
  const expiresIn = Number(body.expires_in ?? 7200);
  jsapiTicketCache = {
    ticket,
    expiresAtMs: now + (Number.isFinite(expiresIn) ? expiresIn : 7200) * 1000,
  };
  return ticket;
}

/** 钉钉文档：plain = jsapi_ticket & noncestr & timestamp & url，再 SHA1。 */
export function computeJsapiSignature(params: {
  jsapiTicket: string;
  nonceStr: string;
  timeStamp: string;
  url: string;
}): string {
  const plain = `jsapi_ticket=${params.jsapiTicket}&noncestr=${params.nonceStr}&timestamp=${params.timeStamp}&url=${params.url}`;
  return createHash("sha1").update(plain, "utf8").digest("hex");
}

export function randomNonceStr(): string {
  return randomBytes(16).toString("hex");
}

export interface WorkbenchJsapiConfigPayload {
  corpId: string;
  agentId: string;
  timeStamp: string;
  nonceStr: string;
  signature: string;
}

export async function buildWorkbenchJsapiConfig(pageUrl: string): Promise<WorkbenchJsapiConfigPayload> {
  const corpId = getEnvOrEmpty("DINGTALK_CORP_ID") || getEnvOrEmpty("DINGTALK_CORP_ID_ALT");
  const agentId = getEnvOrEmpty("DINGTALK_AGENT_ID");
  if (!corpId) {
    throw new Error("DINGTALK_CORP_ID is required for JSAPI config (dd.config)");
  }
  if (!agentId) {
    throw new Error("DINGTALK_AGENT_ID is required for JSAPI config (微应用在开放平台上的 AgentId)");
  }
  const ticket = await getJsapiTicket();
  const nonceStr = randomNonceStr();
  const timeStamp = String(Math.floor(Date.now() / 1000));
  const signature = computeJsapiSignature({
    jsapiTicket: ticket,
    nonceStr,
    timeStamp,
    url: pageUrl,
  });
  return {
    corpId,
    agentId,
    timeStamp,
    nonceStr,
    signature,
  };
}
