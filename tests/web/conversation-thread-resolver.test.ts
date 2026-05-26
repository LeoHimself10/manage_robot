import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createSideThreadSession,
  findMainThreadSession,
  listManagerConversationSessions,
  loadAllPlanSessions,
  resolveConversationThread,
} from "../../src/web/conversation-thread-resolver";

describe("conversation-thread-resolver", () => {
  let sessionDir: string;
  const prevDir = process.env.PLAN_SESSION_DIR;

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), "conv-thread-"));
    process.env.PLAN_SESSION_DIR = sessionDir;
  });

  afterEach(() => {
    if (prevDir === undefined) delete process.env.PLAN_SESSION_DIR;
    else process.env.PLAN_SESSION_DIR = prevDir;
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("findMainThreadSession creates workbench main placeholder", () => {
    const main = findMainThreadSession("mgr-1");
    expect(main.threadKind).toBe("main");
    expect(main.threadId).toBe("main");
    expect(main.senderStaffId).toBe("mgr-1");
  });

  it("createSideThreadSession does not mutate main draft", () => {
    const main = findMainThreadSession("mgr-2");
    writeFileSync(
      join(sessionDir, `${main.chatKeyHash}.json`),
      JSON.stringify({
        ...main,
        latestDraft: { tasks: [{ id: "task_1", title: "主线程草案" }] },
      }),
      "utf8",
    );
    const side = createSideThreadSession("mgr-2");
    expect(side.threadKind).toBe("side");
    expect(side.latestDraft).toBeUndefined();
    const reloadedMain = findMainThreadSession("mgr-2");
    const draft = reloadedMain.latestDraft as { tasks?: Array<{ title?: string }> };
    expect(draft?.tasks?.[0]?.title).toBe("主线程草案");
  });

  it("listManagerConversationSessions pins main first", () => {
    findMainThreadSession("mgr-3");
    createSideThreadSession("mgr-3");
    const rows = listManagerConversationSessions("mgr-3");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]?.threadKind).toBe("main");
  });

  it("resolveConversationThread finds side by threadId", () => {
    findMainThreadSession("mgr-4");
    const side = createSideThreadSession("mgr-4");
    const resolved = resolveConversationThread("mgr-4", {
      threadKind: "side",
      threadId: side.threadId,
    });
    expect(resolved?.planId).toBe(side.planId);
  });

  it("loadAllPlanSessions reads persisted files", () => {
    findMainThreadSession("mgr-5");
    expect(loadAllPlanSessions().length).toBeGreaterThan(0);
  });
});
