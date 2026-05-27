import { describe, expect, it } from "vitest";
import {
  isDraftTouchedThisTurn,
  mergeOrchestratorDraftIntoSession,
  resolveDraftForOutbound,
} from "../../src/view/draft-outbound";

const baseDraft = {
  title: "旧任务",
  tasks: [
    {
      id: "task_1",
      title: "旧子任务",
      deliverables: ["报告"],
      completionCriteria: ["完成"],
      timeNode: { dueAt: "2026-06-01" },
    },
  ],
};

const normalizedBaseDraft = {
  title: "旧任务",
  tasks: [
    {
      id: "task_1",
      title: "旧子任务",
      deliverables: ["报告"],
      completionCriteria: ["完成"],
      timeNode: { dueAt: "2026-06-01" },
    },
  ],
};

describe("resolveDraftForOutbound", () => {
  it("does not render when session has draft but turn did not touch it", () => {
    const result = resolveDraftForOutbound({
      preTurnDraft: baseDraft,
      postTurnDraft: baseDraft,
      toolInvocationNames: [],
    });
    expect(result.draftTouchedThisTurn).toBe(false);
    expect(result.draftForRender).toBeUndefined();
    expect(result.persistedDraft).toEqual(normalizedBaseDraft);
  });

  it("clears persisted draft after start_new_task when post is undefined", () => {
    const result = resolveDraftForOutbound({
      preTurnDraft: baseDraft,
      postTurnDraft: undefined,
      toolInvocationNames: ["start_new_task"],
    });
    expect(result.draftTouchedThisTurn).toBe(false);
    expect(result.draftForRender).toBeUndefined();
    expect(result.persistedDraft).toBeUndefined();
  });

  it("renders when orchestrator returns draft JSON", () => {
    const newDraft = {
      title: "新",
      tasks: [{ id: "task_1", title: "新子任务" }],
    };
    const result = resolveDraftForOutbound({
      preTurnDraft: baseDraft,
      postTurnDraft: baseDraft,
      orchResultDraft: newDraft,
      toolInvocationNames: [],
    });
    expect(result.draftTouchedThisTurn).toBe(true);
    expect(result.draftForRender?.title).toBe("新");
    expect((result.draftForRender?.tasks as unknown[]).length).toBe(1);
  });

  it("renders when prepare_publish_task mutates session without JSON draft", () => {
    const postDraft = { ...baseDraft, stagedBy: "prepare_publish_task" };
    const result = resolveDraftForOutbound({
      preTurnDraft: baseDraft,
      postTurnDraft: postDraft,
      toolInvocationNames: ["prepare_publish_task"],
    });
    expect(result.draftTouchedThisTurn).toBe(true);
    expect(result.draftForRender?.stagedBy).toBe("prepare_publish_task");
  });

  it("renders on update_draft_task with merge", () => {
    const postDraft = {
      ...baseDraft,
      tasks: [{ ...baseDraft.tasks[0], title: "已改标题" }],
    };
    const result = resolveDraftForOutbound({
      preTurnDraft: baseDraft,
      postTurnDraft: postDraft,
      toolInvocationNames: ["update_draft_task"],
    });
    expect(result.draftTouchedThisTurn).toBe(true);
    expect((result.draftForRender?.tasks as Array<{ title: string }>)[0].title).toBe("已改标题");
  });
});

describe("mergeOrchestratorDraftIntoSession", () => {
  it("replaces tasks array on full DRAFT without update_draft_task", () => {
    const orch = {
      title: "新话题",
      tasks: [{ id: "task_1", title: "全新任务" }],
    };
    const merged = mergeOrchestratorDraftIntoSession(
      baseDraft as Record<string, unknown>,
      orch,
      [],
    );
    expect(merged.title).toBe("新话题");
    expect((merged.tasks as Array<{ title: string }>)[0].title).toBe("全新任务");
    expect((merged.tasks as Array<{ inputMaterials?: string[] }>)[0].inputMaterials).toBeUndefined();
  });

  it("deep-merges on add_draft_subtask without replacing tasks from thin orch json", () => {
    const orch = { tasks: [{ id: "task_99", title: "phantom" }] };
    const merged = mergeOrchestratorDraftIntoSession(
      baseDraft as Record<string, unknown>,
      orch,
      ["add_draft_subtask"],
    );
    expect((merged.tasks as Array<{ title: string }>)[0].title).toBe("旧子任务");
  });

  it("ignores orch tasks[] when update_draft_task already mutated session", () => {
    const postSession = {
      ...baseDraft,
      tasks: [{ ...baseDraft.tasks[0], title: "局部改标题" }],
    };
    const orch = {
      tasks: [{ id: "task_1", title: "误覆盖标题" }],
    };
    const merged = mergeOrchestratorDraftIntoSession(
      postSession as Record<string, unknown>,
      orch,
      ["update_draft_task"],
    );
    const t = (merged.tasks as Array<Record<string, unknown>>)[0];
    expect(t.title).toBe("局部改标题");
    expect(t.inputMaterials).toBeUndefined();
  });
});

describe("isDraftTouchedThisTurn", () => {
  it("true when postTurnDraft reference changes", () => {
    const post = { title: "x", tasks: [] };
    expect(
      isDraftTouchedThisTurn({
        preTurnDraft: baseDraft,
        postTurnDraft: post,
        toolInvocationNames: [],
      }),
    ).toBe(true);
  });
});
