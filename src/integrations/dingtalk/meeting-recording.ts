interface AccessTokenCache {
  token: string;
  expiresAtMs: number;
}

interface AccessTokenResp {
  accessToken?: string;
  access_token?: string;
  expireIn?: number;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
  code?: string;
  message?: string;
}

interface CloudRecordTextResp {
  hasMore?: boolean;
  nextToken?: number | string;
  nextTtoken?: number | string;
  paragraphList?: CloudRecordParagraph[];
  errcode?: number;
  errmsg?: string;
  code?: string;
  message?: string;
}

interface ConferenceApiResp {
  hasMore?: boolean;
  nextToken?: number | string;
  nextTtoken?: number | string;
  errcode?: number;
  errmsg?: string;
  code?: string;
  message?: string;
  [key: string]: unknown;
}

interface CloudRecordParagraph {
  unionId?: string;
  nickName?: string;
  recordId?: number | string;
  startTime?: number;
  endTime?: number;
  paragraph?: string;
  sentenceList?: Array<{
    unionId?: string;
    sentence?: string;
    startTime?: number;
    endTime?: number;
  }>;
}

export interface DingTalkMeetingTranscriptParagraph {
  unionId?: string;
  nickName?: string;
  startTime?: number;
  endTime?: number;
  text: string;
}

export interface DingTalkMeetingTranscript {
  conferenceId: string;
  text: string;
  paragraphs: DingTalkMeetingTranscriptParagraph[];
  fetchedAt: string;
}

export interface DingTalkVideoConferenceInfo {
  conferenceId: string;
  title?: string;
  roomCode?: string;
  scheduleConferenceId?: string;
  creatorUserId?: string;
  creatorUnionId?: string;
  creatorNick?: string;
  hostUnionId?: string;
  startTimeMs?: number;
  endTimeMs?: number;
  status?: string;
  flashStatus?: string;
}

export interface DingTalkVideoConferenceMember {
  unionId: string;
  userId?: string;
  nickName?: string;
  role?: string;
  rawJson?: Record<string, unknown>;
}

export type DingTalkMeetingApiErrorCode =
  | "config_missing"
  | "token_failed"
  | "permission_denied"
  | "api_error"
  | "empty_transcript";

export class DingTalkMeetingApiError extends Error {
  constructor(
    message: string,
    public readonly code: DingTalkMeetingApiErrorCode,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "DingTalkMeetingApiError";
  }
}

export interface DingTalkMeetingRecordingClient {
  getCloudRecordTranscript(input: {
    conferenceId: string;
    unionId?: string;
    maxResults?: number;
  }): Promise<DingTalkMeetingTranscript>;
  getVideoConference(input: {
    conferenceId: string;
  }): Promise<DingTalkVideoConferenceInfo>;
  listVideoConferenceMembers(input: {
    conferenceId: string;
    maxResults?: number;
  }): Promise<DingTalkVideoConferenceMember[]>;
}

function env(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function readCredentials(): { appKey: string; appSecret: string } {
  const appKey = env("DINGTALK_CLIENT_ID");
  const appSecret = env("DINGTALK_CLIENT_SECRET");
  if (!appKey || !appSecret) {
    throw new DingTalkMeetingApiError(
      "DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET is required",
      "config_missing",
      500,
    );
  }
  return { appKey, appSecret };
}

function tokenFromBody(body: AccessTokenResp): { token: string; expiresIn: number } {
  const token = String(body.accessToken ?? body.access_token ?? "").trim();
  const rawExpires = Number(body.expireIn ?? body.expires_in ?? 7200);
  const expiresIn = Number.isFinite(rawExpires) && rawExpires > 0 ? rawExpires : 7200;
  if (!token) {
    throw new DingTalkMeetingApiError(
      `DingTalk token response missing accessToken: ${JSON.stringify(body)}`,
      "token_failed",
      502,
    );
  }
  return { token, expiresIn };
}

function apiErrorCode(status: number, body: AccessTokenResp | CloudRecordTextResp | ConferenceApiResp): DingTalkMeetingApiErrorCode {
  const rawCode = String(body.code ?? body.errcode ?? "").toLowerCase();
  const rawMsg = String(body.message ?? body.errmsg ?? "").toLowerCase();
  if (status === 401 || status === 403) return "permission_denied";
  if (rawCode.includes("permission") || rawMsg.includes("permission") || rawMsg.includes("no permission")) {
    return "permission_denied";
  }
  return "api_error";
}

function collectParagraphText(row: CloudRecordParagraph): string {
  const direct = String(row.paragraph ?? "").trim();
  if (direct) return direct;
  const sentences = Array.isArray(row.sentenceList) ? row.sentenceList : [];
  return sentences.map((s) => String(s.sentence ?? "").trim()).filter(Boolean).join("");
}

function formatTranscriptLine(row: DingTalkMeetingTranscriptParagraph): string {
  const speaker = String(row.nickName ?? "").trim();
  return speaker ? `${speaker}: ${row.text}` : row.text;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

function recordCandidates(body: ConferenceApiResp): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const root = asRecord(body);
  if (root) records.push(root);
  for (const key of ["result", "data", "conference", "videoConference", "videoConferenceInfo"]) {
    const nested = asRecord(root?.[key]);
    if (nested) records.push(nested);
  }
  return records;
}

function readString(records: Record<string, unknown>[], keys: string[]): string | undefined {
  const wanted = new Set(keys.map(normalizeKey));
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (!wanted.has(normalizeKey(key))) continue;
      const text = String(value ?? "").trim();
      if (text) return text;
    }
  }
  return undefined;
}

function readNumber(records: Record<string, unknown>[], keys: string[]): number | undefined {
  const value = readString(records, keys);
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeConferenceInfo(conferenceId: string, body: ConferenceApiResp): DingTalkVideoConferenceInfo {
  const records = recordCandidates(body);
  return {
    conferenceId,
    title: readString(records, ["title", "meetingTitle", "conferenceTitle", "subject"]),
    roomCode: readString(records, ["roomCode", "room_code"]),
    scheduleConferenceId: readString(records, ["scheduleConferenceId", "schedule_conference_id"]),
    creatorUserId: readString(records, ["creatorUserId", "creator_user_id", "operator", "userId"]),
    creatorUnionId: readString(records, [
      "creatorUnionId",
      "creator_union_id",
      "operatorUnionId",
      "ownerUnionId",
      "minutesOwnerUnionId",
    ]),
    creatorNick: readString(records, ["creatorNick", "creatorName", "operatorName", "nickName"]),
    hostUnionId: readString(records, ["hostUnionId", "host_union_id", "moderatorUnionId"]),
    startTimeMs: readNumber(records, ["startTimeMs", "startTime", "meetingStartTime", "conferenceStartTime"]),
    endTimeMs: readNumber(records, ["endTimeMs", "endTime", "meetingEndTime", "conferenceEndTime"]),
    status: readString(records, ["status", "meetingStatus", "conferenceStatus"]),
    flashStatus: readString(records, ["flashStatus", "minutesStatus", "recordStatus", "cloudRecordStatus"]),
  };
}

function memberArrays(body: ConferenceApiResp): unknown[][] {
  const arrays: unknown[][] = [];
  const records = recordCandidates(body);
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      const normalized = normalizeKey(key);
      if (
        (normalized === "members" ||
          normalized === "memberlist" ||
          normalized === "attendees" ||
          normalized === "participants" ||
          normalized === "participantlist" ||
          normalized === "list") &&
        Array.isArray(value)
      ) {
        arrays.push(value);
      }
    }
  }
  return arrays;
}

function normalizeMembers(body: ConferenceApiResp): DingTalkVideoConferenceMember[] {
  const members: DingTalkVideoConferenceMember[] = [];
  const seen = new Set<string>();
  for (const arr of memberArrays(body)) {
    for (const item of arr) {
      const record = asRecord(item);
      if (!record) continue;
      const unionId = readString([record], ["unionId", "union_id", "memberUnionId", "userUnionId"]);
      if (!unionId || seen.has(unionId)) continue;
      seen.add(unionId);
      members.push({
        unionId,
        userId: readString([record], ["userId", "userid", "staffId", "staffid"]),
        nickName: readString([record], ["nickName", "name", "userName", "memberName"]),
        role: readString([record], ["role", "memberRole"]),
        rawJson: record,
      });
    }
  }
  return members;
}

export function createDingTalkMeetingRecordingClient(options: {
  fetchImpl?: typeof fetch;
  now?: () => number;
} = {}): DingTalkMeetingRecordingClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  let tokenCache: AccessTokenCache | undefined;

  async function getAccessToken(forceRefresh = false): Promise<string> {
    const current = now();
    if (!forceRefresh && tokenCache && tokenCache.expiresAtMs > current + 30_000) {
      return tokenCache.token;
    }
    const creds = readCredentials();
    const response = await fetchImpl("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appKey: creds.appKey,
        appSecret: creds.appSecret,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as AccessTokenResp;
    if (!response.ok || (typeof body.errcode === "number" && body.errcode !== 0) || body.code) {
      throw new DingTalkMeetingApiError(
        `DingTalk token request failed: ${response.status} ${JSON.stringify(body)}`,
        "token_failed",
        response.status || 502,
      );
    }
    const { token, expiresIn } = tokenFromBody(body);
    tokenCache = {
      token,
      expiresAtMs: current + expiresIn * 1000,
    };
    return token;
  }

  async function fetchTextPage(input: {
    conferenceId: string;
    unionId?: string;
    maxResults: number;
    nextToken?: string;
  }): Promise<CloudRecordTextResp> {
    const token = await getAccessToken(false);
    const params = new URLSearchParams();
    if (input.unionId) params.set("unionId", input.unionId);
    params.set("direction", "0");
    params.set("maxResults", String(input.maxResults));
    if (input.nextToken) params.set("nextToken", input.nextToken);
    const url =
      `https://api.dingtalk.com/v1.0/conference/videoConferences/${encodeURIComponent(input.conferenceId)}` +
      `/cloudRecords/getTexts?${params.toString()}`;
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-acs-dingtalk-access-token": token,
      },
    });
    const body = (await response.json().catch(() => ({}))) as CloudRecordTextResp;
    if (!response.ok || (typeof body.errcode === "number" && body.errcode !== 0) || body.code) {
      throw new DingTalkMeetingApiError(
        `DingTalk cloud record text request failed: ${response.status} ${JSON.stringify(body)}`,
        apiErrorCode(response.status, body),
        response.status || 502,
      );
    }
    return body;
  }

  async function fetchConferenceJson(url: string): Promise<ConferenceApiResp> {
    const token = await getAccessToken(false);
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-acs-dingtalk-access-token": token,
      },
    });
    const body = (await response.json().catch(() => ({}))) as ConferenceApiResp;
    if (!response.ok || (typeof body.errcode === "number" && body.errcode !== 0) || body.code) {
      throw new DingTalkMeetingApiError(
        `DingTalk conference request failed: ${response.status} ${JSON.stringify(body)}`,
        apiErrorCode(response.status, body),
        response.status || 502,
      );
    }
    return body;
  }

  return {
    async getVideoConference(input) {
      const conferenceId = String(input.conferenceId ?? "").trim();
      if (!conferenceId) {
        throw new DingTalkMeetingApiError("conferenceId is required", "api_error", 400);
      }
      const url = `https://api.dingtalk.com/v1.0/conference/videoConferences/${encodeURIComponent(conferenceId)}`;
      const body = await fetchConferenceJson(url);
      return normalizeConferenceInfo(conferenceId, body);
    },

    async listVideoConferenceMembers(input) {
      const conferenceId = String(input.conferenceId ?? "").trim();
      if (!conferenceId) {
        throw new DingTalkMeetingApiError("conferenceId is required", "api_error", 400);
      }
      const maxResults = Math.min(Math.max(Math.floor(Number(input.maxResults ?? 128)), 1), 200);
      const members: DingTalkVideoConferenceMember[] = [];
      const seen = new Set<string>();
      let nextToken: string | undefined = "0";
      for (let i = 0; i < 20; i += 1) {
        const params = new URLSearchParams();
        params.set("maxResults", String(maxResults));
        if (nextToken) params.set("nextToken", nextToken);
        const url =
          `https://api.dingtalk.com/v1.0/conference/videoConferences/${encodeURIComponent(conferenceId)}` +
          `/members?${params.toString()}`;
        const body = await fetchConferenceJson(url);
        for (const member of normalizeMembers(body)) {
          if (seen.has(member.unionId)) continue;
          seen.add(member.unionId);
          members.push(member);
        }
        if (!body.hasMore) break;
        const token = String(body.nextToken ?? body.nextTtoken ?? "").trim();
        if (!token || token === nextToken) break;
        nextToken = token;
      }
      return members;
    },

    async getCloudRecordTranscript(input) {
      const conferenceId = String(input.conferenceId ?? "").trim();
      if (!conferenceId) {
        throw new DingTalkMeetingApiError("conferenceId is required", "api_error", 400);
      }
      const maxResults = Math.min(Math.max(Math.floor(Number(input.maxResults ?? 2000)), 1), 2000);
      const paragraphs: DingTalkMeetingTranscriptParagraph[] = [];
      let nextToken: string | undefined;
      for (let i = 0; i < 20; i += 1) {
        const page = await fetchTextPage({
          conferenceId,
          unionId: String(input.unionId ?? "").trim() || undefined,
          maxResults,
          nextToken,
        });
        for (const row of page.paragraphList ?? []) {
          const text = collectParagraphText(row);
          if (!text) continue;
          paragraphs.push({
            unionId: typeof row.unionId === "string" ? row.unionId : undefined,
            nickName: typeof row.nickName === "string" ? row.nickName : undefined,
            startTime: Number.isFinite(Number(row.startTime)) ? Number(row.startTime) : undefined,
            endTime: Number.isFinite(Number(row.endTime)) ? Number(row.endTime) : undefined,
            text,
          });
        }
        if (!page.hasMore) break;
        const token = String(page.nextToken ?? page.nextTtoken ?? "").trim();
        if (!token || token === nextToken) break;
        nextToken = token;
      }
      const text = paragraphs.map(formatTranscriptLine).filter(Boolean).join("\n");
      if (!text.trim()) {
        throw new DingTalkMeetingApiError("DingTalk meeting transcript is empty", "empty_transcript", 404);
      }
      return {
        conferenceId,
        text,
        paragraphs,
        fetchedAt: new Date(now()).toISOString(),
      };
    },
  };
}
