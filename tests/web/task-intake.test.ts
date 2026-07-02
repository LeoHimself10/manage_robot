import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  __resetWorkbenchStoresForTest,
  handleAssignmentHttp,
} from "../../src/web/assignment-workbench";
import { renderManagerTaskIntakePage } from "../../src/web/manager-task-intake-page";
import { handleTaskIntakeMeetingPreview, handleTaskIntakeMeetingsList } from "../../src/web/task-intake-api";
import { __setTaskIntakeLlmForTest } from "../../src/agent/task-intake/task-intake-llm";
import { findMainThreadSession } from "../../src/web/conversation-thread-resolver";
import { createPeopleDirectoryStore } from "../../src/infra/people-directory-store";
import { createDingTalkMeetingStore } from "../../src/infra/dingtalk-meeting-store";
import type { DingTalkMeetingRecordingClient } from "../../src/integrations/dingtalk/meeting-recording";

function seedContact(userId: string, name: string, unionId?: string): void {
  const store = createPeopleDirectoryStore();
  try {
    store.upsertContact({
      userId,
      unionId,
      name,
      departmentIds: [],
      departmentNames: [],
      active: true,
      isAdmin: false,
      isBoss: false,
      isSenior: false,
    });
  } finally {
    store.close();
  }
}

function stubReq(overrides: {
  url?: string;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}): IncomingMessage {
  const chunks = overrides.body ? [Buffer.from(overrides.body)] : [];
  return {
    url: overrides.url ?? "/",
    method: overrides.method ?? "GET",
    headers: overrides.headers ?? {},
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  } as IncomingMessage;
}

interface CapturedResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function stubRes(): { res: ServerResponse; captured: () => CapturedResponse } {
  const state: CapturedResponse = { statusCode: 200, headers: {}, body: "" };
  const res = {
    writeHead(statusCode: number, headers?: Record<string, string>): void {
      state.statusCode = statusCode;
      if (headers) state.headers = { ...state.headers, ...headers };
    },
    setHeader(name: string, value: string | string[]): void {
      state.headers[name] = value;
    },
    getHeader(name: string): string | string[] | undefined {
      return state.headers[name];
    },
    end(chunk: string): void {
      state.body = chunk ?? "";
    },
  } as ServerResponse;
  return { res, captured: () => state };
}

async function flushAsync(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

describe("task-intake HTTP", () => {
  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), "ti-http-"));
    vi.stubEnv("WORKBENCH_DATA_DIR", tmp);
    vi.stubEnv("WORKBENCH_SQLITE_PATH", join(tmp, "wb.sqlite"));
    vi.stubEnv("WORKBENCH_SESSION_SECRET", "test-session-secret-at-least-32-chars-long");
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "mgr-plain");
    vi.stubEnv("WORKBENCH_PROJECT_PORTFOLIO_USER_IDS", "");
    vi.stubEnv("WORKBENCH_TEST_LOGIN_ENABLED", "1");
    vi.stubEnv("TASK_INTAKE_ENABLED", "1");
    vi.stubEnv("TASK_INTAKE_DINGTALK_MEETINGS_ENABLED", "1");
    vi.stubEnv("PLAN_SESSION_DIR", join(tmp, "sessions"));
    __resetWorkbenchStoresForTest();
    __setTaskIntakeLlmForTest(async () =>
      JSON.stringify({
        parentTitle: "本周任务",
        parentDescription: "本周注册申报整体推进",
        subtasks: [
          { title: "整理资料", deliverables: "资料整理报告", completionCriteria: "资料已归档" },
          { title: "提交申请", deliverables: "申请材料", completionCriteria: "申请已受理" },
        ],
      }),
    );
  });

  afterEach(() => {
    __setTaskIntakeLlmForTest(undefined);
    __resetWorkbenchStoresForTest();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  async function loginManager(userId = "mgr-plain"): Promise<string> {
    const loginReq = stubReq({
      method: "POST",
      url: "/api/workbench/login",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, role: "manager" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    return String(loginRes.captured().headers["Set-Cookie"] ?? "");
  }

  it("renders the task-intake page with the wizard", () => {
    const html = renderManagerTaskIntakePage({ userLabel: "测试" });
    expect(html).toContain("任务快录入库");
    expect(html).toContain("task-intake/preview");
    expect(html).toContain('id="docUrl"');
    expect(html).toContain("docUrl:");
    expect(html).toContain("最近会议");
    expect(html).toContain("task-intake/meetings");
  });

  it("previews tasks from a readable URL when no text is pasted", async () => {
    const cookie = await loginManager();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("更新API文档\n联调验收脚本", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    );
    const seenPrompts: string[] = [];
    __setTaskIntakeLlmForTest(async (input) => {
      seenPrompts.push(input.user);
      return JSON.stringify({
        parentTitle: "链接导入任务",
        parentDescription: "来自链接正文",
        subtasks: [
          {
            title: input.user.includes("更新API文档") ? "更新API文档" : "未读取链接",
            objective: "完成链接中的任务",
            deliverables: "文档",
            completionCriteria: "已验收",
          },
        ],
      });
    });

    const previewReq = stubReq({
      method: "POST",
      url: "/api/workbench/manager/task-intake/preview",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ docUrl: "https://93.184.216.34/tasks", parentTitle: "链接导入任务" }),
    });
    const previewRes = stubRes();
    handleAssignmentHttp(previewReq, previewRes.res);
    await flushAsync();

    const body = JSON.parse(previewRes.captured().body);
    expect(body.ok).toBe(true);
    expect(body.rows[0].title).toBe("更新API文档");
    expect(seenPrompts.some((p) => p.includes("联调验收脚本"))).toBe(true);
  });

  it("lists only manager-related DingTalk meetings", async () => {
    seedContact("mgr-plain", "主管", "union-mgr");
    const meetingStore = createDingTalkMeetingStore();
    const now = Date.now();
    meetingStore.upsertMeeting({
      conferenceId: "conf-visible",
      title: "项目周会",
      creatorUnionId: "union-other",
      startTimeMs: now - 1000,
      flashStatus: "video_generated",
    });
    meetingStore.replaceMeetingMembers("conf-visible", [{ unionId: "union-mgr", nickName: "主管" }]);
    meetingStore.upsertMeeting({
      conferenceId: "conf-hidden",
      title: "无关会议",
      creatorUnionId: "union-other",
      startTimeMs: now - 1000,
      flashStatus: "video_generated",
    });
    meetingStore.replaceMeetingMembers("conf-hidden", [{ unionId: "union-other", nickName: "别人" }]);
    meetingStore.close();
    const cookie = await loginManager();

    const req = stubReq({
      method: "GET",
      url: "/api/workbench/manager/task-intake/meetings?days=14",
      headers: { cookie },
    });
    const res = stubRes();
    handleAssignmentHttp(req, res.res);
    await flushAsync();

    const body = JSON.parse(res.captured().body);
    expect(body.ok).toBe(true);
    expect(body.meetings.map((m: { conferenceId: string }) => m.conferenceId)).toEqual(["conf-visible"]);
  });

  it("syncs recent DingTalk calendar meetings before listing", async () => {
    seedContact("mgr-plain", "涓荤", "union-mgr");
    const meetingStore = createDingTalkMeetingStore();
    const now = Date.parse("2026-07-02T06:30:00.000Z");
    const meetingClient = {
      async listCalendarVideoMeetings() {
        return [
          {
            calendarEventId: "evt-ai-log",
            conferenceId: "calendar-conf",
            title: "AI日志助手 需求收集",
            roomCode: "899106669",
            organizerUnionId: "union-owner",
            attendeeUnionIds: ["union-mgr"],
            startTimeMs: Date.parse("2026-07-02T11:00:00+08:00"),
            endTimeMs: Date.parse("2026-07-02T12:00:00+08:00"),
            rawJson: { id: "evt-ai-log" },
          },
        ];
      },
      async listVideoConferencesByRoomCode() {
        return [
          {
            conferenceId: "actual-conf",
            title: "AI日志助手 需求收集",
            roomCode: "899106669",
            creatorUnionId: "union-owner",
            startTimeMs: Date.parse("2026-07-02T11:00:05+08:00"),
            endTimeMs: Date.parse("2026-07-02T11:47:42+08:00"),
            status: "1",
          },
        ];
      },
      async getCloudRecordTranscript() {
        throw new Error("not used");
      },
      async getVideoConference() {
        throw new Error("not used");
      },
      async listVideoConferenceMembers() {
        return [];
      },
    } satisfies DingTalkMeetingRecordingClient;

    const result = await handleTaskIntakeMeetingsList({
      managerUserId: "mgr-plain",
      days: 14,
      meetingStore,
      meetingClient,
      nowMs: now,
    });

    expect(result.meetings.map((m) => m.conferenceId)).toEqual(["actual-conf"]);
    expect(result.meetings[0]).toMatchObject({
      title: "AI日志助手 需求收集",
      transcriptCached: false,
    });
    expect(meetingStore.userCanAccessMeeting("actual-conf", "union-mgr")).toBe(true);
    meetingStore.close();
  });

  it("previews AI minutes with the recording owner unionId when the manager is only an attendee", async () => {
    seedContact("mgr-plain", "涓荤", "union-mgr");
    const meetingStore = createDingTalkMeetingStore();
    meetingStore.upsertMeeting({
      conferenceId: "actual-conf",
      title: "颅内项目周会",
      creatorUnionId: "union-owner",
      startTimeMs: Date.parse("2026-06-22T17:17:30+08:00"),
    });
    meetingStore.replaceMeetingMembers("actual-conf", [{ unionId: "union-mgr", nickName: "涓荤" }]);
    const requestedUnionIds: string[] = [];
    const meetingClient = {
      async getCloudRecordTranscript(input) {
        requestedUnionIds.push(String(input.unionId ?? ""));
        if (input.unionId !== "union-owner") throw new Error("wrong unionId");
        return {
          conferenceId: "actual-conf",
          text: "曹杰: 更新入组进展\n姚凯珩: 跟进日志助手任务",
          paragraphs: [],
          fetchedAt: "2026-07-02T00:00:00.000Z",
        };
      },
      async getVideoConference() {
        throw new Error("not used");
      },
      async listVideoConferenceMembers() {
        return [];
      },
    } satisfies DingTalkMeetingRecordingClient;
    __setTaskIntakeLlmForTest(async (input) =>
      JSON.stringify({
        parentTitle: "颅内项目周会跟进",
        parentDescription: "来自AI听记",
        subtasks: [
          {
            title: input.user.includes("日志助手") ? "跟进日志助手任务" : "未读取AI听记",
            objective: "落实会议行动项",
            deliverables: "行动项更新",
            completionCriteria: "完成同步",
          },
        ],
      }),
    );

    const result = await handleTaskIntakeMeetingPreview({
      managerUserId: "mgr-plain",
      conferenceId: "actual-conf",
      meetingStore,
      meetingClient,
    });

    expect(requestedUnionIds).toEqual(["union-owner"]);
    expect(result.rows[0]?.title).toBe("跟进日志助手任务");
    meetingStore.close();
  });

  it("does not send the synthetic meeting title marker as transcript content", async () => {
    seedContact("mgr-plain", "Manager", "union-mgr");
    const meetingStore = createDingTalkMeetingStore();
    meetingStore.upsertMeeting({
      conferenceId: "conf-meeting-marker",
      title: "AI log requirements",
      creatorUnionId: "union-mgr",
      startTimeMs: Date.parse("2026-07-02T03:00:00.000Z"),
    });
    meetingStore.replaceMeetingMembers("conf-meeting-marker", [{ unionId: "union-mgr", nickName: "Manager" }]);
    meetingStore.setMeetingTranscript({
      conferenceId: "conf-meeting-marker",
      transcriptText:
        "Action item: Yao Kaiheng drafts the AI log assistant requirements.\n" +
        "Action item: Dong Shaobo supplies representative log pain points.",
      fetchedAt: "2026-07-02T00:00:00.000Z",
    });
    const seenPrompts: string[] = [];
    __setTaskIntakeLlmForTest(async (input) => {
      seenPrompts.push(input.user);
      return JSON.stringify({
        parentTitle: "AI log requirements follow-up",
        parentDescription: "Imported from AI minutes",
        subtasks: [
          {
            title: input.user.includes("[meeting]") ? "bad synthetic meeting marker" : "draft AI log requirements",
            objective: "Draft requirements",
            deliverables: "Requirements document",
            completionCriteria: "Reviewed",
          },
        ],
      });
    });

    const result = await handleTaskIntakeMeetingPreview({
      managerUserId: "mgr-plain",
      conferenceId: "conf-meeting-marker",
      meetingStore,
    });

    expect(seenPrompts[0]).not.toContain("[meeting]");
    expect(result.rows[0]?.title).toBe("draft AI log requirements");
    meetingStore.close();
  });

  it("previews a cached DingTalk meeting transcript and rejects unrelated meetings", async () => {
    seedContact("mgr-plain", "主管", "union-mgr");
    const meetingStore = createDingTalkMeetingStore();
    const now = Date.now();
    meetingStore.upsertMeeting({
      conferenceId: "conf-visible",
      title: "项目周会",
      creatorUnionId: "union-mgr",
      startTimeMs: now - 1000,
      flashStatus: "video_generated",
    });
    meetingStore.replaceMeetingMembers("conf-visible", [{ unionId: "union-mgr", nickName: "主管" }]);
    meetingStore.setMeetingTranscript({
      conferenceId: "conf-visible",
      transcriptText: "主管: 更新API文档\n员工: 联调验收脚本",
      fetchedAt: "2026-06-30T00:00:00.000Z",
    });
    meetingStore.upsertMeeting({
      conferenceId: "conf-hidden",
      title: "无关会议",
      creatorUnionId: "union-other",
      startTimeMs: now - 1000,
      flashStatus: "video_generated",
    });
    meetingStore.replaceMeetingMembers("conf-hidden", [{ unionId: "union-other", nickName: "别人" }]);
    meetingStore.setMeetingTranscript({
      conferenceId: "conf-hidden",
      transcriptText: "别人: 不应读取",
      fetchedAt: "2026-06-30T00:00:00.000Z",
    });
    meetingStore.close();
    const cookie = await loginManager();
    __setTaskIntakeLlmForTest(async (input) =>
      JSON.stringify({
        parentTitle: "项目周会跟进",
        parentDescription: "来自钉钉会议转写",
        subtasks: [
          {
            title: input.user.includes("更新API文档") ? "更新API文档" : "未读取会议",
            objective: "完成会议行动项",
            deliverables: "文档",
            completionCriteria: "已验收",
          },
        ],
      }),
    );

    const previewReq = stubReq({
      method: "POST",
      url: "/api/workbench/manager/task-intake/meetings/preview",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ conferenceId: "conf-visible" }),
    });
    const previewRes = stubRes();
    handleAssignmentHttp(previewReq, previewRes.res);
    await flushAsync();
    const previewBody = JSON.parse(previewRes.captured().body);
    expect(previewBody.ok).toBe(true);
    expect(previewBody.rows[0].title).toBe("更新API文档");

    const deniedReq = stubReq({
      method: "POST",
      url: "/api/workbench/manager/task-intake/meetings/preview",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ conferenceId: "conf-hidden" }),
    });
    const deniedRes = stubRes();
    handleAssignmentHttp(deniedReq, deniedRes.res);
    await flushAsync();
    expect(deniedRes.captured().statusCode).toBe(403);
    expect(JSON.parse(deniedRes.captured().body).error).toBe("meeting_not_accessible");
  });

  it("previews then publishes when every row has an assignee (non-portfolio manager)", async () => {
    const cookie = await loginManager();
    seedContact("u-a", "员工甲");
    seedContact("u-b", "员工乙");
    const previewReq = stubReq({
      method: "POST",
      url: "/api/workbench/manager/task-intake/preview",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ pastedText: "整理资料\n提交申请", parentTitle: "本周任务" }),
    });
    const previewRes = stubRes();
    handleAssignmentHttp(previewReq, previewRes.res);
    await flushAsync();
    const previewBody = JSON.parse(previewRes.captured().body);
    expect(previewBody.ok).toBe(true);
    expect(previewBody.rows).toHaveLength(2);

    const commitReq = stubReq({
      method: "POST",
      url: "/api/workbench/manager/task-intake/commit",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        parentTitle: "本周任务",
        parentDescription: "本周注册申报整体推进",
        rows: [
          { itemId: "ti_1", selected: true, title: "整理资料", objective: "整理资料目标", deliverables: "资料整理报告", completionCriteria: "资料已归档", actions: "", dependsOn: "", dueAt: "2026-12-31", assigneeUserId: "u-a" },
          { itemId: "ti_2", selected: true, title: "提交申请", objective: "提交申请目标", deliverables: "申请材料", completionCriteria: "申请已受理", actions: "", dependsOn: "", dueAt: "2026-12-31", assigneeUserId: "u-b" },
        ],
      }),
    });
    const commitRes = stubRes();
    handleAssignmentHttp(commitReq, commitRes.res);
    await flushAsync();
    const commitBody = JSON.parse(commitRes.captured().body);
    expect(commitBody.ok).toBe(true);
    expect(commitBody.result.mode).toBe("published");
    expect(commitBody.result.task.taskNo).toBeTruthy();
    expect(commitBody.result.subtaskCount).toBe(2);
  });

  it("stages a draft to the main thread when an assignee is missing", async () => {
    const cookie = await loginManager();
    const commitReq = stubReq({
      method: "POST",
      url: "/api/workbench/manager/task-intake/commit",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        parentTitle: "本周任务",
        parentDescription: "本周注册申报整体推进",
        rows: [
          { itemId: "ti_1", selected: true, title: "整理资料", objective: "整理资料目标", deliverables: "资料整理报告", completionCriteria: "资料已归档", actions: "", dependsOn: "", dueAt: "2026-12-31", assigneeUserId: "u-a" },
          { itemId: "ti_2", selected: true, title: "提交申请", objective: "提交申请目标", deliverables: "申请材料", completionCriteria: "申请已受理", actions: "", dependsOn: "", dueAt: "2026-12-31", assigneeUserId: "" },
        ],
      }),
    });
    const commitRes = stubRes();
    handleAssignmentHttp(commitReq, commitRes.res);
    await flushAsync();
    const commitBody = JSON.parse(commitRes.captured().body);
    expect(commitBody.ok).toBe(true);
    expect(commitBody.result.mode).toBe("staged");
    expect(commitBody.result.stagedDeepLink).toContain("openDraftEditor=1");

    const main = findMainThreadSession("mgr-plain");
    const draft = main.latestDraft as { tasks?: unknown[] } | undefined;
    expect(draft?.tasks).toHaveLength(2);
  });

  it("accepts self due mode in commit payload and stages successfully", async () => {
    const cookie = await loginManager();
    const commitReq = stubReq({
      method: "POST",
      url: "/api/workbench/manager/task-intake/commit",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        parentTitle: "本周任务",
        parentDescription: "本周注册申报整体推进",
        rows: [
          {
            itemId: "ti_1",
            selected: true,
            title: "整理资料",
            objective: "整理资料目标",
            deliverables: "资料整理报告",
            completionCriteria: "资料已归档",
            actions: "",
            dependsOn: "",
            dueMode: "self",
            dueExpectation: "三天左右",
            dueAt: "",
            assigneeUserId: "",
          },
        ],
      }),
    });
    const commitRes = stubRes();
    handleAssignmentHttp(commitReq, commitRes.res);
    await flushAsync();
    const commitBody = JSON.parse(commitRes.captured().body);
    expect(commitBody.ok).toBe(true);
    expect(commitBody.result.mode).toBe("staged");
  });

  it("rejects commit with invalid mode when parent description is missing", async () => {
    const cookie = await loginManager();
    seedContact("u-a", "员工甲");
    const commitReq = stubReq({
      method: "POST",
      url: "/api/workbench/manager/task-intake/commit",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        parentTitle: "本周任务",
        parentDescription: "",
        rows: [
          { itemId: "ti_1", selected: true, title: "整理资料", objective: "整理目标", deliverables: "资料包", completionCriteria: "已完成", actions: "", dependsOn: "", dueAt: "2026-12-31", assigneeUserId: "u-a" },
        ],
      }),
    });
    const commitRes = stubRes();
    handleAssignmentHttp(commitReq, commitRes.res);
    await flushAsync();
    const commitBody = JSON.parse(commitRes.captured().body);
    expect(commitBody.ok).toBe(true);
    expect(commitBody.result.mode).toBe("invalid");
    expect(commitBody.result.errors.some((e: { itemId: string }) => e.itemId === "parentDescription")).toBe(true);
  });

  it("redirects away from the page and 404s the API when disabled", async () => {
    vi.stubEnv("TASK_INTAKE_ENABLED", "0");
    __resetWorkbenchStoresForTest();
    const cookie = await loginManager();

    const pageReq = stubReq({ url: "/workbench/manager/task-intake", headers: { cookie } });
    const pageRes = stubRes();
    handleAssignmentHttp(pageReq, pageRes.res);
    await flushAsync();
    expect(pageRes.captured().statusCode).toBe(302);

    const apiReq = stubReq({
      method: "POST",
      url: "/api/workbench/manager/task-intake/preview",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ pastedText: "x" }),
    });
    const apiRes = stubRes();
    handleAssignmentHttp(apiReq, apiRes.res);
    await flushAsync();
    expect(apiRes.captured().statusCode).toBe(404);
  });
});
