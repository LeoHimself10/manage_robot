# 质量来源只读连接验证记录

## 目标

- 来源链接：`https://alidocs.dingtalk.com/i/nodes/lo1YvX0prG98k9woqvrYVPw7xzbmLdEZ`
- 目标工作表：第一个子表“客户端问题反馈记录表”
- 连接方式：钉钉企业内部应用 OpenAPI，只申请和使用钉钉表格读权限
- 禁止方式：浏览器 Cookie、个人登录态、页面抓取和任何表格写接口

## 接口契约

```text
GET /v1.0/doc/workbooks/{workbookId}/sheets?operatorId={operatorUnionId}
GET /v1.0/doc/workbooks/{workbookId}/sheets/{sheetId}?operatorId={operatorUnionId}
GET /v1.0/doc/workbooks/{workbookId}/sheets/{sheetId}/ranges/{rangeAddress}?select=values&operatorId={operatorUnionId}
```

## 2026-07-13 企业只读探针状态

状态：已通过阿里云 ECS Workbench 在现网容器执行真实网络探针，钉钉表格只读权限、目标表访问授权和项目探针均验证通过。

已完成：

- 只读客户端方法的单元测试通过。
- 探针会严格校验第一个子表名称、必要表头和非空数据行。
- 探针只输出工作表名称、行列数和表头，不输出业务数据、Access Token 或密钥。
- 现网 `/etc/manage-robot.env` 与 `/etc/manage-robot-mingsibot.env` 均已配置 `DINGTALK_CLIENT_ID`、`DINGTALK_CLIENT_SECRET`。
- 现网通讯录中“杨贺新”唯一匹配，`userId` 与 `unionId` 均存在；验证记录不保存其具体值。
- 权限开通后，使用 managebot 当前企业内部应用成功读取 16 个子表，并确认第一个子表为“客户端问题反馈记录表”。
- 首表占用范围为 1610 行（含表头）、28 列，其中实际有内容的数据行 1596 条；必要表头“反馈时间”“问题描述”“问题归类”均存在。
- 钉钉单次范围读取最多允许 30000 个单元格；客户端已自动把本表拆成两个 GET 请求并合并结果。
- 真实探针只请求 Access Token 和表格 GET 接口，没有调用任何表格写接口，也没有修改现网环境文件或容器。

开发和测试探针已用运行时参数验证以下两个配置值。由于本次不部署现网，现网环境文件暂不写入：

```text
QUALITY_SOURCE_WORKBOOK_ID
QUALITY_SOURCE_OPERATOR_UNION_ID
```

此前的 HTTP `403`（`Forbidden.AccessDenied.AccessTokenPermissionDenied`）已经随应用读权限和目标表授权完成而消除。目标分享链接中的节点标识已被 API 验证为可用工作簿标识，杨贺新的 `unionId` 可作为读取操作人。

配置完成后，在隔离工作区运行：

```bash
npm run quality:source-probe
```

通过标准：输出工作表“客户端问题反馈记录表”、非零数据行数及包含“反馈时间”“问题描述”“问题归类”的表头，命令退出码为 `0`。2026-07-13 实际执行结果满足此标准。
