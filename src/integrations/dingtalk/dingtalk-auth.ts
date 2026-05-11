interface AccessTokenCache {
  token: string;
  expiresAtMs: number;
}

interface DingTalkTokenResponse {
  accessToken?: string;
  expireIn?: number;
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
}

interface DingTalkUserInfoResponse {
  errcode?: number;
  errmsg?: string;
  result?: {
    userid?: string;
    name?: string;
    unionid?: string;
    associated_unionid?: string;
    sys?: boolean;
    sys_level?: number;
    device_id?: string;
  };
}

export interface DingTalkIdentity {
  userId: string;
  name?: string;
  unionId?: string;
  associatedUnionId?: string;
  isAdmin?: boolean;
  sysLevel?: number;
  deviceId?: string;
}

export class DingTalkAuthError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "CONFIG_MISSING"
      | "AUTH_CODE_REQUIRED"
      | "AUTH_CODE_INVALID"
      | "TOKEN_REQUEST_FAILED"
      | "USERINFO_REQUEST_FAILED",
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "DingTalkAuthError";
  }
}

export interface DingTalkAuthClient {
  resolveIdentityByAuthCode(authCode: string): Promise<DingTalkIdentity>;
}

interface CreateClientOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const TOKEN_REFRESH_SKEW_MS = 30_000;

const TOKEN_ENDPOINT = "https://api.dingtalk.com/v1.0/oauth2/accessToken";
const USERINFO_ENDPOINT = "https://oapi.dingtalk.com/topapi/v2/user/getuserinfo";

function getEnvOrEmpty(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function readDingTalkCredentials(): { appKey: string; appSecret: string } {
  const appKey = getEnvOrEmpty("DINGTALK_CLIENT_ID");
  const appSecret = getEnvOrEmpty("DINGTALK_CLIENT_SECRET");
  if (!appKey || !appSecret) {
    throw new DingTalkAuthError(
      "DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET is required",
      "CONFIG_MISSING",
      500,
    );
  }
  return { appKey, appSecret };
}

function pickToken(body: DingTalkTokenResponse): { token: string; expiresIn: number } {
  const token = String(body.accessToken ?? body.access_token ?? "").trim();
  const expiresInRaw = Number(body.expireIn ?? body.expires_in ?? 7200);
  const expiresIn = Number.isFinite(expiresInRaw) && expiresInRaw > 0 ? expiresInRaw : 7200;
  if (!token) {
    throw new DingTalkAuthError(
      `DingTalk token response missing access token: ${JSON.stringify(body)}`,
      "TOKEN_REQUEST_FAILED",
      502,
    );
  }
  return { token, expiresIn };
}

function shouldTreatAuthCodeInvalid(errcode?: number, errmsg?: string): boolean {
  if (errcode !== undefined && [40078, 40079, 40086].includes(errcode)) return true;
  const msg = String(errmsg ?? "").toLowerCase();
  return (
    (msg.includes("code") || msg.includes("auth")) &&
    (msg.includes("invalid") || msg.includes("expire") || msg.includes("used"))
  );
}

function shouldRefreshToken(errcode?: number, errmsg?: string): boolean {
  if (errcode !== undefined && [88, 40014].includes(errcode)) return true;
  const msg = String(errmsg ?? "").toLowerCase();
  return msg.includes("token") && (msg.includes("expired") || msg.includes("invalid"));
}

export function getDingTalkCorpId(): string | undefined {
  const direct = getEnvOrEmpty("DINGTALK_CORP_ID");
  if (direct) return direct;
  const compatible = getEnvOrEmpty("DINGTALK_CORP_ID_ALT");
  return compatible || undefined;
}

export function createDingTalkAuthClient(options: CreateClientOptions = {}): DingTalkAuthClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  let tokenCache: AccessTokenCache | undefined;

  async function getAppAccessToken(forceRefresh = false): Promise<string> {
    const currentNow = now();
    if (
      !forceRefresh &&
      tokenCache &&
      tokenCache.expiresAtMs - TOKEN_REFRESH_SKEW_MS > currentNow
    ) {
      return tokenCache.token;
    }
    const creds = readDingTalkCredentials();
    const response = await fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appKey: creds.appKey,
        appSecret: creds.appSecret,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as DingTalkTokenResponse;
    if (!response.ok || (typeof body.errcode === "number" && body.errcode !== 0)) {
      throw new DingTalkAuthError(
        `DingTalk token request failed: ${response.status} ${JSON.stringify(body)}`,
        "TOKEN_REQUEST_FAILED",
        502,
      );
    }
    const { token, expiresIn } = pickToken(body);
    tokenCache = {
      token,
      expiresAtMs: currentNow + expiresIn * 1000,
    };
    return token;
  }

  async function fetchUserInfo(
    appAccessToken: string,
    authCode: string,
  ): Promise<DingTalkUserInfoResponse> {
    const response = await fetchImpl(
      `${USERINFO_ENDPOINT}?access_token=${encodeURIComponent(appAccessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: authCode }),
      },
    );
    const body = (await response.json().catch(() => ({}))) as DingTalkUserInfoResponse;
    if (!response.ok) {
      throw new DingTalkAuthError(
        `DingTalk getuserinfo HTTP ${response.status}: ${JSON.stringify(body)}`,
        "USERINFO_REQUEST_FAILED",
        502,
      );
    }
    return body;
  }

  async function resolveIdentityByAuthCode(authCode: string): Promise<DingTalkIdentity> {
    const code = String(authCode ?? "").trim();
    if (!code) {
      throw new DingTalkAuthError("authCode is required", "AUTH_CODE_REQUIRED", 400);
    }

    let appAccessToken = await getAppAccessToken(false);
    let body = await fetchUserInfo(appAccessToken, code);
    if (
      typeof body.errcode === "number" &&
      body.errcode !== 0 &&
      shouldRefreshToken(body.errcode, body.errmsg)
    ) {
      appAccessToken = await getAppAccessToken(true);
      body = await fetchUserInfo(appAccessToken, code);
    }

    if (typeof body.errcode === "number" && body.errcode !== 0) {
      if (shouldTreatAuthCodeInvalid(body.errcode, body.errmsg)) {
        throw new DingTalkAuthError(
          `DingTalk authCode invalid: ${body.errmsg ?? body.errcode}`,
          "AUTH_CODE_INVALID",
          401,
        );
      }
      throw new DingTalkAuthError(
        `DingTalk getuserinfo failed: ${JSON.stringify(body)}`,
        "USERINFO_REQUEST_FAILED",
        502,
      );
    }

    const userId = String(body.result?.userid ?? "").trim();
    if (!userId) {
      throw new DingTalkAuthError(
        `DingTalk getuserinfo missing userid: ${JSON.stringify(body)}`,
        "USERINFO_REQUEST_FAILED",
        502,
      );
    }

    return {
      userId,
      name: body.result?.name,
      unionId: body.result?.unionid,
      associatedUnionId: body.result?.associated_unionid,
      isAdmin: body.result?.sys,
      sysLevel: body.result?.sys_level,
      deviceId: body.result?.device_id,
    };
  }

  return {
    resolveIdentityByAuthCode,
  };
}
