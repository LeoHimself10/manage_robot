import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createSideThreadSession,
  deleteSideThreadSession,
  findMainThreadSession,
  healSideThreadSession,
  markSessionAsMainThread,
  preserveThreadIdentityOnSave,
  renameSideThreadSession,
  resolveConversationThread,
  sideThreadChatKey,
} from "../../src/web/conversation-thread-resolver";
import { buildThreadListItem } from "../../src/infra/conversation-present";
import { hashChatKey } from "../../src/infra/plan-session-store";

describe("manager side thread persistence", () => {
  let sessionDir: string;
  const prevDir = process.env.PLAN_SESSION_DIR;

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), "mgr-side-thread-"));
    process.env.PLAN_SESSION_DIR = sessionDir;
  });

  afterEach(() => {
    if (prevDir === undefined) delete process.env.PLAN_SESSION_DIR;
    else process.env.PLAN_SESSION_DIR = prevDir;
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("preserveThreadIdentityOnSave keeps side thread metadata", () => {
    const side = createSideThreadSession("mgr-a");
    const saved = preserveThreadIdentityOnSave({
      ...side,
      latestDraft: { tasks: [{ id: "t1", title: "子任务" }] },
    });
    expect(saved.threadKind).toBe("side");
    expect(saved.threadId).toBe(side.threadId);
    expect(saved.threadId).not.toBe("main");
  });

  it("preserveThreadIdentityOnSave does not promote side file when threadId still set", () => {
    const side = createSideThreadSession("mgr-b");
    const corrupted = markSessionAsMainThread(side);
    writeFileSync(
      join(sessionDir, `${side.chatKeyHash}.json`),
      JSON.stringify(corrupted),
      "utf8",
    );
    const healed = preserveThreadIdentityOnSave({
      ...corrupted,
      threadId: side.threadId,
      senderStaffId: "mgr-b",
    });
    expect(healed.threadKind).toBe("side");
    expect(healed.threadId).toBe(side.threadId);
  });

  it("resolveConversationThread heals side session wrongly marked main", () => {
    const side = createSideThreadSession("mgr-c");
    const corrupted = markSessionAsMainThread(side);
    writeFileSync(
      join(sessionDir, `${side.chatKeyHash}.json`),
      JSON.stringify(corrupted),
      "utf8",
    );
    const resolved = resolveConversationThread("mgr-c", {
      threadKind: "side",
      threadId: side.threadId,
    });
    expect(resolved?.threadKind).toBe("side");
    expect(resolved?.threadId).toBe(side.threadId);
    const raw = JSON.parse(
      readFileSync(join(sessionDir, `${side.chatKeyHash}.json`), "utf8"),
    ) as { threadKind?: string; threadId?: string };
    expect(raw.threadKind).toBe("side");
    expect(raw.threadId).toBe(side.threadId);
  });

  it("healSideThreadSession restores metadata for matching chatKey hash", () => {
    findMainThreadSession("mgr-d");
    const side = createSideThreadSession("mgr-d");
    const corrupted = markSessionAsMainThread(side);
    const healed = healSideThreadSession(corrupted, "mgr-d", side.threadId!);
    expect(healed.threadKind).toBe("side");
    expect(healed.threadId).toBe(side.threadId);
  });

  it("sideThreadChatKey hash matches persisted session file", () => {
    const side = createSideThreadSession("mgr-e");
    expect(side.chatKeyHash).toBe(
      hashChatKey(sideThreadChatKey("mgr-e", side.threadId!)),
    );
  });

  it("renameSideThreadSession updates list title", () => {
    const side = createSideThreadSession("mgr-f");
    const renamed = renameSideThreadSession("mgr-f", side.threadId!, "Q2 复盘专项");
    expect(renamed?.threadLabel).toBe("Q2 复盘专项");
    const item = buildThreadListItem(renamed!);
    expect(item.title).toBe("Q2 复盘专项");
  });

  it("deleteSideThreadSession removes session file", () => {
    const side = createSideThreadSession("mgr-g");
    const tid = side.threadId!;
    expect(deleteSideThreadSession("mgr-g", tid)).toBe(true);
    expect(
      resolveConversationThread("mgr-g", { threadKind: "side", threadId: tid }),
    ).toBeUndefined();
    expect(deleteSideThreadSession("mgr-g", "main")).toBe(false);
  });
});
