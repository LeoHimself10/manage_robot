import test from 'node:test';import assert from 'node:assert/strict';
import {assessmentFailure,assessmentFailureDiagnostic} from './quality-assessment-error.mjs';
test('shows validation conflict and preserves history message without leaking upstream data',()=>{
 const error={code:'MODEL_OUTPUT_INVALID',attempts:2,message:'secret-token-and-source-facts',validationIssues:[{code:'HANDLING_CATEGORY_MISMATCH',path:'handlingRecommendation',message:'secret details'}]};
 const response=assessmentFailure(error,'request-test');assert.equal(response.code,'MODEL_OUTPUT_INVALID');assert.match(response.error,/分类不一致/);assert.match(response.error,/版本保留/);
 assert.ok(!JSON.stringify([response,assessmentFailureDiagnostic(error,'request-test')]).includes('secret'));
});
test('distinguishes transport and missing configuration from validation',()=>{
 assert.match(assessmentFailure({code:'MODEL_CALL_FAILED'},'r').error,/暂未完成/);
 assert.match(assessmentFailure({code:'MODEL_NOT_CONFIGURED'},'r').error,/配置不完整/);
 assert.equal(assessmentFailure(new Error('raw upstream token'),'r').code,'ASSESSMENT_PROCESSING_FAILED');
});

test('does not claim a repair when only one attempt occurred',()=>{assert.ok(!assessmentFailure({code:'MODEL_OUTPUT_INVALID',attempts:1,validationIssues:[{code:'HANDLING_CATEGORY_MISMATCH'}]},'r').error.includes('修正后'));});
