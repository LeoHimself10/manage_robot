const DEFAULT_INPUT_MAX_CHARS = 3000;

export function resolveInputMaxChars(): number {
  const raw = process.env.INPUT_MAX_CHARS?.trim();
  if (!raw) return DEFAULT_INPUT_MAX_CHARS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INPUT_MAX_CHARS;
}

export interface InputQualityRequest {
  domainHint?: unknown;
  background: string;
}

export interface InputQualityResult {
  canGenerateWbs: boolean;
  missingFields: string[];
  questions: string[];
}

export function checkInputQuality(
  request: InputQualityRequest
): InputQualityResult {
  const text = request.background.trim();
  if (!text) {
    return {
      canGenerateWbs: false,
      missingFields: ["background"],
      questions: ["请先描述要规划的任务背景、目标或问题现象。"],
    };
  }

  const limit = resolveInputMaxChars();
  if (text.length > limit) {
    return {
      canGenerateWbs: false,
      missingFields: ["background"],
      questions: [
        `单次背景描述过长（${text.length} 字符，上限 ${limit}）。请将内容拆分后分段发送或删除无关文字后再试；模型侧不做静默截断。`,
      ],
    };
  }

  return {
    canGenerateWbs: true,
    missingFields: [],
    questions: [],
  };
}
