---
status: local-real-ai-integration
last_verified_at: 2026-09-09
scope: ma-assessment-and-tong-initial-analysis
---

# 新版工作台接入原系统 AI

FR-AI-CONNECT-01：马荣鑫“AI 研判”和佟成“AI 质量初析”调用原系统模型；禁止用定时器或固定文本返回生成结果。保留已评审的布局、人工草稿与历史版本。

## 启动与源码

在 `.worktrees/tong-quality-prototype` 运行 `node --import tsx scripts/quality-ui-ai-server.mjs`，同时提供：

- `http://127.0.0.1:8808/ma-workbench/`：本目录下的马荣鑫修改版。
- `http://127.0.0.1:8809/?record=a4&tab=analysis`：佟成初析。

先停止这两个端口原先的静态服务器。只绑定 `127.0.0.1`，不用于公网部署。

`scripts/quality-ui-ai-runtime.mjs` 从 `QUALITY_ORIGINAL_SYSTEM_ROOT` 加载原系统模块；默认是相邻 `yesterday-admin-test-actors` 工作树（8797 原系统所在目录）。该源码目录及其依赖需保留。密钥只从原系统 `.env` / 进程环境读取，不返回浏览器。没有配置时失败，不回退模拟结果。

这次复用原系统 AI 模块，并非代理原系统带会话的业务 HTTP 接口：

- 马荣鑫：`prepareAiOriginalAssessmentV0WithHistoricalRetrieval` → `QwenAiOriginalAssessmentModel` → `runAiOriginalAssessmentV0` 原有 Schema 与业务校验；真实历史案例检索，无匹配时不伪造案例。
- 佟成：按原系统 `qualityAnalysisInputSchema` 构造快照 → `QwenQualityAnalysisModel` → `validateQualityAnalysisOutput`；使用原提示词、分类知识与只读分类约束。
- 原页面及业务 HTTP、SQLite、权限与通知保持原状。输入为新版当前样例资料，不把 a4 等样例 ID 当成正式事件 ID。

## 本地 API 与审计

- `GET /api/quality-ui/status`：仅公开是否配置、模型和规则版本，不公开密钥或环境变量。
- `POST /api/quality-ui/assessment`：`requestId`（UUID）+ `source` 快照，返回真实研判、引用案例及调用元信息。
- `POST /api/quality-ui/initial-analysis`：另加已确认通报背景、上游旧样例建议、附件人工说明。旧上游 AI 标为未验证样例；不假装已生成真实上游建议。

状态为 `GENERATING → SUCCEEDED | FAILED`。`requestId` + 输入摘要幂等；并发重试复用同一 Promise；相同 ID 不同输入返回 409；最多同时 2 个调用。服务重启时已完成结果可恢复，未完成请求明确标为中断，不偷偷再次调用模型。

`data/quality-ui-ai/attempts.jsonl` 记录请求编号、输入快照与摘要、来源版本、开始/完成时间、状态、校验后的原始输入输出、模型、提示词版本、Token 与耗时。属于独立本地 AI 审计，**不是**正式质量业务表。原始提供商错误文本不回传或写入日志，防止暴露配置。数据目录被项目 `.gitignore` 排除。

API 限定本机 Host/同源 Origin、JSON POST、128 KiB 请求上限与严格字段校验。静态文件限制在两处页面目录，`.env`、服务端脚本和审计文件不对浏览器开放。

## 交互与迁移

- 两页 `ai-connected.js` 将按钮绑定到真实请求；原固定生成函数仅作为旧原型历史材料保留，不再是线上按钮的执行路径。
- 来源、AI 原稿、人工修改独立；重新生成不会覆盖人工草稿。采纳初析前保留旧人工草稿副本。
- 页面刷新可恢复未完成的同一请求，不重复消耗模型；真实建议和人工草稿保存在浏览器，完整 AI 记录保存在本地服务。
- 历史样例不删除，显示“历史演示记录”；新结果明确显示真实 AI、模型、请求编号、时间与提示词版本。不展示未经校准的准确率或编造证据强度。
- 建议总日期按生成日期 + 模型建议天数换算，正式日期仍由人工确认。
- 两页顶栏明确：事件、部门和附件仍是样例。OA 评论、正式分配和推送仍是原先的本地交互；本次未接业务数据/身份，也不读取附件正文。

原马荣鑫参考目录完全保留；佟成改动前文件保存在 `../tong-workbench-20260908/revisions/before-real-ai/`。

## 验证记录

2026-09-09 在用户本地浏览器点击真实按钮：

- 马荣鑫 a2 首次生成：请求 `6f52e106-6997-41c7-ab75-c9e2661ee370`，`qwen3.6-plus`，3290 Token，9209 ms。
- 马荣鑫 a2 重新生成：请求 `21b208db-2589-4414-9d1a-f5391ca169c4`，同模型，3351 Token，10176 ms；V1/V2 都可查，已编辑的人工结论保留，刷新后仍在。
- 佟成 a4：请求 `19d94cb2-de87-48d9-8f05-9da903f67452`，同模型，2671 Token，19406 ms；生成期间编辑问题方向并刷新，只有一条实际调用，人工内容保持原样；主动预填后旧稿可查，分类只读、部门仍需选择，建议日期为 2026-09-19。
- 浏览器脚本错误日志为空；真实生成与采纳路径使用原校验结果，没有固定结果回退。
- 两页均检查 1366×768 与 1920×1080：正文和模型长文本正常换行，页面 `scrollWidth` 与 `clientWidth` 一致，无横向溢出；检查后已恢复原窗口尺寸。
- `node --test tests/web/quality-ui-ai-http.test.mjs`：4 项通过，覆盖并发/重启幂等、失败不伪造结果且不泄密、跨站/输入/方法拒绝、未完成请求重启后不偷偷重跑。
- 新增 JS/MJS 均通过 `node --check`。原业务代码未修改，不宣称完整业务回归或生产部署完成。
