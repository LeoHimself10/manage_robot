import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressDigestFacts } from "../../../src/agent/progress-digest/progress-digest-facts";
import {
  loadProgressDigestLlmConfig,
  slimFactsForLlm,
  summarizeProgressDigestWithLlm,
} from "../../../src/agent/progress-digest/progress-digest-llm";

const sampleFacts: ProgressDigestFacts = {
  dateYmd: "2026-05-21",
  dateDisplay: "5月21日",
  audience: "manager",
  detailUrl: "https://example.com/workbench/manager/tasks",
  isBrief: false,
  activityWindow: {
    sinceIso: "2026-05-19T16:00:00.000Z",
    untilIso: "2026-05-20T16:00:00.000Z",
    labelYmd: "2026-05-20",
    labelDisplay: "5月20日",
  },
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

  it("slimFactsForLlm omits userId fields", () => {
    const slim = slimFactsForLlm(sampleFacts);
    expect(JSON.stringify(slim)).not.toContain("userId");
  });

  it("returns parsed headline and suggestions on success", async () => {
    const config = loadProgressDigestLlmConfig()!;
    const fetchImpl = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                headline: "有 1 项需要您处理。",
                suggestions: ["优先处理已拒绝子任务"],
              }),
            },
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const out = await summarizeProgressDigestWithLlm(sampleFacts, config, fetchImpl);
    expect(out?.headline).toContain("需要您处理");
    expect(out?.suggestions).toEqual(["优先处理已拒绝子任务"]);
    expect(fetchImpl).toHaveBeenCalledOnce();
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
