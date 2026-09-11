import {OA_SCOPE} from './oa-store.mjs';
export function createOaSync({client,store,names={},scope=OA_SCOPE,now=()=>Date.now()}) {
  let running;
  async function sync() {
    const endTime=now(), previous=store.meta('discovery_window_v1')?store.meta('cursor'):null,startTime=previous?Math.max(previous-300000,endTime-119*86400000):endTime-119*86400000;
    const progress={status:'RUNNING',startedAt:new Date(endTime).toISOString(),inserted:0,updated:0,skipped:0,scanned:0};
    store.meta('sync',progress);
    try {
      let nextToken=0,pages=0; const seenTokens=new Set();
      do {
        if(++pages>200 || seenTokens.has(String(nextToken))) throw new Error('OA_PAGINATION_LIMIT');
        seenTokens.add(String(nextToken));
        const result=await client.listIds(scope.processCode,startTime,endTime,nextToken);
        if(!Array.isArray(result.list))throw new Error('OA_INVALID_LIST');
        store.enqueue(result.list);
        nextToken=result.nextToken;
      } while(nextToken!==undefined&&nextToken!==null&&String(nextToken)!=='-1'&&String(nextToken)!=='');
      // Advance discovery only after every page was durably enqueued. Failed reads remain queued.
      store.meta('cursor',endTime);
      store.meta('discovery_window_v1',true);
      for(const id of store.pending()) {
        const detail=await client.getInstance(id);
        const counts=store.ingest(id,detail,names);
        for(const key of ['inserted','updated','skipped'])progress[key]+=counts[key];
        progress.scanned++;
      }
      store.meta('sync',{...progress,status:'SUCCEEDED',completedAt:new Date(now()).toISOString()});
      return store.meta('sync');
    } catch(error) {
      // Never log tokens, URLs with tokens, or raw DingTalk error payloads.
      const code=String(error.code || error.message || 'OA_SYNC_FAILED').replace(/[^a-zA-Z0-9_.-]/g,'').slice(0,100);
      store.meta('sync',{...progress,status:'FAILED',code,failedAt:new Date(now()).toISOString()});
      throw Object.assign(new Error(code),{code});
    }
  }
  return {
    sync(){return running || (running=sync().finally(()=>{running=null;}));},
    // Use inside the original application's existing authenticated Stream listener.
    // There is intentionally no public unverified webhook and no second robot connection.
    async onEvent(event) {
      if((event.corpId||event.CorpId)!==scope.corpId || event.processCode!==scope.processCode || !['bpms_task_change','bpms_instance_change'].includes(event.EventType))return {ignored:true};
      const id=event.eventId || `${event.EventType}:${event.processInstanceId}:${event.taskId||''}:${event.type}:${event.EventTime||event.createTime||event.finishTime}`;
      if(store.db.prepare("SELECT 1 FROM oa_events WHERE id=? AND status='DONE'").get(id))return {duplicate:true};
      store.db.prepare("INSERT OR IGNORE INTO oa_events VALUES (?,?,'PENDING',?)").run(id,event.processInstanceId,new Date(now()).toISOString());
      store.enqueue([event.processInstanceId]);
      const detail=await client.getInstance(event.processInstanceId);
      const result=store.ingest(event.processInstanceId,detail,names);
      store.db.prepare("UPDATE oa_events SET status='DONE' WHERE id=?").run(id);
      return result;
    },
  };
}
