# 日报请假识别设计

**日期**：2026-06-16  
**状态**：已实现

## 目标

在日报「未交」统计中，将钉钉考勤 **全天请假** 的员工单独标注为「请假」，与真正未交区分。

## 数据来源

- 钉钉 API：`topapi/attendance/getleavestatus`
- 权限：`qyapi_get_attendance_data`（明思、微光各应用需分别开通）
- 查询窗口：与日报业务日一致 `[D cutoff, D+1 cutoff)`

## 判定规则

1. 员工在业务日窗口内无日报 → 初始归入 `missing`
2. 调用 `getleavestatus` 查同一窗口
3. 若存在 `duration_unit === "percent_day"` 且 `duration_percent >= 100`，且请假时段与窗口有交集 → 从 `missing` 移至 `onLeave`
4. 半天假 / 小时假：仍算 `missing`

## 展示

| 位置 | 格式 |
|------|------|
| 工作台统计 | `已交 X · 未交 Y · 请假 Z` |
| 工作台名单 | 橙色「未提交」+ 蓝色「请假」分块 |
| 早报统计 | `已交 X · 未交 Y · 请假 Z` |
| 早报结尾 | `未提交：…；请假：…` 分开 |
| LLM | `onLeave[]` 注入；禁止写成未提交 |

## 容错

- API 失败：不拆分，全员留在 `missing`，审计 `daily_report_leave_fetch_failed`
- 配置：`leaveCheckEnabled`（默认 `true`），环境变量 `DAILY_REPORT_LEAVE_CHECK_ENABLED`

## 实现文件

- `dingtalk-leave-client.ts` — API 客户端
- `daily-report-leave.ts` — 拆分逻辑
- `daily-report-run.ts` — `collectOrgDigests` 集成
- `daily-reports-api.ts` / `daily-reports-page.ts` — 工作台
- `daily-report-morning-llm.ts` / `daily-report-morning-build.ts` — 早报
