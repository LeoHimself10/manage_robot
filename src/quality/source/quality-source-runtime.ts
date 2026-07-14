import { refreshQualityCandidates } from "../candidates/quality-candidate-detector";
import { createQualityStore } from "../infra/quality-store";
import { createDingTalkQualitySource } from "./dingtalk-quality-source";
import {
  createQualitySourceScheduler,
  QUALITY_SOURCE_SYNC_INTERVAL_MS,
} from "./quality-source-scheduler";
import { createQualitySourceSync } from "./quality-source-sync";

const REQUIRED_CONFIG = [
  "DINGTALK_CLIENT_ID",
  "DINGTALK_CLIENT_SECRET",
  "QUALITY_SOURCE_WORKBOOK_ID",
  "QUALITY_SOURCE_OPERATOR_UNION_ID",
] as const;

export function hasCompleteQualitySourceConfig(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const enabled = String(env.QUALITY_SOURCE_SYNC_ENABLED ?? "1").trim().toLowerCase();
  if (["0", "false", "no"].includes(enabled)) return false;
  return REQUIRED_CONFIG.every((name) => String(env[name] ?? "").trim().length > 0);
}

export function createQualitySourceRuntime(deps?: {
  env?: Record<string, string | undefined>;
  runSync?: () => Promise<void>;
  log?: (event: Record<string, unknown>) => void;
  intervalMs?: number;
}) {
  const env = deps?.env ?? process.env;
  const enabled = hasCompleteQualitySourceConfig(env);
  const log = deps?.log ?? ((event) => console.info(JSON.stringify(event)));
  let started = false;
  let disabledLogged = false;
  let sourceSync: ReturnType<typeof createQualitySourceSync> | undefined;

  async function defaultRunSync(): Promise<void> {
    if (!sourceSync) {
      createQualityStore().close();
      sourceSync = createQualitySourceSync({
        reader: createDingTalkQualitySource({ env }),
        refreshCandidates: async () => { refreshQualityCandidates({ env }); },
      });
    }
    await sourceSync.syncNow();
  }

  const scheduler = createQualitySourceScheduler({
    runSync: deps?.runSync ?? defaultRunSync,
    intervalMs: deps?.intervalMs ?? QUALITY_SOURCE_SYNC_INTERVAL_MS,
    logError: log,
  });

  function start(): void {
    if (!enabled) {
      if (!disabledLogged) {
        disabledLogged = true;
        log({
          event: "quality_source_sync_disabled",
          reason: "configuration_incomplete_or_disabled",
        });
      }
      return;
    }
    if (started) return;
    started = true;
    scheduler.startIntervalLoop();
    log({
      event: "quality_source_sync_scheduler_started",
      intervalMs: deps?.intervalMs ?? QUALITY_SOURCE_SYNC_INTERVAL_MS,
    });
  }

  function stop(): void {
    scheduler.stopIntervalLoop();
    started = false;
    sourceSync?.close();
    sourceSync = undefined;
  }

  return { enabled, start, stop, runOnce: scheduler.runOnce };
}
