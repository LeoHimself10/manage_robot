# 主管待分派事件不可见修复 r13

last_verified_at: 2026-09-17
release: quality-test-handoff-20260917-r13

FR-QH-01：佟成确认初析并移交后，接收主管必须能在质量列表和“待分派员工”中看到事件、打开详情，并进入已保存的原任务分配侧会话。

根因：正式初析及 quality_analysis_handoffs 已成功落库，但新版角色投影的列表和详情仅通过正式子任务或责任节点判断主管可见性，遗漏尚未生成正式任务的 PENDING_PLANNING 移交。旧查询已支持该关系，新投影未对齐。

修复：仅当事件为 PENDING_ASSIGNMENT、最新初析移交属于当前主管、状态为 PENDING_PLANNING 且尚未存在对应正式任务时，允许列表和详情读取。新增 planningHandoff 只读字段及“进入任务分配”入口，继续打开原 threadId，不创建第二套分派或任务状态。历史接收人、未分配员工不能由该路径获得权限；已发布任务仍走正式任务投影。无数据库迁移或业务写入，无通知开关变更。

验收：60 项相关 Vitest 通过；TypeScript 和 13 个内联页面脚本检查通过。服务器隔离副本真实 HTTP 验证两条受影响事件的列表、详情、原侧会话及各 2 条草案任务；三个未分配员工不可见。使用副本实际返回的 HTML/API 在 1366×768、1920×1080 渲染，入口可见、目标 threadId 正确、无横向溢出或脚本错误。本地 SSH 转发超时，因此视觉测试使用实际响应快照；没有把它记为在线浏览器点击验收。

上线：2026-09-17 10:33（北京时间），manage-robot-quality-cao，8092，容器 67ed0368f534；其他业务容器与 Caddy 未变化。公网响应头为 r13。线上角色投影再次确认 QE-20260916-2CD60AB4、QE-20260917-E9886E2B 均为待分派员工且有原草案入口，534 个发行文件哈希一致。正式任务、事件、AI快照、初析、移交、证据和审计校验一致。

发行材料：/opt/quality-pilot/releases/handoff-r13/。停服后 SQLite 一致性备份：/opt/quality-pilot/backups/handoff-r13-20260917/。回滚镜像：manage-robot:quality-test-confirm-20260916-r12，沿用当前数据与配置，不覆盖上线后的用户数据。

代码分支：codex/quality-handoff-fix-20260917。关键文件：src/quality/presentation/quality-event-perspective.ts、src/web/quality-tracking-page.ts、tests/quality/quality-formal-task-projection.test.ts、scripts/quality-handoff-staging-probe.mjs。
