# 用服反馈流程 · 本机 OA 接入

last_verified_at: 2026-09-09

本目录是新增的真实 OA 收件箱页面。8808 `/ma-workbench/` 显示真实来源；原交互设计保留在 `/design/ma-workbench/`，8809 佟成页面仍使用此前的样例业务链和真实 AI。未部署到 ECS。

## 已接通

2026-09-09 展示精简：AI 正文使用原系统分类字典的中文名称；信息缺口的字段标识转为中文，未知内部字段名不展示但保留说明。移除正文中的引用编号、请求编号、提示词版本和重复判断段落；空信息区不显示。生成记录只保留时间和依据资料版本。原始 AI 输出及引用关系继续完整保存在 SQLite，历史结果无需重跑。修改前页面代码保留在 `ma-workbench/revisions/before-ai-business-display-20260909/`。

- 原应用已开通 `Workflow.Instance.Read`，随后用真实接口验证成功。不需要修改或发布 OA 审批模板。
- 仅读取已配置企业的 `用服反馈流程`；企业、流程、应用和审批人员标识保存在忽略的 `.env.oa-scope.local`，示例见 `config/quality-oa-scope.example.json`。
- 首次补拉最近 119 天仍在审批的实例，后续每分钟查询新实例并复查持久化的待处理实例。已撤销和完成的已导入单据保留历史。
- 导入条件：实例 RUNNING；马荣鑫任务 RUNNING；同节点存在佟成会签任务；操作记录中直接主管/部门主管已 AGREE。单纯抄送、未启动任务、主管拒绝不导入。此规则依据当前发布 V80 的三条产品分支；审批人或节点设计变化时须重新核验。
- 实例 ID 幂等；来源、任务状态变化产生新版本；不会因为某次分页未返回而删除其他记录。
- 页面提供真实编号、提交人、原表单、审批记录、原单链接、搜索、分页、AI 研判与历史版本。
- AI 调用原系统 qwen3.6-plus、分类字典、检索、提示词和校验器。服务端从 SQLite 获取所选版本，不信任浏览器传入的来源正文。AI 输出另存 `oa_ai`，刷新及重启可恢复。

## 实测

2026-09-09 首次近 30 天扫描导入 3 条；扩展到 119 天的未完结审批后累计导入 6 条。定时复查返回 inserted=0、updated=0，未重复导入。

使用一条已授权的实际审批记录调用原系统 AI 成功。验证记录为 `SUCCEEDED`、sourceVersion=1；业务编号和具体结果仅在本地验收数据中保留。这是一份 AI 建议，未提交人工通报。

自动化验证：

```sh
node --test tests/quality/oa-import.test.mjs tests/web/quality-oa-http.test.mjs tests/web/quality-ui-ai-http.test.mjs
```

浏览器验证：1366×768 与 1920×1080 均无页面水平溢出；审批编号搜索正确；服务重启后 6 条来源和已生成 AI 历史仍可读取。

9 项通过：导入门禁、去重与版本、撤销保留、分页补拉、失败重试、外组织事件隔离、本机会话、来源版本校验、AI 幂等及旧 AI 接口回归。

## 源码与运行

- `src/quality/oa/oa-client.mjs`：官方 API 适配器，只提供 token、审批 ID 列表、实例详情。
- `src/quality/oa/oa-store.mjs`：独立 SQLite 收件箱、不可覆盖版本、节点门禁与字段投影。
- `src/quality/oa/oa-sync.mjs`：分页、持久化待查队列、定时补拉与受信任事件适配入口。
- `scripts/quality-oa-http.mjs`：本机登录、配置校验、查询、同步、AI 生成与历史接口。
- `scripts/quality-ui-ai-server.mjs`：8808 / 8809 服务入口。
- `data/quality-oa/oa.sqlite`：真实导入数据与 AI 记录，已排除 Git。
- `.env.oa.local`：服务端凭证，已排除 Git，静态服务不可访问；不要复制进文档、前端、日志或提交。
- `.env.oa-scope.local`：将 `config/quality-oa-scope.example.json` 复制到此路径后填写企业、流程和人员标识；凭证格式见 `config/quality-oa-credentials.example.json`。两个配置文件均位于当前工作树根目录且被 Git 忽略；`QUALITY_OA_SCOPE_FILE` 可指定范围配置位置。缺省范围仅为离线样例。
- `data/quality-oa/local-entry.json`：本机授权入口；`local-session.json` 为本机开发会话。服务仅绑定 127.0.0.1，不是生产钉钉免登或多用户权限系统。

运行：`node --import tsx scripts/quality-ui-ai-server.mjs`。原系统 AI 模块默认取相邻 `yesterday-admin-test-actors` 工作树，可用 `QUALITY_ORIGINAL_SYSTEM_ROOT` 指定；模型密钥复用运行环境。

## 接口

全部 `/api/quality-oa/*` 需要本机会话 Cookie，拒绝跨站 Origin 和 cross-site 请求。源记录不会由前端修改。

- GET `/api/quality-oa/status`
- GET `/api/quality-oa/sources`
- POST `/api/quality-oa/sync`
- POST `/api/quality-oa/config`：仅未配置时接受，固定目标应用，先验证接口再保存凭证。
- POST `/api/quality-oa/assessment`：`id`, `version`, `requestId`。
- GET `/api/quality-oa/ai-history?id=...`

## 边界

当前自动导入通过每分钟服务端补拉运行，**尚未配置 OA Stream 事件订阅**。代码中的 `onEvent` 供后续接入原机器人已有的受信任 Stream 分发器，未新建抢占原机器人消息的第二个连接，也未暴露免验证 Webhook。

附件只保留 OA 表单中的关联数据，通过原 OA 查看。AI 未读取附件正文。页面上的 OA 日期与时分保留接口原值，不额外按 Z 后缀换算；同步/AI 时间按本机时区显示。

本轮未接通：正式人工研判/通报到原质量事件 API、OA 评论回写、自动同意/拒绝审批、正式任务创建、ECS 部署。原交互设计仍可独立查看，不能把样例中的后续操作当成真实流转。

## 官方依据

- https://open.dingtalk.com/document/orgapp/obtains-the-details-of-a-single-approval-instance-pop
- https://open.dingtalk.com/document/orgapp/obtain-an-approval-list-of-instance-ids

已在实际浏览器核对接口请求、分页参数和任务状态字段，并以真实 API 调用验证。
