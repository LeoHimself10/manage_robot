# 马荣鑫反馈与质量跟踪工作台

last_verified_at: 2026-09-09

开发基线：`58dab6188b6e569edd2d7107fb9b04e4c4f80166`（已确认的 9 月 3 日 18:00 源码快照）。本次位于独立分支 `codex/ma-quality-workbench-v1`，没有替换既有部署。

## 本地验收

运行 `npm run dev:ma-quality`，打开 http://127.0.0.1:8810/ ，点击“进入马荣鑫视角”。端口可用 `MA_WORKBENCH_PORT` 指定。数据仅位于当前工作目录的 `data/local-ma-quality-workbench/`，首次空库写入明确标注的本地演示反馈；刷新与重启保留变更。该脚本绑定回环地址，禁用钉钉同步、表格回写、通知及定时提醒。不要将本地登录脚本作为生产入口。

正式页面 `/workbench/quality/ma`，API `/api/workbench/quality/ma/feedbacks`；`QUALITY_MA_WORKBENCH_ENABLED=1` 开启。启用后有反馈研判权限的主管访问原 `/workbench/quality`、`/workbench/quality/review` 也使用新页面。开关默认关闭，其他角色原页面继续使用既有实现。`QUALITY_MA_LOCAL_DATA=1` 仅用于本地数据标记，不授予权限。

## 本次确认的流程

1. 员工提交后，来源反馈进入“全部反馈”；点击记录直接在该行下面展开原始表单、附件和审批历史。
2. 核对后点击“进入质量事件”并确认，写入独立准入记录，才出现在“待我研判”。此时尚未正式通报、不通知佟成、不把来源标为 REPORTED。
3. 在待研判中生成 AI 原始建议或进行人工研判；AI 与人工记录独立保存。AI 未配置时明确提示，仍可人工完成。界面不再提供处理方式或建议处理方式。
4. 保存分类、风险、结论及必要的修改理由。保存后可继续修改；点击“推送佟成初析”并确认才复用正式质量通报事务，生成质量事件与只读来源快照。
5. 后续只读展示佟成初析版本、一个责任部门及其主管、部门内正式任务、员工进展与证据、主管逐级验收、质量终验和公开历史。

这是 2026-09-09 用户对旧“先研判普通/待补/通报”的流程修订；旧服务保留兼容，新 Ma 入口固定质量方向，不在准入后重复选择处理方式。正式任务分配、改派、期限、进展及承接验收的权威数据仍来自原任务系统。页面不会创建第二套任务状态或分配表单。

## API 与数据

所有接口沿用工作台 cookie 会话与服务端能力校验；外部密码会话、无能力员工、纯 admin 不能使用业务写操作，他人已准入/通报的工作项受归属限制。

- `GET /feedbacks?scope=all|pending|progress|closed&q=&page=&pageSize=`：列表、搜索、计数、OA 接入状态。
- `GET /feedbacks/:sourceKey`：原始资料、准入、AI 与人工历史、后续流程只读投影。
- `POST /feedbacks/:sourceKey/admit`：确认准入或重新确认更新来源。
- `POST /feedbacks/:sourceKey/ai`：复用既有真实 AI 研判服务。
- `POST /feedbacks/:sourceKey/assessment`：保存独立人工研判。
- `POST /feedbacks/:sourceKey/submit`：明确推送，复用既有正式质量事件通报服务。
- `GET /feedbacks/:sourceKey/attachments/:id`：鉴权后预览，`?download=1` 下载。sourceKey 应 URL 编码。

POST 带 UUID `requestId`、`expectedSourceVersion`；保存另带 `expectedVersion`，推送另带 `expectedAssessmentVersion`。来源更新或过期版本返回冲突，提示重新核对；不静默覆盖已保存判断。重复准入/推送保持幂等。

准入使用 `quality_source_admissions` 及审计表；AI 与人工沿用原有独立记录。OA 来源、附件、来源版本与审批历史使用 `quality_oa_*` 表，版本与审批历史禁止更新和删除。工作簿同步不会删除 OA 来源，OA 来源也不会进入工作簿回写队列。

OA 的 4W2H、软件版本、导管型号和回收报损等字段通过可选 `oaContext` 进入现有 AI 服务；提示词版本为 `v0.12-oa-context`。附件仅传文件名、类型、大小与表单栏位，并明确标为内容未分析；不会将签名下载地址或文件内容作为已核实证据。旧表格输入与旧 AI 快照保留兼容。

## 钉钉 OA 接口预留

当前没有真实 OA 网络适配器、事件订阅或可外部调用的接收地址。页面明确显示“钉钉 OA 待接入”。以下是后续连接点，不能据此认为企业应用已配置成功：

- `src/quality/oa/quality-oa-connector.ts` 的 `QualityOaConnector`：实现 `getInstance(processInstanceId)` 和 `downloadAttachment({processInstanceId,fileId})`，服务启动时注册适配器。
- `src/quality/oa/quality-oa-source.ts` 的 `ingestQualityOaInstance`：由未来已鉴权的服务端事件接收器调用。收到员工提交事件即读取完整表单入库，不等审批通过。仅审批状态变化不会使原表单研判失效；表单或附件变化会生成来源新版本。
- `OaInstance.formComponentValues` 保留完整组件字段；映射覆盖产品类型、设备/导管型号、序列号、软件版本、生产批号、回收/报损、WHAT/WHERE/WHEN/HOW/HOW MANY、影响程度及上传附件。附件当前契约要求稳定 `fileId` 与文件名；只有 URL 的图片组件需在真实适配器中解析为受控文件标识，不应将临时签名地址直接暴露给前端。

企业接入时需准备：企业内部应用凭据（仅服务器配置）、“用服反馈流程”的 `processCode`、审批详情及附件读取权限、提交与变更事件订阅，以及所选传输方式的签名/校验配置。环境变量命名与 SDK 字段在实际连接时核对；本版本未启用任何声称可直接联网的 OA 配置项。无需在聊天中发送 AppSecret。

真实接入验收应覆盖事件验签、重复投递、补偿读取、附件权限与过期处理、表单历史版本、撤回/拒绝仅更新 OA 状态且保留质量判断。本地演示附件仅由标注 `localFixture` 的种子记录生成。

## 验收记录

- 领域与 HTTP 回归覆盖准入门禁、保存不推送、来源版本冲突、AI/人工分离、隐藏处理方式不影响采纳、明确推送幂等、权限与附件访问、正式任务状态投影。
- 实际 cookie 登录后，原始附件与任务证据均返回成功；初析 V1/V2、单部门四种员工任务状态及关闭记录可读取。
- 浏览器验证 1366×768 与 1920×1080 的行内展开、稳定流程导航、原始资料、研判、初析、分配、证据与验收。窄窗口仍保留本人、OA 待接入及本地测试标记。
- 服务重启后仍保留 6 条样例、准入/人工结果、任务证据与生成过的 AI 历史；不会重复播种或清除操作。

本地第 2 条样例已通过现有模型配置实际生成过一份 AI 建议，用于交互验收；没有替用户保存人工判断或推送。业务样例仍标注本地演示，真实 OA 连接保持关闭。
