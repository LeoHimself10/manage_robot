import { logStructured } from "../../infra/logger";
import {
  createDingTalkQualitySourceWriter,
  createQualitySourceWritebackOutbox,
  type QualitySourceWritebackRecord,
} from "./quality-source-writeback";
import type { NormalizedQualitySourceRow } from "./quality-source-schema";

const REQUIRED_CONFIG = [
  "DINGTALK_CLIENT_ID",
  "DINGTALK_CLIENT_SECRET",
  "QUALITY_SOURCE_WORKBOOK_ID",
  "QUALITY_SOURCE_OPERATOR_UNION_ID",
] as const;

interface WritebackWriter {
  ensureStatusColumnAndBackfill(): Promise<{ backfilled: number }>;
  writeStatus(input: { source: NormalizedQualitySourceRow; desiredValue: string }): Promise<unknown>;
}

interface WritebackOutbox {
  processNext(sender: (input: QualitySourceWritebackRecord & {
    source: NormalizedQualitySourceRow;
  }) => Promise<void>): Promise<QualitySourceWritebackRecord | { status: string } | null>;
  close(): void;
}

export function isQualitySourceWritebackEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const enabled = String(env.QUALITY_SOURCE_WRITEBACK_ENABLED ?? "1").trim().toLowerCase();
  if (["0", "false", "no"].includes(enabled)) return false;
  return REQUIRED_CONFIG.every((name) => String(env[name] ?? "").trim().length > 0);
}

export function createQualitySourceWritebackRuntime(deps?: {
  env?: Record<string, string | undefined>;
  writer?: WritebackWriter;
  outbox?: WritebackOutbox;
  intervalMs?: number;
  batchSize?: number;
  log?: (event: Record<string, unknown>) => void;
}) {
  const env = deps?.env ?? process.env;
  const enabled = isQualitySourceWritebackEnabled(env);
  const writer = deps?.writer ?? createDingTalkQualitySourceWriter({ env });
  const outbox = deps?.outbox ?? (enabled
    ? createQualitySourceWritebackOutbox()
    : { processNext: async () => null, close: () => undefined });
  const intervalMs = deps?.intervalMs ?? 30_000;
  const batchSize = deps?.batchSize ?? 50;
  const log = deps?.log ?? logStructured;
  let running = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function runOnce(): Promise<{ skipped: boolean; backfilled: number; processed: number }> {
    if (!enabled || running) return { skipped: true, backfilled: 0, processed: 0 };
    running = true;
    try {
      const initialized = await writer.ensureStatusColumnAndBackfill();
      let processed = 0;
      for (; processed < batchSize; processed += 1) {
        const result = await outbox.processNext(async (record) => {
          await writer.writeStatus({ source: record.source, desiredValue: record.desiredValue });
        });
        if (!result) break;
      }
      log({
        event: "quality_source_writeback_scan_done",
        backfilled: initialized.backfilled,
        processed,
      });
      return { skipped: false, backfilled: initialized.backfilled, processed };
    } catch (error) {
      log({
        event: "quality_source_writeback_scan_failed",
        error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      });
      throw error;
    } finally {
      running = false;
    }
  }

  function start(): void {
    if (!enabled || timer || process.env.NODE_ENV === "test") return;
    void runOnce().catch(() => undefined);
    timer = setInterval(() => { void runOnce().catch(() => undefined); }, intervalMs);
    log({ event: "quality_source_writeback_scheduler_started", intervalMs });
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
    outbox.close();
  }

  return { enabled, runOnce, start, stop };
}

let sharedRuntime: ReturnType<typeof createQualitySourceWritebackRuntime> | undefined;

export function getQualitySourceWritebackRuntime() {
  sharedRuntime ??= createQualitySourceWritebackRuntime();
  return sharedRuntime;
}

export function triggerQualitySourceWriteback(): void {
  if (!isQualitySourceWritebackEnabled()) return;
  const runtime = getQualitySourceWritebackRuntime();
  if (runtime.enabled) void runtime.runOnce().catch(() => undefined);
}
