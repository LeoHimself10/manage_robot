# 曹玉寒受限质量入口 · 2026-09-11

## 独立应用发布（09:56 更新）

- 已在微光创建并发布「质量追踪系统」1.0.0，发布人曹玉寒，平台发布时间 2026-09-11 09:56:24。
- App ID：`aef00be4-004e-4826-b099-ec320d4ae7fc`；AgentId：`4981819826`。
- 正式发布详情显示“仅我可见”，创建人为曹玉寒；后端仍逐请求限制真实 userId。
- 移动端、PC 端首页均为下面的新版入口；登录页及免登接口现在在新版前缀内，不再转到旧应用登录页。
- 运行镜像更新为 `manage-robot:quality-app-20260911`，配置为服务器 `/opt/quality-pilot/new-app.env`。其中新应用凭证用于免登，`QUALITY_OA_CLIENT_ID/SECRET` 保留原应用 OA 读取授权，两者分离。
- 对外 JSAPI 配置接口已验证 200，并返回新 AgentId；登录页面 200，未登录业务接口 403。另通过 7 项登录相关回归、20 项生产接入测试和 TypeScript 检查。
- 用户本人点击确认发布。真实钉钉客户端首次打开并完成免登仍需实际验证；签名接口成功不等于已验证整个客户端登录过程。
- 原 `/opt/quality-pilot/production.env` 和旧镜像保留用于回滚；新服务重建应使用 `new-app.env`。

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

## 2026-09-11 新版入口修复

last_verified_at: 2026-09-11

已核实“登录后显示旧版”的原因：后端登录目标白名单不认识带生产前缀的马荣鑫、佟成页面，导致回退到旧任务首页；前端路径替换也会把登录目标判断缩小到旧工作台路径。两个视角菜单还将基础路径重复拼接，并把主管、员工指向普通任务首页。

- 免登目标校验现在识别新版首页，且仅在显式配置的独立试点进程启用；外站、接口地址和测试身份仍被拒绝。
- 主管、员工入口恢复为 `/workbench/quality?perspective=manager|employee`，使用 9 月 10 日确认的统一蓝白质量页面；它们也可切回马荣鑫和佟成。
- 曹玉寒的试点业务授权在质量视角查询和写入门禁保持一致。操作人始终为实际登录的曹玉寒；主管、员工仅投影本人关联任务，不借用其他主管身份。其他管理员仍只读。
- 预发布通过只读浏览器代理实际检查了四个页面及菜单跳转。使用隔离数据库与独立测试签名，未伪造生产会话、未提交 OA 或正式业务操作。
- 验证：9 个 Vitest 文件 77 项、3 个 Node 测试文件 23 项通过；TypeScript 检查通过。隔离服务页面、API、重定向和身份拒绝检查通过。
- 线上镜像已更新为 `manage-robot:quality-ui-fix-20260911-1118`（`ffefb746c124`）；配置仍为 `/opt/quality-pilot/new-app.env`。公网新版入口、登录脚本和无会话拒绝已复核，其他组织服务未重启。
- 回滚只替换此独立容器镜像为 `manage-robot:quality-app-20260911`，沿用当前 env 和数据卷；不要恢复数据库。

钉钉新应用仍为“质量追踪系统”，AgentId `4981819826`，首页为 `https://managebot.vivolightsales.com/workbench/quality-pilot/`。钉钉客户端内真实免登仍需用户重新进入应用确认；本次没有把预发布会话验证当作生产免登验证。
