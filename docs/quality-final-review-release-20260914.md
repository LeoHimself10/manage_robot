# 质量终验与 OA 评论链路 r9

last_verified_at: 2026-09-14
release: quality-test-final-review-20260914-r9
scope: 独立钉钉质量测试容器 manage-robot-quality-cao

## 本次交付

- 主管“任务分配与验收”合并为一个操作区，移除重复证据验收页签；质量终验结果仍为只读。
- 佟成在当前页查看正式任务要求、完成说明、当前与历史证据和主管验收，填写一个意见框完成终验。
- 终验退回可选主管节点或具体员工任务。主管退回保留员工验收成果，可补充处理说明再次送终验，或指定自己已通过的员工任务补充。员工退回仅恢复目标任务，补交后重新经过主管验收。
- 事件关闭、OA 评论同步记录同一 SQLite 事务；退回与正式任务重开同一事务。权限、事件/节点版本、请求身份、目标及内容均校验，历史证据保留。
- 只有正式通过的意见产生 OA 同步记录。来源实例、流程、实际操作用户与意见由服务端固化；退回、重开、主管验收及草稿均不创建评论。
- 测试运行永久抑制该次评论投递（SUPPRESSED，attempts=0），以后打开开关也不会补发测试意见。明确失败可重试相同记录；发送结果不明时仅核对 OA 已有评论，未能证实则保留 UNKNOWN，不盲目重复发送。
- PDF 使用仓库已安装的 pdfjs-dist 5.7.284 提供同页分页阅读，避免嵌入式浏览器原生 PDF 空白；保留原文件下载。前端发行文件及 Apache 2.0 许可保存在 public/quality/tong/pdf-*。

## 接口与源依据

- `GET /api/quality-oa/tong`：增加 finalReview（正式任务、证据、节点、历史、同步结果）。
- `POST /api/quality-oa/tong/final-close|final-return|final-reopen|comment-retry`：真实登录质量管理入口；模拟员工／主管不能调用这些写操作。
- `POST /api/workbench/quality/nodes/:nodeId/manager-return`：被退回主管处理补充事项。
- `quality_final_comment_outbox`：按终验 UUID 唯一，保存通过意见及确定的原 OA 目标。
- 钉钉接口：`POST /v1.0/workflow/processInstances/comments`，请求字段 processInstanceId、commentUserId、text。已对照官方 [@alicloud/dingtalk 2.2.48](https://www.npmjs.com/package/@alicloud/dingtalk/v/2.2.48) 的 workflow_1_0/AddProcessInstanceComment SDK 实现核对。
- PDF 接入依据：[Mozilla PDF.js examples](https://mozilla.github.io/pdf.js/examples/)。
- 当前测试服务器强制 `QUALITY_PILOT_TEST_MODE=1`、`QUALITY_OA_FINAL_COMMENT_ENABLED=0`，所有既有通知／催办／来源回写开关继续关闭。适配器和 worker 均有独立门禁。本次没有向真实 OA 新增评论；真实组织权限与投递结果不宣称已实测。

## 验证

- TypeScript 检查通过；13 个内联页面脚本检查通过。
- 154 项回归通过：正式任务投影、终验与评论队列、全流程、角色隔离、主管和质量页面。最后补充的跨动作 UUID 冲突验证所在 31 项测试也全部通过。
- `scripts/quality-final-review-staging-probe.mjs` 只允许带 `.inline-staging-only` 标记和专用假密钥的隔离副本运行；覆盖承接、必交证据、版本替换、提交、主管退回/复验、两类终验退回、主管回复/再退员工、关闭/重开、OA 目标防篡改、模拟身份拒绝、重复提交及测试禁止投递。
- 1366×768 与 1920×1080 浏览器检查：主管五列页签、单意见框、两类节点选项、只读终验结果、无页面横向溢出。PDF 两页内容及上一页/下一页交互已检查。
- 浏览器只读代理用于 UI 验证；所有流程写入仅在服务器隔离副本执行。用户当前数据库未用于回归操作。

## 部署与数据

- 发布前镜像：manage-robot:quality-test-inline-manager-20260914-r8。
- 当前镜像：manage-robot:quality-test-final-review-20260914-r9。
- 当前容器：4157014ae64f；挂载仍为 /opt/quality-pilot/test-data-20260914，监听 127.0.0.1:8092。
- 发布前 SQLite 备份：/opt/quality-pilot/backups/final-r9-20260914/workbench-170834.sqlite。
- 健康检查与 529 个发行文件哈希核验通过；公网入口携带 r9 发行标记，未登录访问仍受保护。
- 发布前后 132 条正式子任务状态一致；12 份证据、质量事件与验收记录逐行校验一致。
- 微光、明思、安徽三个正式服务以及 Caddy 容器 ID 均未变化。
- 回滚只需恢复 r8 镜像，继续挂载当前测试数据卷；新增 outbox 表与旧镜像兼容，不能用历史备份覆盖用户最新数据。
