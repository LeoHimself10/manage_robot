# 质量追踪测试隔离

last_verified_at: 2026-09-14

用户明确当前是测试系统，不允许给真实人员发送消息。此前独立容器与正式任务服务共享数据库，仅关闭本进程通知不足以隔离后台消费。

## 当前部署

- 镜像：manage-robot:quality-test-isolated-20260914-r3；容器仍为 manage-robot-quality-cao；端口和钉钉入口不变。
- env：/opt/quality-pilot/test-app.env（服务器私有文件，不入库）。
- 数据卷：/opt/quality-pilot/test-data-20260914 → /app/data；不再挂载 /opt/manage_robot/data。正式系统仍使用原数据卷。
- 使用 SQLite backup 生成一致性副本，保留已有测试进度、OA 缓存和会话。部门/主管仍是通讯录快照，不能描述为虚构账号；视角切换仍使用曹玉寒真实认证身份，业务写入仅在测试副本。尚未恢复独立模拟部门/主管/员工身份。
- 钉钉认证、OA 读取及 AI 分析仍可使用；业务通知、主管通知、质量通知 worker、催办、通讯录同步、来源回写关闭。关闭不代表模拟发送成功。
- 服务强制 QUALITY_PILOT_TEST_MODE=1 和 /app/data/.quality-test-isolated 标记，启动时缺任一项即失败；页面显示测试隔离提示。

## 原共享库的既有记录

- 核查到本入口 1 条 PENDING_ANALYSIS 事件、0 条正式任务；该事件无任务桥接。
- 关联的 1 条 PENDING 通知和 1 条 PENDING 来源回写改为 DEAD，last_error 记录 TEST_ISOLATION_20260914 原因，保留历史。检查时均未发送，不代表对全部历史消息做过全面审计。
- 修改前备份：/opt/quality-pilot/backups/before-test-isolation-20260914.sqlite；停用记录：/opt/quality-pilot/test-isolation-20260914.json。不得恢复整个正式库覆盖正常工作。

## 验证

- 22 项身份与导航测试通过。
- node --import tsx scripts/quality-test-notification-safety.test.mjs：覆盖 10 个实际通知方法，包含消息卡片、发布、改派、停办、主管/员工反馈、逾期、催办、进展及钉钉待办；均 enabled=false，注入网络 mock 调用次数为 0。未向真实人员发送测试消息。
- 镜像构建 518 个文件校验通过；隔离模式缺失、隔离卷缺失两种容器启动均拒绝。
- 当前 /health 正常，公网登录页出现测试提示；正式系统、明思、安徽和 Caddy 容器未重启。

## 运维约束

后续只使用 test-app.env 与测试数据卷，禁止按历史 new-app.env + 正式数据卷的命令回滚。服务当前仍为认证后的单用户测试入口；本次未新增模拟身份授权或开放其他人员访问。
