#!/usr/bin/env bash
set -e
docker exec manage-robot-mingsibot node -e "
const appKey=process.env.DINGTALK_CLIENT_ID;
const appSecret=process.env.DINGTALK_CLIENT_SECRET;
const doc={workspaceId:'ZpvYeSO5GMXNNpvm',operatorUnionId:'LgtyC2b4P9XqZhbBTnnDuwiEiE'};
(async()=>{
  const tr=await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appKey,appSecret})});
  const token=(await tr.json()).accessToken;
  const cr=await fetch('https://api.dingtalk.com/v1.0/doc/workspaces/'+doc.workspaceId+'/docs',{method:'POST',headers:{'Content-Type':'application/json','x-acs-dingtalk-access-token':token},body:JSON.stringify({name:'API调试-勿删',docType:'WORKBOOK',operatorId:doc.operatorUnionId})});
  const cj=await cr.json();
  console.log('create status', cr.status, JSON.stringify(cj,null,2));
  const ids=[cj.nodeId,cj.dentryUuid,cj.uuid,cj.docKey,cj.workbookId].filter(Boolean);
  for (const id of ids) {
    const sr=await fetch('https://api.dingtalk.com/v1.0/doc/workbooks/'+encodeURIComponent(id)+'/sheets?operatorId='+encodeURIComponent(doc.operatorUnionId),{method:'POST',headers:{'Content-Type':'application/json','x-acs-dingtalk-access-token':token},body:JSON.stringify({name:'测试sheet'})});
    const sj=await sr.json();
    console.log('sheet try id='+id+' status='+sr.status, JSON.stringify(sj));
  }
  const url=cj.url||'';
  const m=url.match(/nodes\\/([^/?]+)/);
  if(m){const nid=m[1];const sr=await fetch('https://api.dingtalk.com/v1.0/doc/workbooks/'+encodeURIComponent(nid)+'/sheets?operatorId='+encodeURIComponent(doc.operatorUnionId),{method:'POST',headers:{'Content-Type':'application/json','x-acs-dingtalk-access-token':token},body:JSON.stringify({name:'测试sheet2'})});console.log('sheet from url node', nid, sr.status, JSON.stringify(await sr.json()));}
})().catch(e=>{console.error(e);process.exit(1);});
"
