import {createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';

export const SIMULATION_DEPARTMENT={id:'QUALITY_SIM_DEPT',name:'模拟测试部门'};
export const SIMULATION_ACTORS=Object.freeze([
  {ref:'manager',userId:'QUALITY_SIM_MANAGER',name:'模拟主管',role:'manager'},
  ...[1,2,3].map(n=>({ref:`employee-${n}`,userId:`QUALITY_SIM_EMPLOYEE_${n}`,name:`模拟员工${n}`,role:'employee'})),
]);
export function seedSimulationDirectory(dbPath,operatorUserId) {
  if(process.env.QUALITY_PILOT_TEST_MODE!=='1')throw Error('Simulation requires isolated test mode');
  const db=new DatabaseSync(dbPath);
  try {
    db.exec('BEGIN IMMEDIATE');
    // Keep historical contacts for traceability, but never offer them as assignees.
    db.prepare('UPDATE dingtalk_contacts SET active=0 WHERE active<>0').run();
    const insert=db.prepare(`INSERT INTO dingtalk_contacts(user_id,name,department_ids_json,department_names_json,position,active,last_synced_at)
      VALUES(?,?,?,?,?,1,?) ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,department_ids_json=excluded.department_ids_json,
      department_names_json=excluded.department_names_json,position=excluded.position,active=1,union_id=NULL,deleted_at=NULL`);
    for(const a of SIMULATION_ACTORS)insert.run(a.userId,a.name,JSON.stringify([SIMULATION_DEPARTMENT.id]),JSON.stringify([SIMULATION_DEPARTMENT.name]),a.role==='manager'?'模拟主管':'模拟执行人',new Date().toISOString());
    db.exec('COMMIT');
  } catch(e){db.exec('ROLLBACK');throw e;} finally {db.close();}
  const config=join(dirname(dbPath),'simulation');mkdirSync(config,{recursive:true});
  writeFileSync(join(config,'empty.json'),'[]\n');mkdirSync(join(config,'profiles'),{recursive:true});
  Object.assign(process.env,{
    WORKBENCH_MANAGER_USER_IDS:`${operatorUserId},QUALITY_SIM_MANAGER`,
    WORKBENCH_MANAGER_IDS_FILE:join(config,'empty.json'),WORKBENCH_DYNAMIC_MANAGER_IDS_FILE:join(config,'empty.json'),
    WORKBENCH_ADMIN_USER_IDS:operatorUserId,WORKBENCH_ADMIN_IDS_FILE:join(config,'empty.json'),
    EMPLOYEE_FIXTURE_SOURCE:join(config,'empty.json'),EMPLOYEE_PROFILE_DIR:join(config,'profiles'),
  });
}

export function resolveSimulationActor(path,url,cookie='') {
  const requested=url.searchParams.get('simulation');
  if(requested && !SIMULATION_ACTORS.some(a=>a.ref===requested))throw Error('Invalid simulation actor');
  const saved=cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('quality_simulation='))?.split('=')[1];
  const selected=SIMULATION_ACTORS.find(a=>a.ref===(requested||saved));
  if(path.startsWith('/ma-workbench/')||path.startsWith('/tong/'))return null;
  if(path.startsWith('/workbench/manager/')||url.searchParams.get('perspective')==='manager')return SIMULATION_ACTORS[0];
  if(path.startsWith('/workbench/employee')||url.searchParams.get('perspective')==='employee')return selected?.role==='employee'?selected:SIMULATION_ACTORS[1];
  if(path==='/workbench/quality' && url.searchParams.get('perspective')==='quality_management')return null;
  return selected||null;
}

// This token is used only inside the server after real DingTalk authentication.
// It must never replace the browser's real wb_session cookie.
export function simulationSessionToken(identity,actor,secret) {
  if(!SIMULATION_ACTORS.includes(actor))throw Error('Unknown simulation identity');
  const session={...identity.session,userId:actor.userId,role:actor.role,primaryRole:actor.role,
    dingUser:{userId:actor.userId,name:actor.name,loginAt:new Date().toISOString()},
    impersonation:{actorUserId:identity.userId,actorName:identity.session.dingUser?.name,
      targetUserId:actor.userId,targetName:actor.name,targetKind:actor.role,startedAt:new Date().toISOString()}};
  const payload=Buffer.from(JSON.stringify(session)).toString('base64url');
  return payload+'.'+createHmac('sha256',secret).update(payload).digest('hex');
}

export function simulationNavigation(actor) {
  const prefix='/workbench/quality-pilot';
  const links=[['岗位配置',prefix+'/admin/posts.html'],['客服主管（模拟）',prefix+'/ma-workbench/'],['质量主管（模拟）',prefix+'/tong/'],
    ...SIMULATION_ACTORS.map(a=>[a.name,`${prefix}/workbench/quality?perspective=${a.role}&simulation=${a.ref}`])];
  return `<nav aria-label="模拟视角" style="padding:10px 16px;background:#fff4cc;color:#684900;font-size:14px;line-height:1.8;text-align:center"><strong>测试系统 · ${actor?.name||'质量研判与初析'} · 数据已隔离，禁止真实推送</strong><br>${links.map(([name,url])=>`<a style="display:inline-block;padding:5px 12px" target="_self" href="${url}">${name}</a>`).join('')}</nav>`;
}
