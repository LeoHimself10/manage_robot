import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DingTalkMeetingApiError,
  createDingTalkMeetingRecordingClient,
} from "../../../src/integrations/dingtalk/meeting-recording";

interface CapturedRequest {
  url: string;
  init?: RequestInit;
  body?: unknown;
}

function jsonRes(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildFetchMock(handlers: Array<(req: CapturedRequest) => Response | Promise<Response>>) {
  const calls: CapturedRequest[] = [];
  let cursor = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    let body: unknown;
    if (init?.body) {
      try {
        body = JSON.parse(String(init.body));
      } catch {
        body = init.body;
      }
    }
    const req = { url: String(input), init, body };
    calls.push(req);
    const handler = handlers[cursor] ?? handlers[handlers.length - 1];
    cursor += 1;
    return handler(req);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("DingTalk meeting recording client", () => {
  beforeEach(() => {
    vi.stubEnv("DINGTALK_CLIENT_ID", "app-key");
    vi.stubEnv("DINGTALK_CLIENT_SECRET", "app-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("paginates cloud recording text and formats speaker transcript", async () => {
    const { fetchImpl, calls } = buildFetchMock([
      () => jsonRes({ accessToken: "token-1", expireIn: 7200 }),
      (req) => {
        expect(req.url).toContain("/cloudRecords/getTexts");
        expect(req.url).toContain("unionId=union-mgr");
        expect(req.url).toContain("maxResults=2000");
        return jsonRes({
          hasMore: true,
          nextToken: 10,
          paragraphList: [
            {
              nickName: "Alice",
              unionId: "union-a",
              startTime: 0,
              endTime: 1000,
              paragraph: "更新API文档",
            },
          ],
        });
      },
      (req) => {
        expect(req.url).toContain("nextToken=10");
        return jsonRes({
          hasMore: false,
          paragraphList: [
            {
              nickName: "Bob",
              unionId: "union-b",
              startTime: 1200,
              endTime: 2400,
              sentenceList: [{ sentence: "联调验收脚本" }],
            },
          ],
        });
      },
    ]);
    const client = createDingTalkMeetingRecordingClient({ fetchImpl });

    const result = await client.getCloudRecordTranscript({
      conferenceId: "conf-1",
      unionId: "union-mgr",
    });

    expect(result.text).toContain("Alice: 更新API文档");
    expect(result.text).toContain("Bob: 联调验收脚本");
    expect(result.paragraphs).toHaveLength(2);
    expect(calls[0]?.url).toContain("/oauth2/accessToken");
    expect(calls[0]?.body).toEqual({ appKey: "app-key", appSecret: "app-secret" });
  });

  it("throws a typed error when DingTalk denies access", async () => {
    const { fetchImpl } = buildFetchMock([
      () => jsonRes({ accessToken: "token-1", expireIn: 7200 }),
      () => jsonRes({ code: "permissionError", message: "No permission" }, 403),
    ]);
    const client = createDingTalkMeetingRecordingClient({ fetchImpl });

    await expect(
      client.getCloudRecordTranscript({ conferenceId: "conf-denied", unionId: "union-mgr" }),
    ).rejects.toMatchObject({
      name: "DingTalkMeetingApiError",
      code: "permission_denied",
      statusCode: 403,
    } satisfies Partial<DingTalkMeetingApiError>);
  });

  it("treats a missing AI minutes cloud record as an empty transcript", async () => {
    const { fetchImpl } = buildFetchMock([
      () => jsonRes({ accessToken: "token-1", expireIn: 7200 }),
      () => jsonRes({ code: "cloudRecordNotFound%!(EXTRA string=50513)", message: "cloudRecordNotFound" }, 400),
    ]);
    const client = createDingTalkMeetingRecordingClient({ fetchImpl });

    await expect(
      client.getCloudRecordTranscript({ conferenceId: "conf-no-record", unionId: "union-mgr" }),
    ).rejects.toMatchObject({
      name: "DingTalkMeetingApiError",
      code: "empty_transcript",
    } satisfies Partial<DingTalkMeetingApiError>);
  });

  it("lists calendar video meetings for a user and extracts the room code", async () => {
    const { fetchImpl, calls } = buildFetchMock([
      () => jsonRes({ accessToken: "token-1", expireIn: 7200 }),
      (req) => {
        expect(req.url).toContain("/v1.0/calendar/users/union-mgr/calendars/primary/events");
        expect(req.url).toContain("maxResults=50");
        return jsonRes({
          events: [
            {
              id: "evt-1",
              summary: "AI日志助手 需求收集",
              start: { dateTime: "2026-07-02T11:00:00+08:00" },
              end: { dateTime: "2026-07-02T12:00:00+08:00" },
              organizer: { id: "union-owner", displayName: "Owner" },
              attendees: [{ id: "union-mgr", displayName: "Manager" }],
              onlineMeetingInfo: {
                conferenceId: "calendar-conf",
                extraInfo: { roomCode: "899 106 669" },
                type: "dingtalk",
              },
            },
          ],
        });
      },
    ]);
    const client = createDingTalkMeetingRecordingClient({ fetchImpl });

    const result = await client.listCalendarVideoMeetings?.({
      unionId: "union-mgr",
      timeMinMs: Date.parse("2026-06-18T00:00:00.000Z"),
      timeMaxMs: Date.parse("2026-07-02T00:00:00.000Z"),
    });

    expect(result).toEqual([
      expect.objectContaining({
        calendarEventId: "evt-1",
        conferenceId: "calendar-conf",
        title: "AI日志助手 需求收集",
        roomCode: "899106669",
        startTimeMs: Date.parse("2026-07-02T11:00:00+08:00"),
        endTimeMs: Date.parse("2026-07-02T12:00:00+08:00"),
        organizerUnionId: "union-owner",
      }),
    ]);
    expect(calls.filter((call) => call.url.includes("/oauth2/accessToken"))).toHaveLength(1);
  });

  it("lists historical video conferences by room code", async () => {
    const { fetchImpl } = buildFetchMock([
      () => jsonRes({ accessToken: "token-1", expireIn: 7200 }),
      (req) => {
        expect(req.url).toContain("/v1.0/conference/roomCodes/899106669/infos");
        expect(req.url).toContain("maxResults=20");
        return jsonRes({
          hasMore: false,
          totalCount: 1,
          conferenceList: [
            {
              conferenceId: "actual-conf",
              title: "AI日志助手 需求收集",
              roomCode: "899106669",
              status: 1,
              startTime: 1782961205000,
              endTime: 1782964062000,
              creatorId: "union-mgr",
            },
          ],
        });
      },
    ]);
    const client = createDingTalkMeetingRecordingClient({ fetchImpl });

    const result = await client.listVideoConferencesByRoomCode?.({
      roomCode: "899 106 669",
      maxResults: 20,
    });

    expect(result).toEqual([
      expect.objectContaining({
        conferenceId: "actual-conf",
        title: "AI日志助手 需求收集",
        roomCode: "899106669",
        creatorUnionId: "union-mgr",
        startTimeMs: 1782961205000,
        endTimeMs: 1782964062000,
      }),
    ]);
  });

  it("fetches video conference details and paginates members", async () => {
    const now = Date.now();
    const { fetchImpl, calls } = buildFetchMock([
      () => jsonRes({ accessToken: "token-1", expireIn: 7200 }),
      (req) => {
        expect(req.url).toContain("/v1.0/conference/videoConferences/conf-1");
        expect(req.url).not.toContain("/members");
        return jsonRes({
          title: "明思周会",
          roomCode: "123456",
          creatorUnionId: "union-owner",
          hostUnionId: "union-host",
          startTime: now,
          endTime: now + 1000,
          status: "ENDED",
        });
      },
      (req) => {
        expect(req.url).toContain("/members");
        expect(req.url).toContain("maxResults=20");
        return jsonRes({
          hasMore: true,
          nextToken: "n2",
          members: [{ unionId: "union-a", userId: "u-a", nickName: "Alice", role: "host" }],
        });
      },
      (req) => {
        expect(req.url).toContain("nextToken=n2");
        return jsonRes({
          hasMore: false,
          memberList: [{ unionId: "union-b", userid: "u-b", name: "Bob" }],
        });
      },
    ]);
    const client = createDingTalkMeetingRecordingClient({ fetchImpl });

    const info = await client.getVideoConference({ conferenceId: "conf-1" });
    const members = await client.listVideoConferenceMembers({ conferenceId: "conf-1", maxResults: 20 });

    expect(info).toMatchObject({
      conferenceId: "conf-1",
      title: "明思周会",
      creatorUnionId: "union-owner",
      hostUnionId: "union-host",
      startTimeMs: now,
    });
    expect(members.map((m) => m.unionId)).toEqual(["union-a", "union-b"]);
    expect(calls.filter((call) => call.url.includes("/oauth2/accessToken"))).toHaveLength(1);
  });
});
