#!/usr/bin/env bash
set -euo pipefail
UID_ARG="${1:-652949075622784820}"
docker exec manage-robot-mingsibot node -e "
const appKey=process.env.DINGTALK_CLIENT_ID;
const appSecret=process.env.DINGTALK_CLIENT_SECRET;
const uid='${UID_ARG}';
(async()=>{
  const tr=await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appKey,appSecret})});
  const tj=await tr.json();
  const token=tj.accessToken;
  if(!token){console.error('no token', tj); process.exit(1);}
  const ur=await fetch('https://oapi.dingtalk.com/topapi/v2/user/get?access_token='+token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userid:uid})});
  const uj=await ur.json();
  if(uj.errcode!==0){console.error('user get failed', uj); process.exit(1);}
  const unionId=uj.result.unionid;
  console.log('operator', uj.result.name, 'unionId='+unionId);
  const wr=await fetch('https://api.dingtalk.com/v1.0/doc/workspaces?operatorId='+encodeURIComponent(unionId),{headers:{'x-acs-dingtalk-access-token':token}});
  const wj=await wr.json();
  console.log('v1 workspaces http', wr.status, JSON.stringify(wj).slice(0,500));
  for (const ws of (wj.workspaces||[])) {
    console.log(JSON.stringify({name:ws.name, workspaceId:ws.workspaceId, role:ws.role, url:ws.url}));
  }
  const w2=await fetch('https://api.dingtalk.com/v2.0/wiki/workspaces?operatorId='+encodeURIComponent(unionId)+'&maxResults=30&withPermissionRole=true',{headers:{'x-acs-dingtalk-access-token':token}});
  const j2=await w2.json();
  console.log('v2 workspaces http', w2.status);
  for (const ws of (j2.workspaces||[])) {
    console.log(JSON.stringify({name:ws.name, workspaceId:ws.workspaceId, role:ws.permissionRole, url:ws.url}));
  }
})().catch(e=>{console.error(e);process.exit(1);});
"
