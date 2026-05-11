# Task Planning Demo MVP Implementation Plan

> **历史文档快照**：下文含阶段性警告与归档说明，**勿当作当前实现的操作手册**。请以仓库根目录 [`AGENTS.md`](../../../AGENTS.md)、[`docs/Qwen-接入实施说明.md`](../../Qwen-接入实施说明.md)、[`docs/deploy-aliyun-dingtalk.md`](../../deploy-aliyun-dingtalk.md) 为准；本目录说明见 [`README.md`](../README.md)。

> **⚠️ 历史计划（部分已过期）**  
> 截至 2026-05-07 工程实现已演进为：**仅 Qwen 生成**分类与 WBS；**已删除** `classifier.ts` / `capa-advisor.ts` / `templates.ts` / `wbs-generator.ts` 等规则生成路径。  
> **当前事实来源**：`src/agent/demo/pipeline.ts`、`qwen-planner.ts`、`llm-schema.ts`、`docs/Qwen-接入实施说明.md`、PRD v1.3。  
> 下方逐步任务中涉及上述已删文件的 **Git 步骤与文件路径仅供归档**，**勿按原文执行**。
>
> **工程进度（2026-05-08）**：Demo 目录与 `src/infra/` 已补充 JSONL 审计、可观测分段耗时、会话/限速、Plan 快照、输出 PII 脱敏、`consistency` 与 **gate warnings** 等能力；单元测试迁移至 **Vitest**（`vitest.config.ts` / `vitest.setup.ts`）。产品范围仍以 PRD v1.3 为准，细节见 **`AGENTS.md`** 与 **`docs/harness-next-optimizations.md`**。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local TypeScript Demo MVP that turns quality/R&D task background into a classified, CAPA-advised, gate-checked task decomposition Markdown draft.

**Architecture (superseded in parts):** The repo originally planned a deterministic classifier + template WBS. **Current code:** input QC → **required `llmPlanner` (Qwen)** → schema validation → gate → Markdown; failures → `GENERATION_FAILED`. Demo modules live under `src/agent/demo/`.

**Tech Stack:** TypeScript, Vitest, Node.js local CLI-style runner, existing domain/harness modules.

---

## File Structure

- Create `package.json`: project scripts and dependencies (`typescript`, `vitest`, `tsx`).
- Create `tsconfig.json`: strict TypeScript config for `src` and `tests`.
- Create `src/domain/capa.ts`: CAPA advisory enums and interface.
- Create `src/domain/classification.ts`: domain/subtype classification types.
- Modify `src/domain/plan.ts`: add optional demo output metadata fields without breaking existing plan usage.
- Modify `src/domain/task-package.ts`: make owner/acceptance fields optional enough for Demo task drafts.
- Create `src/agent/demo/input-qc.ts`: required-context checks and clarifying questions.
- Create `src/agent/demo/classifier.ts`: deterministic keyword-based initial classifier.
- Create `src/agent/demo/capa-advisor.ts`: pure-advisory CAPA recommendation logic.
- Create `src/agent/demo/templates.ts`: subtype-to-task-skeleton mapping.
- Create `src/agent/demo/wbs-generator.ts`: turn skeletons into task packages.
- Create `src/agent/demo/gate.ts`: Demo gate validation for every task package.
- Create `src/agent/demo/markdown-renderer.ts`: Markdown/表格输出.
- Create `src/agent/demo/pipeline.ts`: orchestrates the full Demo flow.
- Create `src/agent/demo/index.ts`: public exports for Demo modules.
- Create `src/agent/harness/demo-adapter.ts`: documents and maps Demo draft output into the existing Harness `Plan` shape without activating dispatch/assignment states.
- Create `src/demo.ts`: runnable local example for quality/business review.
- Create tests in `tests/agent/demo/*.test.ts`.

---

### Task 1: Project Test Harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tests/smoke.test.ts`

- [ ] **Step 1: Write the failing smoke test**

Create `tests/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("test harness", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 2: Add package metadata and scripts**

Create `package.json`:

```json
{
  "name": "manage-robot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "demo": "tsx src/demo.ts"
  },
  "devDependencies": {
    "tsx": "latest",
    "typescript": "latest",
    "vitest": "latest"
  }
}
```

- [ ] **Step 3: Add TypeScript config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
      "module": "ESNext",
      "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`

Expected: `node_modules/` and `package-lock.json` are created, install exits successfully.

- [ ] **Step 5: Run smoke test**

Run: `npm test`

Expected: PASS with one test.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`

Expected: PASS with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json tests/smoke.test.ts
git commit -m "test: add TypeScript demo test harness"
```

---

### Task 2: Demo Domain Types

**Files:**
- Create: `src/domain/capa.ts`
- Create: `src/domain/classification.ts`
- Modify: `src/domain/plan.ts`
- Modify: `src/domain/task-package.ts`
- Test: `tests/agent/demo/domain-types.test.ts`

- [ ] **Step 1: Write failing tests for domain shapes**

Create `tests/agent/demo/domain-types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createEmptyPlan } from "../../../src/agent/harness/bootstrap";
import { CapaAdvisory } from "../../../src/domain/capa";
import { ClassificationResult } from "../../../src/domain/classification";
import { TaskPackage } from "../../../src/domain/task-package";

describe("demo domain types", () => {
  it("supports CAPA advisory values", () => {
    const advisory: CapaAdvisory = {
      advisory: "RECOMMENDED",
      rationale: ["客户现场反馈且影响范围未确认"],
      disclaimer:
        "该建议仅用于任务拆解与质量沟通参考，最终是否开启 CAPA 以质量授权人员和公司 QMS 流程判定为准。",
      promptingQuestions: ["是否涉及已出货产品？"],
    };

    expect(advisory.advisory).toBe("RECOMMENDED");
  });

  it("supports classification metadata", () => {
    const result: ClassificationResult = {
      domain: "QUALITY",
      subtype: "CUSTOMER_COMPLAINT_OR_FIELD_ISSUE",
      confidence: "MEDIUM",
      rationale: ["输入包含客户现场反馈"],
      missingInformation: ["影响批次"],
    };

    expect(result.domain).toBe("QUALITY");
  });

  it("allows demo task packages without owner assignment", () => {
    const task: TaskPackage = {
      id: "task_1",
      title: "问题事实确认",
      objective: "确认问题现象与影响范围",
      collaborators: [],
      inputMaterials: ["客户反馈截图"],
      actions: ["复核问题现象", "确认影响批次"],
      deliverables: ["问题事实确认记录"],
      completionCriteria: ["影响范围有明确边界"],
      timeNode: { checkpoints: ["T+1 输出初步范围"], dueAt: "T+2" },
      feedbackFrequency: "每日",
      risksAndOpenQuestions: ["需确认是否影响已出货产品"],
      dependencyTaskIds: [],
    };

    expect(task.ownerId).toBeUndefined();
  });

  it("allows plan draft demo metadata", () => {
    const plan = createEmptyPlan({
      domain: "QUALITY",
      subType: "PRODUCTION_PROCESS_ABNORMALITY",
      demoClassification: {
        domain: "QUALITY",
        subtype: "PRODUCTION_PROCESS_ABNORMALITY",
        confidence: "HIGH",
        rationale: ["输入包含生产异常"],
        missingInformation: [],
      },
    });

    expect(plan.demoClassification?.confidence).toBe("HIGH");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/demo/domain-types.test.ts`

Expected: FAIL because `capa.ts`, `classification.ts`, and demo fields do not exist yet.

- [ ] **Step 3: Add CAPA domain type**

Create `src/domain/capa.ts`:

```ts
export type CapaAdvisoryValue =
  | "NOT_REQUIRED"
  | "RECOMMENDED"
  | "UNCERTAIN"
  | "INSUFFICIENT_INFO";

export interface CapaAdvisory {
  advisory: CapaAdvisoryValue;
  rationale: string[];
  disclaimer: string;
  promptingQuestions: string[];
}

export const CAPA_DISCLAIMER =
  "该建议仅用于任务拆解与质量沟通参考，最终是否开启 CAPA 以质量授权人员和公司 QMS 流程判定为准。";
```

- [ ] **Step 4: Add classification domain type**

Create `src/domain/classification.ts`:

```ts
import { PlanDomain } from "../agent/harness/types";

export type ClassificationConfidence = "HIGH" | "MEDIUM" | "LOW";

export type QualitySubtype =
  | "PRODUCTION_PROCESS_ABNORMALITY"
  | "INSPECTION_OR_TEST_ABNORMALITY"
  | "CUSTOMER_COMPLAINT_OR_FIELD_ISSUE"
  | "SUPPLIER_ISSUE"
  | "DESIGN_RELATED_QUALITY_TASK"
  | "QUALITY_OTHER_OR_UNCERTAIN";

export type RdSubtype =
  | "REQUIREMENT_OR_DESIGN_INPUT"
  | "SOLUTION_DEVELOPMENT"
  | "VERIFICATION_AND_VALIDATION"
  | "DESIGN_CHANGE_ACTION"
  | "RD_OTHER_OR_UNCERTAIN";

export type TaskSubtype = QualitySubtype | RdSubtype;

export interface ClassificationResult {
  domain: PlanDomain;
  subtype: TaskSubtype;
  confidence: ClassificationConfidence;
  rationale: string[];
  missingInformation: string[];
}
```

- [ ] **Step 5: Relax Demo task owner fields**

Modify `src/domain/task-package.ts` to:

```ts
export interface TimeNode {
  startAt?: string;
  checkpoints: string[];
  dueAt: string;
}

export interface TaskPackage {
  id: string;
  title: string;
  objective: string;
  scopeBoundary?: string;
  ownerId?: string;
  collaborators: string[];
  inputMaterials: string[];
  actions: string[];
  deliverables: string[];
  completionCriteria: string[];
  timeNode: TimeNode;
  feedbackFrequency: string;
  acceptanceBy?: string;
  risksAndOpenQuestions: string[];
  traceInfo?: string[];
  dependencyTaskIds: string[];
}
```

- [ ] **Step 6: Add optional demo metadata to plan**

Modify `src/domain/plan.ts` to:

```ts
import { PlanDomain, PlanStatus } from "../agent/harness/types";
import { CapaAdvisory } from "./capa";
import { ClassificationResult } from "./classification";
import { TaskPackage } from "./task-package";

export interface Plan {
  id: string;
  domain: PlanDomain;
  subType: string;
  productOrProjectRef?: string;
  severity?: string;
  background: string;
  constraints: string[];
  initiatorId: string;
  status: PlanStatus;
  taskPackages: TaskPackage[];
  externalRefs: string[];
  createdAt: string;
  updatedAt: string;
  demoClassification?: ClassificationResult;
  capaAdvisory?: CapaAdvisory;
}
```

- [ ] **Step 7: Run test and typecheck**

Run: `npm test -- tests/agent/demo/domain-types.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/domain/capa.ts src/domain/classification.ts src/domain/plan.ts src/domain/task-package.ts tests/agent/demo/domain-types.test.ts
git commit -m "feat: add demo task planning domain types"
```

---

### Task 3: Input Quality Check

**Files:**
- Create: `src/agent/demo/input-qc.ts`
- Test: `tests/agent/demo/input-qc.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/agent/demo/input-qc.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkInputQuality } from "../../../src/agent/demo/input-qc";

describe("checkInputQuality", () => {
  it("blocks WBS generation when quality context is too thin", () => {
    const result = checkInputQuality({
      domainHint: "QUALITY",
      background: "某产品异常，尽快分析原因。",
    });

    expect(result.canGenerateWbs).toBe(false);
    expect(result.missingFields).toContain("problemSource");
    expect(result.questions.length).toBeGreaterThan(0);
  });

  it("allows WBS generation when quality context contains key facts", () => {
    const result = checkInputQuality({
      domainHint: "QUALITY",
      background:
        "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
    });

    expect(result.canGenerateWbs).toBe(true);
    expect(result.missingFields).not.toContain("problemPhenomenon");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/demo/input-qc.test.ts`

Expected: FAIL because `checkInputQuality` does not exist.

- [ ] **Step 3: Implement input QC**

Create `src/agent/demo/input-qc.ts`:

```ts
import { PlanDomain } from "../harness/types";

export interface InputQualityRequest {
  domainHint?: PlanDomain;
  background: string;
}

export interface InputQualityResult {
  canGenerateWbs: boolean;
  missingFields: string[];
  questions: string[];
}

const qualityChecks: Array<{
  field: string;
  question: string;
  patterns: RegExp[];
}> = [
  {
    field: "problemSource",
    question: "问题来源是什么？例如生产异常、检验/测试异常、客诉/售后、供应商问题。",
    patterns: [/生产|产线|检验|测试|客诉|客户|售后|供应商|来料/],
  },
  {
    field: "productOrBatch",
    question: "涉及哪个产品、批次、版本、客户或使用场景？",
    patterns: [/产品|批次|版本|客户|设备|样机|工位|产线|A|B|C/],
  },
  {
    field: "problemPhenomenon",
    question: "具体问题现象是什么？请描述异常表现、频次或检测结果。",
    patterns: [/异常|失败|不良|报错|偏差|失效|升高|降低|不通过/],
  },
  {
    field: "impactScope",
    question: "影响范围是什么？涉及数量、批次、客户、库存、在制品或出货状态。",
    patterns: [/影响|范围|数量|台|批|出货|库存|在制|已发货|未发货/],
  },
  {
    field: "evidence",
    question: "已有证据有哪些？例如照片、视频、测试记录、检验报告、生产记录。",
    patterns: [/记录|报告|照片|视频|数据|证据|日志|截图/],
  },
  {
    field: "timeConstraint",
    question: "期望完成时间或关键时间约束是什么？",
    patterns: [/今天|明天|两天|2天|本周|截止|完成|T\+|小时|天内/],
  },
];

export function checkInputQuality(
  request: InputQualityRequest
): InputQualityResult {
  const text = request.background.trim();
  const checks = request.domainHint === "RD" ? qualityChecks.slice(1) : qualityChecks;
  const missing = checks
    .filter((check) => !check.patterns.some((pattern) => pattern.test(text)))
    .map((check) => check.field);

  const questions = checks
    .filter((check) => missing.includes(check.field))
    .map((check) => check.question);

  return {
    canGenerateWbs: missing.length <= 2,
    missingFields: missing,
    questions,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/agent/demo/input-qc.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/demo/input-qc.ts tests/agent/demo/input-qc.test.ts
git commit -m "feat: add demo input quality checks"
```

---

### Task 4: Classification

**Files:**
- Create: `src/agent/demo/classifier.ts`
- Test: `tests/agent/demo/classifier.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/agent/demo/classifier.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyTask } from "../../../src/agent/demo/classifier";

describe("classifyTask", () => {
  it("classifies production process quality issues", () => {
    const result = classifyTask({
      background: "生产测试发现 A 产品某批次开机自检失败率升高，已有生产记录。",
    });

    expect(result.domain).toBe("QUALITY");
    expect(result.subtype).toBe("PRODUCTION_PROCESS_ABNORMALITY");
    expect(result.confidence).toBe("HIGH");
  });

  it("classifies verification and validation R&D tasks", () => {
    const result = classifyTask({
      background: "需要制定 V&V 验证方案，覆盖需求、样本量、测试方法和通过准则。",
    });

    expect(result.domain).toBe("RD");
    expect(result.subtype).toBe("VERIFICATION_AND_VALIDATION");
  });

  it("marks thin ambiguous input as uncertain", () => {
    const result = classifyTask({ background: "这个事情需要处理一下。" });

    expect(result.confidence).toBe("LOW");
    expect(result.missingInformation.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/demo/classifier.test.ts`

Expected: FAIL because `classifyTask` does not exist.

- [ ] **Step 3: Implement deterministic classifier**

Create `src/agent/demo/classifier.ts`:

```ts
import { ClassificationResult } from "../../domain/classification";

export interface ClassifyTaskRequest {
  background: string;
}

interface Rule {
  subtype: ClassificationResult["subtype"];
  domain: ClassificationResult["domain"];
  rationale: string;
  patterns: RegExp[];
}

const rules: Rule[] = [
  {
    domain: "QUALITY",
    subtype: "PRODUCTION_PROCESS_ABNORMALITY",
    rationale: "输入包含生产、产线、批次或过程异常线索",
    patterns: [/生产|产线|工位|过程|批次|不良率/],
  },
  {
    domain: "QUALITY",
    subtype: "INSPECTION_OR_TEST_ABNORMALITY",
    rationale: "输入包含检验或测试异常线索",
    patterns: [/检验|测试异常|复测|IQC|IPQC|OQC|不通过/],
  },
  {
    domain: "QUALITY",
    subtype: "CUSTOMER_COMPLAINT_OR_FIELD_ISSUE",
    rationale: "输入包含客户、客诉、现场或售后线索",
    patterns: [/客户|客诉|现场|售后|退回|投诉/],
  },
  {
    domain: "QUALITY",
    subtype: "SUPPLIER_ISSUE",
    rationale: "输入包含供应商或来料线索",
    patterns: [/供应商|来料|外协|采购|原材料/],
  },
  {
    domain: "QUALITY",
    subtype: "DESIGN_RELATED_QUALITY_TASK",
    rationale: "输入包含设计缺陷或设计变更线索",
    patterns: [/设计缺陷|设计相关|设计变更|结构缺陷|硬件缺陷|软件缺陷/],
  },
  {
    domain: "RD",
    subtype: "REQUIREMENT_OR_DESIGN_INPUT",
    rationale: "输入包含需求或设计输入线索",
    patterns: [/需求|设计输入|用户场景|临床场景|约束/],
  },
  {
    domain: "RD",
    subtype: "SOLUTION_DEVELOPMENT",
    rationale: "输入包含方案开发或论证线索",
    patterns: [/方案|论证|系统|硬件|软件|结构|选型/],
  },
  {
    domain: "RD",
    subtype: "VERIFICATION_AND_VALIDATION",
    rationale: "输入包含验证确认或测试方案线索",
    patterns: [/V&V|验证|确认|测试方案|样本量|通过准则/],
  },
  {
    domain: "RD",
    subtype: "DESIGN_CHANGE_ACTION",
    rationale: "输入包含设计变更或 ECN 线索",
    patterns: [/ECN|变更|回归验证|影响评估/],
  },
];

export function classifyTask(request: ClassifyTaskRequest): ClassificationResult {
  const text = request.background.trim();
  const matched = rules.find((rule) =>
    rule.patterns.some((pattern) => pattern.test(text))
  );

  if (!matched) {
    return {
      domain: "QUALITY",
      subtype: "QUALITY_OTHER_OR_UNCERTAIN",
      confidence: "LOW",
      rationale: ["输入信息不足，无法稳定判断任务类型"],
      missingInformation: ["任务来源", "问题现象", "影响范围"],
    };
  }

  return {
    domain: matched.domain,
    subtype: matched.subtype,
    confidence: text.length > 20 ? "HIGH" : "MEDIUM",
    rationale: [matched.rationale],
    missingInformation: [],
  };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- tests/agent/demo/classifier.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/demo/classifier.ts tests/agent/demo/classifier.test.ts
git commit -m "feat: add demo task classifier"
```

---

### Task 5: CAPA Advisory

**Files:**
- Create: `src/agent/demo/capa-advisor.ts`
- Test: `tests/agent/demo/capa-advisor.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/agent/demo/capa-advisor.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { adviseCapa } from "../../../src/agent/demo/capa-advisor";

describe("adviseCapa", () => {
  it("recommends CAPA assessment for customer field issues with unclear impact", () => {
    const advisory = adviseCapa({
      domain: "QUALITY",
      subtype: "CUSTOMER_COMPLAINT_OR_FIELD_ISSUE",
      background: "客户现场反馈设备间歇性报警，影响范围和批次尚未确认。",
    });

    expect(advisory.advisory).toBe("RECOMMENDED");
    expect(advisory.disclaimer).toContain("最终是否开启 CAPA");
  });

  it("returns insufficient information for thin quality input", () => {
    const advisory = adviseCapa({
      domain: "QUALITY",
      subtype: "QUALITY_OTHER_OR_UNCERTAIN",
      background: "有个质量问题。",
    });

    expect(advisory.advisory).toBe("INSUFFICIENT_INFO");
    expect(advisory.promptingQuestions.length).toBeGreaterThan(0);
  });

  it("does not require CAPA for R&D-only tasks", () => {
    const advisory = adviseCapa({
      domain: "RD",
      subtype: "VERIFICATION_AND_VALIDATION",
      background: "制定 V&V 测试方案。",
    });

    expect(advisory.advisory).toBe("NOT_REQUIRED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/demo/capa-advisor.test.ts`

Expected: FAIL because `adviseCapa` does not exist.

- [ ] **Step 3: Implement CAPA advisory**

Create `src/agent/demo/capa-advisor.ts`:

```ts
import { CapaAdvisory, CAPA_DISCLAIMER } from "../../domain/capa";
import { TaskSubtype } from "../../domain/classification";
import { PlanDomain } from "../harness/types";

export interface CapaAdvisoryRequest {
  domain: PlanDomain;
  subtype: TaskSubtype;
  background: string;
}

export function adviseCapa(request: CapaAdvisoryRequest): CapaAdvisory {
  if (request.domain !== "QUALITY") {
    return {
      advisory: "NOT_REQUIRED",
      rationale: ["当前任务被分类为研发任务，Demo 阶段不建议触发 CAPA 判断。"],
      disclaimer: CAPA_DISCLAIMER,
      promptingQuestions: [],
    };
  }

  const text = request.background;
  if (text.length < 20 || request.subtype === "QUALITY_OTHER_OR_UNCERTAIN") {
    return {
      advisory: "INSUFFICIENT_INFO",
      rationale: ["输入信息不足，无法判断是否建议进一步评估 CAPA。"],
      disclaimer: CAPA_DISCLAIMER,
      promptingQuestions: [
        "是否涉及客户、已出货产品或现场使用？",
        "是否存在批量性、重复性或安全/法规风险？",
        "是否已有临时遏制措施？",
      ],
    };
  }

  if (/客户|客诉|现场|售后|已出货|安全|法规|批量|重复|召回/.test(text)) {
    return {
      advisory: "RECOMMENDED",
      rationale: [
        "输入包含客户/现场/已出货或潜在安全法规风险线索。",
        "建议质量授权人员进一步评估是否进入 CAPA 流程。",
      ],
      disclaimer: CAPA_DISCLAIMER,
      promptingQuestions: ["请确认影响范围、重复性和当前遏制措施。"],
    };
  }

  return {
    advisory: "UNCERTAIN",
    rationale: ["当前信息显示为质量问题，但 CAPA 触发条件仍不充分。"],
    disclaimer: CAPA_DISCLAIMER,
    promptingQuestions: [
      "是否存在重复发生？",
      "是否影响客户、批量产品或法规承诺？",
    ],
  };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- tests/agent/demo/capa-advisor.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/demo/capa-advisor.ts tests/agent/demo/capa-advisor.test.ts
git commit -m "feat: add CAPA advisory for demo planning"
```

---

### Task 6: Templates and WBS Generation

**Files:**
- Create: `src/agent/demo/templates.ts`
- Create: `src/agent/demo/wbs-generator.ts`
- Test: `tests/agent/demo/wbs-generator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/agent/demo/wbs-generator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateWbs } from "../../../src/agent/demo/wbs-generator";

describe("generateWbs", () => {
  it("creates quality issue task packages from classification", () => {
    const tasks = generateWbs({
      classification: {
        domain: "QUALITY",
        subtype: "PRODUCTION_PROCESS_ABNORMALITY",
        confidence: "HIGH",
        rationale: ["生产异常"],
        missingInformation: [],
      },
      background:
        "生产测试发现 A 产品某批次开机自检失败率升高，已有生产记录和不良照片。",
    });

    expect(tasks.map((task) => task.title)).toContain("问题事实确认");
    expect(tasks.map((task) => task.title)).toContain("临时遏制与影响控制");
    expect(tasks.every((task) => task.deliverables.length > 0)).toBe(true);
  });

  it("creates R&D verification task packages", () => {
    const tasks = generateWbs({
      classification: {
        domain: "RD",
        subtype: "VERIFICATION_AND_VALIDATION",
        confidence: "HIGH",
        rationale: ["验证确认"],
        missingInformation: [],
      },
      background: "制定 V&V 验证方案，覆盖测试方法、样本量和通过准则。",
    });

    expect(tasks[0].title).toContain("验证目标");
    expect(tasks.length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/demo/wbs-generator.test.ts`

Expected: FAIL because templates and WBS generator do not exist.

- [ ] **Step 3: Add task skeleton templates**

Create `src/agent/demo/templates.ts`:

```ts
import { TaskSubtype } from "../../domain/classification";

export interface TaskSkeleton {
  title: string;
  objective: string;
  actions: string[];
  deliverables: string[];
  completionCriteria: string[];
  checkpoints: string[];
  dueAt: string;
  feedbackFrequency: string;
}

const qualityDefault: TaskSkeleton[] = [
  {
    title: "问题事实确认",
    objective: "确认问题现象、影响范围和已有证据，避免在事实不清时直接下结论。",
    actions: ["复核问题现象", "确认产品/批次/版本/客户范围", "归集照片、记录、数据等证据"],
    deliverables: ["问题事实确认记录", "影响范围清单", "证据材料列表"],
    completionCriteria: ["问题现象被复核", "影响范围有明确边界", "证据材料可追溯"],
    checkpoints: ["T+0.5 输出初步事实", "T+1 输出影响范围"],
    dueAt: "T+1",
    feedbackFrequency: "每日",
  },
  {
    title: "临时遏制与影响控制",
    objective: "在根因未明前控制问题扩散。",
    actions: ["识别需隔离对象", "制定复检/停用/停发建议", "通知相关责任人"],
    deliverables: ["隔离或控制措施清单", "通知记录", "执行证据"],
    completionCriteria: ["受影响对象已被控制", "临时措施已通知并有记录"],
    checkpoints: ["T+0.5 确认是否需要遏制"],
    dueAt: "T+1",
    feedbackFrequency: "每日",
  },
  {
    title: "根因分析计划",
    objective: "建立原因假设和验证路径。",
    actions: ["列出原因假设", "设计最小验证实验", "记录支持与反证证据"],
    deliverables: ["根因假设清单", "验证计划", "证据链记录"],
    completionCriteria: ["关键假设均有验证或排除路径", "下一步责任与时间明确"],
    checkpoints: ["T+1 输出假设树", "T+2 输出验证计划"],
    dueAt: "T+2",
    feedbackFrequency: "每日",
  },
  {
    title: "纠正措施与验证准备",
    objective: "基于根因准备纠正措施和效果验证方案。",
    actions: ["提出候选纠正措施", "评估变更影响", "制定效果验证方式"],
    deliverables: ["纠正措施草案", "变更影响评估", "验证方案草案"],
    completionCriteria: ["措施与根因存在对应关系", "验证方式可执行"],
    checkpoints: ["T+3 输出措施草案"],
    dueAt: "T+3",
    feedbackFrequency: "节点反馈",
  },
];

const rdVerification: TaskSkeleton[] = [
  {
    title: "验证目标与范围确认",
    objective: "明确验证对象、需求/风险追溯和范围边界。",
    actions: ["梳理验证对象", "关联需求/风险", "定义不在本次验证范围内的内容"],
    deliverables: ["验证范围说明", "需求/风险追溯清单"],
    completionCriteria: ["验证范围和排除项清晰", "追溯关系可被评审"],
    checkpoints: ["T+1 输出范围草案"],
    dueAt: "T+1",
    feedbackFrequency: "节点反馈",
  },
  {
    title: "验证方法与样本设计",
    objective: "形成可执行的验证方法、样本量和通过准则。",
    actions: ["定义测试方法", "确定样本量", "制定通过/失败准则"],
    deliverables: ["测试方法说明", "样本量建议", "通过准则"],
    completionCriteria: ["方法可执行", "准则可判定"],
    checkpoints: ["T+2 输出方法草案"],
    dueAt: "T+2",
    feedbackFrequency: "节点反馈",
  },
  {
    title: "验证计划评审准备",
    objective: "准备验证计划评审输入。",
    actions: ["汇总未决问题", "准备评审材料", "标出需决策事项"],
    deliverables: ["验证计划评审包", "未决问题清单"],
    completionCriteria: ["评审材料完整", "需决策事项明确"],
    checkpoints: ["T+3 输出评审包"],
    dueAt: "T+3",
    feedbackFrequency: "节点反馈",
  },
];

export function getTaskSkeletons(subtype: TaskSubtype): TaskSkeleton[] {
  if (subtype === "VERIFICATION_AND_VALIDATION") return rdVerification;
  return qualityDefault;
}
```

- [ ] **Step 4: Add WBS generator**

Create `src/agent/demo/wbs-generator.ts`:

```ts
import { ClassificationResult } from "../../domain/classification";
import { TaskPackage } from "../../domain/task-package";
import { getTaskSkeletons } from "./templates";

export interface GenerateWbsRequest {
  classification: ClassificationResult;
  background: string;
}

export function generateWbs(request: GenerateWbsRequest): TaskPackage[] {
  return getTaskSkeletons(request.classification.subtype).map((skeleton, index) => ({
    id: `task_${index + 1}`,
    title: skeleton.title,
    objective: skeleton.objective,
    collaborators: [],
    inputMaterials: [request.background],
    actions: skeleton.actions,
    deliverables: skeleton.deliverables,
    completionCriteria: skeleton.completionCriteria,
    timeNode: {
      checkpoints: skeleton.checkpoints,
      dueAt: skeleton.dueAt,
    },
    feedbackFrequency: skeleton.feedbackFrequency,
    risksAndOpenQuestions: [],
    traceInfo: request.classification.domain === "RD" ? ["待关联需求/风险 ID"] : undefined,
    dependencyTaskIds: index === 0 ? [] : [`task_${index}`],
  }));
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -- tests/agent/demo/wbs-generator.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent/demo/templates.ts src/agent/demo/wbs-generator.ts tests/agent/demo/wbs-generator.test.ts
git commit -m "feat: generate demo WBS task packages"
```

---

### Task 7: Gate Validation and Markdown Output

**Files:**
- Create: `src/agent/demo/gate.ts`
- Create: `src/agent/demo/markdown-renderer.ts`
- Test: `tests/agent/demo/output.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/agent/demo/output.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateDemoGate } from "../../../src/agent/demo/gate";
import { renderPlanDraftMarkdown } from "../../../src/agent/demo/markdown-renderer";

describe("demo gate and markdown output", () => {
  it("fails gate when a task is missing deliverables", () => {
    const result = validateDemoGate([
      {
        id: "task_1",
        title: "问题事实确认",
        objective: "确认事实",
        collaborators: [],
        inputMaterials: [],
        actions: ["确认事实"],
        deliverables: [],
        completionCriteria: ["范围清楚"],
        timeNode: { checkpoints: [], dueAt: "T+1" },
        feedbackFrequency: "每日",
        risksAndOpenQuestions: [],
        dependencyTaskIds: [],
      },
    ]);

    expect(result.passed).toBe(false);
    expect(result.missingByTask[0].missingFields).toContain("deliverables");
  });

  it("renders markdown with CAPA advisory and task table", () => {
    const markdown = renderPlanDraftMarkdown({
      summary: "生产测试发现不良率升高。",
      classification: {
        domain: "QUALITY",
        subtype: "PRODUCTION_PROCESS_ABNORMALITY",
        confidence: "HIGH",
        rationale: ["生产异常"],
        missingInformation: [],
      },
      capaAdvisory: {
        advisory: "UNCERTAIN",
        rationale: ["需要确认是否重复发生"],
        disclaimer:
          "该建议仅用于任务拆解与质量沟通参考，最终是否开启 CAPA 以质量授权人员和公司 QMS 流程判定为准。",
        promptingQuestions: ["是否影响已出货产品？"],
      },
      tasks: [
        {
          id: "task_1",
          title: "问题事实确认",
          objective: "确认事实",
          collaborators: [],
          inputMaterials: ["生产记录"],
          actions: ["确认事实"],
          deliverables: ["事实确认记录"],
          completionCriteria: ["范围清楚"],
          timeNode: { checkpoints: ["T+0.5"], dueAt: "T+1" },
          feedbackFrequency: "每日",
          risksAndOpenQuestions: [],
          dependencyTaskIds: [],
        },
      ],
      gate: { passed: true, missingByTask: [] },
      openQuestions: [],
    });

    expect(markdown).toContain("## CAPA 建议");
    expect(markdown).toContain("| task_1 | 问题事实确认 |");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/demo/output.test.ts`

Expected: FAIL because gate and renderer do not exist.

- [ ] **Step 3: Implement gate validation**

Create `src/agent/demo/gate.ts`:

```ts
import { TaskPackage } from "../../domain/task-package";

export interface MissingTaskFields {
  taskId: string;
  title: string;
  missingFields: string[];
}

export interface DemoGateResult {
  passed: boolean;
  missingByTask: MissingTaskFields[];
}

export function validateDemoGate(tasks: TaskPackage[]): DemoGateResult {
  const missingByTask = tasks
    .map((task) => {
      const missingFields: string[] = [];
      if (task.deliverables.length === 0) missingFields.push("deliverables");
      if (task.completionCriteria.length === 0)
        missingFields.push("completionCriteria");
      if (!task.timeNode?.dueAt) missingFields.push("timeNode.dueAt");
      if (!task.feedbackFrequency) missingFields.push("feedbackFrequency");
      return { taskId: task.id, title: task.title, missingFields };
    })
    .filter((item) => item.missingFields.length > 0);

  return { passed: missingByTask.length === 0, missingByTask };
}
```

- [ ] **Step 4: Implement Markdown renderer**

Create `src/agent/demo/markdown-renderer.ts`:

```ts
import { CapaAdvisory } from "../../domain/capa";
import { ClassificationResult } from "../../domain/classification";
import { TaskPackage } from "../../domain/task-package";
import { DemoGateResult } from "./gate";

export interface RenderPlanDraftMarkdownRequest {
  summary: string;
  classification: ClassificationResult;
  capaAdvisory?: CapaAdvisory;
  tasks: TaskPackage[];
  gate: DemoGateResult;
  openQuestions: string[];
}

function list(items: string[]): string {
  if (items.length === 0) return "- 无";
  return items.map((item) => `- ${item}`).join("\n");
}

export function renderPlanDraftMarkdown(
  request: RenderPlanDraftMarkdownRequest
): string {
  const taskRows = request.tasks
    .map(
      (task) =>
        `| ${task.id} | ${task.title} | ${task.objective} | ${task.deliverables.join("；")} | ${task.completionCriteria.join("；")} | ${task.timeNode.dueAt} | ${task.feedbackFrequency} |`
    )
    .join("\n");

  const capaSection = request.capaAdvisory
    ? `\n## CAPA 建议\n\n- 建议：${request.capaAdvisory.advisory}\n- 理由：\n${list(request.capaAdvisory.rationale)}\n- 免责声明：${request.capaAdvisory.disclaimer}\n- 需补充问题：\n${list(request.capaAdvisory.promptingQuestions)}\n`
    : "";

  const gateSection = request.gate.passed
    ? "门禁结果：通过。"
    : `门禁结果：未通过。\n${request.gate.missingByTask
        .map((item) => `- ${item.taskId} ${item.title}: ${item.missingFields.join(", ")}`)
        .join("\n")}`;

  return `# 任务拆解 Demo 草案\n\n## 任务理解摘要\n\n${request.summary}\n\n## 场景分类\n\n- 域：${request.classification.domain}\n- 子类型：${request.classification.subtype}\n- 置信度：${request.classification.confidence}\n- 判断依据：\n${list(request.classification.rationale)}\n${capaSection}\n## WBS 任务包\n\n| ID | 子任务 | 目标 | 交付物 | 完成标准 | 截止 | 反馈频率 |\n| -- | ------ | ---- | ------ | -------- | ---- | -------- |\n${taskRows}\n\n## 派发门禁\n\n${gateSection}\n\n## 仍需确认的问题\n\n${list(request.openQuestions)}\n`;
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -- tests/agent/demo/output.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent/demo/gate.ts src/agent/demo/markdown-renderer.ts tests/agent/demo/output.test.ts
git commit -m "feat: render gate-checked demo task drafts"
```

---

### Task 8: Demo Pipeline and Runner

**Files:**
- Create: `src/agent/demo/pipeline.ts`
- Create: `src/agent/demo/index.ts`
- Create: `src/demo.ts`
- Test: `tests/agent/demo/pipeline.test.ts`

- [ ] **Step 1: Write failing pipeline tests**

Create `tests/agent/demo/pipeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTaskPlanningDemo } from "../../../src/agent/demo/pipeline";

describe("createTaskPlanningDemo", () => {
  it("returns clarifying questions when input is too thin", () => {
    const result = createTaskPlanningDemo({
      background: "某产品异常，尽快处理。",
      domainHint: "QUALITY",
    });

    expect(result.status).toBe("NEEDS_MORE_INFO");
    expect(result.questions.length).toBeGreaterThan(0);
    expect(result.markdown).toBeUndefined();
  });

  it("creates a markdown draft for sufficient quality input", () => {
    const result = createTaskPlanningDemo({
      background:
        "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
      domainHint: "QUALITY",
    });

    expect(result.status).toBe("DRAFT_READY");
    expect(result.classification?.domain).toBe("QUALITY");
    expect(result.capaAdvisory?.disclaimer).toContain("最终是否开启 CAPA");
    expect(result.gate?.passed).toBe(true);
    expect(result.markdown).toContain("# 任务拆解 Demo 草案");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/demo/pipeline.test.ts`

Expected: FAIL because pipeline does not exist.

- [ ] **Step 3: Implement pipeline**

Create `src/agent/demo/pipeline.ts`:

```ts
import { CapaAdvisory } from "../../domain/capa";
import { ClassificationResult } from "../../domain/classification";
import { TaskPackage } from "../../domain/task-package";
import { PlanDomain } from "../harness/types";
import { adviseCapa } from "./capa-advisor";
import { classifyTask } from "./classifier";
import { DemoGateResult, validateDemoGate } from "./gate";
import { checkInputQuality } from "./input-qc";
import { renderPlanDraftMarkdown } from "./markdown-renderer";
import { generateWbs } from "./wbs-generator";

export interface TaskPlanningDemoRequest {
  background: string;
  domainHint?: PlanDomain;
}

export interface TaskPlanningDemoResult {
  status: "NEEDS_MORE_INFO" | "DRAFT_READY";
  questions: string[];
  classification?: ClassificationResult;
  capaAdvisory?: CapaAdvisory;
  tasks?: TaskPackage[];
  gate?: DemoGateResult;
  markdown?: string;
}

export function createTaskPlanningDemo(
  request: TaskPlanningDemoRequest
): TaskPlanningDemoResult {
  const inputQuality = checkInputQuality({
    domainHint: request.domainHint,
    background: request.background,
  });

  if (!inputQuality.canGenerateWbs) {
    return {
      status: "NEEDS_MORE_INFO",
      questions: inputQuality.questions,
    };
  }

  const classification = classifyTask({ background: request.background });
  const capaAdvisory = adviseCapa({
    domain: classification.domain,
    subtype: classification.subtype,
    background: request.background,
  });
  const tasks = generateWbs({ classification, background: request.background });
  const gate = validateDemoGate(tasks);
  const openQuestions = [
    ...inputQuality.questions,
    ...classification.missingInformation,
    ...capaAdvisory.promptingQuestions,
  ];

  const markdown = renderPlanDraftMarkdown({
    summary: request.background,
    classification,
    capaAdvisory:
      classification.domain === "QUALITY" ? capaAdvisory : undefined,
    tasks,
    gate,
    openQuestions,
  });

  return {
    status: "DRAFT_READY",
    questions: openQuestions,
    classification,
    capaAdvisory,
    tasks,
    gate,
    markdown,
  };
}
```

- [ ] **Step 4: Export demo modules**

Create `src/agent/demo/index.ts`:

```ts
export * from "./capa-advisor";
export * from "./classifier";
export * from "./gate";
export * from "./input-qc";
export * from "./markdown-renderer";
export * from "./pipeline";
export * from "./templates";
export * from "./wbs-generator";
```

- [ ] **Step 5: Add local demo runner**

Create `src/demo.ts`:

```ts
import { createTaskPlanningDemo } from "./agent/demo/pipeline";

const result = createTaskPlanningDemo({
  domainHint: "QUALITY",
  background:
    "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
});

if (result.status === "NEEDS_MORE_INFO") {
  console.log("需要补充以下信息：");
  for (const question of result.questions) console.log(`- ${question}`);
} else {
  console.log(result.markdown);
}
```

- [ ] **Step 6: Run pipeline tests**

Run: `npm test -- tests/agent/demo/pipeline.test.ts`

Expected: PASS.

- [ ] **Step 7: Run all tests and typecheck**

Run: `npm test`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 8: Run local demo**

Run: `npm run demo`

Expected: console output starts with `# 任务拆解 Demo 草案` and includes `## CAPA 建议`, `## WBS 任务包`, and `## 派发门禁`.

- [ ] **Step 9: Commit**

```bash
git add src/agent/demo/index.ts src/agent/demo/pipeline.ts src/demo.ts tests/agent/demo/pipeline.test.ts
git commit -m "feat: add task planning demo pipeline"
```

---

### Task 9: Harness Boundary Adapter

**Files:**
- Create: `src/agent/harness/demo-adapter.ts`
- Test: `tests/agent/harness/demo-adapter.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Create `tests/agent/harness/demo-adapter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTaskPlanningDemo } from "../../../src/agent/demo/pipeline";
import { toHarnessPlanDraft } from "../../../src/agent/harness/demo-adapter";

describe("toHarnessPlanDraft", () => {
  it("maps a demo draft into Harness Plan without dispatching it", () => {
    const demo = createTaskPlanningDemo({
      domainHint: "QUALITY",
      background:
        "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
    });

    if (demo.status !== "DRAFT_READY") {
      throw new Error("expected demo draft");
    }

    const plan = toHarnessPlanDraft({
      id: "plan_demo_1",
      initiatorId: "manager_1",
      background:
        "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
      demo,
      createdAt: "2026-05-07T04:00:00.000Z",
    });

    expect(plan.status).toBe("DRAFT");
    expect(plan.domain).toBe("QUALITY");
    expect(plan.subType).toBe("PRODUCTION_PROCESS_ABNORMALITY");
    expect(plan.taskPackages.length).toBeGreaterThan(0);
    expect(plan.demoClassification?.subtype).toBe("PRODUCTION_PROCESS_ABNORMALITY");
    expect(plan.capaAdvisory?.disclaimer).toContain("最终是否开启 CAPA");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/harness/demo-adapter.test.ts`

Expected: FAIL because `toHarnessPlanDraft` does not exist.

- [ ] **Step 3: Implement Harness boundary adapter**

Create `src/agent/harness/demo-adapter.ts`:

```ts
import { Plan } from "../../domain/plan";
import { TaskPlanningDemoResult } from "../demo/pipeline";

export interface ToHarnessPlanDraftRequest {
  id: string;
  initiatorId: string;
  background: string;
  demo: Extract<TaskPlanningDemoResult, { status: "DRAFT_READY" }>;
  createdAt: string;
}

export function toHarnessPlanDraft(request: ToHarnessPlanDraftRequest): Plan {
  const { demo } = request;
  return {
    id: request.id,
    domain: demo.classification.domain,
    subType: demo.classification.subtype,
    background: request.background,
    constraints: demo.questions,
    initiatorId: request.initiatorId,
    status: "DRAFT",
    taskPackages: demo.tasks,
    externalRefs: [],
    createdAt: request.createdAt,
    updatedAt: request.createdAt,
    demoClassification: demo.classification,
    capaAdvisory: demo.capaAdvisory,
  };
}
```

- [ ] **Step 4: Run adapter tests and typecheck**

Run: `npm test -- tests/agent/harness/demo-adapter.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/harness/demo-adapter.ts tests/agent/harness/demo-adapter.test.ts
git commit -m "feat: map demo drafts into harness plan shape"
```

---

### Task 10: Documentation Update

**Files:**
- Modify: `docs/superpowers/specs/2026-05-07-task-planning-demo-mvp-design.md`
- Modify: `docs/PRD-钉钉任务规划与承接确认机器人.md`

- [ ] **Step 1: Add run instructions to the design spec**

Append this section to `docs/superpowers/specs/2026-05-07-task-planning-demo-mvp-design.md`:

```markdown
## 9. 本地 Demo 运行方式

实现完成后，可用以下命令运行：

```bash
npm install
npm test
npm run typecheck
npm run demo
```

`npm run demo` 会输出一份 Markdown 任务拆解草案，包含输入理解、分类、CAPA 建议、WBS 任务包、派发门禁和仍需确认的问题。
```
```

- [ ] **Step 2: Add demo command reference to PRD**

In `docs/PRD-钉钉任务规划与承接确认机器人.md`, after section `5.1 MVP 输出`, add:

```markdown
### 5.2 本地 Demo 运行方式

研发实现完成后，可通过 `npm run demo` 生成一份示例 Markdown 拆解稿，用于与质量/研发评审任务拆解效果。该命令仅用于本地演示，不代表钉钉机器人或 OA 流程已经接入。
```

Then renumber the existing `### 5.2 后续版本：承接确认与执行反馈` to `### 5.3 后续版本：承接确认与执行反馈`.

- [ ] **Step 3: Run markdown sanity search**

Run: `rg "npm run demo|本地 Demo" docs`

Expected: at least two matches, one in PRD and one in spec.

- [ ] **Step 4: Run final verification**

Run: `npm test`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run demo`

Expected: Markdown output is printed.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-05-07-task-planning-demo-mvp-design.md docs/PRD-钉钉任务规划与承接确认机器人.md
git commit -m "docs: add demo run instructions"
```

---

## Self-Review

**Spec coverage:** Covered input quality checks, classification, CAPA advisory, template/WBS generation, gate validation, Markdown output, Demo-to-Harness draft adapter, and Demo evaluation path. Explicitly kept OA, electronic signature, task change, assignment confirmation, node feedback, and acceptance out of scope.

**Placeholder scan:** No TBD/TODO placeholders. Each implementation step includes exact files, code, commands, and expected outcomes.

**Type consistency:** Domain names are consistent across tasks: `CapaAdvisory`, `ClassificationResult`, `TaskPackage`, `DemoGateResult`, and `createTaskPlanningDemo`.

