# 测试 API 与数据基线

last_verified_at: 2026-09-14

- 钉钉入口仍由 createProductionAccess 限定实际登录用户；拒绝外部伪造、过期、其他用户和模拟签名作为真实登录。
- 模拟角色仅允许 QUALITY_SIM_MANAGER、QUALITY_SIM_EMPLOYEE_1/2/3。页面选择保存在独立路径 Cookie，API 使用服务器生成的内部业务会话；真实 wb_session 不替换。模拟会话带原操作人 impersonation 审计上下文。模拟角色不能获取质量初析/终验能力。
- 部门及负责人来自独立 SQLite 中4个活动虚构联系人；原通讯录副本停用但不删除。新旧任务状态均以测试 SQLite 正式任务表为权威。
- 数据卷 /opt/quality-pilot/test-data-20260914 与正式系统分离；所有启动/通知保护沿用 r3，禁止改回共享生产数据库。
- 测试入口：scripts/quality-simulation.test.mjs、scripts/quality-simulation-staging-probe.mjs、scripts/quality-test-notification-safety.test.mjs；后者验证10条通知通路不发起网络。预发布探针强制验证专用假密钥，不能用于真实会话伪造。
