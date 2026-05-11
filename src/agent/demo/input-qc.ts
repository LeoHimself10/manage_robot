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

  return {
    canGenerateWbs: true,
    missingFields: [],
    questions: [],
  };
}
