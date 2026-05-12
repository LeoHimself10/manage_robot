import { describe, expect, it } from "vitest";

import { computeJsapiSignature } from "../../../src/integrations/dingtalk/dingtalk-jsapi-config";

describe("dingtalk-jsapi-config", () => {
  it("computeJsapiSignature matches SHA1 over DingTalk plain string", () => {
    const sig = computeJsapiSignature({
      jsapiTicket: "ticket1",
      nonceStr: "nonce1",
      timeStamp: "123456",
      url: "https://example.com/workbench",
    });
    expect(sig).toMatch(/^[a-f0-9]{40}$/);
    const again = computeJsapiSignature({
      jsapiTicket: "ticket1",
      nonceStr: "nonce1",
      timeStamp: "123456",
      url: "https://example.com/workbench",
    });
    expect(again).toBe(sig);
  });
});
