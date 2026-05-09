# 任务分配与派发能力设计

**文档日期**：2026-05-09
**修订人**：姚凯珩
**状态**：草案；**Conversational intent（v2.11）** 已在 Demo 主线落地（见 **`AGENTS.md`**、**`docs/Qwen-接入实施说明.md`**），本设计可与该实现对齐后进入实施；跨 prompt/schema/钉钉文件的改动需在分支合并后做一次回归核对。
**关联文档**：
- `docs/PRD-钉钉任务规划与承接确认机器人.md`
- `docs/agent-harness-架构与开发计划.md`
- `docs/superpowers/specs/2026-05-07-task-planning-demo-mvp-design.md`
- `docs/superpowers/specs/2026-05-09-conversational-intent-agent-redesign.md`

## 1. 背景

当前 MVP 已能把模糊任务转为可评审的结构化草案：信息充分性判断、分类、WBS、CAPA 建议、派发门禁、Markdown 输出。下一阶段的核心目标，是让草案从「可读」变成「可派发到具体员工」，即在不破坏现有产品边界的前提下，加入 **由 LLM 主导的责任人推荐 + 主管确认 + 钉钉触达 + 能力档案持续沉淀** 的闭环能力。

公司近期会要求每位员工提交面向任务分配的能力信息。本设计要保证：第一版用假数据即可验证模型能力，结构和接口能直接承接未来真实员工自填档案。

## 2. 目标与非目标

### 2.1 目标

- 在 WBS 草案完成后，自动产出每个子任务的 **责任人推荐 + 备选人 + 理由 + 风险**，由 LLM 判断为主。
- 主管在钉钉接收 **分配确认卡片**，可一键确认派发，或跳转后台 Web 工作台调整。
- 主管确认后，系统自动给员工发送 **任务承接卡片**，员工可确认承接 / 需要修改 / 无法承接。
- 系统持续沉淀员工能力档案、历史任务表现、推荐效果，供后续推荐与人工复盘使用。
- 用结构化的假员工数据集验证：模型在拿到哪些信息时能给出合理的分配结果。

### 2.2 非目标

- 不替代现有 HR/OA/QMS 系统，不做任何与正式人事记录绑定的判定。
- 不做实时强化学习、排程优化、技能图谱可视化、内部零工市场等趋势性能力。
- 不做完整的项目看板、甘特图、节点反馈、验收闭环（沿用 PRD V2/V3 边界）。
- 不在第一版做员工能力档案的在线编辑界面（先用假数据 + 后台导入）。
- 不让模型自动改写员工原始档案，所有「来自模型的判断」必须独立存储并标注来源。

## 3. 整体流程与状态边界

### 3.1 流程概览

```text
输入质检 → Qwen 结构化生成（含 responseIntent）
        → DRAFT / REVISE_DRAFT 出现时进入 Assignment 阶段
        → assignmentRecommender（LLM 主导）输出 AssignmentDraft
        → 钉钉「分配确认卡片」推给主管
        → 主管确认 / 调整（卡片直接确认 或 跳 Web 工作台）
        → DISPATCHED：逐人发送「任务承接卡片」
        → 员工承接 / 需要修改 / 无法承接（承接卡片 或 Web 补充页）
        → 全程审计事件 + 能力档案沉淀
```

### 3.2 与现有 Plan 状态机的衔接

在现有 `DRAFT_READY` 之后引入新状态：

- `ASSIGNMENT_RECOMMENDING`：草案已就绪，正在调用 assignmentRecommender。
- `AWAITING_DISPATCH_CONFIRM`：分配草案已生成，等待主管确认。
- `DISPATCHED`：主管确认，已逐人发送承接卡片。
- 后续衔接 PRD 中已有的 `NEGOTIATING / IN_EXECUTION / IN_ACCEPTANCE / DONE`，本设计不展开。

Assignment 子状态沿用现有约定：

- `PENDING_CONFIRM → ACCEPTED | REQUEST_CHANGES | REJECTED`
- 超时路径：`PENDING_CONFIRM → TIMEOUT_REMIND_SENT → TIMEOUT_ESCALATED`

第一版只实现到 `DISPATCHED`、`ACCEPTED / REQUEST_CHANGES / REJECTED`；超时升级与节点反馈保持 PRD V2 的边界。

### 3.3 设计原则

- **LLM 是分配决策核心**：分配建议必须由模型基于任务 + 员工档案 + 历史信息做出，规则只做硬约束与安全边界。
- **主管负责确认**：模型不直接派发，所有派发动作都需要主管确认；可在卡片直接确认，也可在 Web 工作台调整后确认。
- **Chat/Card for fast decisions, Web for complex work**：钉钉卡片只承载摘要 + 单步按钮，复杂操作跳到后台 Web。
- **不污染原始档案**：员工自填、系统沉淀、模型推断三类数据分开存。
- **可审计可回放**：每次推荐、调整、派发、承接都写入审计事件，串联同一 `traceId`。

## 4. 员工能力档案与假数据

### 4.1 数据分层

为避免模型一句话改写员工档案，能力数据分三层独立存储：

- **Self-Profile（员工自填档案）**：未来由员工自助提交；第一版用假数据。
- **Track Record（系统沉淀履历）**：只追加事件流，记录每次分配、承接、反馈、结果。
- **Derived Profile（模型推断画像）**：基于 Self + Track 周期性生成，标注来源 / 置信度 / 最近更新时间，可重建、可下线。

模型推荐时使用「**面向任务分配的压缩画像**」，由 Self + Track + Derived 按规则裁剪生成；不让模型直接接触原始 Track 全量数据。

### 4.2 Self-Profile 字段（假数据生成依据）

每位员工档案至少包含：

- **基础与身份**：姓名、钉钉 userId、部门、岗位、职级、直属主管、所在地点。
- **能力标签**：质量体系、8D/CAPA、根因分析、供应商管理、嵌入式、结构、测试验证、需求分析、风险管理等。
- **能力边界**：擅长 / 不擅长 / 需要前置输入 / 必须协作角色。
- **代表案例**：3-5 条过往任务，含任务类型、个人贡献、交付物、结果。
- **工具与权限**：可访问的 QMS / PLM / 测试平台 / 代码仓库 / 供应商资料等。
- **可用性偏好**：可承接负载、近期冲突、是否适合紧急任务、是否拒绝某类任务。

### 4.3 Track Record 事件（系统自动写入）

- 分配推荐：`recommended_for_task`，含模型推荐理由摘要、置信度、备选人。
- 主管调整：`assignment_overridden`，含主管选择、是否采纳推荐、覆盖原因（可空）。
- 员工承接：`accepted | requested_changes | rejected`，含说明、所需输入、可替代人选建议。
- 任务结果（V1 阶段轻量、V2 完整）：是否准时、是否返工、主管验收意见、复盘备注。
- 模型自评：`recommendation_self_critique`，每次推荐后让模型记录此次的不确定点。

事件写入 `assignment-events.jsonl`，与现有 `AUDIT_DEMO_JSONL_PATH` 并轨，共享 `traceId`。

### 4.4 Derived Profile

- 由离线/异步任务基于 Self + Track 生成，例如「擅长任务类型 Top N」「合作偏好」「典型负载」。
- 必须带版本号与生成时间；员工或主管查看时显式提示「系统推断」。
- 员工可对错误推断提出申诉，进入人工复核队列；本设计第一版只留接口，不做完整审批 UI。

### 4.5 假数据集要求

- 至少覆盖 15-30 名员工，跨质量、研发、测试、供应商质量、项目管理等角色。
- 每个角色至少有 1 名「明显擅长」、1 名「能力相邻可承接」、1 名「明显不合适」的样本，便于回归推荐质量。
- 含至少 1 名跨域协作型员工、1 名高负载员工、1 名近期拒绝过类似任务的员工，用于压力测试推荐与风险提示。
- 假数据脚本与真实导入格式保持一致，便于未来直接替换。

## 5. LLM 推荐输出结构与主管确认

### 5.1 assignmentRecommender 阶段

新增独立 LLM 调用，与现有 `runQwenPlanner` 解耦：

- 输入：`PlanDraft`（含子任务、依赖、交付物、完成标准、时间约束、CAPA 建议）+ 候选人压缩画像列表 + 当前会话上下文（精简）。
- 输出：`AssignmentDraft`，每个子任务一项，含责任人、备选人、理由、风险、置信度、需主管确认的问题、模型自评不确定点。
- 失败回退：模型失败或校验失败时返回 `ASSIGNMENT_GENERATION_FAILED`，**不使用规则稿替代**，以「无推荐」状态进入主管 Web 工作台手动分配。

### 5.2 候选人压缩画像（喂给 LLM 的部分）

每位候选人压缩为可控文本片段：

- 基础：姓名、岗位、部门。
- 能力摘要：擅长方向、能力边界、关键工具/权限。
- 最近 N 条任务履历摘要：任务类型、结果、是否准时、是否返工、是否拒接。
- 当前可用性：在手任务数、明显冲突、是否标记不可承接。
- 可选 Derived 标签：带「系统推断 + 时间 + 置信度」标识。

候选人范围由系统侧硬约束：仅展示组织可见、未离职、有钉钉 ID、未被任务发起人显式排除的员工。其余适配判断交给 LLM。

### 5.3 AssignmentDraft 数据契约（草稿）

```ts
type Confidence = "HIGH" | "MEDIUM" | "LOW";

interface AssignmentRiskFlag {
  type: "OVERLOAD" | "MISSING_PERMISSION" | "CROSS_DEPARTMENT"
      | "RECENT_REJECTION" | "INSUFFICIENT_EVIDENCE" | "OTHER";
  description: string;
}

interface AssignmentCandidate {
  userId: string;
  displayName: string;
  rationale: string;            // 引用具体能力档案/履历证据
  evidenceRefs?: string[];      // 引用的 case/track event id
  risks?: AssignmentRiskFlag[];
}

interface SubTaskAssignment {
  taskId: string;
  primary: AssignmentCandidate;
  alternates: AssignmentCandidate[];
  confidence: Confidence;
  confidenceReason: string;
  managerQuestions?: string[];   // 需主管确认的问题
  modelSelfCritique?: string;    // 模型自评不确定点
}

interface AssignmentDraft {
  planId: string;            // 当前 Demo 实现里等于 traceId（与 plan-store 一致），未来可独立
  traceId: string;
  generatedAt: string;
  promptVersion: string;
  modelName: string;
  assignments: SubTaskAssignment[];
  globalRisks?: AssignmentRiskFlag[];
}
```

### 5.4 三层信息呈现原则

- **主视图（钉钉卡片 + Web 主表）**：子任务名、推荐负责人、备选人、置信度、关键理由一句话、风险标记、操作按钮。
- **展开详情（Web 行展开）**：完整理由、候选人对比、引用的能力档案片段、当前负载、潜在冲突。
- **后台审计（只读）**：完整 LLM 输入输出、主管调整记录、消息发送结果、员工响应；面向复盘与调优。

主管平时只看主视图；详情仅在「低置信度 / 高风险 / 跨部门 / 主管质疑」时展开。

## 6. 钉钉卡片与 Web 工作台

### 6.1 设计原则

- 钉钉卡片只承担 **低摩擦、单步决策**：查看摘要、确认派发、确认承接、拒绝、跳详情。
- 复杂操作（多条调整、候选人对比、补充任务信息、批量派发、查看完整证据链）一律跳后台 Web。
- 卡片以业务唯一 `outTrackId`（建议形如 `plan:<planId>` / `assign:<planId>:<userId>`）跟踪与更新；与 Plan/Assignment 状态机字段对齐。
- 卡片回调要快、要可审计；点击事件、操作人、时间、原推荐、调整结果都进事件流。

### 6.2 主管侧：分配确认卡片

默认仅展示：

- 任务标题与计划摘要。
- 子任务数量、低置信度任务数。
- 风险高亮（如「2 项低置信度 / 1 项跨部门 / 1 项负载冲突」），由 §5.3 中的 `confidence` 与 `risks` 聚合得到，不引入新的「整体置信度」字段。
- 操作按钮：`确认并派发`、`打开分配工作台`、`查看完整规划`。

不在卡片里展示：完整子任务表、模型理由、候选人对比。完整信息走 Web。

### 6.3 员工侧：任务承接卡片

主管确认后，逐人下发，默认展示：

- 子任务目标、交付物、完成标准、时间节点、反馈频率。
- 操作按钮：`确认承接`、`需要修改`、`无法承接`。

「确认承接」直接在卡片完成；「需要修改 / 无法承接」跳 Web 承接补充页填写说明。

### 6.4 Web 工作台范围（第一版）

仅承担钉钉卡片放不下的部分：

- **进入路径**：从钉钉卡片链接进入，URL 带 `traceId / planId / role`，基于钉钉登录态识别身份；不开放对外注册。
- **主管分配工作台**：单页解决任务摘要 + 子任务分配表 + 行展开详情 + 一键派发；不做时间节点 / 交付物 / 完成标准的深度编辑（这些字段第一版仍由模型生成 + 门禁兜底，Web 只做轻量备注或重生成请求）。
- **员工承接补充页**：仅在「需要修改」「无法承接」时跳转，收集修改建议、不能承接原因、可替代人选建议、所需输入或权限缺口。
- **审计列表（只读）**：按时间倒序展示规划 / 推荐 / 调整 / 反馈 / 状态 / `traceId`，可点击查看完整 LLM 输入输出与员工档案快照。

第一版明确不做：员工档案（Self-Profile）的在线编辑界面、看板/甘特、执行变更、节点反馈、验收、OA 同步、多组织/多租户、站内消息系统。Derived Profile 的查看与申诉接口属于 §14 Phase D 的最小实现范围，不与「员工档案在线编辑」混为一谈。

## 7. 持续沉淀员工能力与迭代分配效果

### 7.1 反馈如何回流

第一版用「**提示词增强 + 证据召回**」，不引入实时强化学习：

- 每次推荐前，把候选人最近 N 条 Track Record 摘要塞进上下文。
- 摘要由系统按规则压缩（任务类型、结果、是否准时、主管反馈、是否拒接），不让模型自由编造。
- 主管反复否决某员工的特定模式时，系统在下次推荐前显式标注，但不直接修改员工档案。
- Derived Profile 周期性离线刷新，保留版本号，可回滚。

### 7.2 数据更新规则

- Self-Profile：仅员工本人更新（V2 后开放员工自助入口）。
- Track Record：仅系统自动写入，员工与主管可查看，不可删改。
- Derived Profile：仅系统生成，员工可查看 + 申诉，不可直接编辑。
- 任何对档案的修改都进入审计事件，可追溯到操作者与依据。

### 7.3 隐私与对齐边界

- 能力数据不写入对外日志；姓名、钉钉 ID、联系方式按现有 PII 脱敏规则处理。
- 模型输出不允许出现负面人格化描述，只允许任务匹配维度的判断（例：「缺少 X 经验」而非「能力较差」）。
- 拒接率 / 返工率不直接面向员工排名；管理层报表需要单独权限。
- 任何长期画像必须显示「最近更新时间」，避免主管误以为是当前事实。

## 8. 与 conversational-intent-agent-redesign 的衔接

本设计与 `2026-05-09-conversational-intent-agent-redesign.md` 在层次上不冲突，但实施阶段需要协调以下接触面。

### 8.1 触发条件

Assignment 阶段的触发信号采用对方设计的 `responseIntent`：

- `responseIntent === "DRAFT"` 或 `"REVISE_DRAFT"` 时进入 `ASSIGNMENT_RECOMMENDING`。
- 其他 intent（`CHAT / CLARIFY / DISCUSS / RESET_OR_NEW_TASK`）一律不触发分配。
- **v2.11 已上线**：以 `responseIntent` 为首选信号；若极端情况下模型未输出合法 intent，可回退为「`tasks` 非空 + 通过门禁」作为工程兜底（与 `llm-schema` 兼容策略一致）。

### 8.2 钉钉渲染

- 对方修改 `dingtalk-bot.ts` 的 Markdown 分支（按 intent 渲染）。
- 本设计在同一文件新增互动卡片调用与按钮回调；为减少冲突，新代码尽量放在新建模块（如 `src/dingtalk/cards/`），`dingtalk-bot.ts` 只做单点接入。
- DRAFT/REVISE_DRAFT 渲染顺序约定：先发对方设计的草案 Markdown，再发本设计的「分配确认卡片」。两条消息逻辑独立、可分别失败重试。

### 8.3 Session Memory

对方扩展 `conversationState`（`activeDraftBrief / knownFacts / lastResponseIntent / userRejectedTemplate` 等）。本设计需要的「当前 plan 是否已生成 AssignmentDraft / 是否已派发 / 待主管确认 / 待哪些员工承接」属于会话态，**直接挂在对方扩展后的结构上**，不另起一套：

```ts
interface DingTalkDemoSessionContext {
  // ... 对方扩展字段
  conversationState?: {
    // ... 对方字段
    assignmentState?: {
      assignmentDraftId?: string;
      stage?: "RECOMMENDING" | "AWAITING_DISPATCH_CONFIRM" | "DISPATCHED";
      pendingAssignees?: { userId: string; status: "PENDING_CONFIRM" | "ACCEPTED" | "REQUEST_CHANGES" | "REJECTED" }[];
    };
  };
}
```

### 8.4 Prompt 与 Schema

- 对方 v2.11 改主 prompt（task-planning），新增 `responseIntent / assistantMessage`。
- 本设计新建独立 prompt（建议命名 `assignment-recommender-agent-v0.1`），文件独立，与 v2.11 解耦；不在主 prompt 中混入分配相关字段。
- 主 schema 不变；新增 `AssignmentDraft` schema 独立于现有 `llm-schema`。
- coerce 链路按需扩展，避免在主 planner 与 pipeline 重复 coerce（沿用 AGENTS.md 工程约束）。

### 8.5 实施顺序建议

1. 先等对方 v2.11 落地（`responseIntent / assistantMessage`、新 memory、Markdown 分支）。
2. 本设计在独立 worktree 推进：新增 `src/agent/assignment/`、`src/dingtalk/cards/`、Web 后台、能力档案数据集；对 `dingtalk-bot.ts` / `session-store.ts` 的改动留到最后做集成层粘合。
3. 集成阶段再做端到端联调与回归。

如时间紧需要并行，必须保证：本设计不修改主 prompt、不修改主 schema、不与对方在同一文件并行重写。

## 9. 数据契约补充

除 §5.3 的 `AssignmentDraft`，还需以下最小契约。详细字段在实施阶段细化。

```ts
interface EmployeeProfile {
  userId: string;
  displayName: string;
  department: string;
  role: string;
  level?: string;
  managerUserId?: string;
  location?: string;
  selfProfile: {
    skillTags: string[];
    strengths: string[];
    boundaries: string[];
    cases: { taskType: string; contribution: string; deliverable: string; outcome: string }[];
    tools: string[];
    availability: { capacityHint?: string; emergencyOk?: boolean; rejectedTaskTypes?: string[] };
  };
  derived?: {
    version: string;
    generatedAt: string;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    summary: string;
  };
}

type AssignmentEventType =
  | "recommended_for_task"
  | "assignment_overridden"
  | "manager_confirmed_dispatch"
  | "assignment_dispatched"
  | "employee_accepted"
  | "employee_requested_changes"
  | "employee_rejected"
  | "recommendation_self_critique"
  | "task_outcome_recorded";

interface AssignmentEvent {
  eventId: string;
  traceId: string;
  planId: string;
  taskId?: string;
  type: AssignmentEventType;
  actorUserId?: string;     // 主管或员工 userId；系统事件可为空
  occurredAt: string;
  payload: Record<string, unknown>;
}
```

## 10. 数据存储与持久化

### 10.1 部署假设

第一版钉钉机器人与 Web 工作台 **同进程同机器** 部署，共享本地文件系统；沿用 `AGENTS.md` 「单实例进程内存 + 文件存储」的现网假设，不引入数据库。多副本 / Redis / 关系型数据库列入长期项，不在本设计范围。

### 10.2 目录约定

在现有 `./data/` 之下扩展，与 `PLAN_STORE_DIR / AUDIT_DEMO_JSONL_PATH` 共用根目录：

```text
./data/
  plans/                         # 已有 PLAN_STORE_DIR
    <planId>.json                # PlanDraft 快照（已有）
    <planId>.assignment.json     # AssignmentDraft 快照（新增；与同 planId 一一对应）
  employees/
    profiles/                    # Self-Profile，每人一个 JSON
      <userId>.json
    derived/                     # Derived Profile，每人一个 JSON，含 version / generatedAt / confidence
      <userId>.json
    fixtures/                    # 假数据 seed 与导入备份
      seed.json
  events/
    audit-demo.jsonl             # 已有 AUDIT_DEMO_JSONL_PATH
    assignment-events.jsonl      # 新增：§4.3 / §9 中的 AssignmentEvent
    card-callbacks.jsonl         # 新增：钉钉卡片回调原始事件（验签后）
  cards/
    <outTrackId>.json            # 卡片 ↔ 内部 plan/assignment 的映射 + 当前状态投影
```

`./data/` 必须保持在 `.gitignore` 中，员工档案与事件流不进 git。

### 10.3 各类数据的存取规则

- **PlanDraft 快照**：复用现有 `plan-store`，逻辑不变。
- **AssignmentDraft 快照**：新增 `assignment-store`，按 `planId` 写一个 JSON 文件；写入采用「写临时文件 + 原子 rename」，失败时记日志，不阻断主链路（沿用 `plan-store` 风格）。
- **EmployeeProfile（Self）**：每人一个 JSON 文件；只允许通过统一的 `employee-profile-repo` 读写；第一版假数据由 seed 脚本生成。
- **Derived Profile**：每人一个 JSON 文件，含 `version / generatedAt / confidence / source`；写入即新版本，不就地改写历史；保留最近 N 版（N 默认 3，可配置）。
- **AssignmentEvent**：`assignment-events.jsonl` 仅追加；事件以 `traceId` 串联 `audit-demo.jsonl`。
- **卡片回调**：原始回调（验签通过）写 `card-callbacks.jsonl` 仅追加；业务侧解析后再写 `AssignmentEvent`。
- **卡片状态投影**：`cards/<outTrackId>.json` 由事件流即时折叠产出，作为「当前是否已派发 / 谁已承接 / 谁待响应」的查询缓存；崩溃后可用事件重建，不视为权威数据源。

### 10.4 并发与一致性

- 同进程内不会并发写同一文件，使用单线程异步串行写即可。
- 跨「bot 接收回调」与「Web 工作台保存」两个入口对同一对象写入时，统一通过 repo 层加进程内锁（key 为 `planId` 或 `userId`）。
- 所有写入采用「先写 `.tmp` 再 `fs.rename`」，避免半写文件。
- 卡片回调需做幂等：以 `outTrackId + actionType + actorUserId` 计算 hash，重复回调直接 ack 不重复处理。

### 10.5 隐私与权限

- `employees/`、`events/`、`cards/` 目录与文件统一 `chmod 0750`，只允许 bot 进程用户与 Web 工作台用户读写。
- PII 脱敏沿用现有正则；写入审计与事件流前，对 Markdown / 自由文本字段做脱敏。
- Self-Profile 的原始字段不外发到日志；展示给 LLM 的是压缩画像（§5.2），不直接喂全量。

### 10.6 备份与轮转

- `*.jsonl` 第一版不做自动轮转；通过外部 `BACKUP_DIR` 做日级 rsync 即可（环境变量留口子）。
- 当单个 `*.jsonl` > 100MB 或单类目录文件数 > 5 万时，进入「需要迁库」的预警，但本版不强制。
- 员工档案可单独导出脚本，便于未来一次性迁移到 SQLite / PostgreSQL。

### 10.7 抽象与未来迁移

为避免文件存储的实现细节扩散，新增以下最小 repo 抽象（实现可全为文件 IO，接口面向未来 DB 替换）：

```ts
interface AssignmentDraftRepo {
  save(draft: AssignmentDraft): Promise<void>;
  load(planId: string): Promise<AssignmentDraft | undefined>;
}

interface EmployeeProfileRepo {
  list(filter?: { department?: string; role?: string }): Promise<EmployeeProfile[]>;
  get(userId: string): Promise<EmployeeProfile | undefined>;
  upsertSelfProfile(profile: EmployeeProfile): Promise<void>;        // V1 仅供 seed/导入
  upsertDerivedProfile(userId: string, derived: EmployeeProfile["derived"]): Promise<void>;
}

interface AssignmentEventRepo {
  append(event: AssignmentEvent): Promise<void>;
  listByPlan(planId: string): Promise<AssignmentEvent[]>;            // 用于折叠状态与审计回放
}

interface CardStateRepo {
  upsert(outTrackId: string, projection: Record<string, unknown>): Promise<void>;
  get(outTrackId: string): Promise<Record<string, unknown> | undefined>;
  resolveByPlan(planId: string): Promise<{ outTrackId: string; projection: Record<string, unknown> }[]>;
}
```

业务层禁止直接 `fs.readFile / writeFile` 这些数据；统一走 repo。后续迁 SQLite / PostgreSQL 时，只需替换 repo 实现，不动业务代码。

### 10.8 环境变量补充

新增配置项（默认值与现网风格一致，可在 `.env.example` 中补齐）：

- `ASSIGNMENT_DRAFT_DIR`（默认 `./data/plans`，与 PlanDraft 同目录）
- `EMPLOYEE_PROFILE_DIR`（默认 `./data/employees/profiles`）
- `EMPLOYEE_DERIVED_DIR`（默认 `./data/employees/derived`）
- `EMPLOYEE_FIXTURE_PATH`（默认 `./data/employees/fixtures/seed.json`）
- `ASSIGNMENT_EVENTS_PATH`（默认 `./data/events/assignment-events.jsonl`）
- `CARD_CALLBACKS_PATH`（默认 `./data/events/card-callbacks.jsonl`）
- `CARD_STATE_DIR`（默认 `./data/cards`）
- `BACKUP_DIR`（可选，无默认）

## 11. 审计与可观测

- 所有 Assignment 阶段的 LLM 调用打 `InferenceTrace`，并入 `DemoGenerationMetadata.traces[]`，区分 `phase: "assignment"`。
- 新增段耗时：`assignmentPlanMs / assignmentValidateMs / cardSendMs`，加入 `DemoGenerationTimings`。
- 主管 / 员工的每次卡片操作，写入 `assignment-events.jsonl`，与 `AUDIT_DEMO_JSONL_PATH` 共享 `traceId`。
- Web 工作台所有写操作走同一审计事件流。
- 钉钉消息发送结果（成功 / 限流 / 失败）记入事件，便于失败重试与排障。

## 12. 安全与合规

- 钉钉卡片回调按钉钉文档要求做签名验签、去重、幂等。
- Web 工作台基于钉钉登录态识别用户，不做独立账号；主管 / 员工角色由后端基于发起人 / 候选人列表判定。
- 候选人范围严格基于组织可见性、在职状态、是否拥有钉钉 ID；这些为系统侧硬约束，不交给 LLM。
- 员工能力档案、Track Record、Derived Profile 等存储位置须支持权限隔离，避免普通用户拉取全员数据。
- PII 脱敏规则沿用现网（手机号 / 身份证 / IPv4），同样应用到分配相关 Markdown 与 Web 输出。

## 13. 测试与验收

### 13.1 假数据回归集

- 至少 6 个典型任务样本（生产异常 / 客诉 / 需求落地 / 方案论证 / 设计变更 / 跨域协作）。
- 每个样本期望：模型推荐的责任人合理、给出引用证据、风险提示与员工档案一致、低置信度时给出主管确认问题。

### 13.2 关键测试场景

- 草案出现且员工档案充分时，能产出非空 `AssignmentDraft`。
- 没有合适候选人时，模型输出 `LOW` 置信度并要求主管补充信息，不强行编造推荐。
- 主管在卡片直接 `确认并派发` 后，系统逐人发送承接卡片，状态进入 `DISPATCHED`。
- 主管跳 Web 调整责任人后保存，触发派发，事件流可回放。
- 员工 `确认承接 / 需要修改 / 无法承接` 三态都能被记录并更新主管侧状态。
- LLM 调用失败时返回 `ASSIGNMENT_GENERATION_FAILED`，不使用规则稿替代。
- PII 脱敏在卡片与 Web 输出上都有效。

### 13.3 验收标准

- 主管能在不依赖 Web 的情况下，对中等复杂度任务一键确认并完成派发。
- 至少一类任务上，模型推荐的首选责任人在评测集中的合理率达到内部预设阈值（具体数值在评测建立后确定，不在本设计中硬编码）。
- 主管覆盖推荐时，覆盖原因可在事件流回放，并能用于下一次推荐的上下文。
- 员工承接结果与 Plan 状态机一致；失败重试可保证至少一次到达。

## 14. 风险与缓解

- **模型幻觉指派**：可能推荐不存在或不合适的人。缓解：候选人范围由系统硬约束 + 模型必须引用证据；缺乏证据触发低置信度提示。
- **能力档案污染**：模型推断被误当作员工真实能力。缓解：三层数据分离 + 显式来源标注 + 不允许模型直接修改 Self-Profile。
- **卡片体验过载**：主管不愿意点开复杂卡片。缓解：卡片只放摘要 + 单步按钮，复杂操作跳 Web。
- **与 conversational-intent 设计的耦合**：双轨并行可能在 prompt / schema / dingtalk-bot 上冲突。缓解：**v2.11 已落地**，实施 assignment 前以当前 `main`（或已合并的功能分支）为基线做差异评审，文件层面尽量解耦。
- **隐私与负向标签风险**：拒接率 / 返工率被误用作绩效。缓解：明确数据用途 + 权限隔离 + 不暴露员工排名。
- **假数据失真**：假员工不能代表真实组织能力分布。缓解：第一版只用于验证字段是否够用，结论以「能否产出合理推荐 + 是否需要补字段」为准，不作为模型效果的最终判定。

## 15. 落地分期

### Phase A：依赖对齐 + 假数据集
- **v2.11 conversational intent** 已合并入主线后，复核与本设计接触的 prompt/schema/钉钉渲染差异。
- 设计并生成假员工数据集与压缩画像规则。
- 定义 `AssignmentDraft / AssignmentEvent / EmployeeProfile` 数据契约与 schema。

### Phase B：assignmentRecommender 主链路
- 新增 `src/agent/assignment/` 模块、独立 prompt、schema、coerce、validate。
- DRAFT/REVISE_DRAFT 后异步触发 assignmentRecommender。
- 输出 `AssignmentDraft` 进入审计与会话态。

### Phase C：钉钉卡片 + Web 工作台 MVP
- 新增分配确认卡片、承接卡片、回调处理、`outTrackId` 跟踪。
- Web 工作台：主管分配工作台 + 员工承接补充页 + 审计只读列表。
- 完成端到端：草案 → 推荐 → 主管确认 → 派发 → 员工三态响应。

### Phase D：能力沉淀与回流
- 接入 Track Record 事件流到推荐上下文。
- Derived Profile 离线生成与版本管理。
- 员工申诉接口（最小实现）。

后续阶段（不在本设计范围）：节点反馈、超时升级、验收闭环、OA / 电子签名、外部 Agent 链接、多副本与 Redis 化。

## 16. 参考与延伸

- DingTalk 互动卡片：[发送钉钉互动卡片](https://developers.dingtalk.com/document/robots/send-interactive-dynamic-cards)、[响应互动卡片消息](https://developers.dingtalk.com/document/dingstart/responding-to-interactive-messages)、[任务通知最佳实践](https://developers.dingtalk.com/document/group/best-practices-task-notification)。
- DingTalk 任务管理与会议转任务实践：[Task Management Revolution](https://www.dingtalk-global.com/news/explain/gao-bie-qun-liao-shua-ping-260219)、[Meeting to Tasks Automation](https://www.dingtalk-global.com/en/news/explain/meeting-to-tasks-automation-with-dingtalk-26030567)。
- 企业 Agent 与人岗匹配方向：StackAI 多 Agent 工作流指南、Salesforce 企业 Agent 经验、人岗匹配 2.0 / 技能图谱实践（2026 中文资料）。

> 本文档为草案。`2026-05-09-conversational-intent-agent-redesign` 对应能力已在 Demo 实现；启动 assignment 实施前请对照 **`AGENTS.md`** 与 **`docs/Qwen-接入实施说明.md`** 做接触面核对，再基于本文档转入 `writing-plans` 流程，产出可执行的实施计划。
