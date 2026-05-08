# Agent 成熟度评估与下一步建议

## 当前水平定位

如果用一个通用的 AI Agent 成熟度模型来衡量：

| 层级 | 定义 | 你的系统 |
|------|------|---------|
| L1: Responder | 单次 LLM 调用，无迭代，无状态 | — |
| L2: Structured Agent | 结构化输出 + 自纠正 + 基础状态管理 | **你现在在这里** |
| L3: Tool-using Agent | 多工具编排 + RAG 记忆 + 动态规划 | 下一步 |
| L4: Autonomous Agent | 目标驱动的自主行为 + 经验学习 | 远期 |

**你现在是一个扎实的 L2 Agent**——而且不是 Demo 级别的 L2。有自纠正循环、有 session 记忆、有审计追溯、有门禁校验、有安全护栏、有可观测性。放在企业内部工具这个品类里，已经超过了 90% 的 MVP。

但 L2 的核心局限也很明确：**LLM 只能"想"，不能"做"。** 你的 Agent 可以规划一个任务包，但它不能查 HR 系统找到合适的承接人、不能翻历史 plan 找类似案例、不能在截止日期前主动提醒。它被困在 prompt→JSON→渲染 这个单行道里。

---

## 下一步的三个关键缺口

### 缺口一：工具调用（Tool Use / Function Calling）

**现状：** 系统只有一个工具——Qwen LLM。Pipeline 是硬编码的串行链路，LLM 不参与工具选择。

**为什么重要：** Agent 区别于 Chatbot 的本质特征是"能做事"。当前系统生成的 plan 里写了 assignee、写了 due date、写了提醒频率——但这些字段是 LLM 凭空编的，因为没有工具去查询真实的 HR 系统或日历。

**具体建议：**

1. **引入 function calling 机制**：让 LLM 在生成 plan 时主动调用工具获取真实数据。例如：
   - `search_assignee(skill: string)` → 查 HR 系统返回匹配的工程师
   - `check_calendar(userId: string, date: string)` → 查此人是否在岗
   - `lookup_similar_plans(keywords: string[])` → 检索历史 plan 作为参考

2. **工具注册表**：`src/agent/tools/` 目录，每个工具一个文件，统一接口：
   ```typescript
   interface AgentTool {
     name: string;
     description: string;        // for LLM function calling
     parameters: JSONSchema;     // for LLM function calling
     execute(args: unknown): Promise<unknown>;
   }
   ```

3. **两阶段生成**：Plan 生成从单次 LLM 调用变成"信息收集 → 规划生成"两个阶段：
   - 阶段 1：LLM 调用工具收集必要信息（HR、日历、历史案例）
   - 阶段 2：基于收集到的真实数据生成 plan

4. **不要过度设计**：先做一个工具（比如"查 HR 推荐人"，哪怕返回 mock 数据），跑通 function calling 的完整链路，再扩展。

**预期效果：** plan 里的 assignee 是真实的人、due date 避开假期、有历史案例参考。执行层从 6.5 → 7.5。

---

### 缺口二：长期记忆与检索（RAG Memory）

**现状：** 有 session 级短期记忆（30 分钟 TTL），有 Plan 快照文件存储。但没有检索能力——过去的 plan 存在磁盘上，LLM 看不到。

**为什么重要：** 你的 Plan 快照已经在存了（`plan-store.ts` 写 JSON 文件）。但这些文件只是一堆散落的 JSON，没有被索引、不能被搜索、不能在新任务规划时作为参考。一个做了 100 次规划的 bot 和一个刚启动的 bot，表现完全一样——这浪费了积累的数据。

**具体建议：**

1. **从文件到嵌入**：不需要马上上向量数据库。先用一个轻量方案：
   - 每次 `DRAFT_READY` 时，除了存 JSON 快照，额外把 `background + classification + tasks summary` 拼接成一个文本块
   - 用 Qwen 的 embedding API（DashScope 支持 `text-embedding-v3`）生成向量
   - 存在本地的 SQLite + `sqlite-vec` 扩展 或简单的 JSON 文件 + 暴力余弦相似度

2. **检索增强生成**：在新 plan 生成前，用用户输入做 embedding 检索 top-3 相似历史 plan，注入 prompt：
   ```
   ## 历史相似案例（仅供参考，请勿照搬）
   1. [2026-05-03] A 产品批次异常 — 3 个任务包 — 承接人：张三
   2. [2026-04-28] B 设备 V&V 方案 — 2 个任务包 — 承接人：李四
   ```

3. **反馈闭环**：记录哪些 plan 实际被执行了（accepted）、哪些被拒绝了（rejected/changed），用于后续推荐排序。

**预期效果：** 记忆从 5.0 → 7.0。bot 越用越聪明，历史经验可复用。

---

### 缺口三：多步规划与动态重规划

**现状：** 单次 prompt 生成完整 plan。没有分解、没有中间步骤、没有重规划能力。

**为什么重要：** 复杂任务（比如"A 产品批次召回方案"）可能需要 10+ 个 task，涉及多部门协作。一次性生成全部 task 质量不稳定，LLM 容易在后期 task 上偷懒。分步生成 + 每步校验，质量更高。

**具体建议：**

1. **两阶段规划**：先让 LLM 输出"任务框架"（3-5 个高层目标），用户确认后，再逐个展开为详细 task package。这不增加 LLM 调用次数（总 token 可能还更少），但每步的注意力更集中。

2. **动态重规划**：当执行中出现变化（承接人拒绝、超时未反馈），不要从头重新生成整个 plan，而是让 LLM 做局部修正："task_3 的张工拒绝了，请从以下备选人中重新分配，只修改 task_3 的 assignee 和时间节点。"

3. **CoT 提示词**：不改变代码，只在 prompt 中增加推理链指令：
   ```
   请按以下步骤思考（不要在最终 JSON 中输出推理过程）：
   1. 这个任务的领域是 QUALITY 还是 RD？为什么？
   2. 最关键的 1-3 个子任务是什么？
   3. 每个子任务的交付物和完成标准分别是什么？
   4. 检查每个子任务是否满足门禁四要素。
   然后一次性输出完整 JSON。
   ```

**预期效果：** 规划能力从 6.5 → 7.5。

---

## 实施优先级

不需要同时做三件事。建议按这个顺序：

| 优先级 | 事项 | 工作量 | 影响维度 | 理由 |
|--------|------|--------|---------|------|
| **P0** | CoT 提示词升级 | 0.5h | 规划 6.5→7.0 | 零代码改动，纯 prompt 工程，立刻见效 |
| **P0** | 单工具 function calling 跑通 | 3h | 执行 6.5→7.0 | 哪怕只加一个 mock 工具，打通工具调用链路是质变 |
| **P1** | 两阶段规划（框架 → 展开） | 2h | 规划 7.0→7.5 | 复杂任务质量提升，token 消耗不增加 |
| **P1** | 轻量 RAG（embedding + top-3 检索） | 4h | 记忆 5.0→6.5 | 需要调 embedding API + SQLite，但逻辑清晰 |
| **P2** | 动态重规划 | 3h | 规划 7.5→8.0 | 依赖工具链路和 RAG 先跑通 |
| **P2** | 工具扩展到真实 HR/日历 | 取决于外部 API | 执行 7.0→7.5 | 依赖外部系统对接 |

---

## 总结

你现在有一个**工程上很扎实的 L2 Agent**——这是我见过的企业内部 bot 项目里，代码质量和架构演进做得最好的之一。四轮重构从 31:1 规则/LLM 比到现在的全 LLM-led + 完整 infra，每一步方向都对。

接下来的路不是"继续优化 pipeline"，而是**让 Agent 从"能想"变成"能做"**。三个关键词：**工具调用**、**长期记忆**、**动态规划**。先做 CoT prompt（零成本见效），然后打通 function calling 链路（哪怕只加一个 mock 工具），就是 L2→L3 的关键一步。
