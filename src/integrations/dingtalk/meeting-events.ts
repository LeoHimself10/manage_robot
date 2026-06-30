import {
  createDingTalkMeetingStore,
  type DingTalkMeetingMemberInput,
  type DingTalkMeetingStore,
} from "../../infra/dingtalk-meeting-store";
import {
  createDingTalkMeetingRecordingClient,
  type DingTalkMeetingRecordingClient,
} from "./meeting-recording";

type JsonRecord = Record<string, unknown>;

export interface DingTalkMeetingEventResult {
  handled: boolean;
  conferenceId?: string;
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
  if (depth > 4) return out;
  const parsed = parseJsonMaybe(value);
  const record = asRecord(parsed);
  if (!record) return out;
  out.push(record);
  for (const key of ["data", "eventData", "payload", "content", "bizData", "event", "result"]) {
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

export async function handleDingTalkMeetingEventMessage(
  input: DingTalkMeetingEventMessageInput,
): Promise<DingTalkMeetingEventResult> {
  const root = asRecord(input.message) ?? {};
  const headers = asRecord(root.headers);
  const records = [
    ...collectRecords(root),
    ...collectRecords(root.data),
    ...collectRecords(root.message),
  ];
  const conferenceId = readString(records, [
    "conferenceId",
    "conference_id",
    "videoConferenceId",
    "video_conference_id",
  ]);
  if (!conferenceId) return { handled: false };

  const eventType = eventTypeText(headers, records);
  if (
    eventType &&
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
