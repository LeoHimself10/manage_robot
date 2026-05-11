const DEFAULT_CHAT_SESSION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 5000;

export interface MemoryChatSessionStoreOptions {
  ttlMs?: number;
}

export function readChatSessionTtlMs(): number {
  const raw = process.env.CHAT_SESSION_TTL_MS?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CHAT_SESSION_TTL_MS;
}

export function deriveChatSessionKey(payload: {
  conversationId?: string;
  conversationType?: string;
  sessionWebhook?: string;
  senderStaffId?: string;
}): string {
  return deriveStableChatSessionKey(payload).chatKey;
}

export function deriveLegacyChatSessionKey(payload: {
  sessionWebhook?: string;
  senderStaffId?: string;
}): string {
  const w = (payload.sessionWebhook ?? "").trim();
  const u = (payload.senderStaffId ?? "").trim();
  return `${w}::${u}`;
}

export function deriveStableChatSessionKey(payload: {
  conversationId?: string;
  conversationType?: string;
  sessionWebhook?: string;
  senderStaffId?: string;
}): {
  chatKey: string;
  source: "conversation" | "webhook_fallback";
  legacyChatKey: string;
} {
  const conversationId = (payload.conversationId ?? "").trim();
  const conversationType = (payload.conversationType ?? "").trim();
  const senderStaffId = (payload.senderStaffId ?? "").trim();
  const legacyChatKey = deriveLegacyChatSessionKey({
    sessionWebhook: payload.sessionWebhook,
    senderStaffId,
  });
  if (conversationId) {
    return {
      chatKey: `${conversationId}::${conversationType || "unknown"}::${senderStaffId}`,
      source: "conversation",
      legacyChatKey,
    };
  }
  return {
    chatKey: legacyChatKey,
    source: "webhook_fallback",
    legacyChatKey,
  };
}

export function readRateLimitWindowMs(): number {
  const raw = process.env.RATE_LIMIT_WINDOW_MS?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RATE_LIMIT_WINDOW_MS;
}

/**
 * Single-process TTL session map + naive per-chat rate limiting (milliseconds since last touched).
 */
export class MemoryChatSessionStore<T = Record<string, unknown>> {
  private readonly entries = new Map<
    string,
    { payload: T; expiresAt: number }
  >();
  private readonly lastRateAt = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(options?: MemoryChatSessionStoreOptions) {
    this.ttlMs = options?.ttlMs ?? readChatSessionTtlMs();
  }

  get(chatKey: string): T | undefined {
    const row = this.entries.get(chatKey);
    if (!row) return undefined;
    if (Date.now() > row.expiresAt) {
      this.entries.delete(chatKey);
      return undefined;
    }
    return row.payload;
  }

  set(chatKey: string, payload: T): void {
    this.entries.set(chatKey, {
      payload,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /**
   * @returns false when another request within `windowMs` was already admitted for `chatKey`.
   */
  checkRateLimitThenTouch(chatKey: string, windowMs: number): boolean {
    const now = Date.now();
    const prev = this.lastRateAt.get(chatKey);
    if (prev !== undefined && now - prev < windowMs) return false;
    this.lastRateAt.set(chatKey, now);
    return true;
  }
}
