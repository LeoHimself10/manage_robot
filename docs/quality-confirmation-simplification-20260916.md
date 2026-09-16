# 初析取消修改原因与正式确认说明

last_verified_at: 2026-09-16
release: quality-test-confirm-20260916-r12

FR-QS-07：按用户截图要求，取消佟成初析编辑页面的“修改原因与正式确认说明”整段，包括提示、输入框和必填错误；无说明时可以保存并正式确认初析，修改 AI 内容后也不再要求另填说明。

前端删除该区块和对应校验；确认 API 的 modificationReason 改为可省略或空串，领域服务同样兼容省略值。未填说明保存为空，不自动生成“已核对”等代填内容。旧草稿说明仍保留，历史正式版本中的非空说明可只读查看。

原确认动作、正式版本、AI 差异、确认人和时间、审计事件仍保留。无数据库迁移、无历史数据删除、无状态机变化。主管研判修改原因的规则不受本次初析调整影响。附件人工说明保持原有可选行为。

源码：`public/quality/tong/ai-initial-analysis.js`、`src/quality/analysis/quality-analysis-contracts.ts`、`src/quality/analysis/quality-analysis-service.ts`。

验证：TypeScript 通过；初析服务 7 项回归通过，覆盖说明省略/空串时生成、保存、API 合同校验、正式确认及移交，AI 快照保持不变；已有带说明版本与修订回归通过。1366×768 和 1920×1080 实际页面校验通过：区块和字段消失，选择部门及成果后无需说明即可通过确认校验，无脚本错误。

部署目标为独立质量测试容器 manage-robot-quality-cao（8092），发布前备份 SQLite；发行 534 文件哈希验证。回滚镜像为 manage-robot:quality-test-dialog-20260916-r11。

现场结果：r12 已发布，健康检查及公网版本响应头一致；容器内 534 文件哈希通过，发布前后正式任务、事件、AI 快照、初析、证据和审计校验一致。
