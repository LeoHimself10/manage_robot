import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createCompEvalSession,
  deleteCompEvalSession,
  getCompEvalSession,
  listCompEvalSessions,
  saveCompEvalSession,
  setActiveCompEvalSession,
} from "../../../src/agent/competency-eval/competency-eval-session-store";

describe("competency-eval-session-store", () => {
  let tmpDir = "";

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "comp-eval-sess-"));
    vi.stubEnv("COMPETENCY_EVAL_DATA_DIR", join(tmpDir, "competency-eval"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates and lists sessions", () => {
    const s = createCompEvalSession("user-a");
    expect(s).toBeTruthy();
    const listed = listCompEvalSessions("user-a");
    expect(listed.sessions.length).toBe(1);
    expect(listed.activeSessionId).toBe(s!.sessionId);
  });

  it("saves messages and updates title", () => {
    const s = createCompEvalSession("user-a")!;
    const saved = saveCompEvalSession("user-a", s.sessionId, {
      messages: [
        { role: "user", content: "评张三最近30天" },
        { role: "assistant", content: "结论如下" },
      ],
    });
    expect(saved?.title).toContain("张三");
    const loaded = getCompEvalSession("user-a", s.sessionId);
    expect(loaded?.messages.length).toBe(2);
  });

  it("deletes session and picks new active", () => {
    const a = createCompEvalSession("user-a")!;
    const b = createCompEvalSession("user-a")!;
    setActiveCompEvalSession("user-a", a.sessionId);
    deleteCompEvalSession("user-a", a.sessionId);
    const listed = listCompEvalSessions("user-a");
    expect(listed.sessions.some((x) => x.sessionId === a.sessionId)).toBe(false);
    expect(listed.sessions.some((x) => x.sessionId === b.sessionId)).toBe(true);
  });
});
