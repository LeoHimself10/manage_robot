# 主管画像核验（deferred）

## 状态

- **默认关闭**：不在主链路阻塞员工画像编辑或任务进度。
- **API 占位**：`POST /api/workbench/manager/profile-verify`  
  - 当 `WORKBENCH_MANAGER_PROFILE_VERIFY_ENABLED` **未**设为 `1` 时，返回 **501**，body 含 `deferred: true` 与说明（避免前端误当作已上线能力）。
  - 设为 `1` 后仍可能返回 **501** `not_implemented`，直至实现写库与 UI。

## 规划要点（落地时）

- 写 `manager_verified_at` / `manager_verified_by`（与员工自服务路径分离，员工侧不可清除）。
- 汇总通知策略（钉钉）：建议批量 + 防抖，避免每条画像变更一条消息；具体模板与频率在实现时定稿。
