import { describe, expect, it } from "vitest";
import { extractPerformanceStreamMessage } from "../../../src/agent/performance/performance-stream-message";

describe("extractPerformanceStreamMessage", () => {
  it("parses complete JSON message", () => {
    expect(extractPerformanceStreamMessage('{"message":"你好"}')).toBe("你好");
  });

  it("extracts partial message from incomplete JSON", () => {
    expect(extractPerformanceStreamMessage('{"message":"正在写')).toBe("正在写");
  });

  it("ignores tool_calls payloads", () => {
    expect(extractPerformanceStreamMessage('{"tool_calls":[{"id":"x"}]}')).toBe("");
  });
});
