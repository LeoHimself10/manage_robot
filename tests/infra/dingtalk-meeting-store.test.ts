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
});
