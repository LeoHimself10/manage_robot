import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  canonicalMainChatKey,
  resolveCanonicalMainSession,
} from "../../src/web/canonical-main-session";
import {
  createPlanSessionStore,
  hashChatKey,
} from "../../src/infra/plan-session-store";

describe("canonical main session", () => {
  let sessionDir = "";

  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), "canonical-main-"));
    sessionDir = join(tmp, "sessions");
    mkdirSync(sessionDir, { recursive: true });
    vi.stubEnv("PLAN_SESSION_DIR", sessionDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("merges workbench placeholder and dingtalk main into one canonical file", () => {
    const userId = "manager-merge-1";
    const wbKey = canonicalMainChatKey(userId);
    const dtKey = "conv-1::1::manager-merge-1";
    const now = new Date().toISOString();

    writeFileSync(
      join(sessionDir, `${hashChatKey(wbKey)}.json`),
      JSON.stringify({
        chatKeyHash: hashChatKey(wbKey),
        planId: "plan-wb",
        createdAt: now,
        updatedAt: now,
        senderStaffId: userId,
        threadKind: "main",
        threadId: "main",
        conversationHistory: [],
      }),
      "utf8",
    );

    writeFileSync(
      join(sessionDir, `${hashChatKey(dtKey)}.json`),
      JSON.stringify({
        chatKeyHash: hashChatKey(dtKey),
        planId: "plan-dt",
        createdAt: now,
        updatedAt: new Date(Date.now() + 60_000).toISOString(),
        senderStaffId: userId,
        conversationId: "conv-1",
        conversationType: "1",
        latestDraft: {
          title: "钉钉草案",
          tasks: [
            {
              id: "task_1",
              title: "来自钉钉",
              objective: "o",
              deliverables: ["d"],
              completionCriteria: ["c"],
              timeNode: { dueAt: "2026-07-01" },
            },
          ],
        },
        conversationHistory: [{ role: "user", content: "hi", at: now }],
      }),
      "utf8",
    );

    const main = resolveCanonicalMainSession(userId, { dingtalkChatKey: dtKey });
    expect(main.chatKeyHash).toBe(hashChatKey(wbKey));
    expect((main.latestDraft as { title?: string })?.title).toBe("钉钉草案");
    expect(main.conversationId).toBe("conv-1");

    const store = createPlanSessionStore();
    expect(store.loadByChatKey(dtKey)).toBeUndefined();
    expect(store.loadByChatKey(wbKey)?.planId).toBe("plan-dt");
  });
});
