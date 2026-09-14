import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve,dirname,relative,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createProductionAccess} from './quality-production-access.mjs';
import {PREFIX,rewriteProductionLinks,productionLocation} from './quality-production-paths.mjs';
import {sanitizeQualityPilotNextPath} from '../src/web/quality-pilot-navigation.ts';
import {loadOriginalAiRuntime} from './quality-ui-ai-runtime.mjs';
import {createOaHandler} from './quality-oa-http.mjs';
import {createOaWorkflow} from './quality-oa-workflow.mjs';
import {OA_SCOPE} from '../src/quality/oa/oa-store.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const release=JSON.parse(await readFile(resolve(root,'quality-release.json'),'utf8'));
// This DingTalk entry is a test system, not a shared-database production service.
if(process.env.QUALITY_PILOT_TEST_MODE!=='1')throw new Error('Explicit isolated test mode required');
await readFile('/app/data/.quality-test-isolated','utf8');
const userId=process.env.QUALITY_PILOT_USER_ID;
const origin=process.env.QUALITY_PILOT_ORIGIN;
const access=createProductionAccess({userId,origin,secret:process.env.WORKBENCH_SESSION_SECRET||process.env.ASSIGNMENT_WEB_SECRET});
const dbPath=process.env.WORKBENCH_SQLITE_PATH;
if(!dbPath||!process.env.QUALITY_PILOT_DATA_DIR)throw new Error('Explicit production database and data directory required');
const oaClientId=process.env.QUALITY_OA_CLIENT_ID||process.env.DINGTALK_CLIENT_ID;
const oaClientSecret=process.env.QUALITY_OA_CLIENT_SECRET||process.env.DINGTALK_CLIENT_SECRET;
if(!process.env.QUALITY_OA_SCOPE_FILE||OA_SCOPE.clientId!==oaClientId||OA_SCOPE.corpId!==process.env.DINGTALK_CORP_ID)throw new Error('OA application and organization scope mismatch');
// This process serves only the restricted quality pilot. It does not start
// another bot, reminder worker or fallback login service.
Object.assign(process.env,{
  QUALITY_PILOT_BUSINESS_USER_ID:userId,
  WORKBENCH_TEST_LOGIN_ENABLED:'0',QUALITY_TEST_ACTORS_ENABLED:'0',WORKBENCH_ADMIN_TEST_SYSTEM_ENABLED:'0',
  QUALITY_LOCAL_REVIEW_UI_ENABLED:'0',QUALITY_SOURCE_SYNC_ENABLED:'0',QUALITY_SOURCE_WRITEBACK_ENABLED:'0',
  QUALITY_NOTIFICATION_WORKER_ENABLED:'0',WORKBENCH_DINGTALK_NOTIFY_ENABLED:'0',
  WORKBENCH_DINGTALK_NOTIFY_MANAGER_ENABLED:'0',FOLLOWUP_REMINDER_ENABLED:'0',DINGTALK_CONTACT_SYNC_ENABLED:'0',
});
const runtime=await loadOriginalAiRuntime(root);
const names={};
const directory=new DatabaseSync(dbPath,{readOnly:true});
try{for(const person of directory.prepare('SELECT user_id,name FROM dingtalk_contacts WHERE active=1').all())names[person.user_id]=person.name;}finally{directory.close();}
const oa=await createOaHandler({root,runtime,names,productionAccess:access,
  dataDirectory:process.env.QUALITY_PILOT_DATA_DIR,
  oaConfig:{clientId:oaClientId,clientSecret:oaClientSecret},
  workflowFactory:store=>createOaWorkflow({store,originalRoot:root,serviceRoot:root,dbPath,modelEnv:runtime.modelEnv,productionUserId:userId})});
const {handleAssignmentHttp}=await import('../src/web/assignment-workbench.ts');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
function reject(res,status,message){res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(message);}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Quality-Release',release.release);
  try {
    if(req.url==='/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,service:'quality-pilot',release:release.release,uiCommit:release.uiCommit,backendCommit:release.backendCommit}));return;}
    const url=new URL(req.url,origin);
    if(!url.pathname.startsWith(PREFIX+'/')&&url.pathname!==PREFIX)return reject(res,404,'Not found');
    if(req.headers.origin&&req.headers.origin!==origin)return reject(res,403,'不允许跨站请求');
    let path=url.pathname.slice(PREFIX.length)||'/';
    const loginRoute=(req.method==='GET'&&['/workbench','/static/workbench-dd-login.js','/api/workbench/auth/jsapi-config'].includes(path))
      ||(req.method==='POST'&&path==='/api/workbench/auth/dingtalk');
    if(path==='/api/workbench/auth/jsapi-config'){
      const signingUrl=new URL(url.searchParams.get('url')||'/',origin);
      if(signingUrl.origin!==origin||!signingUrl.pathname.startsWith(PREFIX+'/'))return reject(res,400,'无效免登页面');
    }
    const identity=access(req);
    if(!identity&&!loginRoute){
      if(req.method==='GET'&&!url.pathname.includes('/api/')){
        res.writeHead(302,{Location:PREFIX+'/workbench?next='+encodeURIComponent(PREFIX+'/ma-workbench/'),'Cache-Control':'no-store'});res.end();return;
      }
      return reject(res,403,'新版仅限曹玉寒通过钉钉登录访问。');
    }
    if(path==='/'){res.writeHead(302,{Location:PREFIX+'/ma-workbench/'});res.end();return;}
    if(identity&&path==='/workbench'&&req.method==='GET'){
      const next=sanitizeQualityPilotNextPath(url.searchParams.get('next')||'',p=>p.startsWith('/workbench/')&&!p.startsWith(PREFIX));
      res.writeHead(302,{Location:next||PREFIX+'/ma-workbench/','Cache-Control':'no-store'});res.end();return;
    }
    if(identity&&req.method==='GET'&&['/workbench/quality','/workbench/quality/review'].includes(path)){
      const perspective=url.searchParams.get('perspective');
      const detail=['eventId','sourceKey','nodeId'].some(k=>url.searchParams.has(k));
      if(!detail&&!["manager","employee","dashboard"].includes(perspective)){
        res.writeHead(302,{Location:PREFIX+(perspective==='quality_management'?'/tong/':'/ma-workbench/'),'Cache-Control':'no-store'});res.end();return;
      }
      if(detail&&!perspective)url.searchParams.set('perspective','quality_management');
    }
    // An expired or fallback cookie must not make the legacy login renderer
    // skip the new application's real DingTalk authentication.
    if(loginRoute&&!identity)req.headers.cookie='';
    // Identity is never accepted from UI, query parameters or request bodies.
    if(path.startsWith('/oa/')||/\/(?:login|logout|impersonat|test-actor)/i.test(path)||url.searchParams.has('testActor'))return reject(res,403,'此入口不支持切换登录身份');
    req.url=path+url.search;
    const originalEnd=res.end.bind(res);
    res.end=function(chunk,...args){
      if(chunk&&/text\/|javascript|json/.test(String(res.getHeader('content-type')||''))){
        chunk=rewriteProductionLinks(Buffer.isBuffer(chunk)?chunk.toString('utf8'):String(chunk));
        if(String(res.getHeader('content-type')||'').includes('text/html'))chunk=chunk.replace(/<body([^>]*)>/i,'<body$1><div role="status" style="padding:10px 20px;background:#fff4cc;color:#684900;font-size:14px;line-height:1.6;text-align:center">测试系统 · 数据已隔离 · 不发送钉钉业务消息、待办或催办 · 不回写 OA</div>');
        if(!res.headersSent)res.removeHeader('content-length');
      }
      return originalEnd(chunk,...args);
    };
    const writeHead=res.writeHead.bind(res);
    res.writeHead=function(status,...args){
      for(const headers of args){if(headers&&typeof headers==='object'&&!Array.isArray(headers)){
        for(const key of Object.keys(headers))if(key.toLowerCase()==='location')headers[key]=productionLocation(String(headers[key]));
      }}
      return writeHead(status,...args);
    };
    if(await oa.handle(req,res))return;
    if(path.startsWith('/api/quality-ui/')){
      if(path==='/api/quality-ui/status'&&req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,data:runtime.health}));return;}
      return reject(res,404,'请从真实 OA 事件生成分析');
    }
    if(path.startsWith('/workbench')||path.startsWith('/api/workbench')||path.startsWith('/static/')){
      if(handleAssignmentHttp(req,res))return;
    }
    if(!['GET','HEAD'].includes(req.method))return reject(res,405,'Method not allowed');
    if(!path.startsWith('/tong/')&&!path.startsWith('/ma-workbench/'))return reject(res,404,'Not found');
    const publicRoot=await realpath(resolve(root,'public/quality'));
    const file=await realpath(resolve(publicRoot,'.'+decodeURIComponent(path)+(path.endsWith('/')?'index.html':'')));
    if(relative(publicRoot,file).startsWith('..')||!types[extname(file)]||!(await stat(file)).isFile())return reject(res,404,'Not found');
    res.setHeader('Content-Type',types[extname(file)]);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.end(req.method==='HEAD'?undefined:await readFile(file));
  }catch(error){if(!res.headersSent)reject(res,500,'页面暂时无法读取，请重试');else res.end();console.error('quality_pilot_error',error.code||error.name);}
});
server.requestTimeout=240000;
server.listen(Number(process.env.PORT||8092),'0.0.0.0',()=>console.log('quality_pilot_ready'));
