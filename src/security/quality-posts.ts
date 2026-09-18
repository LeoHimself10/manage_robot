import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';

export type QualityPost = 'customer' | 'quality';
export type QualityPostScope = 'real' | 'test';
export const qualityPostContext = new AsyncLocalStorage<{scope: QualityPostScope; actorUserId: string; actingPost?: QualityPost}>();
export const postLabels = {customer: '客服主管', quality: '质量主管'};
function connect() {
  const path = process.env.QUALITY_POSTS_DB_PATH;
  if (!path) return null;
  const db = new DatabaseSync(path); db.exec('PRAGMA busy_timeout=5000'); return db;
}
export function initializeQualityPosts(defaults: Record<QualityPostScope, Record<QualityPost,string>>) {
  const db=connect(); if(!db)return;
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS quality_posts(scope TEXT NOT NULL,post TEXT NOT NULL,user_id TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(scope,post));
      CREATE TABLE IF NOT EXISTS quality_post_audit(id INTEGER PRIMARY KEY,scope TEXT NOT NULL,post TEXT NOT NULL,old_user_id TEXT,new_user_id TEXT NOT NULL,actor_user_id TEXT NOT NULL,changed_at TEXT NOT NULL,version INTEGER NOT NULL);`);
    db.exec('BEGIN IMMEDIATE');
    for(const scope of ['real','test'] as const)for(const post of ['customer','quality'] as const){
      const result=db.prepare('INSERT OR IGNORE INTO quality_posts(scope,post,user_id) VALUES(?,?,?)').run(scope,post,defaults[scope][post]);
      if(result.changes)db.prepare('INSERT INTO quality_post_audit(scope,post,old_user_id,new_user_id,actor_user_id,changed_at,version) VALUES(?,?,?,?,?,?,1)').run(scope,post,process.env.QUALITY_PILOT_USER_ID||null,defaults[scope][post],'SYSTEM',new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch(e){db.exec('ROLLBACK');throw e;}finally{db.close();}
}
export function getQualityPosts(scope: QualityPostScope = qualityPostContext.getStore()?.scope ?? 'real') {
  const db=connect();if(!db)return null;
  try{return db.prepare('SELECT post,user_id AS userId,version FROM quality_posts WHERE scope=? ORDER BY post').all(scope) as unknown as {post:QualityPost;userId:string;version:number}[];}finally{db.close();}
}
export function qualityPostHolder(post:QualityPost,scope?:QualityPostScope){return getQualityPosts(scope)?.find(r=>r.post===post)?.userId;}
export function hasQualityPost(userId:string,post:QualityPost,scope?:QualityPostScope){return qualityPostHolder(post,scope)===userId;}
export function ownsCustomerHistory(userId:string,previous:string) {
  if(userId===previous)return true;
  if(!hasQualityPost(userId,'customer'))return false;
  const db=connect();if(!db)return false;
  try{return Boolean(db.prepare("SELECT 1 FROM quality_post_audit WHERE scope=? AND post='customer' AND (new_user_id=? OR old_user_id=?)").get(qualityPostContext.getStore()?.scope??'real',previous,previous));}finally{db.close();}
}
export function qualityPostDisplayName(userId:string):string|undefined {
  const db=connect();if(!db)return undefined;
  try{const row=db.prepare('SELECT post FROM quality_post_audit WHERE new_user_id=? ORDER BY id DESC LIMIT 1').get(userId);return row?postLabels[row.post as QualityPost]:undefined;}finally{db.close();}
}
export function changeQualityPost(input:{scope:QualityPostScope;post:QualityPost;userId:string;expectedVersion:number;actorUserId:string}) {
  const db=connect();if(!db)throw Error('岗位配置未启用');
  try{
    db.exec('BEGIN IMMEDIATE');
    const before=db.prepare('SELECT user_id,version FROM quality_posts WHERE scope=? AND post=?').get(input.scope,input.post);
    if(!before||before.version!==input.expectedVersion)throw Error('岗位配置已更新，请刷新后重试');
    if(before.user_id!==input.userId){
      db.prepare('UPDATE quality_posts SET user_id=?,version=version+1 WHERE scope=? AND post=?').run(input.userId,input.scope,input.post);
      db.prepare('INSERT INTO quality_post_audit(scope,post,old_user_id,new_user_id,actor_user_id,changed_at,version) VALUES(?,?,?,?,?,?,?)').run(input.scope,input.post,String(before.user_id),input.userId,input.actorUserId,new Date().toISOString(),input.expectedVersion+1);
    }
    db.exec('COMMIT');return getQualityPosts(input.scope);
  }catch(e){db.exec('ROLLBACK');throw e;}finally{db.close();}
}

// The configured post and the authenticated operator are separate audit identities.
export function auditQualityPostOperation(action:string,status:number) {
  const context=qualityPostContext.getStore();if(!context?.actorUserId)return;
  const db=connect();if(!db)return;
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS quality_post_operations(id INTEGER PRIMARY KEY,scope TEXT NOT NULL,actor_user_id TEXT NOT NULL,customer_holder TEXT,quality_holder TEXT,action TEXT NOT NULL,status INTEGER NOT NULL,occurred_at TEXT NOT NULL)`);
    db.prepare('INSERT INTO quality_post_operations(scope,actor_user_id,customer_holder,quality_holder,action,status,occurred_at) VALUES(?,?,?,?,?,?,?)').run(context.scope,context.actorUserId,qualityPostHolder('customer')||null,qualityPostHolder('quality')||null,action,status,new Date().toISOString());
  } finally {db.close();}
}
