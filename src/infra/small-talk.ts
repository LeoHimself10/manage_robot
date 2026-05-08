/** 纯寒暄/答谢等极短话术：不走任务规划模型，避免「补充信息」式误触。 */

const PURE_PHRASES = new Set([
  "你好",
  "您好",
  "嗨",
  "哈喽",
  "hello",
  "hi",
  "hey",
  "在吗",
  "在么",
  "谢谢",
  "多谢",
  "感谢",
  "谢了",
  "谢谢啦",
  "谢谢啊",
  "早上好",
  "下午好",
  "晚上好",
  "早安",
  "午安",
  "晚安",
  "好的",
  "好滴",
  "好哒",
  "收到",
  "嗯",
  "嗯嗯",
  "ok",
  "OK",
  "Ok",
  "不用谢",
  "不客气",
  "没关系",
  "再见",
  "拜拜",
  "bye",
]);

function normalizeWhitespace(raw: string): string {
  return raw.trim().replace(/\s+/gu, " ");
}

function stripTrailingNoise(raw: string): string {
  return raw.replace(/[!！?？.。…~～👋🙏]+$/u, "").trim();
}

/** 单行总长度上限：超过则认为可能含任务描述，应交模型判断 */
export const SMALL_TALK_MAX_CHARS = 40;

export function trySmallTalkReply(text: string): { title: string; markdownText: string } | null {
  const s = normalizeWhitespace(text);
  if (s.length === 0 || s.length > SMALL_TALK_MAX_CHARS) {
    return null;
  }

  const segments = s.split(/[，,、]/u).map((p) => stripTrailingNoise(p.trim())).filter(Boolean);
  if (segments.length === 0) {
    return null;
  }
  if (!segments.every((seg) => PURE_PHRASES.has(seg))) {
    return null;
  }

  return {
    title: "提示",
    markdownText: [
      "你好，我是 **任务规划 Demo 机器人**。",
      "",
      "请直接发送一段 **质量 / 研发任务背景**（现象、范围、时限、已有证据等），我会尝试生成结构化拆解草案。",
      "",
      "_纯寒暄不会触发规划；本条未调用大模型。_",
    ].join("\n"),
  };
}
