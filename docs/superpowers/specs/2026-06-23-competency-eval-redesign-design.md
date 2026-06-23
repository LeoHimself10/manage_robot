# 能力评估模块重新设计

**日期：** 2026-06-23
**状态：** 已批准

---

## 1. 背景与问题

### 现有设计的问题

原实现采用 "Rubric"（能力标准文档）路线：

- 主管必须上传能力标准文档（.md/.docx）
- AI 从文档中提取"维度"（Competency Dimension）
- AI 按预设维度组织输出

**问题：**

- 研发主管没有固定评价体系——这是辅助判断工具，不是绩效考核系统
- Rubric 文档是摩擦，不是帮助
- 预设维度限制了 AI 发现人复杂性的能力
- "维度对齐"这个概念本身就是枷锁

### 正确的设计假设

- **唯一数据源**：钉钉日报（已过滤空模块）
- **岗位要求文档**：可选背景上下文，不是评价框架
- **输出结构**：由问题驱动，不预设板块
- **评估性质**：纯定性，辅助主管判断，不打 KPI 分

---

## 2. 核心理念

| 旧（Rubric路线） | 新（自由分析路线） |
|----------------|-----------------|
| 上传能力标准文档 | 上传岗位要求（可选背景） |
| 按预设维度组织输出 | 输出结构由问题驱动 |
| 需要维度对齐才能评估 | 直接基于日报+问题分析 |
| 20轮历史上限 | 历史轮数不受限制 |

---

## 3. 对话流程

```
主管打开页面
    ↓
空状态提示："可上传岗位要求，然后提问"
    ↓
主管提问："评张三最近30天"
    ↓
AI 调用 search_employees("张三") 获取 userId
AI 调用 get_employee_daily_reports(userId, 近30天)
    ↓
（如有岗位要求）附加到 context 作为背景
    ↓
AI 自由分析，输出由问题决定结构
（例："评张三" → 优势/观察/建议；"时间分配" → 按项目分布）
    ↓
流式返回，主管阅读
```

---

## 4. 证据层保证

### 日报读取

- 通过 `get_employee_daily_reports` 读取
- **空模块已被过滤**：`filterReportContentsWithBody` 在格式化时丢弃空字段
- 安全截断：`COMPETENCY_EVAL_REPORT_MAX_CHARS`（48000字）作为保护，不频繁触发

### 约束

- **只读日报**：AI 只能基于日报证据分析
- **不虚构**：prompt 明确要求基于证据
- **纯定性**：不打分，不做硬性排序

---

## 5. 岗位要求 vs. Rubric 的本质区别

| 类型 | 作用 | AI 行为 |
|------|------|--------|
| Rubric（能力标准） | 评价维度，强制对齐 | 枷锁 |
| 岗位要求 | 背景上下文，帮助理解岗位 | 工具（可选）|

上传岗位要求 → AI 更理解 context
未上传 → AI 只基于日报分析

两者输出均自由，不强制按文档结构。

---

## 6. UI 变化

| 元素 | 现状 | 改为 |
|------|------|------|
| Topbar 按钮 | "上传标准" | "岗位要求" |
| Topbar Banner | rubric 维度数 | 岗位要求文件名（已上传时） |
| 空状态标题 | "今天想评估谁？" | 保持 |
| 空状态描述 | "先上传能力标准文档..." | "可上传岗位要求，然后开始提问..." |
| 引导 chips | 固定示例 | 可保留，帮助新用户理解 |

---

## 7. API 变化

### 删除的端点

- `POST /rubrics/upload`
- `GET /rubrics`
- `DELETE /rubrics/:id`
- `GET /rubrics/:id`

### 修改的端点

- `PUT /sessions/:id` — 去掉 `activeRubricId`、`rubricTitle`、`rubricDimCount` 字段
- `GET /sessions` — 同上

### 新增端点

- `POST /job-req/upload` — 上传岗位要求文档（会话级）

---

## 8. 工具链变化（AI Agent）

### 删除的工具

- `list_rubrics`
- `get_rubric`

### 保留的工具

- `search_employees` — 按姓名查 userId
- `get_employee_daily_reports` — 读日报（description 去掉 "对照 rubric 维度"）

---

## 9. 代码删除清单

| 文件 | 变化 |
|------|------|
| `src/agent/competency-eval/rubric-store.ts` | 删除 |
| `src/agent/competency-eval/rubric-extract.ts` | 删除 |
| `src/agent/tools/competency-eval-tools.ts` | 删除 rubric 相关工具定义和 handler |
| `src/agent/competency-eval/competency-eval-agent-turn.ts` | 删除 `buildCompetencyEvalContextPrefix` 中的 rubric 注入逻辑 |

---

## 10. 保留的能力

- 多会话侧栏（主管可对比不同员工）
- SSE 流式输出
- Session 持久化（服务器端）
- 移动端适配
- `COMPETENCY_EVAL_CHAT_HISTORY_MAX_TURNS` 可考虑移除或提高

---

## 11. 下一步

进入实现计划阶段。
