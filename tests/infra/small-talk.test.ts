import { describe, expect, it } from "vitest";
import { trySmallTalkReply } from "../../src/infra/small-talk";

describe("trySmallTalkReply", () => {
  it("greets hello without LLM hint", () => {
    const r = trySmallTalkReply("你好");
    expect(r).not.toBeNull();
    expect(r!.markdownText).toContain("任务规划");
  });

  it("matches punctuated greeting", () => {
    expect(trySmallTalkReply("您好！")).not.toBeNull();
    expect(trySmallTalkReply("谢谢啦。")).not.toBeNull();
  });

  it("matches composite pure pleasantries", () => {
    expect(trySmallTalkReply("你好，谢谢")).not.toBeNull();
  });

  it("does not intercept task-like messages", () => {
    expect(trySmallTalkReply("你好，产线测试失败了")).toBeNull();
    expect(
      trySmallTalkReply(
        "产线测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台。",
      ),
    ).toBeNull();
  });

  it("does not intercept long filler", () => {
    expect(
      trySmallTalkReply(
        "你好你好你好你好你好你好你好你好你好你好你好你好你好你好你好你好你好你好",
      ),
    ).toBeNull();
  });
});
