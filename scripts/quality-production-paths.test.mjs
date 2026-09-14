import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {PREFIX,rewriteProductionLinks as rewrite,productionLocation} from './quality-production-paths.mjs';
test('local URLs become same-origin once',()=>{
  assert.equal(rewrite('"http://127.0.0.1:8797/workbench/quality"'),`"${PREFIX}/workbench/quality"`);
  assert.equal(rewrite('"http://127.0.0.1:8809/?record=a"'),`"${PREFIX}/tong/?record=a"`);
});
test('API paths are protected while external resources remain intact',()=>{
  assert.equal(rewrite("fetch('/api/quality-oa/list')"),`fetch('${PREFIX}/api/quality-oa/list')`);
  assert.equal(rewrite('https://example.com/api/x'),'https://example.com/api/x');
});
test('rewriting is idempotent',()=>{const s='"http://127.0.0.1:8808/ma-workbench/"';assert.equal(rewrite(rewrite(s)),rewrite(s));});
test('redirect headers add the prefix only once',()=>{
  assert.equal(productionLocation('/workbench/quality'),PREFIX+'/workbench/quality');
  assert.equal(productionLocation(PREFIX+'/ma-workbench/'),PREFIX+'/ma-workbench/');
  assert.equal(productionLocation('https://example.org/'),'https://example.org/');
});
test('the executed Ma and Tong menus reach the approved quality views without a doubled prefix',()=>{
  for(const role of ['ma-workbench','tong']){
    const element={innerHTML:'',querySelector(){return this;},addEventListener(){},appendChild(){}};
    const document={createElement:()=>element,querySelector:()=>element,addEventListener(){}};
    const source=readFileSync(new URL('../public/quality/'+role+'/view-switcher.js',import.meta.url),'utf8');
    runInNewContext(rewrite(source),{document});
    assert.ok(!element.innerHTML.includes(PREFIX+PREFIX));
    assert.equal((element.innerHTML.match(/target="_self"/g)||[]).length,3);
    assert.ok(!element.innerHTML.includes('target="_blank"'));
    assert.ok(element.innerHTML.includes('href="'+PREFIX+'/workbench/quality?perspective=manager"'));
    assert.ok(element.innerHTML.includes('href="'+PREFIX+'/workbench/quality?perspective=employee"'));
  }
});
test('the rewritten login client retains the Ma/Tong next URL',()=>{
  const source=readFileSync(new URL('../src/web/workbench-dd-login-entry.ts',import.meta.url),'utf8');
  const functionSource=source.match(/function readWorkbenchNextPath\(\): string \{[\s\S]*?\n\}/)[0].replace('(): string','()');
  for(const next of [PREFIX+'/ma-workbench/',PREFIX+'/tong/?record=oa_123']){
    const result=runInNewContext(rewrite(functionSource)+';readWorkbenchNextPath()',{
      getQueryValue:()=>next,window:{location:{pathname:PREFIX+'/workbench',search:''}}
    });
    assert.equal(result,next);
  }
});
