import type { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import { computeSubtaskBreakdown, type SubtaskAttentionInput } from "../../web/workbench-attention";
import type { DigestAudience } from "./progress-digest-eligibility";
import { buildProgressDigestFacts } from "./progress-digest-facts";
import {
  loadProgressDigestLlmConfig,
  summarizeProgressDigestWithLlm,
} from "./progress-digest-llm";
import type { ProgressDigestPolicy } from "./progress-digest-policy";
import {
  renderBriefDigestTemplate,
  renderProgressDigestTemplate,
} from "./progress-digest-templates";

export type ProgressDigestMode = "full" | "brief";

export interface ProgressDigestBuildResult {
  mode: ProgressDigestMode;
  subject: string;
  markdown: string;
  detailUrl: string;
  renderSource: "llm" | "template";
}

type TaskStore = ReturnType<typeof createWorkbenchFormalTaskStore>;

function env(name: string): string {
  return String(process.env[name] ?? "").trim();
}

export function resolveDigestDetailUrl(audience: DigestAudience): string {
  const base = (env("ASSIGNMENT_WEB_PUBLIC_BASE_URL") || env("WORKBENCH_NOTIFY_DETAIL_URL_BASE"))
    .replace(/\/+$/, "")
    .replace(/\/workbench\/employee\/task$/, "");
  if (!base) return "https://www.dingtalk.com";
  if (audience === "employee") return `${base}/workbench/employee?view=current`;
  return `${base}/workbench/manager/tasks`;
}

export async function buildProgressDigestMarkdown(input: {
  taskStore: TaskStore;
  userId: string;
  audience: DigestAudience;
  policy: ProgressDigestPolicy;
  now?: Date;
  resolveName?: (uid: string) => string | undefined;
  fetchImpl?: typeof fetch;
}): Promise<ProgressDigestBuildResult> {
  const now = input.now ?? new Date();
  const detailUrl = resolveDigestDetailUrl(input.audience);
  const facts = buildProgressDigestFacts({
    taskStore: input.taskStore,
    userId: input.userId,
    audience: input.audience,
    policy: input.policy,
    detailUrl,
    now,
    resolveName: input.resolveName,
  });

  if (facts.isBrief) {
    const brief = renderBriefDigestTemplate(facts);
    return {
      mode: "brief",
      subject: brief.subject,
      markdown: brief.markdown,
      detailUrl,
      renderSource: "template",
    };
  }

  const llmConfig = loadProgressDigestLlmConfig();
  if (llmConfig) {
    const llmOut = await summarizeProgressDigestWithLlm(
      facts,
      llmConfig,
      input.fetchImpl ?? fetch,
    );
    if (llmOut) {
      let markdown = llmOut.markdown;
      if (!markdown.includes("工作台")) {
        markdown = `${markdown}\n\n> 详情请点击下方按钮打开工作台`;
      }
      return {
        mode: "full",
        subject: llmOut.subject,
        markdown,
        detailUrl,
        renderSource: "llm",
      };
    }
  }

  const templated = renderProgressDigestTemplate(facts, input.policy.maxTaskLines);
  return {
    mode: "full",
    subject: templated.subject,
    markdown: templated.markdown,
    detailUrl,
    renderSource: "template",
  };
}

/** Exported for tests — aggregate breakdown across manager tasks. */
export function summarizeManagerBuckets(
  taskStore: TaskStore,
  managerUserId: string,
): ReturnType<typeof computeSubtaskBreakdown> {
  const agg = {
    needsManager: 0,
    waitingAccept: 0,
    inProgress: 0,
    blocked: 0,
    done: 0,
    rejected: 0,
  };
  for (const t of taskStore.listManagerTasks(managerUserId)) {
    const detail = taskStore.getTaskDetail(t.taskNo);
    if (!detail) continue;
    const subInputs: SubtaskAttentionInput[] = detail.subtasks.map((s) => ({
      status: String(s.status ?? ""),
      openDeclineKind: taskStore.getSubtaskOpenDeclineKind(s.subtaskId),
    }));
    const b = computeSubtaskBreakdown(subInputs);
    agg.needsManager += b.needsManager;
    agg.waitingAccept += b.waitingAccept;
    agg.inProgress += b.inProgress;
    agg.blocked += b.blocked;
    agg.done += b.done;
    agg.rejected += b.rejected;
  }
  return agg;
}
