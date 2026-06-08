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
import { __setTaskIntakeLlmForTest } from "../../src/agent/task-intake/task-intake-llm";
import { findMainThreadSession } from "../../src/web/conversation-thread-resolver";
import { createPeopleDirectoryStore } from "../../src/infra/people-directory-store";

function seedContact(userId: string, name: string): void {
  const store = createPeopleDirectoryStore();
  try {
    store.upsertContact({
      userId,
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
