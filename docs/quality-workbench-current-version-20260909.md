# 当前版本与启动说明

last_verified_at: 2026-09-09

## 版本组成

当前运行页面来自 `codex/tong-quality-prototype`，入口是 `scripts/quality-ui-ai-server.mjs`。8808 使用 `docs/mockups/quality-oa-workflow-connected-20260909/`；8809 使用 `docs/mockups/tong-workbench-20260908/`。较早的设计稿保留在独立目录，当前入口以这里为准。

该服务还从两个相邻工作目录导入源码：

- 原系统：`codex/yesterday-admin-test-actors`，提交 `bc58cf595d8091e8884125969e71c8f737a81a94`。提供原 AI 模型、提示词、检索、校验器、8797 工作台与正式 SQLite 数据库，并修复本地视角切换返回旧界面的问题。
- 马荣鑫业务服务：`codex/ma-quality-workbench-v1`，提交 `e9ec021b728bc9334251e49aa814718b8f754b11`。提供 OA 来源适配、准入、人工研判版本、正式通报事务和后续任务投影。

这三个分支共同保存本地运行版本；仅下载本分支无法替代两个后端依赖。固定提交也记录在 `config/quality-workbench-version.json`，恢复时优先使用提交号。

## 已接通范围

- 马荣鑫：实际 OA 来源同步到全部事件；确认进入质量事件后才可研判；AI 调用原系统并独立保存；人工保存和正式推送分开；可以只读查看后续初析、分配、执行、验收。
- 佟成：保留已确认的完整 HTML 和视角切换；初析默认单份可编辑草稿，AI 原稿及历史折叠查看；生成新 AI 不覆盖人工草稿；验收通过/不通过及指定节点退回可以交互。AI 已接原系统，业务流转仍使用样例和浏览器本地存储，尚未接正式初析、分配、终验 API。
- 8797：已登录且有相应能力的本地根入口，按马荣鑫/佟成视角导航到 8808/8809。已有事件深链接继续使用原系统，不改其记录标识。
- 钉钉：当前只读取配置流程的审批来源，不在此版本写回 OA 评论、改变线上审批或发送业务通知。正式事件及任务桥接写入本地数据库。

## 在新目录恢复源码

使用支持 `node:sqlite` 的 Node.js 22.13+，以下命令仅用于新的恢复目录；现有正在运行的工作目录无需重新创建。

```powershell
git clone --branch codex/tong-quality-prototype https://github.com/LeoHimself10/manage_robot.git tong-quality-prototype
Set-Location tong-quality-prototype
git worktree add --detach ../yesterday-admin-test-actors bc58cf595d8091e8884125969e71c8f737a81a94
git worktree add --detach ../ma-quality-workbench-v1 e9ec021b728bc9334251e49aa814718b8f754b11
npm ci
npm --prefix ../yesterday-admin-test-actors ci
npm --prefix ../ma-quality-workbench-v1 ci
```

在原系统目录的 `.env` 配置有效的 `DASHSCOPE_API_KEY` 或 `QWEN_API_KEY`。界面服务仅从该文件复用模型配置，不把密钥发给浏览器。

在界面目录复制示例后，填写所属组织、应用、审批流程与审批人员的实际标识：

```powershell
Copy-Item config/quality-oa-scope.example.json .env.oa-scope.local
Copy-Item config/quality-oa-credentials.example.json .env.oa.local
```

两份文件均为 JSON，均被 Git 忽略。`clientId` 必须一致，应用须具备审批读取权限。也可通过 `QUALITY_OA_SCOPE_FILE` 指定标识配置的绝对路径。不要在已有配置上再次执行复制命令。

在第一个终端，进入原系统目录启动服务：

```powershell
Set-Location ../yesterday-admin-test-actors
$env:QUALITY_EVENT_ROLE_PANELS_ENABLED = '1'
$env:QUALITY_TEST_ACTORS_ENABLED = '1'
$env:WORKBENCH_ADMIN_TEST_SYSTEM_ENABLED = '1'
$env:QUALITY_LOCAL_REVIEW_UI_ENABLED = '1'
node --import tsx scripts/local-quality-initial-analysis-dev.ts --keep-data
```

保留 `--keep-data`：该开发脚本省略此参数会重置它的本地验收数据库。新目录第一次启动会建立验收数据。

在第二个终端，进入界面目录启动 8808/8809：

```powershell
Set-Location tong-quality-prototype
node --import tsx scripts/quality-ui-ai-server.mjs
```

8808 的首次本机登录入口写在忽略文件 `data/quality-oa/local-entry.json`，只在本机使用。8797 提供原系统登录及视角切换。启动原系统后再启动界面服务，确保正式数据库已经初始化。

本机原有 OA 数据、AI 历史和人工研判不在 Git 中。它们分别保存在界面目录的 `data/quality-oa/`、`data/quality-ui-ai/`，以及原系统目录的 `data/local-quality-initial-analysis-v1/`。恢复已有业务记录需要另行恢复私有数据备份。可选通讯录从主项目的 `data/local-production-db/workbench.sqlite` 读取；没有该文件时来源人员会使用原始用户标识。

## 验证记录

- 当前界面与 OA 桥接：10 项 Node 回归通过，覆盖来源门禁、版本、去重、本机会话、AI 幂等、准入、保存不推送、正式通报与后续投影。
- 马荣鑫业务服务：6 个 Vitest 文件、25 项测试通过。
- 本地入口及角色页面：18 项测试通过。
- 此前已在 1366×768 和 1920×1080 验证主要界面及导航；本次发布准备只调整私有标识配置和版本说明，没有重新操作真实审批数据。

本次 GitHub 保存不包含 ECS 部署或主分支合并。
