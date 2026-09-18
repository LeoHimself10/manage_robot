// Never expose upstream response bodies, credentials or source facts in errors.
export function assessmentFailure(error, requestId) {
  const code=['MODEL_OUTPUT_INVALID','MODEL_CALL_FAILED','MODEL_NOT_CONFIGURED'].includes(error?.code)?error.code:'ASSESSMENT_PROCESSING_FAILED';
  const mismatch=error?.validationIssues?.some(x=>x.code==='HANDLING_CATEGORY_MISMATCH');
  const message=code==='MODEL_OUTPUT_INVALID'
    ? (mismatch?'AI 返回的处理方式与问题分类不一致，'+(error.attempts>1?'修正后仍未通过校验。':'未通过校验。')+'请稍后重新研判，或填写人工判断。':'AI 返回结果未通过格式、分类或引用校验，本次未保存为有效研判。请重新研判或填写人工判断。')
    : code==='MODEL_NOT_CONFIGURED'?'AI 服务配置不完整，请联系管理员。'
    : code==='MODEL_CALL_FAILED'?'AI 服务暂未完成请求，请稍后重试。'
    : '研判结果处理失败，请联系管理员核查。';
  return {ok:false,code,requestId,error:message+' 已保存的来源和 AI 版本保留。',attempts:Number.isInteger(error?.attempts)?error.attempts:0};
}
export function assessmentFailureDiagnostic(error, requestId) {
  return {event:'quality_assessment_failed',requestId,code:assessmentFailure(error,requestId).code,
    attempts:Number.isInteger(error?.attempts)?error.attempts:0,
    issues:Array.isArray(error?.validationIssues)?error.validationIssues.slice(0,20).map(x=>({code:String(x.code||'').replace(/[^A-Z_]/g,'').slice(0,80),path:String(x.path||'').replace(/[^a-zA-Z0-9_.,]/g,'').slice(0,160)})):[]};
}
