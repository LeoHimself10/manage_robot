import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createSideThreadSession,
  deleteSideThreadSession,
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

  it("persists immutable quality source context on a dedicated side thread", () => {
    const side = createSideThreadSession("mgr-quality", {
      threadLabel: "QE-001 · 批次异常",
      sourceContext: {
        kind: "quality_event",
        eventId: "event-1",
        eventNo: "QE-001",
        eventVersion: 2,
        analysisVersionId: "analysis-1",
        sourceHash: "hash-1",
        bindingStatus: "DRAFT",
        handoffSnapshot: {
          title: "批次异常",
          publicSummary: "来源事实",
          analysisSummary: "质量初析",
          processingRequirements: "完成批次排查",
        },
      },
      latestDraft: { tasks: [{ id: "task_1", title: "批次排查" }] },
    });
    const resolved = resolveConversationThread("mgr-quality", {
      threadKind: "side",
      threadId: side.threadId,
    });
    expect(resolved?.sourceContext?.kind).toBe("quality_event");
    expect(resolved?.sourceContext?.handoffSnapshot.processingRequirements).toBe("完成批次排查");
    expect(() => deleteSideThreadSession("mgr-quality", side.threadId!)).toThrow("不能删除");
  });

  it("loadAllPlanSessions reads persisted files", () => {
    findMainThreadSession("mgr-5");
    expect(loadAllPlanSessions().length).toBeGreaterThan(0);
  });
});
