import { describe, expect, it } from "vitest";
import { extractDingtalkMessageText } from "../../../src/integrations/dingtalk/extract-message-text";

describe("extractDingtalkMessageText", () => {
  it("reads plain text content", () => {
    const text = extractDingtalkMessageText({
      msgtype: "text",
      text: { content: "请规划 OCT 升级任务" },
    });
    expect(text).toBe("请规划 OCT 升级任务");
  });

  it("appends richText href when not in body", () => {
    const text = extractDingtalkMessageText({
      msgtype: "richText",
      content: {
        richText: [{ text: "请看需求：" }, { href: "https://example.com/spec" }],
      },
    });
    expect(text).toContain("请看需求：");
    expect(text).toContain("[links]");
    expect(text).toContain("https://example.com/spec");
  });

  it("extracts URL pasted in text", () => {
    const text = extractDingtalkMessageText({
      msgtype: "text",
      text: { content: "按这个链接规划 https://example.com/a" },
    });
    expect(text).toBe("按这个链接规划 https://example.com/a");
  });

  it("ignores sessionWebhook internal URLs", () => {
    const text = extractDingtalkMessageText({
      msgtype: "text",
      text: { content: "hello" },
      sessionWebhook: "https://oapi.dingtalk.com/robot/sendBySession?session=abc",
    });
    expect(text).toBe("hello");
    expect(text).not.toContain("oapi.dingtalk.com");
  });
});
