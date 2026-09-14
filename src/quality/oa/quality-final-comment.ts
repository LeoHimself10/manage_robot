import type { DatabaseSync } from "node:sqlite";

type Row = Record<string, any>;
export function ensureQualityFinalCommentSchema(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS quality_final_comment_outbox (
    closure_id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES quality_events(id),
    process_instance_id TEXT, process_code TEXT, comment_user_id TEXT NOT NULL,
    opinion TEXT NOT NULL, comment_text TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('QUEUED','SENDING','SYNCED','FAILED','UNKNOWN','SUPPRESSED','UNLINKED')),
    attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );`);
}

/** Called only inside the successful close transaction. Targets never come from the browser. */
export function enqueueQualityFinalComment(db: DatabaseSync, input: {
  closureId: string; eventId: string; actorUserId: string; opinion: string; occurredAt: string; isTest: boolean;
}) {
  const sources = db.prepare("SELECT source_key FROM quality_event_source_links WHERE event_id=? ORDER BY linked_at").all(input.eventId) as Row[];
  const hasOa = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='quality_oa_instances'").get();
  const targets = hasOa ? sources.map(s => db.prepare("SELECT process_instance_id,process_code,is_fixture FROM quality_oa_instances WHERE source_key=?").get(s.source_key) as Row | undefined).filter(Boolean) : [];
  // A merged event must not guess which original workflow should receive the opinion.
  const target = sources.length === 1 && targets.length === 1 ? targets[0] : undefined;
  const suppressed = input.isTest || process.env.QUALITY_PILOT_TEST_MODE === "1" || target?.is_fixture === 1
    || process.env.QUALITY_OA_FINAL_COMMENT_ENABLED !== "1";
  const status = suppressed ? "SUPPRESSED" : target ? "QUEUED" : "UNLINKED";
  const commentText = `${input.opinion}\n[质量终验 ${input.closureId}]`;
  db.prepare(`INSERT INTO quality_final_comment_outbox
    (closure_id,event_id,process_instance_id,process_code,comment_user_id,opinion,comment_text,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(input.closureId,input.eventId,target?.process_instance_id ?? null,
      target?.process_code ?? null,input.actorUserId,input.opinion,commentText,status,input.occurredAt,input.occurredAt);
}

export function qualityFinalComments(db: DatabaseSync, eventId: string) {
  return db.prepare(`SELECT closure_id AS closureId,opinion,status,attempts,last_error AS lastError,
    created_at AS createdAt,updated_at AS updatedAt FROM quality_final_comment_outbox WHERE event_id=? ORDER BY created_at DESC`).all(eventId);
}

export interface FinalCommentClient {
  addComment(input: {processInstanceId: string; commentUserId: string; text: string}): Promise<unknown>;
  getInstance(id: string): Promise<any>;
}

/** Single-flight per process; DB compare-and-swap also excludes other workers. No blind retry after an ambiguous POST. */
export function createQualityFinalCommentWorker(db: DatabaseSync, client: FinalCommentClient, processCode: string) {
  let busy = false;
  function enabled() { return process.env.QUALITY_PILOT_TEST_MODE !== "1" && process.env.QUALITY_OA_FINAL_COMMENT_ENABLED === "1"; }
  // A crash after delivery is ambiguous. Never reset to QUEUED on restart.
  db.prepare("UPDATE quality_final_comment_outbox SET status='UNKNOWN',last_error='发送中断，需核对 OA 评论结果' WHERE status='SENDING'").run();
  async function processOne(closureId?: string) {
    if (busy || !enabled()) return;
    busy = true;
    try {
      const row = (closureId ? db.prepare("SELECT * FROM quality_final_comment_outbox WHERE closure_id=? AND status IN ('QUEUED','FAILED','UNKNOWN')").get(closureId)
        : db.prepare("SELECT * FROM quality_final_comment_outbox WHERE status='QUEUED' ORDER BY created_at LIMIT 1").get()) as Row | undefined;
      if (!row) return;
      if (row.process_code !== processCode || !row.process_instance_id) throw new Error("OA 评论目标与当前应用流程不一致");
      if (row.status === 'UNKNOWN') {
        const instance = await client.getInstance(row.process_instance_id);
        // Only a matching recorded comment proves delivery; absence is not proof of failure.
        const found = (instance.operationRecords ?? []).some((r: Row) =>
          String(r.remark ?? '') === row.comment_text && String(r.userId ?? '') === row.comment_user_id);
        if (found) db.prepare("UPDATE quality_final_comment_outbox SET status='SYNCED',last_error=NULL,updated_at=? WHERE closure_id=? AND status='UNKNOWN'").run(new Date().toISOString(),row.closure_id);
        return;
      }
      const claim = db.prepare("UPDATE quality_final_comment_outbox SET status='SENDING',attempts=attempts+1,updated_at=? WHERE closure_id=? AND status=?").run(new Date().toISOString(),row.closure_id,row.status);
      if (!claim.changes) return;
      try {
        await client.addComment({processInstanceId:row.process_instance_id,commentUserId:row.comment_user_id,text:row.comment_text});
        db.prepare("UPDATE quality_final_comment_outbox SET status='SYNCED',last_error=NULL,updated_at=? WHERE closure_id=?").run(new Date().toISOString(),row.closure_id);
      } catch (error: any) {
        const definite = error?.definitelyRejected === true;
        db.prepare("UPDATE quality_final_comment_outbox SET status=?,last_error=?,updated_at=? WHERE closure_id=?").run(
          definite ? 'FAILED' : 'UNKNOWN', definite ? 'OA 拒绝评论写入，请检查权限后重试' : '发送结果待核对；为避免重复评论，暂不重新发送',new Date().toISOString(),row.closure_id);
      }
    } finally { busy = false; }
  }
  return { processOne };
}
