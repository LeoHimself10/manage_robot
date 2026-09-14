# 曹玉寒受限质量入口 · 2026-09-11

## 用户确认版发布基线（11:36 更新）

last_verified_at: 2026-09-11

- 用户确认本地 8808/8809 与 8797 联动的 9 月 10 日晚版本，以本地闭环验收事件 `QE-20260910-E2EC5AEA` 为核对样本。此样本是本地测试数据，不导入生产。
- 原始 UI 与 OA 联动源码已保存在 `codex/tong-quality-prototype`，提交 `5b3eedd272367713028701bff293bb9cb8e62b67`；主管、员工及正式任务闭环源码在 `codex/yesterday-admin-test-actors`，提交 `3e7502433801f7113d6a4b58fa8a409c1a0425ca`。两个分支均已推到 GitHub。
- 可部署整合版在 `codex/quality-cao-production`，发布标识 `quality-approved-20260910-evening-r1`。`quality-release.lock.json` 固定上述来源及经过审核的生产接入差异；`quality-release.json` 保存发布包 518 个文件的 SHA-256。
- 31 个当前使用的 Ma/Tong 界面文件和附件逐文件核对：除两个菜单使用真实登录身份及生产路径外，与固定的原始版本一致。原正式任务源码的差异仅限锁文件所列 OA 接入、身份能力、登录和导航适配；执行、证据和验收沿用原闭环版本。
- 构建顺序：三个 `build:*` 浏览器 bundle → `node scripts/quality-release-verify.mjs --write` → 再执行不带 `--write` 的校验 → 打包 → `Dockerfile.quality-pilot`。镜像构建时再次校验所有文件，内容不符即失败。
- 服务响应新增 `X-Quality-Release`；本机 `/health` 返回该标识及两份原始提交号，以便区分实际运行版本和钉钉应用发布版本。
- 23 项生产身份、路径、OA 查询回归通过；隔离预发布的七个页面/API、三个跳转和无会话/错误用户拒绝检查通过。浏览器实际点击 Ma → 主管 → 员工 → Tong，页面保持已确认的蓝白布局。
- 11:36 已部署镜像 `manage-robot:quality-approved-20260910-evening-r1`（镜像配置 SHA `96e958a55a4b`），服务器材料位于 `/opt/quality-pilot/releases/approved-20260910-evening-r1`。只替换 `manage-robot-quality-cao` 容器，沿用 `/opt/quality-pilot/new-app.env` 和共享数据卷。原任务系统、明思和安徽容器 ID、启动时间保持不变。
- 运行中容器的 518 个发布文件再次校验通过；公网新入口、登录页、登录脚本、未登录 API 拒绝均返回该发布标识；原微光与明思工作台继续返回 200。
- 回滚使用上一镜像 `manage-robot:quality-ui-fix-20260911-1118` 并沿用当前配置和数据卷，不恢复数据库。

部署为同一台 ECS 上的独立服务：独立钉钉应用、容器、进程与配置；代码仍属于同一个 GitHub 仓库，质量与正式任务共用 SQLite。真实客户端免登和真实 OA 写回不由上述隔离验收代替。

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

## 2026-09-14 当前页面切换视角

last_verified_at: 2026-09-14

马荣鑫、佟成菜单中的全部视角链接（包含主管、员工）改用 target="_self"，箭头改为向右；主管、员工页面自身的四项菜单原本就在当前页打开。实际操作人仍是当前登录账号。发布标识 quality-approved-20260914-same-page-r2；原始确认版原型不覆盖。

验证：6 项导航测试通过；镜像构建对 518 个发布文件校验通过。已部署 manage-robot:quality-approved-20260914-same-page-r2，/health 正常，公网响应返回新发布标识，运行菜单确认 target="_self"。微光、明思、安徽及 Caddy 容器 ID 保持不变。钉钉客户端实际点击需刷新页面后确认。回滚镜像为 manage-robot:quality-approved-20260910-evening-r1，沿用当前配置与数据卷。
