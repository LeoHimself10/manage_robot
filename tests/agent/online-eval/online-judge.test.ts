import { describe, expect, it, vi } from "vitest";
import { runOnlineJudge } from "../../../src/agent/online-eval/online-judge";

describe("online-judge", () => {
  it("parses judge JSON from mocked fetch", async () => {
    vi.stubEnv("ONLINE_JUDGE_ENABLED", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  scores: { relevance: 4, guidance: 4, grounding: 4, actionability: 4 },
                  overallPass: true,
                  reasons: [],
                }),
              },
            },
          ],
        }),
      })),
    );
    const result = await runOnlineJudge({
      userMessage: "拆任务",
      assistantReply: "好的，已整理草案",
      modelConfig: { apiKey: "k", baseUrl: "https://example.com/v1", timeoutMs: 5000 },
      metadata: {},
    });
    expect(result.skipped).toBe(false);
    expect(result.overallPass).toBe(true);
    expect(result.scores.relevance).toBe(4);
    vi.unstubAllGlobals();
  });

  it("skips when judge disabled", async () => {
    vi.stubEnv("ONLINE_JUDGE_ENABLED", "0");
    const result = await runOnlineJudge({
      userMessage: "x",
      assistantReply: "y",
      modelConfig: { apiKey: "k", baseUrl: "https://example.com/v1", timeoutMs: 5000 },
      metadata: {},
    });
    expect(result.skipped).toBe(true);
    vi.unstubAllEnvs();
  });
});
