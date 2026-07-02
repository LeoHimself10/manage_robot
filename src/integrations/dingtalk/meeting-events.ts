import {
  createDingTalkMeetingStore,
  type DingTalkMeetingMemberInput,
  type DingTalkMeetingTranscriptFragmentInput,
  type DingTalkMeetingStore,
} from "../../infra/dingtalk-meeting-store";
import { createHash } from "node:crypto";
import {
  createDingTalkMeetingRecordingClient,
  type DingTalkMeetingRecordingClient,
} from "./meeting-recording";

type JsonRecord = Record<string, unknown>;

export interface DingTalkMeetingEventResult {
  handled: boolean;
  conferenceId?: string;
}

export interface DingTalkMeetingEventSummary {
  eventType: string;
  conferenceId?: string;
  bizType?: string;
  transcriptFragmentCount: number;
  topLevelKeys: string[];
  dataKeys: string[];
  recordKeys: string[];
  maybeMeetingEvent: boolean;
}

export interface DingTalkMeetingEventMessageInput {
  message: unknown;
  meetingStore?: DingTalkMeetingStore;
  meetingClient?: DingTalkMeetingRecordingClient;
  now?: () => number;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function parseJsonMaybe(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function collectRecords(value: unknown, out: JsonRecord[] = [], depth = 0): JsonRecord[] {
  if (depth > 8) return out;
  const parsed = parseJsonMaybe(value);
  if (Array.isArray(parsed)) {
    for (const item of parsed) collectRecords(item, out, depth + 1);
    return out;
  }
  const record = asRecord(parsed);
  if (!record) return out;
  out.push(record);
  for (const key of [
    "data",
    "eventData",
    "payload",
    "content",
    "bizData",
    "event",
    "result",
    "sentenceList",
    "sentences",
    "paragraphList",
    "paragraphs",
    "list",
  ]) {
    if (key in record) collectRecords(record[key], out, depth + 1);
  }
  return out;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

function readString(records: JsonRecord[], keys: string[]): string | undefined {
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

function readNumber(records: JsonRecord[], keys: string[]): number | undefined {
  const value = readString(records, keys);
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function readScalarString(records: JsonRecord[], keys: string[]): string | undefined {
  const wanted = new Set(keys.map(normalizeKey));
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (!wanted.has(normalizeKey(key))) continue;
      if (value && typeof value === "object") continue;
      const text = String(value ?? "").trim();
      if (text) return text;
    }
  }
  return undefined;
}

function textHash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

function transcriptSource(records: JsonRecord[]): string {
  const bizType = String(readScalarString(records, ["bizType", "biz_type"]) ?? "").toLowerCase();
  if (bizType.includes("minute")) return "ai_minutes";
  if (bizType.includes("cloud")) return "cloud_record_asr";
  return "asr_event";
}

function readTranscriptFragments(records: JsonRecord[]): DingTalkMeetingTranscriptFragmentInput[] {
  const source = transcriptSource(records);
  const eventId = readScalarString(records, ["eventId", "event_id", "bizId", "biz_id", "syncId", "sync_id"]);
  const fragments: DingTalkMeetingTranscriptFragmentInput[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const text = readScalarString(record ? [record] : [], [
      "sentence",
      "sentenceText",
      "paragraph",
      "text",
      "asrText",
      "transcriptText",
      "resultText",
    ]);
    if (!text) continue;
    const unionId = readScalarString([record], [
      "unionId",
      "union_id",
      "speakerUnionId",
      "speaker_union_id",
      "userUnionId",
      "memberUnionId",
    ]);
    const speakerName = readScalarString([record], [
      "nickName",
      "speakerName",
      "speaker",
      "userName",
      "memberName",
      "name",
    ]);
    const startTimeMs = readNumber([record], [
      "startTimeMs",
      "startTime",
      "beginTime",
      "begin_time",
      "sentenceStartTime",
    ]);
    const endTimeMs = readNumber([record], ["endTimeMs", "endTime", "finishTime", "sentenceEndTime"]);
    const rawKey = readScalarString([record], [
      "sentenceId",
      "sentence_id",
      "recordId",
      "record_id",
      "paragraphId",
      "paragraph_id",
      "segmentId",
      "id",
    ]);
    const fragmentKey = [
      source,
      eventId ?? "",
      rawKey ?? "",
      unionId ?? "",
      startTimeMs ?? "",
      textHash(text),
    ].join(":");
    if (seen.has(fragmentKey)) continue;
    seen.add(fragmentKey);
    fragments.push({
      fragmentKey,
      source,
      speakerName,
      unionId,
      startTimeMs,
      endTimeMs,
      text,
      rawJson: record,
    });
  }
  return fragments;
}

function readMembers(records: JsonRecord[]): DingTalkMeetingMemberInput[] {
  const memberKeys = new Set(["members", "memberlist", "attendees", "participants", "participantlist"]);
  const members: DingTalkMeetingMemberInput[] = [];
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (!memberKeys.has(normalizeKey(key)) || !Array.isArray(value)) continue;
      for (const item of value) {
        const memberRecord = asRecord(parseJsonMaybe(item));
        if (!memberRecord) continue;
        const candidates = [memberRecord];
        const unionId = readString(candidates, ["unionId", "union_id", "memberUnionId", "userUnionId"]);
        if (!unionId) continue;
        members.push({
          unionId,
          userId: readString(candidates, ["userId", "userid", "staffId", "staffid"]),
          nickName: readString(candidates, ["nickName", "name", "userName", "memberName"]),
          role: readString(candidates, ["role", "memberRole"]),
          rawJson: memberRecord,
        });
      }
    }
  }
  return members;
}

function addMemberIfPresent(members: DingTalkMeetingMemberInput[], input: DingTalkMeetingMemberInput | undefined): void {
  const unionId = String(input?.unionId ?? "").trim();
  if (!unionId) return;
  if (members.some((member) => member.unionId === unionId)) return;
  members.push({ ...input, unionId });
}

function eventTypeText(headers: JsonRecord | undefined, records: JsonRecord[]): string {
  const parts = [
    readString(headers ? [headers] : [], ["eventType", "topic", "eventName"]),
    readString(records, ["eventType", "topic", "eventName", "type"]),
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function resolveConferenceId(records: JsonRecord[]): string | undefined {
  return readString(records, [
    "conferenceId",
    "conference_id",
    "videoConferenceId",
    "video_conference_id",
    "businessOrder",
    "business_order",
    "meetingId",
    "meeting_id",
    "meetingUuid",
    "meeting_uuid",
  ]);
}

function safeKeys(record: JsonRecord | undefined, limit = 24): string[] {
  if (!record) return [];
  return Object.keys(record).slice(0, limit);
}

function uniqueKeys(records: JsonRecord[], limit = 40): string[] {
  const keys: string[] = [];
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!keys.includes(key)) keys.push(key);
      if (keys.length >= limit) return keys;
    }
  }
  return keys;
}

function meetingEventContext(message: unknown): {
  root: JsonRecord;
  headers?: JsonRecord;
  records: JsonRecord[];
  conferenceId?: string;
  eventType: string;
  transcriptFragments: DingTalkMeetingTranscriptFragmentInput[];
} {
  const root = asRecord(message) ?? {};
  const headers = asRecord(root.headers);
  const records = [
    ...collectRecords(root),
    ...collectRecords(root.data),
    ...collectRecords(root.message),
  ];
  return {
    root,
    headers,
    records,
    conferenceId: resolveConferenceId(records),
    eventType: eventTypeText(headers, records),
    transcriptFragments: readTranscriptFragments(records),
  };
}

export function summarizeDingTalkMeetingEventMessage(message: unknown): DingTalkMeetingEventSummary {
  const { root, records, conferenceId, eventType, transcriptFragments } = meetingEventContext(message);
  const parsedData = asRecord(parseJsonMaybe(root.data));
  const bizType = readScalarString(records, ["bizType", "biz_type"]);
  const haystack = [eventType, bizType ?? "", uniqueKeys(records).join(" ")].join(" ").toLowerCase();
  return {
    eventType,
    conferenceId,
    bizType,
    transcriptFragmentCount: transcriptFragments.length,
    topLevelKeys: safeKeys(root),
    dataKeys: safeKeys(parsedData),
    recordKeys: uniqueKeys(records),
    maybeMeetingEvent:
      Boolean(conferenceId) ||
      transcriptFragments.length > 0 ||
      haystack.includes("asr") ||
      haystack.includes("meeting") ||
      haystack.includes("minute") ||
      haystack.includes("flash") ||
      haystack.includes("conference"),
  };
}

export async function handleDingTalkMeetingEventMessage(
  input: DingTalkMeetingEventMessageInput,
): Promise<DingTalkMeetingEventResult> {
  const { root, headers, records, conferenceId, eventType, transcriptFragments } = meetingEventContext(input.message);
  if (!conferenceId) return { handled: false };

  if (
    eventType &&
    !transcriptFragments.length &&
    !eventType.includes("asr") &&
    !eventType.includes("meeting") &&
    !eventType.includes("flash") &&
    !eventType.includes("minute") &&
    !eventType.includes("record") &&
    !eventType.includes("conference")
  ) {
    return { handled: false };
  }

  const startTimeMs =
    readNumber(records, ["startTimeMs", "startTime", "meetingStartTime", "conferenceStartTime"]) ??
    input.now?.() ??
    Date.now();
  const endTimeMs = readNumber(records, ["endTimeMs", "endTime", "meetingEndTime", "conferenceEndTime"]);
  const creatorUnionId = readString(records, [
    "creatorUnionId",
    "creator_union_id",
    "operatorUnionId",
    "ownerUnionId",
    "minutesOwnerUnionId",
  ]);
  const creatorUserId = readString(records, ["creatorUserId", "creator_user_id", "operator", "userId"]);
  const creatorNick = readString(records, ["creatorNick", "creatorName", "operatorName", "nickName"]);
  const hostUnionId = readString(records, ["hostUnionId", "host_union_id", "moderatorUnionId"]);
  const ownStore = input.meetingStore ? undefined : createDingTalkMeetingStore();
  const meetingStore = input.meetingStore ?? ownStore!;
  try {
    meetingStore.upsertMeeting({
      conferenceId,
      title: readString(records, ["title", "meetingTitle", "conferenceTitle", "subject"]),
      roomCode: readString(records, ["roomCode", "room_code"]),
      scheduleConferenceId: readString(records, ["scheduleConferenceId", "schedule_conference_id"]),
      creatorUnionId,
      creatorUserId,
      creatorNick,
      hostUnionId,
      startTimeMs,
      endTimeMs,
      status: readString(records, ["status", "meetingStatus", "conferenceStatus"]),
      flashStatus: readString(records, ["flashStatus", "minutesStatus", "recordStatus", "cloudRecordStatus", "status"]),
      rawJson: {
        headers: headers ?? {},
        data: asRecord(parseJsonMaybe(root.data)) ?? root,
      },
    });
    const members = readMembers(records);
    addMemberIfPresent(members, {
      unionId: creatorUnionId ?? "",
      userId: creatorUserId,
      nickName: creatorNick,
      role: "creator",
    });
    addMemberIfPresent(members, {
      unionId: hostUnionId ?? "",
      role: "host",
    });
    if (members.length) {
      meetingStore.replaceMeetingMembers(conferenceId, members);
    }
    if (transcriptFragments.length) {
      meetingStore.appendMeetingTranscriptFragments({
        conferenceId,
        source: transcriptSource(records),
        fragments: transcriptFragments,
      });
      for (const fragment of transcriptFragments) {
        addMemberIfPresent(members, {
          unionId: fragment.unionId ?? "",
          nickName: fragment.speakerName,
          role: "speaker",
        });
      }
      if (members.length) {
        meetingStore.replaceMeetingMembers(conferenceId, members);
      }
    }
    const needsHydration = !readString(records, ["title", "meetingTitle", "conferenceTitle", "subject"]) ||
      !creatorUnionId ||
      members.length === 0;
    if (needsHydration) {
      const client = input.meetingClient ?? createDingTalkMeetingRecordingClient();
      try {
        const info = await client.getVideoConference({ conferenceId });
        meetingStore.upsertMeeting({
          ...info,
          rawJson: {
            headers: headers ?? {},
            data: asRecord(parseJsonMaybe(root.data)) ?? root,
            hydrated: true,
          },
        });
        const apiMembers = await client.listVideoConferenceMembers({ conferenceId });
        if (apiMembers.length) {
          meetingStore.replaceMeetingMembers(
            conferenceId,
            apiMembers.map((member) => ({
              unionId: member.unionId,
              userId: member.userId,
              nickName: member.nickName,
              role: member.role,
              rawJson: member.rawJson,
            })),
          );
        }
      } catch (err) {
        meetingStore.setMeetingLastError({
          conferenceId,
          errorText: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { handled: true, conferenceId };
  } finally {
    ownStore?.close();
  }
}
