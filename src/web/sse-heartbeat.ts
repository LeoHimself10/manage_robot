import type { ServerResponse } from "node:http";

export const SSE_HEARTBEAT_INTERVAL_MS = 10_000;

type SseHeartbeatResponse = Pick<
  ServerResponse,
  "destroyed" | "off" | "once" | "write" | "writableEnded"
>;

/**
 * Keep long-running SSE requests active while tools or the model are working
 * without producing user-visible events.
 */
export function startSseHeartbeat(
  res: SseHeartbeatResponse,
  intervalMs = SSE_HEARTBEAT_INTERVAL_MS,
): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
    res.off("close", stop);
  }

  timer = setInterval(() => {
    if (res.destroyed || res.writableEnded) {
      stop();
      return;
    }
    res.write(": keep-alive\n\n");
  }, Math.max(1_000, intervalMs));
  timer.unref();
  res.once("close", stop);
  return stop;
}
