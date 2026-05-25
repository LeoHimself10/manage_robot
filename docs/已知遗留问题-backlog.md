# 已知遗留问题（Backlog）

> 记录在 assignee / publish triage 与 prompt v5.23.x 本轮工作中发现、**尚未解决**或**刻意延后**的事项。  
> 不作为当前迭代的交付范围；按「建议归档去向」独立排期或等 telemetry / 真实反馈后再评估。

**最后更新**：2026-05-22

---

## 总览

| 编号 | 问题 | 现状 / 临时影响 | 暂不做的原因 | 建议归档去向 |
|------|------|-----------------|--------------|--------------|
| M-1 | legacy demo planner 与 orchestrator 行为漂移 | CLI / Vitest / 旧 eval 用 `createTaskPlanningDemo` + `generateStructuredPlan` + `legacy-demo-planner-v1`；线上钉钉不走 | 删除范围大（约 10 个文件 + 大量单测），与本轮 P0 修不耦合；删错可能掩盖回归 | 独立 PR：删 pipeline / qwen-planner / demo.ts / demo-eval.ts / qwen-scenarios / pipeline.test.ts，并补 orchestrator 等价测试 |
| M-2 | user 级 knownFacts 缺失 | 跨任务的用户偏好（如「我喜欢 5 天截止」）无法长期记忆，每次新任务重述 | 与「工具纪律 + scope_only」一致；用户没直接反馈「忘事」前不升级 | 等真实反馈出现再评估加 `scope: "user"` 参数 |
| M-3 | C-3 工作台筛选排序 | 主管侧任务列表筛选/排序欠缺 | 与本次 assignee/publish triage 无关 | 工作台 v1.x 独立工单 |
| M-4 | DISCUSS 模式 / 6 阶段是否够用 | D-5 现有 CLARIFY/QUERY cover 住了，没崩；但模式枚举留有「探索性提问」灰区 | 加新模式会触发 prompt 大改 + eval 全跑；未见实质坏处 | 后续若再观察到模型在「探索/案例咨询」语境表现不稳，重新评估 |
| M-5 | 工具按模式硬白名单 | 当前靠 prompt + `ok:false` 软约束 | 与 ReAct 单次 `callWithTools` 主循环冲突；模式自报有鸡生蛋；DRAFT+ASSIGN 同句难命中 | 若半年内 prompt 仍守不住编造姓名/越权调用，再考虑按 mode 切 registry |
| M-6 | `draftLikeMessageWithoutJson` 误警 | message 出现「草案/生成」几个字就告警，但实际未输出 draft（D-5 即此误警） | 不是真问题；本轮 prompt 改完后误警率会变 | 等 v5.23.8 上线后看新一轮 telemetry，再调阈值/移除该项 |
| M-7 | `telemetry.modeOpsInSameTurn = ["clarify","assign"]` 的边界语义 | 同句 DRAFT+ASSIGN 时 telemetry 含 clarify 是否合理未定义 | 不影响行为，仅影响监控分类 | telemetry 重整时一并梳理 |
| M-8 | prompt 里 ASSIGN 示例的真 userId（641728622 张三） | 直接成了 B-1「抄 ID 配假名」的素材源 | 本轮已在「ASSIGN 示例改用占位符」里覆盖，但整个 prompt 全文 / fixtures / 评测样本还需要 sweep | 计入 prompt-v5232 但单列一项「全仓 grep 真 userId 替换占位符」 |
| M-9 | publish 后 `session.latestDraft` / `latestAssignment` 是否清空 vs 归档 | 当前是 scope 归档（rotate planId），保留旧 scope 内容 | 与本轮「工作台改派单源 SQLite」决定相容，但归档生命周期没明确 | 后续如果发现 disk 涨太快或归档被误读，再加 TTL |
| M-10 | 发起人白名单 `TASK_INITIATOR_USER_IDS` 在 dingtalk-bot 主链路未生效 | AGENTS.md 已注明；安全风险低（仅控制谁能发起任务） | 与 assignee/publish triage 不同条线 | 安全工单独立处理 |
| M-11 | `getContact` 仅验「ID 在不在通讯录」，没验 displayName 一致性 | 本轮通过 search 缓存解决了「假名假 ID」组合，但真名+错 ID 仍可绕过（概率低） | 加 displayName 一致性校验需要 prompt 与 search 返回结构同步改 | 跟进任务：`update_draft_task` 时若 `patch.assigneeDisplayName` 与 contact 不一致 → `ok:false` `displayname_mismatch` |
| M-12 | `prepare_publish_task` 一直允许模型在参数里传 subtasks | 这是 B-2 prepare 洗字段的入口；本轮改为从 session 组装后该入口「形式存在但被忽略」 | 本轮先让「传了也不生效」；schema 移除参数会破坏既有调用方契约 | 后续 prompt 稳定一段时间后，从 schema 移除 subtasks 参数，让「传了就报错」更显式 |
| M-13 | ASSIGN 阶段多 subtask **逐条 `search_employees` / `update_draft_task` 循环**（W10） | 有 8–12 条 `latestDraft` 时点将，模型常逐条 patch，4 次上限后仍口播已指派；eval W10 曾仅断言 search 即 PASS | **已修复（2026-05-22）**：`bulk_assign_tasks` + `requireFullCoverage` 全量 gate + reconcile + `eval:assignment-gate` / 收紧 W10·M1（去掉 inject）；prompt v5.23.9 |

---

## 分项说明

### M-1 — legacy demo planner 与 orchestrator 行为漂移

- **双轨**：`legacy-demo-planner-v1`（`generateStructuredPlan`）vs 线上 `orchestrator-agent-v5.23.x`（`runOrchestrator`）。
- **风险**：删 demo pipeline 时需用 orchestrator 等价测试兜住 CLI / Vitest / eval 回归。

### M-2 — user 级 knownFacts

- 当前 `knownFacts` 按 task scope 维护；跨 planId 的用户偏好无法复用。
- 若升级，需评估 `update_known_facts` 的 `scope: "user"` 与会话存储边界。

### M-3 — 工作台筛选排序（C-3）

- 主管任务列表 UX；与 harness 主链路解耦。

### M-4 — DISCUSS / 模式阶段数

- 观察项：探索性、案例咨询类对话是否需独立模式。
- 触发条件：eval 或线上出现 CLARIFY/QUERY 覆盖不足的案例。

### M-5 — 按模式硬切工具 registry

- 与「模式名是 JSON 意图、不是 tool_calls 函数名」及 DRAFT+ASSIGN 同句叠加的设计张力见 AGENTS.md。
- 备选：半年观察期后按 `mode` 动态 `registry`。

### M-6 — `draftLikeMessageWithoutJson` 误警

- D-5 类：自然语言含「草案」字样但未落 JSON `draft`。
- 行动：v5.23.8 telemetry 后再调告警规则。

### M-7 — `modeOpsInSameTurn` 语义

- 纯可观测性；不影响发布/改派行为。
- 与 telemetry 大盘重整同批处理。

### M-8 — 真 userId 残留 sweep

- 已知示例 ID：`641728622`（张三）曾出现在 ASSIGN 示例。
- **动作**：全仓 grep 真 userId → 占位符；覆盖 prompt、fixtures、eval 样本。

### M-9 — publish 后会话草案生命周期

- 现状：`planId` rotate + `taskScopes` 归档，旧 scope 保留 `latestDraft` / `latestAssignment`。
- 触发 TTL：磁盘增长或模型/工具误读旧 scope。

### M-10 — 发起人白名单未接入

- 配置：`TASK_INITIATOR_USER_IDS` / `TASK_INITIATOR_IDS_FILE`（见 `src/security/initiator-whitelist.ts`）。
- `dingtalk-bot` 主链路暂未调用；独立安全工单接入。

### M-11 — displayName 与通讯录 ID 一致性

- search 缓存缓解 B-1 类「假名假 ID」；真名+错 ID 仍可能通过 `getContact`。
- 建议守卫：`update_draft_task` → `displayname_mismatch`。

### M-12 — `prepare_publish_task` 的 subtasks 参数

- 本轮：参数可传但被忽略，权威子任务来自 session。
- 远期：从 tool schema 移除 `subtasks`，传参即结构化错误。

### M-13 — ASSIGN 多 subtask 逐条 search（W10）

- **现象**：用户「请你点将 / 质量部 SMT 优先」时，模型对每条子任务单独 `search_employees`，而非 1–2 次 department browse + 顶层 `assignment.assignments[]` 一次写完。
- **与 M-5 区别**：M-5 是「要不要按模式硬切 registry」；M-13 是 **ASSIGN 批量 JSON 纪律**在多条 draft 下失效，加 search quota 只会更早失败，不教模型正确路径。
- **已有纪律（未足够）**：prompt v5.23.8「≤2 search + 1 get_employee_details + 禁止 per-task 循环」；`assignAction` memory hint；`update_draft_task` >4 次软拒。
- **建议修复方向（未排期）**：
  1. Prompt：ASSIGN 对标 PUBLISH 两回合（工具回合 ≤2 search → 终局 JSON 无 tool_calls）；补充「N 条 draft → assignment N 行」示例与反例。
  2. Memory hint：`latestDraft.tasks.length > 4` 时注入 `assignBulk` 条数约束。
  3. Tool 引导：`search_employees` browse 模式返回「请一次 assignment JSON 覆盖全部 taskId」hint（非门禁）。
  4. 姓名列表场景继续走 `resolve_roster_names` → `set_candidate_pool`，避免逐条 search。
- **明确不做**：再降 `SEARCH_EMPLOYEES_PER_ORCHESTRATOR_QUOTA`；ASSIGN 回合硬 `maxIterations=2` 截断。

---

## 相关文档

- [AGENTS.md](../AGENTS.md) — 现网架构与已知边界（含 M-10 注记）
- [workbench-manager-profile-verify-deferred.md](./workbench-manager-profile-verify-deferred.md) — 另一类 deferred 能力示例
- [harness-pipeline-refactor-plan.md](./harness-pipeline-refactor-plan.md) — pipeline 薄封装与 M-1 删除范围参考
