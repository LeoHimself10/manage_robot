# 曹玉寒受限质量入口 · 2026-09-11

本次发布入口：`https://managebot.vivolightsales.com/workbench/quality-pilot/`。
微光原应用仍由 `manage-robot-dingtalk` 提供；新入口由独立容器
`manage-robot-quality-cao` 提供，Caddy 仅将上述前缀转发至本机 8092。
未替换原应用首页，也未修改明思、安徽入口。

## 权限与数据

- 仅配置的曹玉寒真实 userId 可访问。每个页面和 API 校验现有工作台 HMAC 签名、有效期、`dingtalk_authcode` 登录来源以及一致的 DingTalk userId。
- 不接受本地备用登录、签名链接登录、密码登录、测试身份、委托身份或来自另一站点的请求。
- 此独立进程显式授予曹玉寒研判与质量管理能力，业务记录仍使用曹玉寒实际 userId；切换页面不切换操作人。原服务的账号能力不变。
- 正式质量与任务共用 `/opt/manage_robot/data/workbench/workbench.sqlite`。OA 缓存在同一数据卷的 `quality-pilot/oa` 下；不导入本地测试库或演示事件。
- OA 读取指定“用服反馈流程”，每 60 秒同步。查询不按审批状态过滤；进入质量流程的状态与节点限制保留。
- 此进程不开启第二个 Stream 机器人，不发送通知或回写 OA。既有任务服务保持运行。首次真实账号登录及线上业务提交不在本次自动验收中。

## 验证

- TypeScript 检查通过；8 个流程测试文件 74 项通过。
- Node 身份、路径、OA 查询测试 20 项通过。
- 隔离预发布数据库和独立测试签名密钥下，两个新版页面、来源/研判/初析 API、原质量页面返回成功，其他身份和无会话请求被拒绝。
- 公网未登录新版接口返回 403，入口返回登录跳转；原工作台与明思入口均返回 200。
- 生产 OA 同步已开始。未自动伪造生产登录会话，也未提交真实业务验收来冒充曹玉寒本人验证。

## 运维与回滚

- 镜像：`manage-robot:quality-cao-20260911`，基于线上已存在依赖镜像构建，包含整合后的源码和静态资源；不包含配置密钥、数据库或本地工作目录。
- 服务器发布材料：`/opt/quality-pilot/releases/20260911-cao`。
- 配置：`/opt/quality-pilot/production.env`、`/opt/quality-pilot/oa-scope.json`（仅服务器，0600）。
- 发布前数据库快照：`/opt/quality-pilot/backups/workbench-before-20260911.sqlite`。
- 原路由备份：`/opt/quality-pilot/backups/Caddyfile-before-20260911`。
- 回滚先恢复原 Caddyfile 并校验/重载，再停止 `manage-robot-quality-cao`。不要自动恢复数据库备份，以免覆盖发布后的正常业务写入。
- 当前源码仍保留本地开发服务，生产只运行 `scripts/quality-production-server.mjs`；它不启动本地种子或授权入口。
