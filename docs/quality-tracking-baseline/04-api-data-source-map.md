# 测试 API 与数据基线

## 岗位配置与成果任务映射 r14（2026-09-18）

以本节作为本次改造后的补充基线；下文 r13 及更早记录保留为历史。业务操作使用“客服主管”“质量主管”，实际身份保留在审计。管理员通过 `/admin/posts.html` 配置真实岗位与测试岗位，每岗一人，版本校验防止覆盖他人修改。换人后即时撤销旧岗位权限并接续未完成工作；不改写已有部门任务及历史数据。

初析的必须成果与执行任务分离。新移交只建立待规划占位项，主管可让 AI 生成或手工增删、拆分、合并任务；每项成果须明确一个最终交付任务和可选支撑任务，同一任务可交付多项成果。人工确认结构后才能选人、发放；一项任务也可成立。结构变更使确认失效，日期与人员变更沿用原流程。详见 [r14 实施和验证记录](../quality-roles-planning-20260918.md)。


## 主管移交可见性 r13 修复（2026-09-17）

独立质量试点已发布 r13：最新初析移交给主管但尚未生成正式任务时，主管列表及详情可见，并提供进入原任务分配侧会话的入口。仅接收主管获得该可见性；不新增分派状态、不改通知开关、不迁移数据库。两条受影响事件已在线上投影核验恢复，详见[修复记录](../quality-handoff-fix-20260917.md)。


last_verified_at: 2026-09-18

- 钉钉入口仍由 createProductionAccess 限定实际登录用户；拒绝外部伪造、过期、其他用户和模拟签名作为真实登录。
- 模拟角色仅允许 QUALITY_SIM_MANAGER、QUALITY_SIM_EMPLOYEE_1/2/3。页面选择保存在独立路径 Cookie，API 使用服务器生成的内部业务会话；真实 wb_session 不替换。模拟会话带原操作人 impersonation 审计上下文。模拟角色不能获取质量初析/终验能力。
- 部门及负责人来自独立 SQLite 中4个活动虚构联系人；原通讯录副本停用但不删除。新旧任务状态均以测试 SQLite 正式任务表为权威。
- 数据卷 /opt/quality-pilot/test-data-20260914 与正式系统分离；所有启动/通知保护沿用 r3，禁止改回共享生产数据库。
- 测试入口：scripts/quality-simulation.test.mjs、scripts/quality-simulation-staging-probe.mjs、scripts/quality-test-notification-safety.test.mjs；后者验证10条通知通路不发起网络。预发布探针强制验证专用假密钥，不能用于真实会话伪造。

- r7 员工页内办理：承接/拒绝仍调用 `/api/workbench/employee/action`，进度仍调用 `/api/workbench/employee/progress`。仅质量任务在进度更新前增加节点/正式状态校验，阻止旧页面把已提交任务改回执行中，普通任务流程不变。
- 事件投影 `branch[].employeeWork` 通过 `quality_task_links` 读取正式子任务，返回目标、交付成果、标准、期限、状态、附件与草稿。只有该正式子任务的执行人能获得编辑模型。
- 新增 `POST /api/workbench/quality/nodes/:nodeId/employee-draft`，持久化进展、下一步和完成说明；`expectedVersion` 防止多窗口覆盖。草稿不改变正式状态。
- 上传复用 `POST .../nodes/:nodeId/evidence`，增加 `requirementId` 与 `supersedesId`；后端从正式 deliverables 生成稳定要求 ID，新版本继承关联，禁止关联其他节点或过期要求。`quality_evidence` 新增 requirement_id/supersedes_id/file_revision/submitted_at/removed_at。移除只将未提交文件标记移除，文件和历史记录保留；旧系统已经提交的附件迁移时补齐提交标记。
- `POST .../nodes/:nodeId/submit-completion` 校验执行人、正式状态、节点版本、分配要求版本、各项必交文件与完成说明。正式子任务 DONE、质量节点待主管验收、提交说明、文件提交标记及审计共用 SQLite 事务；调用原正式任务更新方法（借用连接与 SAVEPOINT），避免两套状态部分成功。
- `POST .../nodes/:nodeId/evidence/:evidenceId/remove` 仅允许当前执行人移除未提交的有效版本。下载沿用有权限校验的证据接口；文件哈希验证，改派后的旧执行人不能借滞后节点权限下载。
- 回归：58 项质量/权限/页面测试通过；覆盖必交缺项、补充材料不能代替、版本继承和历史不可删、草稿冲突、改派后拒绝、视频拒绝、失败事务回滚。`scripts/quality-inline-employee-staging-probe.mjs` 在专用假密钥和 `.inline-staging-only` 标记双重限制下，验收隔离副本完整 HTTP 承接、进度、上传、下载、完成、主管退回、V3 再提交与通过链路；禁止在实际测试数据卷运行此探针。

- r8 主管页内验收直接复用 `POST /api/workbench/manager/quality-review`，带正式 subtaskId、节点 expectedVersion、decision、reason 与 requestId。原主管页面不传 expectedVersion 时保持兼容。每项投影只在正式主管、节点直接上级及正式执行人均匹配时返回验收上下文；CLOSED 不可验收。
- 验收服务先校验人员与正式任务关联，再验证幂等请求属于同节点、同主管、同决定和意见。退回更新原正式子任务为 IN_PROGRESS、节点 RETURNED、验收意见、任务事件、质量审计和通知 outbox 共用 SQLite 事务；原正式任务写入借用同一连接和 SAVEPOINT。实际登录操作人也进入审计，即使物理隔离副本中事件 is_test 为 false。
- 完成逐项验收后仍走现有状态投影及原主责整体验收，最后一项通过自动进入 PENDING_QUALITY_REVIEW。权限和业务角色不新增；测试通知仍强制禁用。
- 主管 HTTP 副本回归脚本：`scripts/quality-inline-manager-staging-probe.mjs`，需要专用假密钥和 `.inline-staging-only` 标记。复制数据后可重置场景，不得用于用户正在操作的测试数据库。

2026-09-14 r9：
- `GET /api/quality-oa/tong` 增加 `finalReview`，包含正式任务、当前／历史证据、退回节点、终验历史和评论同步状态。
- `POST /api/quality-oa/tong/{final-close|final-return|final-reopen|comment-retry}` 服务端解析已授权 OA 来源对应的事件；浏览器不能指定任意 OA 实例、发表评论人或替换已保存意见。模拟主管／员工调用 OA 写操作路由被拒绝。
- `POST /api/workbench/quality/nodes/:nodeId/manager-return` 仅被退回主管可处理，支持补充说明再次送终验或选择本人直接员工任务补充，原因、版本和请求 UUID 必须有效。
- `quality_final_comment_outbox` 只由成功终验关闭事务写入；草稿／退回／重开／主管验收均不产生评论。关闭与队列写入原子提交，正式子任务重开与质量退回同事务。
- 已通过意见、原 OA 实例／流程、实际操作用户、唯一终验 ID 固化；幂等请求必须匹配事件、身份、动作、目标和内容。测试／禁用开关下记录为 SUPPRESSED，永不自动转成待发送。
- OA 评论 worker 仅在 `QUALITY_OA_FINAL_COMMENT_ENABLED=1` 且非测试运行；独立测试服务器硬设为 0，客户端再检查一次。明确拒绝可手动重试原记录，超时／断连为 UNKNOWN，只核对同用户同文本评论，不盲目补发；结果不明时宁可保留待核对状态，避免重复评论。接口成功不回滚终验；同步失败也不回滚关闭。
