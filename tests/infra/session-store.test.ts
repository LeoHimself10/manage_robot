import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveChatSessionKey,
  MemoryChatSessionStore,
  readChatSessionTtlMs,
  readRateLimitWindowMs,
} from "../../src/infra/session-store";

describe("MemoryChatSessionStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns undefined after TTL expiry", () => {
    const store = new MemoryChatSessionStore({ ttlMs: 1000 });
    store.set("k1", { v: 1 });
    expect(store.get("k1")).toEqual({ v: 1 });
    vi.advanceTimersByTime(1001);
    expect(store.get("k1")).toBeUndefined();
  });

  it("checkRateLimitThenTouch rejects second call inside window", () => {
    const store = new MemoryChatSessionStore({ ttlMs: 60_000 });
    expect(store.checkRateLimitThenTouch("chat-a", 5000)).toBe(true);
    expect(store.checkRateLimitThenTouch("chat-a", 5000)).toBe(false);
    vi.advanceTimersByTime(5001);
    expect(store.checkRateLimitThenTouch("chat-a", 5000)).toBe(true);
  });

  it("deriveChatSessionKey is stable composite", () => {
    expect(
      deriveChatSessionKey({
        sessionWebhook: "https://example/webhook",
        senderStaffId: "u123",
      })
    ).toBe("https://example/webhook::u123");
  });

  it("uses independent windows per key", () => {
    const store = new MemoryChatSessionStore({ ttlMs: 60_000 });
    expect(store.checkRateLimitThenTouch("a", 5000)).toBe(true);
    expect(store.checkRateLimitThenTouch("b", 5000)).toBe(true);
  });
});

describe("session envReaders", () => {
  const saved = { ...process.env };

  afterEach(() => {
    Object.assign(process.env, saved);
  });

  it("readChatSessionTtlMs parses env", () => {
    process.env.CHAT_SESSION_TTL_MS = "120000";
    expect(readChatSessionTtlMs()).toBe(120_000);
  });

  it("readRateLimitWindowMs parses env", () => {
    process.env.RATE_LIMIT_WINDOW_MS = "3000";
    expect(readRateLimitWindowMs()).toBe(3000);
  });
});
