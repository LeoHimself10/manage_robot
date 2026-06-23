# 能力评估助手（Competency Eval）设计

> 状态：已定稿 · 2026-06-23  
> 受众：曹一挥（主管能力复盘/辅导）；实现于 `manage_robot` 明思实例（mingsibot）

## 1. 背景与目标

曹一挥需要基于**可演进的多份能力标准文档**（如《优秀测试主管的 6 大特征》）与员工**钉钉日报/工作日志**，对下属测试主管或骨干做**定性能力评估**（非交付 KPI）。

| 维度 | 说明 |
|------|------|
| 主用户 | 曹一挥（userid `01451725613871`） |
| 使用场景 | 上级定期（月/季）评估下属（选 A） |
| 日志来源 | 钉钉日报（`daily-report-digest` / `dingtalk-report-client`） |
| Rubric | 多份文档（选 C）；**曹一挥自己上传**（md / docx），系统自动从文档提取维度 |
| 报告留存 | 不长期落库；每次按需重新生成（选 A） |
| 交互 | **纯聊天**（选 A），像「带 skill 的 ChatGPT」 |
| 交付入口 | MVP：工作台聊天页；钉钉摘要+深链为二期 |

与「交付绩效看板」区分：绩效看板是准时率/迟交等**量化 KPI**；本功能是**能力维度 + 日志证据**的定性评估。

## 2. 非目标

- 不作为 HR 正式考核或员工排名系统
- MVP 不做 rubric 富文本在线编辑器（改标准 = 重新上传文件）
- MVP 不做评估报告历史库
- 不把 Cursor/Claude Code CLI 作为生产钉钉中台
- 不接入任务 `progress_note`（三期可加）

## 3. 曹一挥怎么用（产品视角）

1. 打开工作台「能力评估」→ **只有一个聊天界面**（无填表 wizard）
2. 点 **📎 上传** md 或 Word → 系统提示「已加载《xxx》，识别到 6 个评估维度」
3. 在输入框用自然语言：
   - 「用这份标准评张三最近 30 天」
   - 「换李四，还是最近两周」
   - 「第 3 条在日志里有证据吗？」
4. 助手返回 Markdown 报告，可继续追问
5. 可上传多份标准；对话中说「换成测试工程师那份」或重新上传新版
6. **报告不存档**；关闭页或刷新后需重新生成；**上传的标准文件会保留**

## 4. 架构

```
聊天页（仅白名单）
  → POST upload（存 rubric 文件 + 自动提取维度）
  → POST chat（message + activeRubricId + conversationHistory）
  → runCompetencyEvalTurn（仿 performance-agent-turn）
  → promptProfile / toolProfile = competency_eval
  → tools + dingtalk-report-client
  → 流式 Markdown 回复
```

- **模块**：`src/agent/competency-eval/`
- **存储**：`data/competency-eval/users/{userId}/rubrics/{rubricId}/`（原文 + 提取缓存）
- **实例**：mingsibot
- **隔离**：不接任务 orchestrator、不动主线程草案

## 5. 开放权限

### 5.1 MVP 开放给谁

```bash
COMPETENCY_EVAL_ENABLED=1
COMPETENCY_EVAL_USER_IDS=01451725613871,641871342
```

| 用户 | MVP |
|------|-----|
| 曹一挥（01451725613871） | ✅ 白名单 |
| 姚凯珩（641871342） | ✅ 白名单 |
| admin / 其他主管 / 员工 | ❌ 默认 403 |

即使 `canAccessAdmin`，未在白名单仍不可访问。侧栏入口仅白名单可见。

### 5.2 被评估人范围

- `search_employees`：通讯录搜人
- `get_employee_daily_reports`：**仅** `daily-report-digest.config.json` 日报名单内 userid
- 名单外：tool 软失败，不泄露日报

### 5.3 Rubric 文件权限

- 上传 / 列表 / 删除：**仅 rubric 所属 userId**（本人）
- 不可读他人上传的标准

## 6. Rubric：上传 + 自动提取

### 6.1 上传

- API：`POST /api/workbench/competency-eval/rubrics/upload`（multipart，仿 `upload-roster`）
- 格式 MVP：**`.md`、`.docx`**（docx 用现有文本提取能力）
- 限制：单文件 ≤ 2MB；每用户最多 20 份（可 env 配置）

### 6.2 提取（上传后立即执行）

1. 从文档读纯文本
2. **规则解析**：`## 1）…` 等主维度、文首表头列
3. 维度 &lt; 2 时：**一次 LLM 结构化提取**兜底
4. 写入同目录 `extracted.json` + 保留 `source.md` 或 `source.docx`

### 6.3 对话中怎么用

- 前端维护 `activeRubricId`（最近上传或用户指定）
- 每条 chat 请求带 `activeRubricId`；服务端注入 `[context]`
- Agent 通过 `get_rubric` 取全文 + 维度列表；按维度对照日志

### 6.4 可选默认标准

- 可预置 `data/competency-eval/defaults/测试主管.md` 供首次进入时一键「使用示例标准」（非必须）

## 7. 日志数据

- Tool `get_employee_daily_reports(userId, startYmd, endYmd)`
- 复用 `dingtalk-report-client`；默认窗口 30 天（用户可在自然语言中指定）
- 无日报：标注「该时段无日志」，禁止编造

## 8. Agent

- Tools：`list_rubrics`, `get_rubric`, `get_employee_daily_reports`, `search_employees`, `get_current_time`
- 不做任务发放/改派/催办
- 输出：总览 + 分维度表格 + 综合建议；表头跟提取结果
- `maxToolIterations` ≈ 4–6

## 9. 聊天 UI

- 路径：`/workbench/manager/competency-eval`
- 布局：仿绩效页 `perf-chat-card`（单栏聊天 + 底部输入 + 📎 上传）
- 上传后气泡提示已加载标准；chip 示例：「评张三最近 30 天」
- `conversationHistory` 存在**浏览器**（同绩效 chat），刷新清空；**不落 SQLite**
- 流式输出 + Markdown 渲染

## 10. 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `COMPETENCY_EVAL_ENABLED` | `0` | 实例开关 |
| `COMPETENCY_EVAL_USER_IDS` | 空 | 白名单 |
| `COMPETENCY_EVAL_DEFAULT_WINDOW_DAYS` | `30` | 默认日志窗口 |
| `COMPETENCY_EVAL_REPORT_MAX_CHARS` | `48000` | 日志注入上限 |
| `COMPETENCY_EVAL_MAX_RUBRICS_PER_USER` | `20` | 上传份数上限 |

## 11. 验收标准（MVP）

- [ ] 仅曹一挥可见入口并可聊天；其他人 403
- [ ] 可上传 md/docx，自动识别 ≥6 维度（测试主管样例）
- [ ] 自然语言触发评人 + 拉日报 + 结构化报告
- [ ] 名单外员工拉日报失败
- [ ] 评估报告不写 SQLite；上传的标准文件持久化在用户目录
- [ ] 与任务 orchestrator 无交叉

## 12. 里程碑

| 阶段 | 内容 |
|------|------|
| MVP | 纯聊天 + 上传 rubric + 隔离 Agent + 白名单 |
| 二期 | 钉钉摘要 + 深链 |
| 三期 | 任务进展 note；多用户白名单运营化 |
