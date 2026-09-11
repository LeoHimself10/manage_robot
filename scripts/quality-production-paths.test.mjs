import test from 'node:test';
import assert from 'node:assert/strict';
import {PREFIX,rewriteProductionLinks as rewrite} from './quality-production-paths.mjs';
test('local URLs become same-origin once',()=>{
  assert.equal(rewrite('"http://127.0.0.1:8797/workbench/quality"'),`"${PREFIX}/workbench/quality"`);
  assert.equal(rewrite('"http://127.0.0.1:8809/?record=a"'),`"${PREFIX}/tong/?record=a"`);
});
test('API paths are protected while external resources remain intact',()=>{
  assert.equal(rewrite("fetch('/api/quality-oa/list')"),`fetch('${PREFIX}/api/quality-oa/list')`);
  assert.equal(rewrite('https://example.com/api/x'),'https://example.com/api/x');
});
test('rewriting is idempotent',()=>{const s='"http://127.0.0.1:8808/ma-workbench/"';assert.equal(rewrite(rewrite(s)),rewrite(s));});
