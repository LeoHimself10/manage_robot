import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDingTalkMeetingStore } from "../../src/infra/dingtalk-meeting-store";

describe("dingtalk meeting store", () => {
  afterEach(() => {
    delete process.env.WORKBENCH_SQLITE_PATH;
  });

  it("lists only meetings related to the current manager unionId and caches transcript", () => {
    const dir = mkdtempSync(join(tmpdir(), "dt-meeting-store-"));
    process.env.WORKBENCH_SQLITE_PATH = join(dir, "wb.sqlite");
    const store = createDingTalkMeetingStore();
    const now = Date.now();

    store.upsertMeeting({
      conferenceId: "conf-owned",
      title: "周会",
      creatorUnionId: "union-mgr",
      startTimeMs: now - 1000,
      flashStatus: "video_generated",
    });
    store.replaceMeetingMembers("conf-owned", [
      { unionId: "union-mgr", nickName: "主管" },
      { unionId: "union-emp", nickName: "员工" },
      { unionId: "union-emp", nickName: "员工重复" },
    ]);
    store.upsertMeeting({
      conferenceId: "conf-other",
      title: "别人会议",
      creatorUnionId: "union-other",
      startTimeMs: now - 1000,
      flashStatus: "video_generated",
    });
    store.replaceMeetingMembers("conf-other", [{ unionId: "union-other", nickName: "别人" }]);
    store.setMeetingTranscript({
      conferenceId: "conf-owned",
      transcriptText: "主管: 更新API文档",
      fetchedAt: "2026-06-30T00:00:00.000Z",
    });

    const visible = store.listMeetingsForUnionId({
      unionId: "union-mgr",
      sinceMs: now - 86_400_000,
    });

    expect(visible.map((m) => m.conferenceId)).toEqual(["conf-owned"]);
    expect(visible[0]?.transcriptCached).toBe(true);
    expect(store.userCanAccessMeeting("conf-owned", "union-mgr")).toBe(true);
    expect(store.userCanAccessMeeting("conf-other", "union-mgr")).toBe(false);
    expect(store.getMeeting("conf-owned")?.transcriptText).toContain("更新API文档");
    expect(store.listMeetingMembers("conf-owned").map((m) => m.unionId).sort()).toEqual([
      "union-emp",
      "union-mgr",
    ]);
    store.close();
  });

  it("appends AI minutes transcript fragments idempotently", () => {
    const dir = mkdtempSync(join(tmpdir(), "dt-meeting-store-fragments-"));
    process.env.WORKBENCH_SQLITE_PATH = join(dir, "wb.sqlite");
    const store = createDingTalkMeetingStore();
    const now = Date.now();

    store.upsertMeeting({
      conferenceId: "conf-ai",
      title: "AI minutes review",
      creatorUnionId: "union-mgr",
      startTimeMs: now - 1000,
      flashStatus: "minutes",
    });

    const inserted = store.appendMeetingTranscriptFragments({
      conferenceId: "conf-ai",
      source: "ai_minutes",
      fragments: [
        {
          fragmentKey: "frag-1",
          speakerName: "Yao",
          unionId: "union-mgr",
          startTimeMs: 1000,
          text: "Define AI log scope",
        },
        {
          fragmentKey: "frag-2",
          speakerName: "Cao",
          unionId: "union-cao",
          startTimeMs: 2000,
          text: "Confirm rollout users",
        },
      ],
    });
    const duplicateInserted = store.appendMeetingTranscriptFragments({
      conferenceId: "conf-ai",
      source: "ai_minutes",
      fragments: [
        {
          fragmentKey: "frag-1",
          speakerName: "Yao",
          unionId: "union-mgr",
          startTimeMs: 1000,
          text: "Define AI log scope",
        },
      ],
    });

    const meeting = store.getMeeting("conf-ai");
    expect(inserted).toBe(2);
    expect(duplicateInserted).toBe(0);
    expect(meeting?.transcriptCached).toBe(true);
    expect(meeting?.transcriptSource).toBe("ai_minutes");
    expect(meeting?.transcriptText).toBe("Yao: Define AI log scope\nCao: Confirm rollout users");
    store.close();
  });

  it("merges conferenceId and taskUuid into one canonical meeting in either arrival order", () => {
    const dir = mkdtempSync(join(tmpdir(), "dt-meeting-store-unified-"));
    process.env.WORKBENCH_SQLITE_PATH = join(dir, "wb.sqlite");
    const store = createDingTalkMeetingStore();
    const startTimeMs = Date.parse("2026-07-24T02:00:00.000Z");

    store.upsertMeeting({
      conferenceId: "minutes:task-unified",
      sourceKind: "ai_minutes",
      taskUuid: "task-unified",
      title: "Product review",
      creatorUnionId: "union-manager",
      startTimeMs: startTimeMs + 20_000,
    });
    store.replaceMeetingMembers("minutes:task-unified", [
      { unionId: "union-manager", role: "creator" },
      { unionId: "union-speaker", role: "speaker" },
    ]);
    store.setMeetingTranscript({
      conferenceId: "minutes:task-unified",
      transcriptText: "Manager: confirm the release plan",
      source: "ai_minutes_dws",
    });

    const merged = store.upsertMeeting({
      conferenceId: "conference-unified",
      videoConferenceId: "conference-unified",
      sourceKind: "video_conference",
      title: "Product review",
      creatorUnionId: "union-manager",
      startTimeMs,
    });

    expect(merged).toMatchObject({
      conferenceId: "conference-unified",
      videoConferenceId: "conference-unified",
      taskUuid: "task-unified",
      sourceKind: "unified",
      transcriptText: "Manager: confirm the release plan",
    });
    expect(store.getMeeting("minutes:task-unified")).toMatchObject({
      conferenceId: "conference-unified",
      sourceKind: "unified",
    });
    expect(store.userCanAccessMeeting("minutes:task-unified", "union-manager")).toBe(true);
    expect(store.listMeetingMembers("conference-unified").map((member) => member.unionId).sort()).toEqual([
      "union-manager",
      "union-speaker",
    ]);
    expect(
      store.listMeetingsForUnionId({
        unionId: "union-manager",
        sinceMs: startTimeMs - 60_000,
      }),
    ).toHaveLength(1);
    store.close();
  });

  it("does not merge nearby meetings when their creators differ", () => {
    const dir = mkdtempSync(join(tmpdir(), "dt-meeting-store-no-false-merge-"));
    process.env.WORKBENCH_SQLITE_PATH = join(dir, "wb.sqlite");
    const store = createDingTalkMeetingStore();
    const startTimeMs = Date.parse("2026-07-24T02:00:00.000Z");
    store.upsertMeeting({
      conferenceId: "conference-a",
      title: "Weekly review",
      creatorUnionId: "union-a",
      startTimeMs,
    });
    store.upsertMeeting({
      conferenceId: "minutes:task-b",
      sourceKind: "ai_minutes",
      taskUuid: "task-b",
      title: "Weekly review",
      creatorUnionId: "union-b",
      startTimeMs: startTimeMs + 10_000,
    });

    expect(store.getMeeting("conference-a")).toBeDefined();
    expect(store.getMeeting("minutes:task-b")).toBeDefined();
    store.close();
  });
});
