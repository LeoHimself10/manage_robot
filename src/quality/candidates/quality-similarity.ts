function normalizeChineseText(value: string): string {
  return value
    .toLocaleLowerCase("zh-CN")
    .normalize("NFKC")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function bigrams(value: string): string[] {
  const characters = Array.from(normalizeChineseText(value));
  if (characters.length < 2) return characters;
  const result: string[] = [];
  for (let index = 0; index < characters.length - 1; index += 1) {
    result.push(`${characters[index]}${characters[index + 1]}`);
  }
  return result;
}

export function chineseBigramDice(left: string, right: string): number {
  const normalizedLeft = normalizeChineseText(left);
  const normalizedRight = normalizeChineseText(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  const leftBigrams = bigrams(normalizedLeft);
  const rightBigrams = bigrams(normalizedRight);
  if (leftBigrams.length === 0 || rightBigrams.length === 0) return 0;
  const remaining = new Map<string, number>();
  for (const item of rightBigrams) remaining.set(item, (remaining.get(item) ?? 0) + 1);
  let intersection = 0;
  for (const item of leftBigrams) {
    const count = remaining.get(item) ?? 0;
    if (count <= 0) continue;
    intersection += 1;
    remaining.set(item, count - 1);
  }
  return (2 * intersection) / (leftBigrams.length + rightBigrams.length);
}

