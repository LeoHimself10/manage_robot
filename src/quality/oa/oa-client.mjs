// Official API: open.dingtalk.com/document/orgapp/obtains-the-details-of-a-single-approval-instance-pop
// This adapter deliberately exposes no approval, message or template mutation.
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
  listIds(processCode, startTime, endTime, nextToken = 0) {
    return this.request('/v1.0/workflow/processes/instanceIds/query',{processCode,startTime,endTime,nextToken,maxResults:20,statuses:['RUNNING']});
  }
  getInstance(id) { return this.request('/v1.0/workflow/processInstances?processInstanceId='+encodeURIComponent(id)); }
}
