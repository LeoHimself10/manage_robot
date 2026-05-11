import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createPlanSessionStore,
  hashChatKey,
  type PlanSession,
} from "../../src/infra/plan-session-store";

describe("plan-session-store", () => {
  let sessionDir: string | undefined;
  let eventsPath: string | undefined;

  afterEach(() => {
    if (sessionDir) rmSync(sessionDir, { recursive: true, force: true });
    if (eventsPath) rmSync(eventsPath, { force: true });
    delete process.env.PLAN_SESSION_DIR;
    delete process.env.PLAN_SESSION_EVENTS_PATH;
  });

  it("hashChatKey is deterministic and does not expose raw chat key", () => {
    const raw = "https://webhook/token::user-1";
    const h1 = hashChatKey(raw);
    const h2 = hashChatKey(raw);
    expect(h1).toBe(h2);
    expect(h1).not.toContain("webhook");
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("loadOrCreate keeps a stable planId for same chat key", () => {
    sessionDir = join(tmpdir(), `sessions-${Date.now()}`);
    eventsPath = join(tmpdir(), `session-events-${Date.now()}.jsonl`);
    process.env.PLAN_SESSION_DIR = sessionDir;
    process.env.PLAN_SESSION_EVENTS_PATH = eventsPath;

    const store = createPlanSessionStore();
    const first = store.loadOrCreate("chat-key-a");
    const second = store.loadOrCreate("chat-key-a");

    expect(second.planId).toBe(first.planId);
    expect(second.chatKeyHash).toBe(hashChatKey("chat-key-a"));
    expect(existsSync(join(sessionDir, `${hashChatKey("chat-key-a")}.json`))).toBe(
      true,
    );
  });

  it("restores session after process restart", () => {
    sessionDir = join(tmpdir(), `sessions-${Date.now()}`);
    eventsPath = join(tmpdir(), `session-events-${Date.now()}.jsonl`);
    process.env.PLAN_SESSION_DIR = sessionDir;
    process.env.PLAN_SESSION_EVENTS_PATH = eventsPath;

    const storeA = createPlanSessionStore();
    const created = storeA.loadOrCreate("chat-key-restart");
    const updated: PlanSession = {
      ...created,
      knownFacts: ["fact-1", "fact-2"],
      latestDraft: { tasks: [{ id: "t1", title: "x" }] },
      lastTraceId: "trace-1",
    };
    storeA.save(updated);

    const storeB = createPlanSessionStore();
    const restored = storeB.loadByChatKey("chat-key-restart");

    expect(restored).toBeDefined();
    expect(restored?.planId).toBe(created.planId);
    expect(restored?.knownFacts).toEqual(["fact-1", "fact-2"]);
    expect((restored?.latestDraft as { tasks?: unknown[] } | undefined)?.tasks?.length).toBe(
      1,
    );
  });

  it("supports legacy session migration to a new chat key", () => {
    sessionDir = join(tmpdir(), `sessions-${Date.now()}`);
    eventsPath = join(tmpdir(), `session-events-${Date.now()}.jsonl`);
    process.env.PLAN_SESSION_DIR = sessionDir;
    process.env.PLAN_SESSION_EVENTS_PATH = eventsPath;

    const store = createPlanSessionStore();
    const legacy = store.loadOrCreate("legacy-key");
    store.save({
      ...legacy,
      conversationId: "cid-1",
      conversationType: "2",
      senderStaffId: "u1",
      sessionWebhookLastSeen: "https://example/webhook",
      knownFacts: ["fact-legacy"],
    });

    const loadedLegacy = store.loadByChatKey("legacy-key");
    expect(loadedLegacy?.knownFacts).toContain("fact-legacy");

    store.save({
      ...loadedLegacy!,
      chatKeyHash: hashChatKey("stable-key"),
    });
    store.deleteByChatKey("legacy-key");

    expect(store.loadByChatKey("legacy-key")).toBeUndefined();
    const stable = store.loadByChatKey("stable-key");
    expect(stable?.knownFacts).toContain("fact-legacy");
    expect(stable?.conversationId).toBe("cid-1");
  });

  it("appends session events into jsonl", () => {
    sessionDir = join(tmpdir(), `sessions-${Date.now()}`);
    eventsPath = join(tmpdir(), `session-events-${Date.now()}.jsonl`);
    process.env.PLAN_SESSION_DIR = sessionDir;
    process.env.PLAN_SESSION_EVENTS_PATH = eventsPath;

    const store = createPlanSessionStore();
    const session = store.loadOrCreate("chat-key-events");

    store.appendEvent({
      planId: session.planId,
      chatKeyHash: session.chatKeyHash,
      eventType: "DRAFT_UPDATED",
      payload: { taskCount: 3 },
    });
    store.appendEvent({
      planId: session.planId,
      chatKeyHash: session.chatKeyHash,
      eventType: "ASSIGNMENT_UPDATED",
      payload: { assignmentCount: 2 },
    });

    const raw = readFileSync(eventsPath, "utf8").trim().split("\n");
    expect(raw).toHaveLength(2);
    const second = JSON.parse(raw[1]) as {
      planId: string;
      eventType: string;
      payload: Record<string, unknown>;
    };
    expect(second.planId).toBe(session.planId);
    expect(second.eventType).toBe("ASSIGNMENT_UPDATED");
    expect(second.payload.assignmentCount).toBe(2);
  });
});
