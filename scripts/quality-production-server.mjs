import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve,dirname,relative,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createProductionAccess} from './quality-production-access.mjs';
import {PREFIX,rewriteProductionLinks} from './quality-production-paths.mjs';
import {loadOriginalAiRuntime} from './quality-ui-ai-runtime.mjs';
import {createOaHandler} from './quality-oa-http.mjs';
import {createOaWorkflow} from './quality-oa-workflow.mjs';
import {OA_SCOPE} from '../src/quality/oa/oa-store.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const userId=process.env.QUALITY_PILOT_USER_ID;
const origin=process.env.QUALITY_PILOT_ORIGIN;
const access=createProductionAccess({userId,origin,secret:process.env.WORKBENCH_SESSION_SECRET||process.env.ASSIGNMENT_WEB_SECRET});
const dbPath=process.env.WORKBENCH_SQLITE_PATH;
if(!dbPath||!process.env.QUALITY_PILOT_DATA_DIR)throw new Error('Explicit production database and data directory required');
if(!process.env.QUALITY_OA_SCOPE_FILE||OA_SCOPE.clientId!==process.env.DINGTALK_CLIENT_ID||OA_SCOPE.corpId!==process.env.DINGTALK_CORP_ID)throw new Error('OA application and organization scope mismatch');
// This process serves only the restricted quality pilot. It does not start
// another bot, reminder worker or fallback login service.
Object.assign(process.env,{
  QUALITY_PILOT_BUSINESS_USER_ID:userId,
  WORKBENCH_TEST_LOGIN_ENABLED:'0',QUALITY_TEST_ACTORS_ENABLED:'0',WORKBENCH_ADMIN_TEST_SYSTEM_ENABLED:'0',
  QUALITY_LOCAL_REVIEW_UI_ENABLED:'0',QUALITY_SOURCE_SYNC_ENABLED:'0',QUALITY_SOURCE_WRITEBACK_ENABLED:'0',
  QUALITY_NOTIFICATION_WORKER_ENABLED:'0',WORKBENCH_DINGTALK_NOTIFY_ENABLED:'0',
});
const runtime=await loadOriginalAiRuntime(root);
const names={};
const directory=new DatabaseSync(dbPath,{readOnly:true});
try{for(const person of directory.prepare('SELECT user_id,name FROM dingtalk_contacts WHERE active=1').all())names[person.user_id]=person.name;}finally{directory.close();}
const oa=await createOaHandler({root,runtime,names,productionAccess:access,
  dataDirectory:process.env.QUALITY_PILOT_DATA_DIR,
  oaConfig:{clientId:process.env.DINGTALK_CLIENT_ID,clientSecret:process.env.DINGTALK_CLIENT_SECRET},
  workflowFactory:store=>createOaWorkflow({store,originalRoot:root,serviceRoot:root,dbPath,modelEnv:runtime.modelEnv,productionUserId:userId})});
const {handleAssignmentHttp}=await import('../src/web/assignment-workbench.ts');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
function reject(res,status,message){res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(message);}
const server=http.createServer(async(req,res)=>{
  try {
    if(req.url==='/health'){res.end(JSON.stringify({ok:true,service:'quality-pilot'}));return;}
    const url=new URL(req.url,origin);
    if(!url.pathname.startsWith(PREFIX+'/')&&url.pathname!==PREFIX)return reject(res,404,'Not found');
    const identity=access(req);
    if(!identity){
      if(!req.headers.cookie?.includes('wb_session=')&&req.method==='GET'&&!url.pathname.includes('/api/')){
        res.writeHead(302,{Location:'/workbench?next='+encodeURIComponent(url.pathname+url.search),'Cache-Control':'no-store'});res.end();return;
      }
      return reject(res,403,'新版仅限曹玉寒通过钉钉登录访问。');
    }
    let path=url.pathname.slice(PREFIX.length)||'/';
    if(path==='/'){res.writeHead(302,{Location:PREFIX+'/ma-workbench/'});res.end();return;}
    // Identity is never accepted from UI, query parameters or request bodies.
    if(path.startsWith('/oa/')||/\/(?:login|logout|impersonat|test-actor)/i.test(path)||url.searchParams.has('testActor'))return reject(res,403,'此入口不支持切换登录身份');
    req.url=path+url.search;
    const originalEnd=res.end.bind(res);
    res.end=function(chunk,...args){
      if(chunk&&/text\/|javascript|json/.test(String(res.getHeader('content-type')||''))){
        chunk=rewriteProductionLinks(Buffer.isBuffer(chunk)?chunk.toString('utf8'):String(chunk));
        if(!res.headersSent)res.removeHeader('content-length');
      }
      return originalEnd(chunk,...args);
    };
    const writeHead=res.writeHead.bind(res);
    res.writeHead=function(status,...args){
      for(const headers of args){if(headers&&typeof headers==='object'&&!Array.isArray(headers)){
        for(const key of Object.keys(headers))if(key.toLowerCase()==='location'&&String(headers[key]).startsWith('/'))headers[key]=PREFIX+headers[key];
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
