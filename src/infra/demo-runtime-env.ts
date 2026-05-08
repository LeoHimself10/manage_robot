/**
 * Demo / DingTalk 运行时可选策略（延迟 vs 鲁棒性）。
 * 见 docs/Qwen-接入实施说明.md。
 */

const DEFAULT_SESSION_DIGEST_MAX_CHARS = 2000;

/** 未设或 truthy → 开启（与历史行为一致）；`0`/`false`/`no` → 关闭结构自纠正（少一次模型调用，失败率可能升）。 */
export function readDemoLlmCorrectionEnabled(): boolean {
  const v = process.env.DEMO_LLM_CORRECTION?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") return false;
  return true;
}

/** 上轮摘要写入用户 prompt 的最大字符；默认 2000，范围 200–8000。 */
export function readSessionDigestMaxChars(): number {
  const raw = process.env.SESSION_DIGEST_MAX_CHARS?.trim();
  if (!raw) return DEFAULT_SESSION_DIGEST_MAX_CHARS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SESSION_DIGEST_MAX_CHARS;
  const rounded = Math.floor(n);
  return rounded < 200
    ? DEFAULT_SESSION_DIGEST_MAX_CHARS
    : rounded > 8000
      ? 8000
      : rounded;
}
