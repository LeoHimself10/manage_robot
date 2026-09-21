# 用户批准直接分配 r24

last_verified_at: 2026-09-21

最新明确要求取消成果对应表并直接发放，取代此前必须人工匹配的产品约束。页面移除任务结构与成果对应弹窗及入口，改用现有横向草案编辑。质量实际任务形成后即可配置人员，无须独立确认结构，无须精确匹配成果名称；普通发布必填校验、承接门禁仍保留。空占位/空任务不能发布。历史成果及映射不删除，不伪造覆盖记录，不代用户发放。

类型和内联脚本检查通过；53 项相关回归通过，含无映射可继续、占位拒绝、正式任务桥接与承接门禁。
镜像 manage-robot:quality-test-direct-allocation-20260921-r24，仅 manage-robot-quality-cao。
备份 /opt/quality-pilot/backups/direct-allocation-r24-20260921。
回滚 manage-robot:quality-test-thread-recovery-20260921-r23，以原 env/挂载/端口重建。
