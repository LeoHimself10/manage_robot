'use strict';
// Runtime final review. The earlier acceptance.js is an archived interaction prototype.
const finalDrafts=new Map();
const finalAssetsBase=new URL(".",document.currentScript.src);
const finalStatus={QUEUED:'等待同步到 OA 评论',SENDING:'正在同步',SYNCED:'已同步到 OA 评论',FAILED:'同步失败，可重试',UNKNOWN:'同步结果待核对',SUPPRESSED:'测试／同步关闭：未写入 OA',UNLINKED:'未找到唯一 OA 来源，未写入'};
const finalNodeStatus={APPROVED:'主管验收通过',RETURNED:'已退回补充',IN_PROGRESS:'处理中',PENDING_PARENT_REVIEW:'待主管验收',PENDING_ACCEPTANCE:'待承接'};
function finalDraft(e){if(!finalDrafts.has(e.id))finalDrafts.set(e.id,{outcome:'PASS',kind:'MANAGER',nodeId:'',opinion:'',attempt:null});return finalDrafts.get(e.id);}
function finalEvidence(e){
 const f=e.real.finalReview;
 if(!f?.nodes.length)return note('尚未形成任务与证据。');
 return `<div class="qf-evidence">${f.nodes.filter(n=>n.work).map(n=>{const w=n.work;return `<details class="qf-task"><summary><strong>${esc(w.title)}</strong><span>${esc(n.assigneeName)} · ${esc(finalNodeStatus[n.status]||n.status)}</span></summary><div class="qf-task-body"><div class="qf-grid"><div><b>任务目标</b><p>${esc(w.objective||n.requirement)}</p></div><div><b>完成标准</b><p>${esc(w.completionCriteria||'未另行指定')}</p></div></div><b>必须提交的证据</b><p>${esc(w.requirements.map(r=>r.name).join('；')||'至少一份任务证据')}</p><b>员工完成说明</b><p>${esc(w.draft.completion||w.progressNote||'暂无说明')}</p>${w.files.filter(x=>!x.removedAt).map(x=>`<div class="qf-file"><div><strong>${esc(x.fileName)}</strong><small>V${Number(x.fileRevision)} · ${x.current?'当前版本':'历史版本'} · ${esc(tongRealNow(x.createdAt))}</small></div><button class="btn" type="button" data-tong-evidence="${esc(x.evidenceId)}">查看证据</button></div>`).join('')||note('尚无有效证据')}${w.reviews.map(r=>`<p class="qf-review">${r.decision==='APPROVE'?'主管验收通过':'退回补充'} · ${esc(r.reason||'无补充意见')} · ${esc(tongRealNow(r.createdAt))}</p>`).join('')}</div></details>`;}).join('')}</div>`;
}
renderEvidence=function(e){return '<h3>责任链与证据</h3>'+finalEvidence(e);};
renderFinal=function(e){
 const f=e.real.finalReview;if(!f)return note('终验数据正在加载，请刷新。');
 const d=finalDraft(e),closed=f.event.status==='CLOSED',ready=f.event.status==='PENDING_QUALITY_REVIEW';
 const targets=f.nodes.filter(n=>n.assigneeKind===d.kind&&['APPROVED','PENDING_PARENT_REVIEW'].includes(n.status));
 if(!targets.some(n=>n.nodeId===d.nodeId))d.nodeId=targets[0]?.nodeId||'';
 let html='<section class="qf-final"><h3>质量终验</h3>'+note(closed?'本次终验已通过，事件已关闭。':ready?'请核对任务要求、员工证据和主管验收记录，再填写终验意见。':'当前任务尚未完成主管验收；完成后可在此提交质量终验。');
 html+=finalEvidence(e);
 if(ready || (closed&&d.outcome==='REOPEN')){
  const returning=d.outcome!=='PASS';
  html+=`<form id="realFinalForm" class="qf-form"><div class="qf-heading"><h3>${closed?'重开质量事件':'提交终验结果'}</h3><span>意见与历史证据均保留</span></div>${closed?'':`<div class="qf-choice"><label><input type="radio" name="finalOutcome" value="PASS" ${!returning?'checked':''}> 终验通过</label><label><input type="radio" name="finalOutcome" value="RETURN" ${returning?'checked':''}> 退回补充</label></div>`}${returning?`<div class="qf-grid"><label>退回类型<select id="realReturnKind"><option value="MANAGER" ${d.kind==='MANAGER'?'selected':''}>退回给主管</option><option value="EMPLOYEE" ${d.kind==='EMPLOYEE'?'selected':''}>退回给员工</option></select></label><label>具体节点<select id="realReturnNode" required>${targets.length?targets.map(n=>`<option value="${esc(n.nodeId)}" ${d.nodeId===n.nodeId?'selected':''}>${esc(n.assigneeName)} · ${esc(n.work?.title||'主管统筹节点')}</option>`).join(''):'<option value="">暂无可退回节点</option>'}</select></label></div><p class="qf-help">${d.kind==='MANAGER'?'员工已有成果与验收结果保留，由主管说明处理结果或指定员工任务补充。':'仅选中的员工任务恢复执行；补充提交后，需经主管再次验收。'}</p>`:`<p class="qf-help">通过并提交后，以下意见同步到本事件原始 OA 单据的评论区。${f.testMode?'当前为测试／同步关闭状态，不会实际写入 OA。':''}</p>`}<label for="realFinalOpinion">${returning?'退回原因与补充要求':'终验通过意见'} *</label><textarea id="realFinalOpinion" required maxlength="${returning?2000:900}" placeholder="${returning?'说明需要补充的内容、证据或处理要求':'填写本次终验结论，将作为 OA 评论内容'}">${esc(d.opinion)}</textarea><div class="qf-actions"><span>${returning?'退回意见仅保留在质量系统，不同步 OA。':'只有正式提交的通过意见才进入同步记录。'}</span><button type="submit" class="btn primary">${closed?'确认重开并退回':returning?'确认退回':'通过终验并关闭'}</button></div><div id="realFinalFeedback" role="status"></div></form>`;
 }else if(closed)html+='<button type="button" class="btn" data-tong-final="reopen">选择节点重开</button>';
 if(f.comments.length)html+='<section class="qf-history"><h3>终验意见与 OA 同步</h3>'+f.comments.map(c=>`<article><strong>${esc(finalStatus[c.status]||c.status)}</strong><p>${esc(c.opinion)}</p><small>${esc(tongRealNow(c.createdAt))}${c.lastError?' · '+esc(c.lastError):''}</small>${['FAILED','UNKNOWN'].includes(c.status)?`<button type="button" class="btn" data-tong-retry="${esc(c.closureId)}">${c.status==='UNKNOWN'?'核对同步结果':'重试同步'}</button>`:''}</article>`).join('')+'</section>';
 if(f.history.length)html+='<section class="qf-history"><h3>终验与退回记录</h3>'+f.history.map(h=>`<article><strong>${esc({QUALITY_CLOSED:'终验通过',QUALITY_RETURNED_NODE:'终验退回',QUALITY_REOPENED:'事件重开',QUALITY_MANAGER_RETURN_HANDLED:'主管已处理退回'}[h.action]||h.action)}</strong><p>${esc(h.reason||'')}</p><small>${esc(tongRealNow(h.occurredAt))}</small></article>`).join('')+'</section>';
 return html+'</section>';
};
function readRealFinal(){const e=eventById(state.selected);if(!e)return;const d=finalDraft(e),field=document.getElementById('realFinalOpinion');if(field)d.opinion=field.value;return {e,d};}
document.addEventListener('input',ev=>{if(ev.target.id==='realFinalOpinion')readRealFinal();});
document.addEventListener('change',ev=>{
 if(!['realReturnKind','realReturnNode'].includes(ev.target.id)&&ev.target.name!=='finalOutcome')return;
 const ctx=readRealFinal();if(!ctx)return;
 if(ev.target.name==='finalOutcome')ctx.d.outcome=ev.target.value;
 else if(ev.target.id==='realReturnKind')ctx.d.kind=ev.target.value;else ctx.d.nodeId=ev.target.value;
 render();
});
document.addEventListener('submit',async ev=>{
 if(ev.target.id!=='realFinalForm')return;ev.preventDefault();ev.stopImmediatePropagation();
 const {e,d}=readRealFinal();if(tongBusy)return;
 const action=d.outcome==='PASS'?'final-close':d.outcome==='REOPEN'?'final-reopen':'final-return';
 const body={id:e.id,expectedVersion:e.real.finalReview.event.version,opinion:d.opinion.trim(),nodeId:d.nodeId,targetKind:d.kind};
 if(!body.opinion)return;
 const fingerprint=JSON.stringify({action,...body});if(d.attempt?.fingerprint!==fingerprint)d.attempt={fingerprint,requestId:crypto.randomUUID()};
 body.requestId=d.attempt.requestId;tongBusy=true;ev.target.querySelectorAll('button,input,select,textarea').forEach(x=>x.disabled=true);
 try{const result=await tongApi(action,body);installReal(result.data);finalDrafts.delete(e.id);state.scope='全部事件';state.tab='final';render();toast(action==='final-close'?'终验已通过，结论与同步状态已保存。':'已退回指定节点，历史证据保留。');}
 catch(error){document.getElementById('realFinalFeedback').textContent=error.message;ev.target.querySelectorAll('button,input,select,textarea').forEach(x=>x.disabled=false);}
 finally{tongBusy=false;}
},true);
document.addEventListener('click',async ev=>{
 const button=ev.target.closest('[data-tong-final],[data-tong-retry],[data-tong-evidence]');if(!button)return;ev.stopImmediatePropagation();
 const e=eventById(state.selected);if(!e)return;
 if(button.dataset.tongFinal==='reopen'){finalDraft(e).outcome='REOPEN';render();return;}
 if(button.dataset.tongEvidence){
  const dialog=document.createElement('dialog');dialog.className='qf-preview';
  const close=document.createElement('button');close.className='btn';close.textContent='关闭证据';
  const message=document.createElement('p');message.textContent='正在读取证据…';
  dialog.append(close,message);document.body.appendChild(dialog);dialog.showModal();let objectUrl,pdfLoading;
  dialog.addEventListener('close',()=>{pdfLoading?.destroy();},{once:true});
  const cleanup=()=>{if(objectUrl)URL.revokeObjectURL(objectUrl);dialog.remove();};dialog.addEventListener('close',cleanup,{once:true});close.onclick=()=>dialog.close();
  try {
    const response=await fetch('/api/workbench/quality/evidence/'+encodeURIComponent(button.dataset.tongEvidence));
    if(!response.ok)throw Error('证据读取失败或无权查看');
    const blob=await response.blob();if(!dialog.open)return;objectUrl=URL.createObjectURL(blob);message.remove();
    const type=(response.headers.get('content-type')||'').split(';')[0];
    const link=document.createElement('a');link.className='btn';link.textContent='下载原文件';link.href=objectUrl;
    const file=e.real.finalReview.nodes.flatMap(n=>n.work?.files||[]).find(f=>f.evidenceId===button.dataset.tongEvidence);link.download=file?.fileName||'证据附件';dialog.append(link);
    if(type==='application/pdf'){
      message.textContent='正在加载 PDF…';dialog.append(message);
      const pdfjs=await import(new URL('pdf-lib.js',finalAssetsBase).href);
      pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdf-worker.js',finalAssetsBase).href;
      pdfLoading=pdfjs.getDocument({data:new Uint8Array(await blob.arrayBuffer()),isEvalSupported:false,useSystemFonts:true});
      const pdf=await pdfLoading.promise;if(!dialog.open)return;
      const toolbar=document.createElement('div');toolbar.className='qf-pdf-toolbar';
      const prev=document.createElement('button'),next=document.createElement('button'),info=document.createElement('span');
      prev.className=next.className='btn';prev.textContent='上一页';next.textContent='下一页';toolbar.append(prev,info,next);
      const paper=document.createElement('div');paper.className='qf-pdf-paper';const canvas=document.createElement('canvas');canvas.setAttribute('role','img');paper.append(canvas);dialog.append(toolbar,paper);
      let pageNo=1,rendering=false;
      async function drawPage(number){
        if(rendering||!dialog.open)return;rendering=true;prev.disabled=next.disabled=true;
        try{const page=await pdf.getPage(number),natural=page.getViewport({scale:1}),scale=Math.min(1.6,Math.max(320,paper.clientWidth-24)/natural.width),viewport=page.getViewport({scale});
          canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);canvas.setAttribute('aria-label','证据 PDF 第 '+number+' 页');
          await page.render({canvas,canvasContext:canvas.getContext('2d'),viewport}).promise;pageNo=number;info.textContent='第 '+number+' / '+pdf.numPages+' 页';message.remove();
        }catch(error){message.textContent='本页暂时无法预览，请下载原文件核对。';dialog.append(message);}
        finally{rendering=false;prev.disabled=pageNo<=1;next.disabled=pageNo>=pdf.numPages;}
      }
      prev.onclick=()=>void drawPage(pageNo-1);next.onclick=()=>void drawPage(pageNo+1);await drawPage(1);
    }else if(type==='text/plain'){
      const text=document.createElement('pre');text.textContent=(await blob.text()).slice(0,200000);dialog.append(text);
    }else if(/^image\/(png|jpeg|gif|webp)$/.test(type)){
      const image=document.createElement('img');image.alt=file?.fileName||'任务证据';image.src=objectUrl;image.style.maxWidth='100%';dialog.append(image);
    }else{message.textContent='此类型请下载原文件核对。';dialog.append(message);}
  }catch(error){message.textContent='在线预览未完成，请下载原文件核对。';if(dialog.open)dialog.append(message);}
  return;
 }
 if(tongBusy)return;tongBusy=true;button.disabled=true;
 try{const result=await tongApi('comment-retry',{id:e.id,closureId:button.dataset.tongRetry});installReal(result.data);render();}
 catch(error){toast(error.message);}finally{tongBusy=false;button.disabled=false;}
},true);
