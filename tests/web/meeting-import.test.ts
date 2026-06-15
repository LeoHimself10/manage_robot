import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  __resetWorkbenchStoresForTest,
  handleAssignmentHttp,
} from "../../src/web/assignment-workbench";
import { renderManagerMeetingImportPage } from "../../src/web/manager-meeting-import-page";
import { __setMeetingImportLlmForTest } from "../../src/agent/meeting-import/meeting-import-llm";
import { createWorkbenchFormalTaskStore } from "../../src/infra/workbench-formal-task-store";

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

describe("meeting-import HTTP", () => {
  let portfolioProjectId = "";

  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), "mi-http-"));
    vi.stubEnv("WORKBENCH_DATA_DIR", tmp);
    vi.stubEnv("WORKBENCH_SQLITE_PATH", join(tmp, "wb.sqlite"));
    vi.stubEnv("WORKBENCH_SESSION_SECRET", "test-session-secret-at-least-32-chars-long");
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "mgr-portfolio");
    vi.stubEnv("WORKBENCH_PROJECT_PORTFOLIO_USER_IDS", "mgr-portfolio");
    vi.stubEnv("WORKBENCH_TEST_LOGIN_ENABLED", "1");
    vi.stubEnv("PLAN_SESSION_DIR", join(tmp, "sessions"));
    __resetWorkbenchStoresForTest();

    __setMeetingImportLlmForTest(async () =>
      JSON.stringify([
        { id: "item-1", title: "整理注册资料", excerpt: "整理注册资料并提交", assigneeName: "张三" },
      ]),
    );

    const store = createWorkbenchFormalTaskStore();
    portfolioProjectId = store.createProject({ ownerUserId: "mgr-portfolio", name: "注册申报" }).projectId;
  });

  afterEach(() => {
    __setMeetingImportLlmForTest(undefined);
    __resetWorkbenchStoresForTest();
    vi.unstubAllEnvs();
  });

  async function loginManager(): Promise<string> {
    const loginReq = stubReq({
      method: "POST",
      url: "/api/workbench/login",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "mgr-portfolio", role: "manager" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    return String(loginRes.captured().headers["Set-Cookie"] ?? "");
  }

  it("renders meeting import page HTML", () => {
    const html = renderManagerMeetingImportPage({ userLabel: "测试" });
    expect(html).toContain("会议待办入库");
    expect(html).toContain("meeting-import/parse");
    // Regression: scriptHtml lives in a TS template literal; \" becomes " and breaks JS parse.
    expect(html).not.toContain('data-idx="" + idx');
    expect(html).toContain("return '<tr data-idx=\"' + idx");
  });

  it("redirects non-portfolio user away from meeting import page", async () => {
    vi.stubEnv("WORKBENCH_PROJECT_PORTFOLIO_USER_IDS", "");
    __resetWorkbenchStoresForTest();
    const cookie = await loginManager();
    const req = stubReq({
      url: "/workbench/manager/meeting-import",
      headers: { cookie },
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    await flushAsync();
    expect(captured().statusCode).toBe(302);
    const loc = String(captured().headers.Location ?? "");
    expect(loc.includes("/workbench/manager/tasks") || loc.includes("/workbench")).toBe(true);
  });

  it("parse and analyze meeting import", async () => {
    const cookie = await loginManager();
    const parseReq = stubReq({
      method: "POST",
      url: "/api/workbench/manager/meeting-import/parse",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        pastedText: "## Action Items\n- 整理注册资料\n",
        meetingTitle: "周会",
      }),
    });
    const parseRes = stubRes();
    handleAssignmentHttp(parseReq, parseRes.res);
    await flushAsync();
    const parseBody = JSON.parse(parseRes.captured().body);
    expect(parseBody.ok).toBe(true);
    expect(parseBody.items.length).toBeGreaterThan(0);
    expect(parseBody.batchId).toMatch(/^mib:/);

    const analyzeReq = stubReq({
      method: "POST",
      url: "/api/workbench/manager/meeting-import/analyze",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        batchId: parseBody.batchId,
        projectId: parseBody.projectSuggestion.projectId || portfolioProjectId,
        projectName: parseBody.projectSuggestion.projectName || "注册申报",
        items: parseBody.items,
      }),
    });
    const analyzeRes = stubRes();
    handleAssignmentHttp(analyzeReq, analyzeRes.res);
    await flushAsync();
    const analyzeBody = JSON.parse(analyzeRes.captured().body);
    expect(analyzeBody.ok).toBe(true);
    expect(analyzeBody.rows.length).toBeGreaterThan(0);
  });
});
