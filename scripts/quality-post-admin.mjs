import {DatabaseSync} from 'node:sqlite';
import {getQualityPosts,changeQualityPost} from '../src/security/quality-posts.ts';
export async function handleQualityPostAdmin(req,res,{identity,isAdmin,dbPath,path,url}) {
  if(!path.startsWith('/api/quality-posts'))return false;
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  if(!isAdmin){json(403,{ok:false,error:'仅管理员可配置质量岗位'});return true;}
  const scope=url.searchParams.get('scope')||'real';
  if(!['real','test'].includes(scope)){json(400,{ok:false,error:'无效配置范围'});return true;}
  const db=new DatabaseSync(dbPath,{readOnly:true});
  try{
    if(req.method==='GET'&&path==='/api/quality-posts'){
      const posts=getQualityPosts(scope).map(r=>({...r,name:db.prepare('SELECT name FROM dingtalk_contacts WHERE user_id=?').get(r.userId)?.name||r.userId}));
      const history=db.prepare('SELECT * FROM quality_post_audit WHERE scope=? ORDER BY id DESC LIMIT 30').all(scope);
      json(200,{ok:true,posts,history});
    }else if(req.method==='GET'&&path==='/api/quality-posts/people'){
      const q=(url.searchParams.get('q')||'').trim();
      const rows=q?db.prepare(`SELECT user_id AS userId,name,department_names_json AS departments FROM quality_post_directory
        WHERE (instr(name,?)>0 OR instr(user_id,?)>0) AND user_id NOT LIKE 'QUALITY_%' ORDER BY name LIMIT 40`).all(q,q):[];
      json(200,{ok:true,items:rows});
    }else if(req.method==='POST'&&path==='/api/quality-posts'){
      let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>8000)throw Error('请求过大');}
      const b=JSON.parse(text);
      if(!['customer','quality'].includes(b.post)||typeof b.userId!=='string'||!Number.isSafeInteger(b.expectedVersion)||b.confirmTransfer!==true)throw Error('请确认岗位及全部未完成工作的交接');
      if(!db.prepare('SELECT 1 FROM quality_post_directory WHERE user_id=?').get(b.userId)||b.userId.startsWith('QUALITY_'))throw Error('请选择通讯录中的有效人员');
      const posts=changeQualityPost({scope,post:b.post,userId:b.userId,expectedVersion:b.expectedVersion,actorUserId:identity.userId});
      json(200,{ok:true,posts});
    }else json(404,{ok:false,error:'接口不存在'});
  }catch(e){json(409,{ok:false,error:/SQLITE|no such|JSON/.test(e.message)?'配置失败，请刷新后重试':e.message});}finally{db.close();}
  return true;
}
