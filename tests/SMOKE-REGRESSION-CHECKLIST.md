# Smoke 回归清单（v5.23.8）

与 [`smoke_test_bug_triage` plan] 验证清单对齐；手工 smoke 时逐项勾选。

## Assignee / Scheme C

- [ ] 用户问「指派给测评工程师」（公司无此岗位）→ search 空 → CLARIFY，不编名、不进 assignment
- [ ] A-5 推荐后 B-1 指定 task_1 → 须 `update_draft_task` 仅写 task_1；message 不声称 2/3 已指派
- [ ] `update_draft_task` 传非 search 命中 userId → `assignee_not_from_search`
- [ ] 钉钉附表负责人列只读 latestAssignment；DRAFT 期为空

## Prepare / Publish

- [ ] prepare 从 session 组装，不改 deliverables/dueAt
- [ ] staged 后改 dueAt → publish 返回 `stale_staging` → 模型 re-prepare → 再确认落库
- [ ] 模型口播「已发布」未调 publish_task → 审计 `false_publish_observed` + 用户见未落库提示；**无** authoritative 静默落库

## Scope / 改派

- [ ] start_new_task 后 list_known_facts 为空；旧 scope facts 不串
- [ ] 发布后工作台改派 → 只写 SQLite；session.latestAssignment 不变

## 展示

- [ ] 主表一张，含负责人/协作人列；无「任务补充信息」区块

## 撤回误报项

- F-3：单次 update 有日志证据即可，非多次误报
- D-5：search_similar 询问轮不要求 draft；`draftLikeMessageWithoutJson` 仅 telemetry
