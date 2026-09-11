'use strict';
// Ma and Tong always use the approved connected UI; task operations keep their existing entry.
(() => {
  const container=document.createElement('div');
  container.className='view-switcher';
  const originalBase='http://127.0.0.1:8797';
  const originalViews=[
    ['主管工作台','曹玉寒 · 分配与验收','/workbench/manager'],
    ['员工工作台','曹玉寒 · 承接与执行','/workbench/employee']
  ];
  const link=(title,subtitle,url)=>`<a class="view-switch-link" href="${url}" target="_blank" rel="noopener"><span><strong>${title}</strong><small>${subtitle}</small></span><span class="view-switch-arrow" aria-hidden="true">↗</span></a>`;
  container.innerHTML=`<button type="button" id="viewSwitchButton" class="view-switch-trigger" aria-expanded="false" aria-controls="viewSwitchPanel">切换视角<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
    <div id="viewSwitchPanel" class="view-switch-panel" hidden>
      <h3>质量工作台</h3><nav class="view-switch-list" aria-label="质量工作台视角">
        <button type="button" class="view-switch-link" id="viewSwitchCurrent" aria-current="page"><span><strong>马荣鑫</strong><small>主管 · 反馈研判</small></span><span class="view-switch-current">当前视角</span></button>
        ${link('佟成','员工 · 质量管理能力已开通','http://127.0.0.1:8809/')}
      </nav><h3>任务与系统管理</h3><nav class="view-switch-list" aria-label="任务与系统管理视角">${originalViews.map(([title,subtitle,path])=>link(title,subtitle,originalBase+path)).join('')}</nav>
      <p class="view-switch-note">当前操作人：曹玉寒。切换页面不会切换登录身份。</p>
    </div>`;
  document.querySelector('.topbar .user').appendChild(container);
  const button=container.querySelector('#viewSwitchButton');
  const panel=container.querySelector('#viewSwitchPanel');
  function close(restoreFocus=false) {
    panel.hidden=true;button.setAttribute('aria-expanded','false');
    if(restoreFocus)button.focus();
  }
  button.addEventListener('click',()=>{
    const open=panel.hidden;panel.hidden=!open;button.setAttribute('aria-expanded',String(open));
  });
  container.querySelector('#viewSwitchCurrent').addEventListener('click',()=>close(true));
  container.addEventListener('click',event=>{
    if(!event.target.closest('a.view-switch-link'))return;
    close();
  });
  document.addEventListener('click',event=>{if(!container.contains(event.target))close();});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!panel.hidden){event.preventDefault();close(true);}
  });
})();
