export class OaApiError extends Error {
  code: string;
  status: number;
  definitelyRejected?: boolean;
  constructor(code: string, status?: number);
}
export class DingTalkOaClient {
  constructor(config: {clientId:string; clientSecret:string; fetchImpl?:typeof fetch});
  token(): Promise<string>;
  request(path:string, body?:unknown, retry?:boolean): Promise<any>;
  listIds(processCode:string,startTime:number,endTime:number,nextToken?:number): Promise<any>;
  getInstance(id:string): Promise<any>;
  addComment(input:{processInstanceId:string;commentUserId:string;text:string}): Promise<true>;
}
