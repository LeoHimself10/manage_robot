# 测试入口交互基线

last_verified_at: 2026-09-14

马荣鑫、佟成页面维持确认版布局；所有视角在当前页打开。顶部提供马荣鑫、佟成、模拟主管、模拟员工1/2/3入口和隔离测试提示。部门下拉框仅包含“模拟测试部门”，唯一对应“模拟主管”。主管/员工使用各自虚构业务身份，真实登录操作人另留审计。返回马荣鑫/佟成清除模拟身份选择。

只在独立测试数据卷运行；不发送消息、待办或催办，不回写 OA。旧初析草稿的真实部门不会自动改为模拟部门，应重新选择后保存。原始来源和 AI 快照不修改。原正式任务页面和处理逻辑复用。

源码：scripts/quality-simulation.mjs、scripts/quality-production-server.mjs、public/quality/{ma-workbench,tong}/view-switcher.js、src/web/quality-tracking-page.ts。
