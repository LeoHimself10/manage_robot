const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/EDY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const root=path.resolve('data/quality-oa-ui-qa'),results=[],errors=[];
 const entry=JSON.parse(fs.readFileSync(path.join(root,'data/quality-oa/local-entry.json'))).path;
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:8812'+entry);
  await page.locator('[data-row]').waitFor();
  const id=await page.locator('[data-row]').first().getAttribute('data-row');
  for(const size of [{width:1366,height:768},{width:1920,height:1080}]) {
   await page.setViewportSize(size);
   await page.goto('http://localhost:8812/ma-workbench/?record='+id+'&view=event');
   await page.locator('#detailFlow').waitFor();
   assert.equal(await page.locator('#detailFlow [data-phase]').count(),6);
   for(const [phase,label] of [[2,'尚未提交质量初析'],[3,'主管尚未发布任务'],[4,'尚无员工承办记录'],[5,'质量终验']]) {
    await page.locator('#detailFlow [data-phase="'+phase+'"]').click();
    assert.ok((await page.locator('#detailContent').innerText()).includes(label));
    assert.equal(await page.locator('#detailFlow [data-phase]').count(),6);
   }
   await page.screenshot({path:path.join(root,size.width+'-flow.png'),fullPage:false});
   await page.locator('[data-tab="review"]').first().click();
   assert.ok((await page.locator('#detailContent').innerText()).includes('人工研判版本记录'));
   const text=await page.locator('#detailContent').innerText();
   assert.ok(!/physical_inspection_result|CATHETER_PRODUCT|引用 F1|建议处理/.test(text));
   assert.equal(await page.locator('#assessmentForm').count(),0); // submitted is read-only
   await page.screenshot({path:path.join(root,size.width+'-review.png'),fullPage:false});
   const geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,flowWidth:document.querySelector('#detailFlow').getBoundingClientRect().width}));
   assert.ok(geometry.scrollWidth<=geometry.width+1);
   results.push({viewport:size,persistentPhases:6,reviewReadonly:true,noInternalAiFields:true,geometry});
   await page.goto('http://localhost:8812/ma-workbench/?record='+id);
   await page.locator('#detail [data-enter-event]').waitFor();
   assert.equal(await page.locator('#detailFlow').count(),0);
   assert.equal(await page.locator('#assessmentForm').count(),0);
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,'visual-results.json'),JSON.stringify({results,errors},null,2));
  console.log(JSON.stringify({passed:true,viewports:results.map(r=>r.viewport),pageErrors:errors.length}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
