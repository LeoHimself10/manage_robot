import { createHash } from 'node:crypto';
import { readFile, realpath, stat, appendFile, mkdir } from 'node:fs/promises';
import { resolve, relative, extname, dirname, isAbsolute } from 'node:path';

const errors = {
  MODEL_NOT_CONFIGURED: '原系统 AI 未配置，请检查服务端模型配置。',
  MODEL_OUTPUT_INVALID: 'AI 返回未通过原系统校验，请重试或继续人工填写。',
  MODEL_TIMEOUT: '原系统 AI 请求超时，请重试；已有结果与人工草稿均保留。',
  MODEL_CALL_FAILED: '原系统 AI 调用失败，请重试；已有结果与人工草稿均保留。',
};
function json(res, status, data) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
}
export function createAiHandler({runtime, roots, journalPath, oa, designRoot}) {
  const attempts = new Map();
  let active = 0;
  async function journal(record) {
    await mkdir(dirname(journalPath), {recursive:true});
    await appendFile(journalPath, JSON.stringify(record) + '\n', 'utf8');
  }
  const restored = (async () => {
    try {
      for (const line of (await readFile(journalPath, 'utf8')).split('\n').filter(Boolean)) {
        const record = JSON.parse(line);
        // An interrupted request must not silently spend tokens again after a
        // server restart: its outcome is unknown until the user starts a new ID.
        const response = record.response || {ok:false,code:'MODEL_CALL_FAILED',error:'上次请求在服务重启时中断，请重新生成。',requestId:record.requestId};
        attempts.set(record.requestId, {hash: record.hash, promise: Promise.resolve(response)});
      }
    } catch (err) { if (err.code !== 'ENOENT') throw err; }
  })();
  return async function handle(req, res) {
    try {
      await restored;
      const port = String(req.socket.localPort);
      const host = req.headers.host;
      if (!roots[port] || ![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) return json(res, 403, {ok:false, error:'仅允许本机访问'});
      if (oa && await oa.handle(req,res)) return;
      const url = new URL(req.url, `http://${host}`);
      if (url.pathname.startsWith('/api/')) {
        if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(res,403,{ok:false,error:'不允许跨站调用'});
        if (req.method === 'GET' && url.pathname === '/api/quality-ui/status') return json(res,200,{ok:true,data:runtime.health});
        const kind = url.pathname.match(/^\/api\/quality-ui\/(assessment|initial-analysis)$/)?.[1];
        if (!kind) return json(res,404,{ok:false,error:'接口不存在'});
        if (req.method !== 'POST') return json(res,405,{ok:false,error:'请使用 POST'});
        if (!(req.headers['content-type'] || '').startsWith('application/json')) return json(res,415,{ok:false,error:'需要 JSON 请求'});
        let size = 0; const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 128 * 1024) return json(res,413,{ok:false,error:'输入资料过大'});
          chunks.push(chunk);
        }
        let body;
        try { body = runtime.validate(kind, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { return json(res,400,{ok:false,error:'输入资料格式不完整或不符合要求', code:'INVALID_INPUT'}); }
        const hash = createHash('sha256').update(kind + JSON.stringify(body)).digest('hex');
        const previous = attempts.get(body.requestId);
        if (previous && previous.hash !== hash) return json(res,409,{ok:false,error:'同一请求编号不能用于不同资料'});
        if (!previous && active >= 2) return json(res,429,{ok:false,error:'已有 AI 请求正在处理，请稍后再试'});
        if (!previous) {
          active++;
          const promise = (async () => {
            const startedAt = new Date().toISOString(), started = Date.now();
            await journal({requestId:body.requestId,kind,hash,startedAt,status:'GENERATING',sourceVersion:body.source.version,input:body});
            let response;
            try {
              const result = await runtime.run(kind, body);
              response = {ok:true,data:{...result,requestId:body.requestId,createdAt:new Date().toISOString(),durationMs:Date.now()-started,dataScope:'UI_SAMPLE',sourceVersion:body.source.version}};
            } catch (err) {
              const code = Object.hasOwn(errors, err.code) ? err.code : 'MODEL_CALL_FAILED';
              response = {ok:false,error:errors[code],code,requestId:body.requestId};
            }
            await journal({requestId:body.requestId,kind,hash,startedAt,completedAt:new Date().toISOString(),status:response.ok?'SUCCEEDED':'FAILED',response});
            return response;
          })().finally(() => {active--;});
          attempts.set(body.requestId, {hash,promise});
        }
        const response = await attempts.get(body.requestId).promise;
        return json(res,response.ok?200:502,response);
      }
      if (!['GET','HEAD'].includes(req.method)) return json(res,405,{ok:false,error:'不支持的方法'});
      const isDesign = designRoot && port === '8808' && url.pathname.startsWith('/design/');
      const root = await realpath(isDesign ? designRoot : roots[port]);
      let pathname = decodeURIComponent(url.pathname);
      if (isDesign) pathname = pathname.slice('/design'.length);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const file = await realpath(resolve(root, '.' + pathname));
      const delta = relative(root,file);
      if (delta.startsWith('..') || isAbsolute(delta)) return json(res,403,{ok:false,error:'无权访问'});
      // Only browser assets are public; request journals and server code never are.
      const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
        '.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp',
        '.mp4':'video/mp4','.pdf':'application/pdf','.txt':'text/plain; charset=utf-8','.zip':'application/zip'};
      if (!types[extname(file)] || !(await stat(file)).isFile()) return json(res,404,{ok:false,error:'文件不存在'});
      res.writeHead(200,{'Content-Type':types[extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      res.end(req.method === 'HEAD' ? undefined : await readFile(file));
    } catch (err) {
      if (!res.headersSent) json(res,err.code==='ENOENT'?404:500,{ok:false,error:err.code==='ENOENT'?'文件不存在':'本地服务处理失败，请检查服务状态'});
      else res.end();
    }
  };
}
