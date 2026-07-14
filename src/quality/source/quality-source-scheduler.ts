export const QUALITY_SOURCE_SYNC_INTERVAL_MS = 2 * 60 * 60 * 1000;

export function createQualitySourceScheduler(deps: {
  runSync: () => Promise<void>;
  intervalMs?: number;
  logError?: (event: Record<string, unknown>) => void;
}): { runOnce(): Promise<void>; startIntervalLoop(): void; stopIntervalLoop(): void } {
  const intervalMs = deps.intervalMs ?? QUALITY_SOURCE_SYNC_INTERVAL_MS;
  const logError = deps.logError ?? ((event) => console.error(JSON.stringify(event)));
  let running = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function runOnce(): Promise<void> {
    if (running) return;
    running = true;
    try {
      await deps.runSync();
    } catch (error) {
      logError({
        event: "quality_source_sync_failed",
        error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      });
    } finally {
      running = false;
    }
  }

  function startIntervalLoop(): void {
    if (timer) return;
    void runOnce();
    timer = setInterval(() => { void runOnce(); }, intervalMs);
  }

  function stopIntervalLoop(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  return { runOnce, startIntervalLoop, stopIntervalLoop };
}

