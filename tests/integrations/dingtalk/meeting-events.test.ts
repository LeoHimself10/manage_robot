import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDingTalkMeetingStore } from "../../../src/infra/dingtalk-meeting-store";
import {
  handleDingTalkMeetingEventMessage,
  summarizeDingTalkMeetingEventMessage,
} from "../../../src/integrations/dingtalk/meeting-events";
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

  it("caches AI minutes ASR transcript fragments from meeting events", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dt-meeting-event-asr-"));
    vi.stubEnv("WORKBENCH_SQLITE_PATH", join(dir, "wb.sqlite"));
    const store = createDingTalkMeetingStore();
    const now = Date.parse("2026-07-02T03:30:00.000Z");

    const message = {
      headers: {
        eventType: "meeting_asr_result_event",
        eventId: "evt-asr-1",
      },
      data: JSON.stringify({
        conferenceId: "conf-asr",
        title: "AI minutes review",
        creatorUnionId: "union-owner",
        bizType: "minutes",
        syncAction: "meeting_asr_result_event",
        startTime: now,
        payload: {
          result: {
            sentenceList: [
              {
                sentenceId: "s1",
                unionId: "union-yao",
                nickName: "Yao",
                startTime: 1000,
                sentence: "Define AI log scope",
              },
              {
                sentenceId: "s2",
                unionId: "union-cao",
                nickName: "Cao",
                startTime: 2000,
                sentence: "Confirm rollout users",
              },
            ],
          },
        },
      }),
    };

    const result = await handleDingTalkMeetingEventMessage({
      message,
      meetingStore: store,
      now: () => now,
    });
    await handleDingTalkMeetingEventMessage({
      message,
      meetingStore: store,
      now: () => now,
    });

    expect(result).toEqual({ handled: true, conferenceId: "conf-asr" });
    expect(store.getMeeting("conf-asr")).toMatchObject({
      transcriptCached: true,
      transcriptSource: "ai_minutes",
      transcriptText: "Yao: Define AI log scope\nCao: Confirm rollout users",
    });
    expect(store.userCanAccessMeeting("conf-asr", "union-yao")).toBe(true);
    store.close();
  });

  it("accepts AI minutes events that identify the meeting as businessOrder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dt-meeting-event-business-order-"));
    vi.stubEnv("WORKBENCH_SQLITE_PATH", join(dir, "wb.sqlite"));
    const store = createDingTalkMeetingStore();
    const now = Date.parse("2026-07-02T07:40:00.000Z");

    const result = await handleDingTalkMeetingEventMessage({
      message: {
        headers: { eventType: "meeting_asr_result_event", eventId: "evt-asr-business-order" },
        data: JSON.stringify({
          businessOrder: "conf-business-order",
          meetingTitle: "Ad-hoc AI minutes",
          bizType: "minutes",
          startTime: now,
          sentenceList: [
            {
              sentenceId: "s1",
              unionId: "union-owner",
              nickName: "Owner",
              sentence: "Capture ad-hoc meeting action items",
            },
          ],
        }),
      },
      meetingStore: store,
      now: () => now,
    });

    expect(result).toEqual({ handled: true, conferenceId: "conf-business-order" });
    expect(store.getMeeting("conf-business-order")).toMatchObject({
      title: "Ad-hoc AI minutes",
      transcriptCached: true,
      transcriptText: "Owner: Capture ad-hoc meeting action items",
    });
    store.close();
  });

  it("summarizes unhandled meeting events without transcript content", () => {
    const summary = summarizeDingTalkMeetingEventMessage({
      headers: { eventType: "meeting_asr_result_event" },
      data: JSON.stringify({
        bizType: "minutes",
        payload: {
          result: {
            sentenceList: [{ sentence: "Sensitive transcript text", nickName: "Owner" }],
          },
        },
      }),
    });

    expect(summary.eventType).toContain("meeting_asr_result_event");
    expect(summary.transcriptFragmentCount).toBe(1);
    expect(JSON.stringify(summary)).not.toContain("Sensitive transcript text");
  });
});
