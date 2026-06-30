import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDingTalkMeetingStore } from "../../../src/infra/dingtalk-meeting-store";
import { handleDingTalkMeetingEventMessage } from "../../../src/integrations/dingtalk/meeting-events";
import type { DingTalkMeetingRecordingClient } from "../../../src/integrations/dingtalk/meeting-recording";

describe("DingTalk meeting flash events", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("upserts a flash meeting event into the meeting cache", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dt-meeting-event-"));
    vi.stubEnv("WORKBENCH_SQLITE_PATH", join(dir, "wb.sqlite"));
    const store = createDingTalkMeetingStore();
    const now = Date.now();

    const result = await handleDingTalkMeetingEventMessage({
      message: {
        headers: {
          eventType: "video_conference_flash_status_change",
          eventId: "evt-1",
        },
        data: JSON.stringify({
          conferenceId: "conf-event",
          title: "明思周会",
          creatorUnionId: "union-mgr",
          status: "SUMMARY_GENERATED",
          startTime: now,
        }),
      },
      meetingStore: store,
      now: () => now + 1000,
    });

    expect(result).toEqual({ handled: true, conferenceId: "conf-event" });
    expect(store.getMeeting("conf-event")).toMatchObject({
      conferenceId: "conf-event",
      title: "明思周会",
      creatorUnionId: "union-mgr",
      flashStatus: "SUMMARY_GENERATED",
      startTimeMs: now,
    });
    expect(store.userCanAccessMeeting("conf-event", "union-mgr")).toBe(true);
    store.close();
  });

  it("hydrates meeting details and members when the flash event only has conferenceId", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dt-meeting-event-hydrate-"));
    vi.stubEnv("WORKBENCH_SQLITE_PATH", join(dir, "wb.sqlite"));
    const store = createDingTalkMeetingStore();
    const now = Date.now();
    const meetingClient = {
      async getVideoConference() {
        return {
          conferenceId: "conf-hydrate",
          title: "只带ID的会议",
          creatorUnionId: "union-owner",
          hostUnionId: "union-host",
          startTimeMs: now,
        };
      },
      async listVideoConferenceMembers() {
        return [
          { unionId: "union-mgr", nickName: "主管" },
          { unionId: "union-emp", nickName: "成员" },
        ];
      },
      async getCloudRecordTranscript() {
        throw new Error("not used");
      },
    } satisfies DingTalkMeetingRecordingClient;

    const result = await handleDingTalkMeetingEventMessage({
      message: {
        headers: { eventType: "video_conference_flash_status_change" },
        data: JSON.stringify({ conferenceId: "conf-hydrate", status: "SUMMARY_GENERATED" }),
      },
      meetingStore: store,
      meetingClient,
      now: () => now + 1000,
    });

    expect(result).toEqual({ handled: true, conferenceId: "conf-hydrate" });
    expect(store.getMeeting("conf-hydrate")).toMatchObject({
      title: "只带ID的会议",
      creatorUnionId: "union-owner",
      hostUnionId: "union-host",
      startTimeMs: now,
    });
    expect(store.userCanAccessMeeting("conf-hydrate", "union-mgr")).toBe(true);
    store.close();
  });
});
