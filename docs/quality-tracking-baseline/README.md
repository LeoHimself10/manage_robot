# 独立钉钉质量测试入口基线

## 主管移交可见性 r13 修复（2026-09-17）

独立质量试点已发布 r13：最新初析移交给主管但尚未生成正式任务时，主管列表及详情可见，并提供进入原任务分配侧会话的入口。仅接收主管获得该可见性；不新增分派状态、不改通知开关、不迁移数据库。两条受影响事件已在线上投影核验恢复，详见[修复记录](../quality-handoff-fix-20260917.md)。


last_verified_at: 2026-09-14
scope: codex/quality-cao-production 独立测试容器

本目录只描述当前分支部署的质量测试入口，不替代主分支的 legacy 质量系统基线。详细部署、隔离和验证记录见 [测试隔离记录](../quality-test-isolation-20260914.md)。

- 页面与模拟身份：[03-html-interaction-spec.md](03-html-interaction-spec.md)
- API、身份与数据：[04-api-data-source-map.md](04-api-data-source-map.md)

- 员工页内办理发布与验证：[r7 发布记录](../quality-inline-employee-release-20260914.md)

- 主管页内验收发布与验证：[r8 发布记录](../quality-inline-manager-release-20260914.md)

- 终验与 OA 评论同步链路：[r9 实现与验证记录](../quality-final-review-release-20260914.md)
