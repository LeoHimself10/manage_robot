'use strict';
function renderOaAttachments(record) {
  const cards=(record.attachments||[]).flatMap(field=>{
    let values=[];try{values=JSON.parse(field.value||'[]');}catch{}
    return (Array.isArray(values)?values:[]).map(file=>`<article class="analysis-block oa-attachment"><h3>${esc(file.fileName||'附件')}</h3><p class="quiet">${esc(field.name)} · ${Math.ceil(Number(file.fileSize||0)/1024)} KB</p><button class="btn" data-oa-preview data-source="${esc(record.id)}" data-field="${esc(field.id)}" data-file="${esc(file.fileId)}" data-kind="${esc(file.fileType||'')}" data-name="${esc(file.fileName||'附件')}">查看附件</button><div class="oa-preview-result" aria-live="polite"></div></article>`);
  });
  return `<div class="section-head"><h3>OA 原始附件</h3>${oaLink(record)}</div><p class="quiet">点击查看图片、视频或文件。附件内容尚未用于 AI 研判。</p>${cards.length?'<div class="oa-attachment-list">'+cards.join('')+'</div>':emptyStage('此反馈暂无附件','可继续核对原始表单与审批记录。')}`;
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-oa-preview]');if(!button)return;
  event.preventDefault();event.stopImmediatePropagation();
  const output=button.parentElement.querySelector('.oa-preview-result');button.disabled=true;output.textContent='正在获取附件…';
  try {
    const query=new URLSearchParams({id:button.dataset.source,field:button.dataset.field,file:button.dataset.file});
    const response=await fetch('/api/quality-oa/attachment?'+query);const result=await response.json();
    if(!response.ok)throw new Error(result.error||'读取附件失败');
    output.replaceChildren();const kind=button.dataset.kind.toLowerCase();
    if(['jpg','jpeg','png','gif','webp','bmp'].includes(kind)){const image=document.createElement('img');image.alt=button.dataset.name;image.src=result.url;image.referrerPolicy='no-referrer';image.addEventListener('error',()=>{image.replaceWith(document.createTextNode('图片预览失败，可通过下方链接打开原文件。'));});output.append(image);}
    else if(['mp4','webm','mov'].includes(kind)){const video=document.createElement('video');video.controls=true;video.preload='metadata';video.src=result.url;output.append(video);}
    const link=document.createElement('a');link.href=result.url;link.target='_blank';link.rel='noopener noreferrer';link.className='btn';link.textContent='打开原文件 ↗';output.append(link);
  }catch(error){output.textContent=error.message;}
  finally{button.disabled=false;button.textContent='重新获取附件';}
},true);
// Presentation only: preserve the original OA snapshot and escape every value.
function renderOaValue(value, depth=0) {
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  if(value==null||value==='')return '<span class="quiet">未填写</span>';
  if(depth>12)return '<span class="quiet">内容层级较多，请在 OA 原单查看</span>';
  if(typeof value==='string') {
    const text=value.trim();
    if(/^[\[{]/.test(text)){try{return renderOaValue(JSON.parse(text),depth+1);}catch{}}
    if(/^https?:\/\/\S+$/i.test(text)) {
      try {const url=new URL(text);if(['https:','http:'].includes(url.protocol))return '<a class="oa-file-link" href="'+escape(url.href)+'" target="_blank" rel="noopener noreferrer">查看文件或链接 ↗</a>';}catch{}
    }
    return '<span class="oa-value-text">'+escape(value)+'</span>';
  }
  if(Array.isArray(value)) {
    if(!value.length)return '<span class="quiet">未填写</span>';
    if(value.some(row=>row&&Array.isArray(row.rowValue)))return '<div class="oa-detail-rows">'+value.map((row,i)=>'<section class="oa-detail-row"><h4>明细 '+(i+1)+'</h4>'+renderOaValue(row.rowValue??row,depth+1)+'</section>').join('')+'</div>';
    if(value.every(field=>field&&typeof field==='object'&&('label' in field)))return '<div class="oa-field-list">'+value.map(field=>'<dl class="oa-field"><dt>'+escape(field.label||'内容')+'</dt><dd>'+renderOaValue(field.value,depth+1)+'</dd></dl>').join('')+'</div>';
    return '<div class="oa-value-list">'+value.map(item=>'<div>'+renderOaValue(item,depth+1)+'</div>').join('')+'</div>';
  }
  if(typeof value==='object') {
    if('value' in value)return renderOaValue(value.value,depth+1);
    if(value.rowValue)return renderOaValue(value.rowValue,depth+1);
    if(value.address)return renderOaValue(value.address,depth+1);
    if(value.phone||value.phoneNumber)return renderOaValue(value.phone||value.phoneNumber,depth+1);
    const url=value.downloadUrl||value.url||value.fileUrl;
    if(url)return '<div>'+ (value.fileName||value.name?'<span class="oa-value-text">'+escape(value.fileName||value.name)+'</span> ':'')+renderOaValue(url,depth+1)+'</div>';
    const labels={name:'名称',text:'内容',detail:'详细地址',province:'省份',city:'城市',district:'区县',street:'街道',fileName:'文件名称',size:'文件大小'};
    const entries=Object.entries(value).filter(([key])=>labels[key]||/[\u3400-\u9fff]/.test(key));
    return entries.length?'<div class="oa-field-list">'+entries.map(([key,v])=>'<dl class="oa-field"><dt>'+escape(labels[key]||key)+'</dt><dd>'+renderOaValue(v,depth+1)+'</dd></dl>').join('')+'</div>':'<span class="quiet">结构化内容，请在 OA 原单查看</span>';
  }
  return escape(value);
}
