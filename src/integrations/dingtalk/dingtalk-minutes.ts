import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";

type JsonRecord = Record<string, unknown>;

export interface DingTalkMinutesListItem {
  taskUuid: string;
  title?: string;
  creatorNick?: string;
  creatorUnionId?: string;
  startTimeMs?: number;
  endTimeMs?: number;
  durationMs?: number;
  status?: string;
  rawJson?: JsonRecord;
}

export interface DingTalkMinutesTranscript {
  taskUuid: string;
  text: string;
  fetchedAt: string;
}

export interface DingTalkMinutesClient {
  listAccessible(input: {
    managerUserId: string;
    startTimeMs: number;
    endTimeMs: number;
    limit?: number;
  }): Promise<DingTalkMinutesListItem[]>;
  getTranscription(input: {
    managerUserId: string;
    taskUuid: string;
  }): Promise<DingTalkMinutesTranscript>;
}

export class DingTalkMinutesError extends Error {
  constructor(
    public readonly code:
      | "not_configured"
      | "auth_required"
      | "command_failed"
      | "invalid_response"
      | "empty_transcript",
    message: string,
  ) {
    super(message);
    this.name = "DingTalkMinutesError";
  }
}

interface CreateOptions {
  runCommand?: (input: {
    executable: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
  }) => Promise<string>;
  now?: () => number;
}

const execFileAsync = promisify(execFile);

function text(value: unknown): string | undefined {
  if (value !== null && typeof value === "object") return undefined;
  const result = String(value ?? "").trim();
  return result || undefined;
}

function numberValue(value: unknown): number | undefined {
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function recordsDeep(value: unknown, output: JsonRecord[] = [], depth = 0): JsonRecord[] {
  if (depth > 10) return output;
  if (Array.isArray(value)) {
    for (const item of value) recordsDeep(item, output, depth + 1);
    return output;
  }
  const record = asRecord(value);
  if (!record) return output;
  output.push(record);
  for (const child of Object.values(record)) {
    if (child && typeof child === "object") recordsDeep(child, output, depth + 1);
  }
  return output;
}

function parseJsonOutput(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new DingTalkMinutesError("invalid_response", "DWS returned an empty response");
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as unknown;
      } catch {
        // Fall through to the stable error below.
      }
    }
    throw new DingTalkMinutesError("invalid_response", "DWS returned non-JSON output");
  }
}

function nextTokenFrom(value: unknown): string | undefined {
  for (const record of recordsDeep(value)) {
    const token = text(
      record.nextToken ??
        record.next_token ??
        record.nextCursor ??
        record.next_cursor ??
        record.cursor,
    );
    if (token) return token;
  }
  return undefined;
}

function listItemsFrom(value: unknown): DingTalkMinutesListItem[] {
  const items = new Map<string, DingTalkMinutesListItem>();
  for (const record of recordsDeep(value)) {
    const taskUuid = text(record.taskUuid ?? record.task_uuid);
    if (!taskUuid || items.has(taskUuid)) continue;
    const durationMicros = numberValue(record.durationMicros ?? record.duration_micros);
    const durationSeconds = numberValue(record.duration);
    items.set(taskUuid, {
      taskUuid,
      title: text(record.title ?? record.name),
      creatorNick: text(record.creatorNick ?? record.creator_nick),
      creatorUnionId: text(record.creatorUnionId ?? record.creator_union_id),
      startTimeMs: numberValue(record.startTime ?? record.start_time),
      endTimeMs: numberValue(record.endTime ?? record.end_time),
      durationMs:
        durationMicros !== undefined
          ? Math.round(durationMicros / 1000)
          : durationSeconds !== undefined
            ? Math.round(durationSeconds * 1000)
            : undefined,
      status: text(record.status),
      rawJson: record,
    });
  }
  return [...items.values()];
}

function transcriptLinesFrom(value: unknown): string[] {
  const lines: string[] = [];
  for (const record of recordsDeep(value)) {
    const content = text(
      record.text ??
        record.content ??
        record.sentence ??
        record.sentenceText ??
        record.transcription,
    );
    if (!content) continue;
    const speaker = text(
      record.speakerNick ??
        record.speakerName ??
        record.speaker ??
        record.nickName,
    );
    const line = speaker ? `${speaker}: ${content}` : content;
    lines.push(line);
  }
  return lines;
}

function readProfiles(): Record<string, string> {
  const file = text(process.env.DINGTALK_MINUTES_DWS_PROFILES_FILE);
  if (!file || !existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const profiles: Record<string, string> = {};
    for (const [userId, value] of Object.entries(parsed)) {
      const direct = typeof value === "string" ? text(value) : undefined;
      const nested = asRecord(value);
      const home = direct ?? text(nested?.home ?? nested?.profileHome);
      if (home) profiles[userId] = home;
    }
    return profiles;
  } catch (error) {
    throw new DingTalkMinutesError(
      "not_configured",
      `Invalid DINGTALK_MINUTES_DWS_PROFILES_FILE: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function resolveProfileHome(managerUserId: string): string {
  const profile = readProfiles()[managerUserId];
  if (profile) return profile;
  const singleHome = text(process.env.DINGTALK_MINUTES_DWS_HOME);
  const allowlist = new Set(
    String(process.env.DINGTALK_MINUTES_DWS_MANAGER_USER_IDS ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  if (singleHome && allowlist.has(managerUserId)) return singleHome;
  throw new DingTalkMinutesError(
    "auth_required",
    "当前主管尚未完成钉钉 AI 听记授权",
  );
}

export function isDingTalkMinutesDwsEnabled(): boolean {
  return String(process.env.DINGTALK_MINUTES_DWS_ENABLED ?? "0").trim() === "1";
}

export function createDingTalkMinutesClient(options: CreateOptions = {}): DingTalkMinutesClient {
  const executable = text(process.env.DINGTALK_MINUTES_DWS_PATH);
  const timeoutRaw = Number(process.env.DINGTALK_MINUTES_DWS_TIMEOUT_MS ?? 30_000);
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 30_000;
  const maxPagesRaw = Number(process.env.DINGTALK_MINUTES_DWS_MAX_PAGES ?? 20);
  const maxPages = Number.isFinite(maxPagesRaw)
    ? Math.min(Math.max(Math.floor(maxPagesRaw), 1), 100)
    : 20;
  const now = options.now ?? (() => Date.now());
  const runCommand =
    options.runCommand ??
    (async (input) => {
      try {
        const result = await execFileAsync(input.executable, input.args, {
          env: input.env,
          timeout: input.timeoutMs,
          maxBuffer: 20 * 1024 * 1024,
          windowsHide: true,
        });
        return String(result.stdout ?? "");
      } catch (error) {
        const stderr = text((error as { stderr?: unknown })?.stderr);
        throw new DingTalkMinutesError(
          "command_failed",
          stderr || (error instanceof Error ? error.message : String(error)),
        );
      }
    });

  async function invoke(managerUserId: string, args: string[]): Promise<unknown> {
    if (!isDingTalkMinutesDwsEnabled() || !executable) {
      throw new DingTalkMinutesError(
        "not_configured",
        "DingTalk AI Minutes DWS reader is not configured",
      );
    }
    const profileHome = resolveProfileHome(managerUserId);
    const env = {
      ...process.env,
      HOME: profileHome,
      USERPROFILE: profileHome,
    };
    return parseJsonOutput(
      await runCommand({
        executable,
        args: [...args, "--format", "json"],
        env,
        timeoutMs,
      }),
    );
  }

  return {
    async listAccessible(input) {
      const limit = Math.min(Math.max(Math.floor(input.limit ?? 100), 1), 500);
      const all = new Map<string, DingTalkMinutesListItem>();
      let nextToken: string | undefined;
      for (let page = 0; page < maxPages && all.size < limit; page += 1) {
        const args = [
          "minutes",
          "list",
          "all",
          "--start",
          new Date(input.startTimeMs).toISOString(),
          "--end",
          new Date(input.endTimeMs).toISOString(),
          "--limit",
          String(Math.min(50, limit - all.size)),
        ];
        if (nextToken) args.push("--cursor", nextToken);
        const payload = await invoke(input.managerUserId, args);
        for (const item of listItemsFrom(payload)) {
          if (!all.has(item.taskUuid)) all.set(item.taskUuid, item);
        }
        const following = nextTokenFrom(payload);
        if (!following || following === nextToken) break;
        nextToken = following;
      }
      return [...all.values()].slice(0, limit);
    },

    async getTranscription(input) {
      const lines: string[] = [];
      let nextToken: string | undefined;
      for (let page = 0; page < maxPages; page += 1) {
        const args = [
          "minutes",
          "get",
          "transcription",
          "--id",
          input.taskUuid,
        ];
        if (nextToken) args.push("--cursor", nextToken);
        const payload = await invoke(input.managerUserId, args);
        lines.push(...transcriptLinesFrom(payload));
        const following = nextTokenFrom(payload);
        if (!following || following === nextToken) break;
        nextToken = following;
      }
      const value = lines.join("\n").trim();
      if (!value) {
        throw new DingTalkMinutesError(
          "empty_transcript",
          "该听记暂未生成可导入的转写正文",
        );
      }
      return {
        taskUuid: input.taskUuid,
        text: value,
        fetchedAt: new Date(now()).toISOString(),
      };
    },
  };
}
