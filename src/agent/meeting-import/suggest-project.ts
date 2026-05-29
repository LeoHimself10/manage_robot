import type { WorkbenchProjectRow } from "../../infra/workbench-project-types";
import type { MeetingImportProjectSuggestion } from "./types";

function scoreProject(
  project: { name: string; description?: string; aliases: string[] },
  text: string,
): { score: number; reason: string } {
  const hay = text.toLowerCase();
  let score = 0;
  const reasons: string[] = [];
  const name = project.name.toLowerCase();
  if (name && hay.includes(name)) {
    score += 10;
    reasons.push(`名称匹配「${project.name}」`);
  }
  for (const a of project.aliases) {
    const al = a.toLowerCase();
    if (al.length >= 2 && hay.includes(al)) {
      score += 6;
      reasons.push(`关键词「${a}」`);
    }
  }
  const desc = String(project.description ?? "").toLowerCase();
  if (desc.length >= 4) {
    const words = desc.split(/\s+/).filter((w) => w.length >= 2);
    for (const w of words.slice(0, 8)) {
      if (hay.includes(w)) {
        score += 2;
        if (!reasons.length) reasons.push("描述相关");
        break;
      }
    }
  }
  return { score, reason: reasons.join("；") || "弱相关" };
}

export function suggestProjectForMeetingText(input: {
  projects: WorkbenchProjectRow[];
  summaryText: string;
  meetingTitle?: string;
}): MeetingImportProjectSuggestion {
  const hay = [input.meetingTitle ?? "", input.summaryText].filter(Boolean).join("\n");
  const ranked = input.projects
    .map((p) => {
      const { score, reason } = scoreProject(
        { name: p.name, description: p.description, aliases: p.aliases },
        hay,
      );
      return { project: p, score, reason };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) {
    return {
      projectName: "",
      confidence: "low",
      reason: "未匹配到已登记项目，请手动选择或新建项目。",
      alternatives: [],
    };
  }

  const top = ranked[0];
  const confidence: MeetingImportProjectSuggestion["confidence"] =
    top.score >= 10 ? "high" : top.score >= 6 ? "medium" : "low";

  return {
    projectId: top.project.projectId,
    projectName: top.project.name,
    confidence,
    reason: top.reason,
    alternatives: ranked.slice(1, 3).map((r) => ({
      projectId: r.project.projectId,
      projectName: r.project.name,
      reason: r.reason,
    })),
  };
}
