import {assessmentFailure,assessmentFailureDiagnostic} from './quality-assessment-error.mjs';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {DingTalkOaClient} from '../src/quality/oa/oa-client.mjs';
import {OaStore,OA_SCOPE} from '../src/quality/oa/oa-store.mjs';
import {createOaSync} from '../src/quality/oa/oa-sync.mjs';
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
const same=(a,b)=>typeof a==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export async function createOaHandler({root,runtime,names={},workflowFactory,productionAccess,tongAccess,dataDirectory,oaConfig}) {
  const dataRoot=dataDirectory || join(root,'data/quality-oa'); await mkdir(dataRoot,{recursive:true});
  const store=new OaStore(join(dataRoot,'oa.sqlite'));
  store.db.exec(`CREATE TABLE IF NOT EXISTS oa_ai (request_id TEXT PRIMARY KEY,source_id TEXT NOT NULL,source_version INTEGER NOT NULL,status TEXT NOT NULL,hash TEXT NOT NULL,response TEXT,at TEXT NOT NULL)`);
  store.db.prepare("UPDATE oa_ai SET status='FAILED',response=? WHERE status='GENERATING'").run(JSON.stringify({ok:false,error:'服务重启中断了本次请求，请重新生成。'}));
  let localAuth;
  const authFile=join(dataRoot,'local-session.json');
  try {localAuth=JSON.parse(await readFile(authFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!localAuth){localAuth={session:randomBytes(32).toString('hex'),bootstrap:randomBytes(32).toString('hex')};await writeFile(authFile,JSON.stringify(localAuth),{mode:0o600,flag:'wx'});}
  if(!/^[a-f0-9]{64}$/.test(localAuth.session)||!/^[a-f0-9]{64}$/.test(localAuth.bootstrap))throw new Error('Invalid local session');
  const {session,bootstrap}=localAuth;
  // This is a single-user loopback development session, not a production DingTalk identity.
  // Neither credentials nor this bootstrap URL are served by the static file handler.
  await writeFile(join(dataRoot,'local-entry.json'),JSON.stringify({path:'/oa/login?key='+bootstrap}),{mode:0o600});
  const configFile=join(root,'.env.oa.local');let syncer,config;
  const namesWithReviewers={...names,[OA_SCOPE.reviewerId]:'客服主管',[OA_SCOPE.cosignerId]:'质量主管'};
  function install(c){config=c;syncer=createOaSync({client:new DingTalkOaClient(c),store,names:namesWithReviewers});}
  if(oaConfig)install(oaConfig);
  else try {install(JSON.parse(await readFile(configFile,'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;}
  const trigger=()=>process.env.QUALITY_OA_SYNC_ENABLED==='0'?undefined:syncer?.sync().catch(()=>{});
  const timer=setInterval(trigger,60000);timer.unref(); if(syncer)trigger();
  const inFlight=new Map();
  const workflow=workflowFactory?await workflowFactory(store,config ? new DingTalkOaClient(config) : null):null;
  const status=()=>({configured:!!config,scope:OA_SCOPE,sync:store.meta('sync'),count:store.list().length,intervalSeconds:60,transport:'POLLING',ai:runtime.health.assessment});
  async function body(req){let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>20000)throw new Error('请求过大');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  const authorized=req=>(req.headers.cookie||'').split(';').some(c=>same(c.trim(),'quality_oa_session='+session));
  return {
    store,status,close(){clearInterval(timer);workflow?.close();store.close();},
    async handle(req,res){
      const host=req.headers.host,port=req.socket.localPort;
      if(!productionAccess&&!['127.0.0.1:'+port,'localhost:'+port].includes(host))return false;
      const url=new URL(req.url,'http://'+host);
      if(!url.pathname.startsWith('/api/quality-oa/')&&!url.pathname.startsWith('/oa/'))return false;
      res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
      if(!productionAccess&&req.headers.origin&&req.headers.origin!=='http://'+host){json(res,403,{ok:false,error:'不允许跨站请求'});return true;}
      if(req.headers['sec-fetch-site']==='cross-site'){json(res,403,{ok:false,error:'请从本机入口打开'});return true;}
      if(!productionAccess&&url.pathname==='/oa/login'&&req.method==='GET'&&same(url.searchParams.get('key'),bootstrap)){
        res.writeHead(303,{'set-cookie':`quality_oa_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`,'location':'/ma-workbench/','cache-control':'no-store'});res.end();return true;
      }
      if(!(productionAccess?productionAccess(req):authorized(req))){json(res,401,{ok:false,error:'请从本机授权入口打开 OA 工作台。'});return true;}
      if(productionAccess&&url.pathname.startsWith('/api/quality-oa/tong')&&(!tongAccess||!tongAccess(req))){json(res,403,{ok:false,error:'仅质量主管视角可访问质量处理工作台'});return true;}
      try {
        if(req.method==='GET'&&url.pathname==='/api/quality-oa/status')json(res,200,{ok:true,data:status()});
        else if(req.method==='GET'&&url.pathname==='/api/quality-oa/attachment') {
          const source=store.get(url.searchParams.get('id'));
          const field=source?.attachments.find(f=>f.id===url.searchParams.get('field'));
          let files=[];try{files=JSON.parse(field?.value||'[]');}catch{}
          const file=Array.isArray(files)?files.find(f=>String(f.fileId)===url.searchParams.get('file')):null;
          if(!file||!config){json(res,404,{ok:false,error:'附件不存在或尚未配置 OA'});return true;}
          try {
            const result=await new DingTalkOaClient(config).request('/v1.0/workflow/processInstances/spaces/files/urls/download',{processInstanceId:source.instanceId,fileId:String(file.fileId)});
            const link=new URL(result.downloadUri);
            // DingTalk may return an HTTP OSS signed URL; the same signature works over TLS.
            if(link.protocol==='http:'&&link.hostname.endsWith('.aliyuncs.com'))link.protocol='https:';
            if(link.protocol!=='https:')throw new Error('INVALID_ATTACHMENT_URL');
            json(res,200,{ok:true,url:link.href});
          }catch(error){json(res,error.status===403?403:502,{ok:false,error:error.status===403?'钉钉应用缺少审批附件下载权限，请管理员开通后重试。':'附件链接获取失败，请稍后重试。'});}
        }
        else if(req.method==='GET'&&url.pathname==='/api/quality-oa/sources')json(res,200,{ok:true,items:store.list(),status:status()});
        else if(workflow&&req.method==='GET'&&url.pathname==='/api/quality-oa/tong')json(res,200,{ok:true,items:workflow.tongList()});
        else if(workflow&&req.method==='POST'&&/^\/api\/quality-oa\/tong\/(generate|draft|confirm|final-close|final-return|final-reopen|comment-retry)$/.test(url.pathname)) {
          const b=await body(req);json(res,200,{ok:true,data:await workflow.tongMutate(url.pathname.split('/').at(-1),b.id,b)});
        }
        else if(workflow&&req.method==='GET'&&url.pathname==='/api/quality-oa/workflow')json(res,200,{ok:true,items:workflow.list()});
        else if(workflow&&req.method==='POST'&&/^\/api\/quality-oa\/workflow\/(admit|save|submit)$/.test(url.pathname)) {
          const b=await body(req);json(res,200,{ok:true,data:workflow.mutate(url.pathname.split('/').at(-1),b.id,b)});
        }
        else if(req.method==='POST'&&url.pathname==='/api/quality-oa/config'){
          if(productionAccess){json(res,403,{ok:false,error:'生产配置只能由服务端管理'});return true;}
          if(config){json(res,409,{ok:false,error:'凭证已配置，变更需要在服务端操作。'});return true;}
          const b=await body(req);
          if(b.clientId!==OA_SCOPE.clientId||!/^[a-zA-Z0-9_-]{12,256}$/.test(b.clientSecret||''))throw new Error('请填写目标应用的完整凭证');
          const c={clientId:b.clientId,clientSecret:b.clientSecret};const client=new DingTalkOaClient(c);
          await client.token();
          // Probe only the explicitly authorized feedback template before persisting credentials.
          await client.listIds(OA_SCOPE.processCode,Date.now()-86400000,Date.now(),0);
          await writeFile(configFile,JSON.stringify(c),{mode:0o600,flag:'wx'}); install(c);trigger();
          json(res,200,{ok:true,data:status()});
        } else if(req.method==='POST'&&url.pathname==='/api/quality-oa/sync'){
          if(!syncer){json(res,409,{ok:false,error:'尚未配置 OA 应用凭证'});return true;}trigger();json(res,202,{ok:true,data:status()});
        } else if(req.method==='GET'&&url.pathname==='/api/quality-oa/ai-history'){
          const id=url.searchParams.get('id');json(res,200,{ok:true,items:store.db.prepare("SELECT response FROM oa_ai WHERE source_id=? AND status='SUCCEEDED' ORDER BY at DESC").all(id).map(r=>JSON.parse(r.response).data)});
        } else if(req.method==='POST'&&url.pathname==='/api/quality-oa/assessment'){
          const b=await body(req),source=store.get(b.id);
          if(!source||!source.activeForMa){json(res,409,{ok:false,error:'本条 OA 当前未处于客服主管待处理节点'});return true;}
          if(source.version!==b.version){json(res,409,{ok:false,error:'OA 来源已更新，请刷新后按新版本研判'});return true;}
          workflow?.requireAssessment(b.id,b.version);
          const sourceInput=Object.fromEntries(['id','version','no','title','what','how','date','occurred','person','model','serial','batch','software','impact'].map(k=>[k,source[k]||'']));
          const input=runtime.validate('assessment',{requestId:b.requestId,source:sourceInput});
          const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
          let old=store.db.prepare('SELECT * FROM oa_ai WHERE request_id=?').get(b.requestId);
          if(old&&old.hash!==hash){json(res,409,{ok:false,error:'请求编号已用于其他版本'});return true;}
          if(!old){
            if(inFlight.size>=2){json(res,429,{ok:false,error:'已有 AI 请求正在处理'});return true;}
            store.db.prepare("INSERT INTO oa_ai VALUES (?,?,?,'GENERATING',?,NULL,?)").run(b.requestId,source.id,source.version,hash,new Date().toISOString());
            const promise=(async()=>{
              let response;const began=Date.now();
              try {const result=await runtime.run('assessment',input,'DINGTALK_OA');response={ok:true,data:{...result,requestId:b.requestId,createdAt:new Date().toISOString(),durationMs:Date.now()-began,sourceVersion:source.version,dataScope:'DINGTALK_OA'}};}
              catch (error) {response=assessmentFailure(error,b.requestId);console.error(JSON.stringify(assessmentFailureDiagnostic(error,b.requestId)));}
              store.db.prepare('UPDATE oa_ai SET status=?,response=? WHERE request_id=?').run(response.ok?'SUCCEEDED':'FAILED',JSON.stringify(response),b.requestId);
              return response;
            })().finally(()=>inFlight.delete(b.requestId));inFlight.set(b.requestId,promise);
          }
          const response=inFlight.has(b.requestId)?await inFlight.get(b.requestId):JSON.parse(old.response);
          json(res,response.ok?200:502,response);
        } else json(res,404,{ok:false,error:'接口不存在'});
      }catch(e){const business=['FORBIDDEN','NOT_FOUND','NOT_ADMITTED','VERSION_CONFLICT','ALREADY_SUBMITTED','INVALID_ASSESSMENT'].includes(e.code);json(res,business?409:502,{ok:false,error:business?e.message:'OA 接入请求失败',code:String(e.code||'OA_REQUEST_FAILED').replace(/[^a-zA-Z0-9_.-]/g,'').slice(0,100)});}
      return true;
    }
  };
}
