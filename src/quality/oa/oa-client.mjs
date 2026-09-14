// Official API: open.dingtalk.com/document/orgapp/obtains-the-details-of-a-single-approval-instance-pop
// Final comments are sent only by the gated, durable quality-final-comment outbox.
// Verified against the official @alicloud/dingtalk 2.2.48 workflow_1_0 SDK.
export class OaApiError extends Error {
  constructor(code, status = 502) { super(code); this.code = code; this.status = status; }
}
export class DingTalkOaClient {
  constructor({clientId, clientSecret, fetchImpl = fetch}) {
    this.clientId = clientId; this.clientSecret = clientSecret; this.fetch = fetchImpl;
  }
  async token() {
    if (this.cached && this.cached.expires > Date.now()) return this.cached.token;
    if (!this.pendingToken) this.pendingToken = (async () => {
      const res = await this.fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
        method:'POST', headers:{'content-type':'application/json'}, signal:AbortSignal.timeout(20000),
        body:JSON.stringify({appKey:this.clientId, appSecret:this.clientSecret}), redirect:'error',
      });
      const data = await res.json();
      if (!res.ok || !data.accessToken) throw new OaApiError(String(data.code || 'OA_TOKEN_FAILED'));
      this.cached = {token:data.accessToken, expires:Date.now() + Math.max(60, Number(data.expireIn || 7200)-120)*1000};
      return data.accessToken;
    })().finally(() => {this.pendingToken = null;});
    return this.pendingToken;
  }
  async request(path, body, retry = true) {
    const res = await this.fetch('https://api.dingtalk.com'+path, {
      method:body ? 'POST':'GET', headers:{'content-type':'application/json','x-acs-dingtalk-access-token':await this.token()},
      ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(25000), redirect:'error',
    });
    const data = await res.json();
    if (res.status === 401 && retry) {this.cached = null; return this.request(path,body,false);}
    if (!res.ok || data.success === false || data.success === 'false') throw new OaApiError(String(data.code || 'OA_READ_FAILED'),res.status);
    return data.result ?? data;
  }
  async addComment({processInstanceId, commentUserId, text}) {
    if (process.env.QUALITY_PILOT_TEST_MODE === '1' || process.env.QUALITY_OA_FINAL_COMMENT_ENABLED !== '1') throw new OaApiError('OA_COMMENT_DISABLED',403);
    if (!processInstanceId || !commentUserId || !text?.trim() || text.length > 1024) throw new OaApiError('OA_COMMENT_INVALID',400);
    let token;try{token=await this.token();}catch(error){error.definitelyRejected=true;throw error;}
    // Unlike read calls, a POST is never automatically retried after a network/parse failure.
    const res=await this.fetch('https://api.dingtalk.com/v1.0/workflow/processInstances/comments',{
      method:'POST',headers:{'content-type':'application/json','x-acs-dingtalk-access-token':token},
      body:JSON.stringify({processInstanceId,commentUserId,text}),signal:AbortSignal.timeout(25000),redirect:'error',
    });
    const data=await res.json();
    if(!res.ok || data.success!==true || data.result!==true){
      const error=new OaApiError(String(data.code||'OA_COMMENT_FAILED'),res.status);
      // Server errors and an unfamiliar response can be delivered-but-unacknowledged.
      error.definitelyRejected=(res.status>=400&&res.status<500)||(res.ok&&data.success===false);
      throw error;
    }
    return true;
  }
  listIds(processCode, startTime, endTime, nextToken = 0) {
    // The inbox includes completed instances for read-only history. Admission
    // is separately gated by current instance and reviewer-node status.
    return this.request('/v1.0/workflow/processes/instanceIds/query',{processCode,startTime,endTime,nextToken,maxResults:20});
  }
  getInstance(id) { return this.request('/v1.0/workflow/processInstances?processInstanceId='+encodeURIComponent(id)); }
}
