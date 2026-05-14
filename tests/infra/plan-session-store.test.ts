import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createPlanSessionStore,
  hashChatKey,
  markPublishedAndRotatePlanSession,
  restoreTaskScope,
  startNewTaskScope,
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

  it("loadOrCreate assigns a default taskScope and mirrors top-level state on save", () => {
    sessionDir = join(tmpdir(), `sessions-${Date.now()}-scope`);
    eventsPath = join(tmpdir(), `session-events-${Date.now()}-scope.jsonl`);
    process.env.PLAN_SESSION_DIR = sessionDir;
    process.env.PLAN_SESSION_EVENTS_PATH = eventsPath;

    const store = createPlanSessionStore();
    const created = store.loadOrCreate("scope-key");

    expect(created.currentTaskScopeId).toMatch(/^scope:/);
    expect(created.taskScopes?.[created.currentTaskScopeId!]).toBeDefined();

    store.save({
      ...created,
      latestDraft: { title: "Draft A", tasks: [{ id: "t1", title: "x" }] },
      knownFacts: ["fact-A"],
    });

    const restored = store.loadByChatKey("scope-key")!;
    const mirror = restored.taskScopes![restored.currentTaskScopeId!];
    expect((mirror.latestDraft as any)?.title).toBe("Draft A");
    expect(mirror.knownFacts).toEqual(["fact-A"]);
    expect(mirror.planId).toBe(restored.planId);
  });

  it("migrates legacy session (no currentTaskScopeId) into a default scope", () => {
    sessionDir = join(tmpdir(), `sessions-${Date.now()}-legacy`);
    eventsPath = join(tmpdir(), `session-events-${Date.now()}-legacy.jsonl`);
    process.env.PLAN_SESSION_DIR = sessionDir;
    process.env.PLAN_SESSION_EVENTS_PATH = eventsPath;

    const store = createPlanSessionStore();
    const created = store.loadOrCreate("legacy-scope-key");
    // simulate legacy file: strip new fields and write back
    const legacyShape: any = { ...created };
    delete legacyShape.currentTaskScopeId;
    delete legacyShape.taskScopes;
    legacyShape.latestDraft = { title: "Legacy Draft" };
    legacyShape.knownFacts = ["legacy-fact"];
    require("node:fs").writeFileSync(
      join(sessionDir, `${created.chatKeyHash}.json`),
      JSON.stringify(legacyShape),
      "utf8",
    );

    const reloaded = store.loadByChatKey("legacy-scope-key")!;
    expect(reloaded.currentTaskScopeId).toMatch(/^scope:/);
    expect(reloaded.taskScopes?.[reloaded.currentTaskScopeId!]).toBeDefined();
    expect(
      (reloaded.taskScopes![reloaded.currentTaskScopeId!].latestDraft as any)?.title,
    ).toBe("Legacy Draft");
  });

  it("startNewTaskScope + restoreTaskScope persist round-trip through save/load", () => {
    sessionDir = join(tmpdir(), `sessions-${Date.now()}-roundtrip`);
    eventsPath = join(tmpdir(), `session-events-${Date.now()}-roundtrip.jsonl`);
    process.env.PLAN_SESSION_DIR = sessionDir;
    process.env.PLAN_SESSION_EVENTS_PATH = eventsPath;

    const store = createPlanSessionStore();
    const session = store.loadOrCreate("rt");
    const initialPlanId = session.planId;

    session.latestDraft = { title: "Topic A" };
    session.knownFacts = ["fact-A"];
    startNewTaskScope(session, { scopeLabel: "Topic B" });
    expect(session.planId).not.toBe(initialPlanId);
    session.latestDraft = { title: "Topic B Draft" };
    session.knownFacts = ["fact-B"];
    store.save(session);

    const reloaded = store.loadByChatKey("rt")!;
    expect((reloaded.latestDraft as any)?.title).toBe("Topic B Draft");

    const restore = restoreTaskScope(reloaded, { scopeLabelKeyword: "默认任务" });
    expect(restore.ok).toBe(true);
    expect(restore.toPlanId).toBe(initialPlanId);
    expect((reloaded.latestDraft as any)?.title).toBe("Topic A");
    expect(reloaded.knownFacts).toEqual(["fact-A"]);
    expect(reloaded.planId).toBe(initialPlanId);
    store.save(reloaded);

    const reloaded2 = store.loadByChatKey("rt")!;
    expect((reloaded2.latestDraft as any)?.title).toBe("Topic A");
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

  it("markPublishedAndRotatePlanSession records taskNo and rotates planId", () => {
    const now = new Date().toISOString();
    const session: PlanSession = {
      chatKeyHash: "h",
      planId: "p-old",
      createdAt: now,
      updatedAt: now,
      knownFacts: [],
      conversationHistory: [],
      currentTaskScopeId: "scope:a",
      taskScopes: {
        "scope:a": {
          scopeId: "scope:a",
          scopeLabel: "L",
          planId: "p-old",
          createdAt: now,
          updatedAt: now,
          latestDraft: { title: "D" },
        },
      },
    };
    const r = markPublishedAndRotatePlanSession(session, { taskNo: "T-001" });
    expect("skipped" in r).toBe(false);
    const ok = r as { fromPlanId: string; toPlanId: string; toScopeId: string };
    expect(ok.fromPlanId).toBe("p-old");
    expect(ok.toPlanId).toBe(session.planId);
    expect(ok.toPlanId).not.toBe("p-old");
    const archived = session.taskScopes?.["scope:a"];
    expect(archived?.publishedTaskNo).toBe("T-001");
    expect(archived?.planId).toBe("p-old");
    expect(session.currentTaskScopeId).toBe(ok.toScopeId);
    expect(session.latestDraft).toBeUndefined();
  });
});
