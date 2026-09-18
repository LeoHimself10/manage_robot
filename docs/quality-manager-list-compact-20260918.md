# 主管列表精简 r17

last_verified_at: 2026-09-18
status: deployed

员工／分配事项列原先把未分派事项的完整初析与来源描述当作任务名称展开，导致行高过大。现在未正式分派时只展示人员与状态；正式任务名称最多显示两行、每个事件预览两项，其余点击事件查看。完整内容与数据未修改。

验证：类型检查、内联脚本语法检查通过；使用实际列表渲染函数和样式在 1366 / 1920 宽度验证长文本省略、待分派不显示正文。验证是组件夹具，不冒充真实线上操作。线上 534 个发行文件哈希和访问门禁通过；正式任务、事件、初析、证据、审计数据校验保持一致。

发布镜像：manage-robot:quality-test-list-compact-20260918-r17，仅更新 manage-robot-quality-cao 隔离测试入口。
备份：/opt/quality-pilot/backups/list-compact-r17-20260918。
回滚镜像：manage-robot:quality-test-acceptance-20260918-r16，沿用原 env、挂载和端口重建。
