/**
 * One-off spot eval for a single meeting minutes paste.
 * Run: node --import tsx scripts/run-meeting-import-spot.ts
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";
import { createWorkbenchFormalTaskStore } from "../src/infra/workbench-formal-task-store";
import { __setMeetingImportLlmForTest } from "../src/agent/meeting-import/meeting-import-llm";
import { loadMeetingImportPolicy } from "../src/agent/meeting-import/meeting-import-policy";
import {
  handleMeetingImportAnalyze,
  handleMeetingImportParse,
} from "../src/web/meeting-import-api";

const MGR = "eval-mgr-meeting-spot";
const OUT = join(process.cwd(), ".eval-meeting-import", "spot-ai-doc-review.json");

const MEETING_TEXT = `核心摘要

本次通话围绕AI辅助文档审核与合规检查系统的功能设计展开讨论，重点明确了AI审核与AI合规审查的边界：前者聚焦单文档内容问题识别，后者关注跨文档需求链完整性及一致性。双方就规则配置灵活性、易错点提示机制、系统架构设计（前端插件与后端数据库结合）、版本控制方案（拟采用Git）等达成初步共识。讨论涉及文档依赖关系管理、原数据定义比对、软判断逻辑实现方式，并确认优先实现基于完整前置文档的简单场景，复杂情况后续迭代。当前主要障碍为文档无法打开，需重新获取可读文件以推进需求确认。

讨论要点分解

1. AI审核与AI合规检查的功能区分

讨论内容：
通话中提到AI审核侧重于单个文档内部的内容问题识别，如表述错误或格式不规范。
AI合规检查则关注多个文档之间的需求链条是否完整、验证是否闭环，属于文档级联动分析。
举例说明内存要求在不同文档中出现32G与16G冲突的情况，需通过跨文档比对发现逻辑矛盾。

讨论结论: 明确两者分工：审核为"单文档细查"，合规为"多文档链路验证"。

2. 原数据定义与软判断机制

讨论内容：
提出建立"原数据"概念，即某一信息首次出现的文档章节作为基准源。
后续文档相关内容需与此原数据进行重合度比对，高相关性下再由AI进行语义层面的"软判断"。
软判断用于识别虽形式相似但语义冲突的内容，例如技术参数前后不一致。

讨论结论: 确认采用"先规则匹配、后AI软判断"的分层处理逻辑，提升准确性。

3. 规则可编辑性与Prompt配置设计

讨论内容：
强调审核规则不应硬编码，而应支持用户自由编辑，如禁止在用户需求说明书（URS）中出现PRD字样。
建议为每个项目设置通用系统提示词（prompt），注入特定背景知识（如OCT设备屏幕与主机分离）。
文件类型识别后，动态加载对应类别的易错点提示规则。

讨论结论: 系统需提供可编辑的prompt入口，支持项目级和文档类型的双重提示配置。

4. 系统架构与数据存储方案

讨论内容：
讨论Word插件作为轻量前端的可能性，所有复杂逻辑与数据存储置于后端数据库。
提出局域网内建共享数据库，实现多用户协同维护配置项。
当前文档协作模式为串行修改，暂不考虑实时并发冲突。

讨论结论: 采纳"前端插件+后端数据库"架构，避免将全部功能堆砌至Word插件。

5. 版本控制与文档同步机制

讨论内容：
担忧多人先后编辑导致文档状态不同步，影响下游判断。
探讨使用SVN或Git等版本控制工具管理文档变更历史。
认为可通过提交时检测冲突解决更新问题，无需额外开发锁定机制。

讨论结论: 后续版本考虑集成Git类版本控制系统，当前按串行流程处理。

6. 文档依赖关系与Playbook初始化问题

讨论内容：
新建文档时若上游文档未完成，Playbook规则尚未建立，依赖关系需手动指定。
已有完整项目的JSON结构可用于构建初始数据库，但在进行中的项目缺乏前置文档。
建议优先支持具备全套前置文档的使用场景。

讨论结论: 初期版本假设用户拥有完整依赖文档，复杂依赖管理留待后续优化。

7. 文件访问与加密问题

讨论内容：
通话中提到接收的文档无法打开，解压后显示已损坏，怀疑因公司加密系统所致。
发现部分URS文档中混杂SRS编号内容，增加解析复杂度。
建议安装公司加密系统以正常访问文件。

讨论结论: 待重新发送可读文件，当前因文件不可用导致需求细节无法确认，状态为未知/待确认。

氛围分析与后续跟进建议

通话氛围：谨慎保守、富有建设性，双方积极探讨技术可行性并主动识别潜在风险。

关键话术/引用："我觉得实践起来最舒服的点，就是我们可能得抽象出一层来，然后让大家能进行一个软编辑。"、"我们现在这个痛点……大家现在的同步方式是什么就是我编辑完了我发到发给那个之后要编辑那个人。"

潜在风险/关注点：文档加密导致无法查看具体内容，核心需求细节缺失；初期架构设计过于复杂可能导致实施困难；多人编辑引发的文档状态不一致问题尚未
`;

function bootstrap() {
  const dir = join(process.cwd(), ".eval-meeting-import", "spot-run");
  mkdirSync(dir, { recursive: true });
  process.env.WORKBENCH_SQLITE_PATH = join(dir, "workbench.sqlite");
  process.env.EMPLOYEE_PROFILE_DIR = join(dir, "employee-profiles");
  process.env.WORKBENCH_MANAGER_USER_IDS = MGR;
  process.env.WORKBENCH_PROJECT_PORTFOLIO_USER_IDS = MGR;
}

function seed() {
  const people = createPeopleDirectoryStore();
  try {
    const now = new Date().toISOString();
    people.upsertContact({
      userId: MGR,
      name: "测评主管",
      unionId: "u-mgr",
      active: true,
      isAdmin: false,
      isBoss: false,
      isSenior: false,
      lastSyncedAt: now,
      departmentNames: ["研发"],
    });
  } finally {
    people.close();
  }
  const store = createWorkbenchFormalTaskStore();
  store.createProject({
    ownerUserId: MGR,
    name: "AI文档审核与合规检查",
    description: "AI辅助文档审核与合规检查系统",
    aliases: ["AI审核", "合规检查", "文档审核"],
  });
  store.createProject({
    ownerUserId: MGR,
    name: "OCT 产品线",
    aliases: ["OCT"],
  });
  return store;
}

async function runMode(label: string, llmEnabled: boolean) {
  bootstrap();
  __setMeetingImportLlmForTest(undefined);
  process.env.MEETING_IMPORT_LLM_ENABLED = llmEnabled ? "1" : "0";
  const store = seed();

  const started = Date.now();
  const parsed = await handleMeetingImportParse({
    taskStore: store,
    managerUserId: MGR,
    pastedText: MEETING_TEXT,
    meetingTitle: "AI文档审核与合规检查系统功能设计讨论",
    meetingDate: "2026-05-28",
  });

  const projectId =
    parsed.projectSuggestion.projectId ??
    store.listProjectsForOwner(MGR)[0]?.projectId ??
    "";
  const projectName =
    parsed.projectSuggestion.projectName ||
    store.listProjectsForOwner(MGR)[0]?.name ||
    "未命名项目";

  const analyzed =
    parsed.items.length > 0
      ? await handleMeetingImportAnalyze({
          taskStore: store,
          managerUserId: MGR,
          batchId: parsed.batchId,
          projectId,
          projectName,
          items: parsed.items,
          meetingTitle: "AI文档审核与合规检查系统功能设计讨论",
        })
      : { rows: [] };

  return {
    mode: label,
    llmEnabled,
    durationMs: Date.now() - started,
    projectSuggestion: parsed.projectSuggestion,
    itemCount: parsed.items.length,
    items: parsed.items,
    previewRows: analyzed.rows.map((r) => ({
      title: r.title,
      selected: r.selected,
      relationKind: r.relationKind,
      assignee: r.assigneeDisplayName ?? r.assigneeNameRaw ?? "(未识别)",
      parentKind: r.parent.kind,
      parentTitle: r.parent.suggestedTitle ?? r.parent.existingTaskTitle ?? "",
      themeKey: r.parent.themeKey,
      dueAt: r.dueAt,
      objective: r.objective.slice(0, 80),
    })),
    warnings: parsed.warnings,
  };
}

async function main() {
  const policy = loadMeetingImportPolicy();
  console.log(`LLM configured: ${Boolean(policy.llmApiKey)} model=${policy.llmModel}\n`);

  const fallback = await runMode("fallback", false);
  console.log("=== Fallback (no LLM) ===");
  console.log(JSON.stringify(fallback, null, 2));

  let llm = null;
  if (policy.llmApiKey) {
    llm = await runMode("llm", true);
    console.log("\n=== Real LLM ===");
    console.log(JSON.stringify(llm, null, 2));
  } else {
    console.log("\n=== Real LLM skipped (no API key) ===");
  }

  const report = { ranAt: new Date().toISOString(), fallback, llm };
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${OUT}`);
  __setMeetingImportLlmForTest(undefined);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
