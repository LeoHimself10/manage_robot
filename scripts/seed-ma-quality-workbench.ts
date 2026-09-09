import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchSqlitePath } from "../src/infra/workbench-db-path";
import { createWorkbenchFormalTaskStore } from "../src/infra/workbench-formal-task-store";
import type { PlanSession } from "../src/infra/plan-session-store";
import { createQualityStore } from "../src/quality/infra/quality-store";
import { createMaWorkbenchService } from "../src/quality/ma-workbench/service";
import { attachQualityOaTestFile, ingestQualityOaInstance, listQualityOaAttachments } from "../src/quality/oa/quality-oa-source";
import type { OaInstance } from "../src/quality/oa/quality-oa-connector";
import { reconcileQualityPlanningPublication } from "../src/quality/analysis/quality-formal-task-projection";
import { createQualityEvidenceService } from "../src/quality/evidence/quality-evidence-service";
import { createQualityReviewService } from "../src/quality/reviews/quality-review-service";
import { createQualityClosureService } from "../src/quality/closure/quality-closure-service";

const MA = "ma-local", TONG = "tong-local", MANAGER = "rd-manager-local";
const DEPARTMENT = "软件研发部（本地测试）";
const versionRequest = (sourceVersion = 1) => ({ requestId: randomUUID(), expectedSourceVersion: sourceVersion });

/** Local empty-database fixture only. This function never invokes AI or an OA connector. */
export async function seedMaQualityWorkbench(dbPath: string): Promise<void> {
  if (resolve(resolveWorkbenchSqlitePath()) !== resolve(dbPath)) throw new Error("本地演示库必须与 WORKBENCH_SQLITE_PATH 一致");
  if (process.env.QUALITY_TASK_PLANNING_V2_ENABLED !== "1") throw new Error("本地演示要求 QUALITY_TASK_PLANNING_V2_ENABLED=1");
  createQualityStore(dbPath).close();
  const check = new DatabaseSync(dbPath);
  try {
    // Do not overwrite any user work, even when a previous seed was interrupted.
    const sourceCount = Number((check.prepare("SELECT count(*) AS n FROM quality_source_rows").get() as { n: number }).n);
    const eventCount = Number((check.prepare("SELECT count(*) AS n FROM quality_events").get() as { n: number }).n);
    const hasTasks = check.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks'").get();
    const taskCount = hasTasks ? Number((check.prepare("SELECT count(*) AS n FROM tasks").get() as { n: number }).n) : 0;
    if (sourceCount || eventCount || taskCount) return;
  } finally { check.close(); }

  const titles = ["启动后图像偶发闪烁", "图像导出偶发失败", "报告字段显示错位", "文件导出时弹出错误提示", "大量病例导出耗时增高", "历史病例列表分页卡顿"];
  const sourceKeys: string[] = [];
  for (const [index, title] of titles.entries()) {
    const number = index + 1;
    const processInstanceId = `LOCAL-MA-${String(number).padStart(3, "0")}`;
    const sourceKey = `oa:${processInstanceId}`;
    const logId = `${processInstanceId}-log`, dataId = `${processInstanceId}-data`;
    const fields: NonNullable<OaInstance["formComponentValues"]> = [
      { name: "产品类型选项", value: "OCT（本地演示）" }, { name: "设备型号", value: "Classic A（演示）" },
      { name: "设备序列号", value: `LOCAL-SN-${number}` }, { name: "软件版本", value: "10.2-local" },
      { name: "导管型号", value: "A2（演示）" }, { name: "导管生产批号", value: "LOCAL-BATCH-202609" },
      { name: "导管是否可以回收寄回", value: "是" }, { name: "本次报损的导管数量（条）", value: "1" },
      { name: "WHAT", value: `【本地演示】${title}` }, { name: "WHERE", value: "演示医院（虚构）" },
      { name: "WHEN", value: `2026-09-0${Math.min(number + 2, 8)}` },
      { name: "HOW", value: "本地样例：进入病例列表，连续操作导出功能时观察界面及日志。本记录用于交互验证。" },
      { name: "HOW MANY", value: String(number) }, { name: "影响程度", value: "中度影响：需重复操作，无患者信息（本地演示）" },
      { name: "服务日志导出并上传", componentType: "Attachment", value: [{ fileId: logId, fileName: "设备服务日志-本地演示.txt", mimeType: "text/plain", fileSize: 300 }] },
      { name: "数据原始格式导出并上传", componentType: "Attachment", value: [{ fileId: dataId, fileName: "问题复现数据-本地演示.json", mimeType: "application/json", fileSize: 300 }] },
    ];
    const instance: OaInstance = { title: `【本地演示】${title}`, businessId: `2026090909000001000${number}`, createTime: `2026-09-0${Math.min(number + 2, 8)}T01:00:00.000Z`, originatorUserId: `feedback-local-${number}`, originatorDeptId: "service-local", originatorDeptName: "客户服务部（本地测试）", status: "RUNNING", formComponentValues: fields, operationRecords: [{ type: "START_PROCESS_INSTANCE", remark: "本地演示：员工提交", createTime: "2026-09-08T01:00:00.000Z" }] };
    const ingest = (record: OaInstance, at: string) => ingestQualityOaInstance({ dbPath, processCode: "PROC-LOCAL-MA-DEMO", processInstanceId, instance: record, receivedAt: at, isTest: false, localFixture: true, reporterName: `员工${number}（本地演示）` });
    ingest(instance, "2026-09-08T01:00:00.000Z");
    if (number === 3) {
      const updated = fields.map(field => field.name === "HOW" ? { ...field, value: `${String(field.value)} 补充：第二次操作仍出现相同现象。` } : field);
      ingest({ ...instance, formComponentValues: updated }, "2026-09-08T02:00:00.000Z");
    }
    if (number >= 5) ingest({ ...instance, status: "COMPLETED", result: "agree", operationRecords: [...instance.operationRecords!, { type: "EXECUTE_TASK_NORMAL", result: "agree", remark: "本地演示：主管审核通过", createTime: "2026-09-08T02:30:00.000Z" }] }, "2026-09-08T02:30:00.000Z");
    attachQualityOaTestFile({ dbPath, sourceKey, fileId: logId, body: Buffer.from(`【本地演示文件】\n事件：${title}\n设备：LOCAL-SN-${number}\n[09:00:01] 初始化完成\n[09:00:03] 开始导出样例数据\n[09:00:05] 记录现场现象，等待质量研判\n本日志无真实设备、员工或患者数据。\n`) });
    attachQualityOaTestFile({ dbPath, sourceKey, fileId: dataId, body: Buffer.from(JSON.stringify({ dataType: "LOCAL_DEMO_ONLY", event: title, device: `LOCAL-SN-${number}`, steps: ["打开病例", "导出", "记录耗时"], observedDurationMs: 1200 + number * 750, containsPatientData: false }, null, 2)) });
    sourceKeys.push(sourceKey);
  }

  const ma = createMaWorkbenchService({ dbPath, listAttachments: listQualityOaAttachments });
  const submitted: Array<{ sourceKey: string; eventId: string }> = [];
  try {
    for (let index = 1; index < sourceKeys.length; index++) {
      const sourceKey = sourceKeys[index]!; const sourceVersion = ma.get(sourceKey, MA).sourceVersion;
      ma.admit(sourceKey, MA, versionRequest(sourceVersion));
      if (index === 1) continue;
      ma.saveAssessment(sourceKey, MA, { ...versionRequest(sourceVersion), expectedVersion: 0, categoryMode: "STANDARD", primaryCategoryCode: "SOFTWARE_DATA", secondaryCategoryCode: index === 2 ? "SOFTWARE_FEATURE_CONFIG" : "SOFTWARE_STABILITY_ERROR", riskLevel: "MEDIUM", conclusion: `【本地演示】已核对原始日志与操作步骤，${titles[index]}需要进入软件方向的质量初析。当前未调用AI。`, adoptionMode: "MANUAL" });
      if (index === 2) continue;
      const result = ma.submit(sourceKey, MA, { ...versionRequest(sourceVersion), expectedAssessmentVersion: 1 });
      submitted.push({ sourceKey, eventId: result.event!.id });
    }
  } finally { ma.close(); }
  await seedDownstream(dbPath, submitted[1]!.eventId, false);
  await seedDownstream(dbPath, submitted[2]!.eventId, true);
  // Only record outbound examples locally. No pending fixture notification can
  // accidentally become a real delivery if a background worker starts later.
  const outbox = new DatabaseSync(dbPath);
  try { outbox.prepare("UPDATE quality_notification_outbox SET channel='TEST',status='SENT',last_error=NULL WHERE event_id IN (SELECT id FROM quality_events WHERE created_by=?)").run(MA); }
  finally { outbox.close(); }
}

async function seedDownstream(dbPath: string, eventId: string, close: boolean): Promise<void> {
  const now = new Date().toISOString(); const dueAt = "2026-09-18T10:00:00.000Z";
  const planId = `ma-local-plan-${close ? "closed" : "progress"}`;
  const integrationKey = `quality-node:${eventId}:analysis-v2`;
  const definitions = close ? [
    { id: "task-1", title: "定位分页卡顿根因", objective: "分析日志并复现分页卡顿", deliverables: "根因分析记录", completionCriteria: "覆盖500条和2000条病例两个边界场景", userId: "rd-one-local" },
    { id: "task-2", title: "修复并验证分页性能", objective: "优化查询并完成回归", deliverables: "修复与回归验证报告", completionCriteria: "连续分页无卡顿，响应时间小于300ms", userId: "rd-two-local" },
  ] : [
    { id: "task-1", title: "复现导出耗时并定位瓶颈", objective: "比较单病例和批量病例导出耗时", deliverables: "复現日志与耗时统计", completionCriteria: "覆盖200例和1000例两档，记录设备与版本", userId: "rd-one-local" },
    { id: "task-2", title: "优化导出队列内存使用", objective: "实现分段读取并验证内存峰值", deliverables: "修改说明与内存曲线", completionCriteria: "连续导出不超过约定内存阈值", userId: "rd-two-local" },
    { id: "task-3", title: "核对历史数据格式兼容性", objective: "验证旧病例数据能完整导出", deliverables: "兼容性核对表", completionCriteria: "关键字段不缺失且可重复导入", userId: "rd-one-local" },
    { id: "task-4", title: "完成完整场景回归", objective: "复测新版本与原有临床操作路径", deliverables: "回归测试报告", completionCriteria: "全部关键场景通过，留存失败样例", userId: "rd-two-local" },
  ];
  const db = new DatabaseSync(dbPath); db.exec("PRAGMA foreign_keys=ON");
  try {
    for (const version of [1, 2]) {
      const content = { problemDirection: close ? "软件查询性能" : "软件数据导出性能", confirmedCategoryReference: "软件与数据功能 / 稳定性、重启与报错", sourceFactSummary: ["【本地演示】原始日志与员工反馈均已留存", "问题可由明确操作路径触发"], confirmedFacts: ["相同数据重复操作可观察到差异"], analysisBasis: ["原始OA表单记录", version === 1 ? "已核对第一版日志" : "新增大批量数据边界对比结果"], preliminaryConclusion: version === 1 ? "初步考虑查询与文件写入耗时叠加，需要定量复现。" : "已缩小到软件处理路径，安排同一软件研发部门进一步定位和验证。", causeHypotheses: ["数据量增长触发额外读取与内存占用"], investigationDirections: ["分解查询、解析与导出三个阶段耗时"], informationGaps: version === 1 ? ["需要1000例数据量的对照日志"] : [], handlingRequirements: ["保留复现前后日志", "修复必须经过本部门主管验收", "测试材料使用本地虚构数据"], suggestedTotalDueAt: dueAt };
      const deliverables = definitions.map((item, index) => ({ deliverableId: `local-deliverable-${index}`, name: item.deliverables, description: item.objective, acceptanceCriteria: item.completionCriteria, source: "HUMAN_CUSTOM", selected: true, createdAt: now, updatedAt: now }));
      db.prepare(`INSERT INTO quality_analysis_versions(analysis_id,event_id,analysis_version,request_id,content_json,deliverables_json,diff_json,modification_reason,primary_department_id,primary_department_name,collaborator_departments_json,primary_manager_user_id,primary_manager_name,primary_manager_account_status,suggested_total_due_at,schema_version,rule_version,case_library_version,knowledge_version,edited_by,confirmed_by,confirmed_at,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), eventId, version, randomUUID(), JSON.stringify(content), JSON.stringify(deliverables), JSON.stringify(version === 2 ? { analysisBasis: "补充边界数据对照", requirement: "同一主责部门继续处理" } : {}), version === 1 ? "【本地演示】人工初析，无AI调用" : "【本地演示】补充数据后修订，保留V1", "rd-local", DEPARTMENT, "[]", MANAGER, "研发主管（本地测试）", "ACTIVE", dueAt, "quality-analysis-output-v1", "local-demo-rules", "local-demo-cases", "local-demo-knowledge", TONG, TONG, now, now);
      db.prepare(`INSERT INTO quality_audit_events(id,event_id,actor_user_id,actor_role,action,before_json,after_json,reason,request_id,occurred_at) VALUES(?,?,?,'quality_specialist','QUALITY_ANALYSIS_CONFIRMED',NULL,?,?,?,?)`)
        .run(randomUUID(), eventId, TONG, JSON.stringify({ analysisVersion: version, primaryDepartmentName: DEPARTMENT }), `【本地演示】质量初析V${version}，唯一主责部门：${DEPARTMENT}`, randomUUID(), now);
    }
    db.prepare(`INSERT INTO quality_analysis_handoffs(handoff_id,event_id,analysis_version,integration_key,primary_department_id,primary_department_name,primary_manager_user_id,task_package_json,plan_id,thread_id,status,created_at)
      VALUES(?,?,2,?,'rd-local',?,?,'{}',?,?,'PENDING_PLANNING',?)`).run(randomUUID(), eventId, integrationKey, DEPARTMENT, MANAGER, planId, `ma-local-thread-${planId}`, now);
    db.prepare("UPDATE quality_events SET status='PENDING_ASSIGNMENT',original_primary_department_id='rd-local',overall_due_at=?,version=version+1 WHERE id=?").run(dueAt, eventId);
  } finally { db.close(); }

  const formal = createWorkbenchFormalTaskStore();
  const session: PlanSession = { chatKeyHash: `ma-local-${planId}`, planId, createdAt: now, updatedAt: now, knownFacts: [], conversationHistory: [], senderStaffId: MANAGER,
    latestDraft: { title: close ? "【本地演示】历史病例列表分页卡顿整改" : "【本地演示】大量病例导出性能整改", description: "【本地演示】由佟成完成初析后交给唯一软件研发部门。", tasks: definitions.map(item => ({ ...item, dueAt })) },
    latestAssignment: { assignments: definitions.map(item => ({ taskId: item.id, primary: { userId: item.userId } })) } };
  const published = formal.publishFromSession({ planId, session, managerUserId: MANAGER, actorUserId: MANAGER, actorName: "研发主管（本地测试）", initiatorDepartment: DEPARTMENT });
  for (const [index, task] of published.subtasks.entries()) {
    if (!close && index === 3) continue;
    formal.updateSubtaskStatus({ subtaskId: task.subtaskId, actorUserId: task.assigneeUserId, action: "accept", note: "【本地演示】已接受部门主管分配" });
    formal.updateSubtaskStatus({ subtaskId: task.subtaskId, actorUserId: task.assigneeUserId, action: "progress", progressStatus: !close && index === 2 ? "BLOCKED" : "IN_PROGRESS", note: !close && index === 2 ? "【本地演示】等待旧版本格式样本，已向主管说明阻塞原因" : index === 1 ? "【本地演示】实现已完成约70%，正在补充大数据量验证" : "【本地演示】已复现并取得第一组证据" });
  }
  reconcileQualityPlanningPublication({ eventId, integrationKey, planId, formalTaskId: published.task.taskId, actorUserId: MANAGER, dbPath, publishedAt: now });
  // The published-task bridge initially exposes PENDING_ACCEPTANCE. These
  // fixtures explicitly model the already-accepted department manager stage.
  const accepted = new DatabaseSync(dbPath);
  try {
    accepted.prepare("UPDATE quality_events SET status='IN_PROGRESS',version=version+1,updated_at=? WHERE id=? AND status IN ('PENDING_ACCEPTANCE','PENDING_ASSIGNMENT')").run(now, eventId);
    accepted.prepare(`INSERT INTO quality_audit_events(id,event_id,actor_user_id,actor_role,action,before_json,after_json,reason,request_id,occurred_at) VALUES(?,?,?,'department_manager','QUALITY_NODE_ACCEPTED',NULL,?,?,?,?)`)
      .run(randomUUID(), eventId, MANAGER, JSON.stringify({ status: "IN_PROGRESS", departmentName: DEPARTMENT }), "【本地演示】唯一主责部门主管已承接并分配本部门员工", randomUUID(), now);
  } finally { accepted.close(); }

  const evidence = createQualityEvidenceService({ dbPath, rootDir: join(dirname(dbPath), "quality-evidence") });
  const review = createQualityReviewService({ dbPath });
  const store = createQualityStore(dbPath);
  try {
    for (const [index, task] of published.subtasks.entries()) {
      if (!close && index > 1) continue;
      const reader = new DatabaseSync(dbPath, { readOnly: true });
      const linked = reader.prepare("SELECT node_id FROM quality_task_links WHERE subtask_id=?").get(task.subtaskId) as { node_id: string }; reader.close();
      const nodeId = linked.node_id;
      evidence.uploadEvidence({ nodeId, actorUserId: task.assigneeUserId, originalName: `${task.title}-验证记录V1.txt`, mimeType: "text/plain", summary: "【本地演示】首次复现及验证数据", buffer: Buffer.from(`【本地演示证据】\n任务：${task.title}\n结果：已记录初步现象。\n责任部门：${DEPARTMENT}\n`), requestId: randomUUID() });
      if (!close && index === 1) continue;
      evidence.submitCompletion({ nodeId, actorUserId: task.assigneeUserId, expectedVersion: store.getAssignmentNode(nodeId)!.version, requestId: randomUUID() });
      if (!close && index === 0) {
        review.reviewDirectChild({ childNodeId: nodeId, actorUserId: MANAGER, decision: "RETURN", reason: "【本地演示】缺少1000例数据边界，请补充后重新提交", expectedVersion: store.getAssignmentNode(nodeId)!.version, requestId: randomUUID() });
        evidence.uploadEvidence({ nodeId, actorUserId: task.assigneeUserId, originalName: `${task.title}-补充验证记录V2.txt`, mimeType: "text/plain", summary: "【本地演示】补充1000例边界测试，保留V1", buffer: Buffer.from("【本地演示证据V2】\n200例导出：1.2秒\n1000例导出：3.8秒\n已补充环境与版本信息，结论可复查。\n"), requestId: randomUUID() });
        evidence.submitCompletion({ nodeId, actorUserId: task.assigneeUserId, expectedVersion: store.getAssignmentNode(nodeId)!.version, requestId: randomUUID() });
      }
      review.reviewDirectChild({ childNodeId: nodeId, actorUserId: MANAGER, decision: "APPROVE", reason: "【本地演示】已核对交付物与证据，符合本任务验收要求", expectedVersion: store.getAssignmentNode(nodeId)!.version, requestId: randomUUID() });
    }
    if (close) {
      review.primaryReview({ eventId, primaryManagerUserId: MANAGER, decision: "APPROVE", reason: "【本地演示】全部员工任务已逐项验收", expectedVersion: store.getEvent(eventId)!.version, requestId: randomUUID() });
      const closure = createQualityClosureService({ dbPath });
      try { closure.closeEvent({ eventId, specialistUserId: TONG, conclusion: "【本地演示】已确认分页查询路径为根因，完成查询优化及边界回归；全部证据和主管验收完整，质量终验通过。", expectedVersion: store.getEvent(eventId)!.version, requestId: randomUUID() }); }
      finally { closure.close(); }
    }
  } finally { evidence.close(); review.close(); store.close(); }
}
