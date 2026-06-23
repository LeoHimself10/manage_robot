export interface RubricDimension {
  key: string;
  title: string;
}

export interface ExtractedRubric {
  title: string;
  dimensions: RubricDimension[];
  outputColumns: string[];
  needsLlmFallback: boolean;
}

const DIMENSION_HEADING_RE = /^##\s*(\d+)[）)]\s*(.+)$/gm;

const DEFAULT_OUTPUT_COLUMNS = ["维度", "参考评分(1-10)", "日志证据摘要", "改进建议"];

const SELF_ASSESSMENT_OUTPUT_COLUMNS = [
  "维度",
  "参考评分(1-10)",
  "日志证据摘要",
  "不足之处",
  "改进建议",
];

function extractTitle(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^#\s+(.+?)\s*$/);
    if (match) {
      return match[1].trim();
    }
  }
  return "未命名标准";
}

function extractDimensions(text: string): RubricDimension[] {
  const dimensions: RubricDimension[] = [];
  for (const match of text.matchAll(DIMENSION_HEADING_RE)) {
    dimensions.push({
      key: match[1],
      title: match[2].trim(),
    });
  }
  return dimensions;
}

function resolveOutputColumns(text: string): string[] {
  if (text.includes("自评") && text.includes("不足")) {
    return SELF_ASSESSMENT_OUTPUT_COLUMNS;
  }
  return DEFAULT_OUTPUT_COLUMNS;
}

export function extractRubricFromText(text: string): ExtractedRubric {
  const dimensions = extractDimensions(text);
  return {
    title: extractTitle(text),
    dimensions,
    outputColumns: resolveOutputColumns(text),
    needsLlmFallback: dimensions.length < 2,
  };
}
