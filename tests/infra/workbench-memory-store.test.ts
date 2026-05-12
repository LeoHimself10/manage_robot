import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import {
  appendMemoryEvents,
  loadMemoryContextForPlan,
} from "../../src/infra/workbench-memory-store";

describe("workbench-memory-store", () => {
  let sqlitePath = "";

  beforeEach(() => {
    const temp = mkdtempSync(join(tmpdir(), "memory-store-test-"));
    sqlitePath = join(temp, "workbench.sqlite");
    vi.stubEnv("WORKBENCH_SQLITE_PATH", sqlitePath);
    vi.stubEnv("MEMORY_FACT_TTL_DAYS", "1");
    vi.stubEnv("CONTENT_FILTER_DISABLED", "0");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("stores redacted summary/facts and exposes active facts", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "联系人手机号 13812345678 已反馈",
                facts: [
                  {
                    kind: "contact",
                    value: "负责人手机 13812345678",
                    source: "assistant",
                    confidence: "HIGH",
                  },
                ],
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await appendMemoryEvents({
      planId: "plan-memory-1",
      userMessage: "用户提到手机号 13812345678",
      assistantMessage: "已记录",
      traceId: "trace-1",
      modelConfig: {
        apiKey: "test-key",
        baseUrl: "https://example.test/v1",
        timeoutMs: 5000,
      },
    });
    const memory = loadMemoryContextForPlan("plan-memory-1");
    expect(memory.summary).toContain("[已脱敏]");
    expect(memory.facts.length).toBe(1);
    expect(memory.facts[0]).toContain("[已脱敏]");
  });

  it("marks expired facts and records memory events", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "短期事实",
                facts: [
                  {
                    kind: "availability",
                    value: "今天有空",
                    source: "assistant",
                    confidence: "LOW",
                    expiresAt: "2000-01-01T00:00:00.000Z",
                  },
                ],
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await appendMemoryEvents({
      planId: "plan-memory-2",
      userMessage: "今天有空",
      assistantMessage: "记录完成",
      traceId: "trace-2",
      modelConfig: {
        apiKey: "test-key",
        baseUrl: "https://example.test/v1",
        timeoutMs: 5000,
      },
    });
    const memory = loadMemoryContextForPlan("plan-memory-2");
    expect(memory.facts).toHaveLength(0);

    const db = new DatabaseSync(sqlitePath);
    try {
      const statuses = db
        .prepare("SELECT status FROM memory_facts WHERE plan_id = ?")
        .all("plan-memory-2") as Array<{ status?: string }>;
      expect(statuses[0]?.status).toBe("expired");
      const events = db
        .prepare("SELECT event_type FROM memory_events WHERE plan_id = ?")
        .all("plan-memory-2") as Array<{ event_type?: string }>;
      expect(events.some((e) => e.event_type === "fact_expired")).toBe(true);
    } finally {
      db.close();
    }
  });
});
