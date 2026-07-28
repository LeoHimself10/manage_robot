import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  getJobReq,
  listJobReqs,
  parseCompetencyEvalConversationHistory,
  isCompetencyEvalPageEnabled,
  saveJobReq,
} from "../../src/web/competency-eval-api";
import { renderCompetencyEvalPage } from "../../src/web/competency-eval-page";
import { COMPETENCY_EVAL_PAGE_CSS } from "../../src/web/competency-eval-page-styles";
import { startSseHeartbeat } from "../../src/web/sse-heartbeat";
import { renderManagerDashboardPage } from "../../src/web/manager-dashboard-page";
import { renderAdminOpsDashboardPage } from "../../src/web/admin-ops-dashboard-page";
import {
  __resetWorkbenchStoresForTest,
  handleAssignmentHttp,
} from "../../src/web/assignment-workbench";

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

function stubRes(): {
  res: ServerResponse;
  captured: () => { statusCode: number; body: string; headers: Record<string, string | string[] | undefined> };
} {
  const state = {
    statusCode: 200,
    body: "",
    headers: {} as Record<string, string | string[] | undefined>,
  };
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

async function loginManager(userId: string): Promise<string> {
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

describe("competency-eval api helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parseCompetencyEvalConversationHistory keeps user/assistant turns with caps", () => {
    expect(parseCompetencyEvalConversationHistory(null)).toEqual([]);
    expect(parseCompetencyEvalConversationHistory([
      { role: "user", content: " 评张三 " },
      { role: "assistant", content: "报告摘要" },
      { role: "system", content: "ignored" },
    ])).toEqual([
      { role: "user", content: "评张三" },
      { role: "assistant", content: "报告摘要" },
    ]);
    const many = Array.from({ length: 25 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `turn-${i}`,
    }));
    expect(parseCompetencyEvalConversationHistory(many)).toHaveLength(20);
  });

  it("isCompetencyEvalPageEnabled mirrors env flag", () => {
    vi.stubEnv("COMPETENCY_EVAL_ENABLED", "1");
    expect(isCompetencyEvalPageEnabled()).toBe(true);
    vi.stubEnv("COMPETENCY_EVAL_ENABLED", "0");
    expect(isCompetencyEvalPageEnabled()).toBe(false);
  });
});

describe("competency-eval SSE heartbeat", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a long-running stream active and stops cleanly", () => {
    vi.useFakeTimers();
    const listeners = new Map<string, () => void>();
    const response = {
      destroyed: false,
      writableEnded: false,
      write: vi.fn(),
      once: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, listener);
        return response;
      }),
      off: vi.fn((event: string) => {
        listeners.delete(event);
        return response;
      }),
    };

    const stop = startSseHeartbeat(response as unknown as ServerResponse, 10_000);
    vi.advanceTimersByTime(30_000);

    expect(response.write).toHaveBeenCalledTimes(3);
    expect(response.write).toHaveBeenCalledWith(": keep-alive\n\n");

    stop();
    vi.advanceTimersByTime(20_000);
    expect(response.write).toHaveBeenCalledTimes(3);
  });
});

describe("competency-eval job requirement upload", () => {
  let tmpDir = "";

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "comp-eval-job-req-"));
    vi.stubEnv("COMPETENCY_EVAL_DATA_DIR", tmpDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("accepts and preserves Markdown content", async () => {
    const saved = await saveJobReq({
      userId: "manager-1",
      filename: "研发主管要求.md",
      buffer: Buffer.from("# 评估标准\n关注交付和协作。", "utf8"),
    });

    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(listJobReqs("manager-1")).toHaveLength(1);
    const loaded = getJobReq("manager-1", saved.meta.jobReqId);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.content).toContain("关注交付和协作");
  });

  it("rejects docx uploads", async () => {
    const saved = await saveJobReq({
      userId: "manager-1",
      filename: "研发主管要求.docx",
      buffer: Buffer.from("PK binary docx"),
    });

    expect(saved).toEqual({
      ok: false,
      reason: "unsupported_file_type",
      message: "岗位要求仅支持 Markdown（.md）文件。",
    });
    expect(listJobReqs("manager-1")).toEqual([]);
  });
});

describe("competency-eval page styles", () => {
  it("keeps main pane in column 1 when sidebar collapsed", () => {
    expect(COMPETENCY_EVAL_PAGE_CSS).toContain(".ce-root.is-sidebar-collapsed .ce-main { grid-column: 1; }");
  });
});

describe("competency-eval page render", () => {
  it("renders chat UI marker and nav when enabled for whitelisted user", () => {
    const html = renderCompetencyEvalPage({
      userLabel: "曹一挥",
      competencyEvalEnabled: true,
    });
    expect(html).toContain("能力评估");
    expect(html).toContain('id="compEvalChatCard"');
    expect(html).toContain('id="compEvalChatLog"');
    expect(html).toContain('id="compEvalSidebar"');
    expect(html).toContain('id="compEvalSessionList"');
    expect(html).toContain('id="compEvalNewSession"');
    expect(html).toContain("/api/workbench/competency-eval");
    expect(html).toContain("/static/performance-chat-markdown.js");
    expect(html).toContain("performance-chat-markdown.js?v=headings-20260728");
    expect(html).toContain('data-wb-nav="mgr-competency-eval"');
  });

  it("shows competency nav on manager dashboard when sessionUserId is whitelisted", () => {
    vi.stubEnv("COMPETENCY_EVAL_ENABLED", "1");
    vi.stubEnv("COMPETENCY_EVAL_USER_IDS", "641871342");
    const html = renderManagerDashboardPage({
      userLabel: "姚凯珩",
      sessionUserId: "641871342",
    });
    expect(html).toContain("能力评估");
    expect(html).toContain('href="/workbench/manager/competency-eval"');
  });

  it("shows competency nav on admin ops when sessionUserId is whitelisted", () => {
    vi.stubEnv("COMPETENCY_EVAL_ENABLED", "1");
    vi.stubEnv("COMPETENCY_EVAL_USER_IDS", "641871342");
    const html = renderAdminOpsDashboardPage({
      userLabel: "姚凯珩",
      sessionUserId: "641871342",
    });
    expect(html).toContain("能力评估");
    expect(html).toContain('href="/workbench/manager/competency-eval"');
    expect(html).toContain('data-wb-view="manager"');
    expect(html).toContain('data-wb-redirect="/workbench/manager/competency-eval"');
  });
});

describe("competency-eval HTTP access", () => {
  let tmpDir = "";

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "comp-eval-http-"));
    vi.stubEnv("WORKBENCH_SQLITE_PATH", join(tmpDir, "workbench.sqlite"));
    vi.stubEnv("WORKBENCH_SESSION_SECRET", "test-session-secret-at-least-32-chars-long");
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "mgr-plain,01451725613871,641871342");
    vi.stubEnv("WORKBENCH_TEST_LOGIN_ENABLED", "1");
    vi.stubEnv("PLAN_SESSION_DIR", join(tmpDir, "sessions"));
    vi.stubEnv("COMPETENCY_EVAL_ENABLED", "1");
    vi.stubEnv("COMPETENCY_EVAL_USER_IDS", "01451725613871,641871342");
    vi.stubEnv("COMPETENCY_EVAL_DATA_DIR", join(tmpDir, "competency-eval"));
    __resetWorkbenchStoresForTest();
  });

  afterEach(() => {
    __resetWorkbenchStoresForTest();
    vi.unstubAllEnvs();
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Windows may keep SQLite WAL handles briefly open after reset.
      }
    }
  });

  it("returns 403 when feature disabled", async () => {
    vi.stubEnv("COMPETENCY_EVAL_ENABLED", "0");
    const cookie = await loginManager("01451725613871");
    const req = stubReq({
      url: "/workbench/manager/competency-eval",
      headers: { cookie },
    });
    const res = stubRes();
    handleAssignmentHttp(req, res.res);
    await flushAsync();
    expect(res.captured().statusCode).toBe(403);
  });

  it("returns 403 for non-whitelist manager", async () => {
    const cookie = await loginManager("mgr-plain");
    const req = stubReq({
      url: "/workbench/manager/competency-eval",
      headers: { cookie },
    });
    const res = stubRes();
    handleAssignmentHttp(req, res.res);
    await flushAsync();
    expect(res.captured().statusCode).toBe(403);
  });

  it("serves chat page for whitelisted manager", async () => {
    const cookie = await loginManager("01451725613871");
    const req = stubReq({
      url: "/workbench/manager/competency-eval",
      headers: { cookie },
    });
    const res = stubRes();
    handleAssignmentHttp(req, res.res);
    await flushAsync();
    expect(res.captured().statusCode).toBe(200);
    expect(res.captured().body).toContain('id="compEvalChatCard"');
    expect(res.captured().body).toContain("能力评估助手");
  });

  it("lets a dual-role admin switch to the competency eval manager page", async () => {
    vi.stubEnv("WORKBENCH_ADMIN_USER_IDS", "641871342");
    const loginReq = stubReq({
      method: "POST",
      url: "/api/workbench/login",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "641871342", role: "admin" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const adminCookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const switchReq = stubReq({
      method: "POST",
      url: "/api/workbench/switch-view",
      headers: {
        cookie: adminCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ view: "manager" }),
    });
    const switchRes = stubRes();
    handleAssignmentHttp(switchReq, switchRes.res);
    await flushAsync();
    expect(switchRes.captured().statusCode).toBe(200);
    const managerCookie = String(switchRes.captured().headers["Set-Cookie"] ?? "");

    const pageReq = stubReq({
      url: "/workbench/manager/competency-eval",
      headers: { cookie: managerCookie },
    });
    const pageRes = stubRes();
    handleAssignmentHttp(pageReq, pageRes.res);
    await flushAsync();
    expect(pageRes.captured().statusCode).toBe(200);
    expect(pageRes.captured().body).toContain("能力评估助手");
  });
});
