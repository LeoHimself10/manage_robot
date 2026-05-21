import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressDigestFacts } from "../../../src/agent/progress-digest/progress-digest-facts";
import {
  loadProgressDigestLlmConfig,
  summarizeProgressDigestWithLlm,
} from "../../../src/agent/progress-digest/progress-digest-llm";

const sampleFacts: ProgressDigestFacts = {
  dateYmd: "2026-05-21",
  dateDisplay: "5月21日",
  audience: "manager",
  detailUrl: "https://example.com/workbench/manager/tasks",
  isBrief: false,
  core: {
    summary: {
      needsYouCount: 1,
      inProgressCount: 0,
      waitingAcceptCount: 0,
      blockedCount: 0,
      overdueCount: 0,
    },
    needsAttention: [
      {
        taskTitle: "产线异常调查",
        assigneeNames: ["杨贺新"],
        statusLabel: "已拒绝",
        overdue: false,
      },
    ],
    inProgress: [],
    recentUpdates: [],
  },
};

describe("progress-digest-llm", () => {
  beforeEach(() => {
    process.env.QWEN_API_KEY = "test-key";
    process.env.PROGRESS_DIGEST_LLM_ENABLED = "1";
    process.env.PROGRESS_DIGEST_LLM_MODEL = "qwen3.6-flash";
  });

  afterEach(() => {
    delete process.env.QWEN_API_KEY;
    delete process.env.PROGRESS_DIGEST_LLM_ENABLED;
    delete process.env.PROGRESS_DIGEST_LLM_MODEL;
    vi.restoreAllMocks();
  });

  it("returns parsed subject and markdown on success", async () => {
    const config = loadProgressDigestLlmConfig()!;
    const fetchImpl = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                subject: "今日任务 · 1项需您处理",
                markdown: "### 今日任务一览 · 5月21日\n\n**有 1 项需要您处理。**",
              }),
            },
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const out = await summarizeProgressDigestWithLlm(sampleFacts, config, fetchImpl);
    expect(out?.subject).toBe("今日任务 · 1项需您处理");
    expect(out?.markdown).toContain("今日任务一览");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const body = JSON.parse(String((fetchImpl.mock.calls[0]?.[1] as RequestInit)?.body));
    expect(body.enable_thinking).toBe(false);
    expect(body.model).toBe("qwen3.6-flash");
  });

  it("returns null on timeout", async () => {
    const config = { ...loadProgressDigestLlmConfig()!, timeoutMs: 50 };
    const fetchImpl = vi.fn((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      }),
    ) as unknown as typeof fetch;

    const out = await summarizeProgressDigestWithLlm(sampleFacts, config, fetchImpl);
    expect(out).toBeNull();
  });

  it("returns null when disabled", async () => {
    const config = { ...loadProgressDigestLlmConfig()!, enabled: false };
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const out = await summarizeProgressDigestWithLlm(sampleFacts, config, fetchImpl);
    expect(out).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
