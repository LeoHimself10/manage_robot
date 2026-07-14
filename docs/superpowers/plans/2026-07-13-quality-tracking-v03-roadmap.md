# 质量追踪第一期 v0.3 开发路线图

> **执行要求：** 实施时必须逐份执行下列计划，并使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按复选框跟踪进度。

**业务基线：** `docs/superpowers/specs/2026-07-10-quality-event-tracking-design.md`

**当前状态：** 设计已确认，计划已编写；尚未获得业务代码开发授权。

**总体目标：** 在不重做现有工作台的前提下，新增售后质量异常发现与通报、跨部门递归执行和逐级证据验收、质量专员全链路闭环及私密双向评论。

**总体架构：** 质量领域使用与现有工作台相同的 SQLite 文件但独立建表；正式任务与子任务仍是执行状态权威源，质量节点通过桥接表与正式任务关联；质量页面和接口按独立业务角色鉴权。

## 全局约束

- [ ] 开发必须在 `.worktrees/` 下的新功能分支进行，不在当前分支或 `main` 直接实现。
- [ ] 三份计划必须按顺序执行；前一份的全量回归通过后才能开始下一份。
- [ ] 钉钉来源同步必须使用企业内部应用的表格读权限和操作人 `unionId`，不得依赖个人浏览器登录态。
- [ ] 只读取第一个子表“客户端问题反馈记录表”，不得调用任何表格写接口。
- [ ] 现有 `tasks`、`subtasks`、`task_events` 不增加质量业务字段；质量关系只写 `quality_*` 表。
- [ ] 现有非质量任务的页面、接口、状态、提醒和通知行为必须保持不变。
- [ ] 客户端只提交业务动作，服务端计算状态；所有写接口执行角色、对象范围、版本号和请求幂等校验。
- [ ] 附件正文、完整私密评论、钉钉密钥不得写入日志。
- [ ] 每项开发任务都先写失败测试，再做最小实现，再运行针对性测试并提交。

## 顺序与验收门槛

| 阶段 | 计划文档 | 可独立验收的结果 | 进入下一阶段的门槛 |
|---|---|---|---|
| 1 | `2026-07-13-quality-tracking-source-intake-plan.md` | 售后主管能同步首表、查看候选、手动或关联来源创建并提交草稿 | 企业授权读取探针成功；来源、候选、草稿、权限测试和现有全量测试通过 |
| 2 | `2026-07-13-quality-tracking-task-evidence-plan.md` | 质量专员能分配原主责；主管在原任务页承接、递归分配、设子期限、上传证据并逐级验收 | 循环、期限、证据、越权和桥接测试通过；现有任务完整回归通过 |
| 3 | `2026-07-13-quality-tracking-closure-notification-plan.md` | 质量专员查看全链路、指定节点退回、关闭/重开；私密评论和可靠通知上线 | 隐私、状态机、通知重试、安全、移动端和全量回归全部通过 |

## 上线前必须由业务方提供的配置

- `QUALITY_SOURCE_WORKBOOK_ID`：钉钉开放接口使用的工作簿 ID，不从分享链接猜测。
- `QUALITY_SOURCE_OPERATOR_UNION_ID`：有权读取该表格的操作人 unionId。
- `QUALITY_AFTERSALES_MANAGER_USER_IDS`：售后主管 userId 列表。
- `QUALITY_SPECIALIST_USER_IDS`：质量专员 userId 列表；当前佟成的 userId 配在此处，不在代码硬编码姓名。
- `QUALITY_SPECIALIST_REPORTS_FILE`：质量专员与其下级关系 JSON 文件。
- 现有 `DINGTALK_CLIENT_ID`、`DINGTALK_CLIENT_SECRET` 对应的企业内部应用已开通钉钉表格读权限，并已被授予目标工作簿访问权。

## 最终发布门槛

```bash
npm run typecheck
npm test
git diff --check
```

预期：三个命令退出码均为 `0`；质量模块测试与现有测试全部通过；无 `TODO`、`TBD`、占位符或被跳过测试。
