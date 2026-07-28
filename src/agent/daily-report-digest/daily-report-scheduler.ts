import * as fs from "fs";
import * as path from "path";

import { logStructured } from "../../infra/logger";
import {
  loadDailyReportDigestConfig,
  type DailyReportDigestConfig,
} from "./daily-report-config";
import { isDailyReportSendWindow, resolveReportRange } from "./daily-report-window";
import { runDailyReportDigest } from "./daily-report-run";

/** 当日去重存储（默认文件标记；可注入便于测试）。 */
export interface DailyReportStateStore {
  /** 是否已发送过该日期（labelYmd） */
  isSent(labelYmd: string): boolean;
  /** 标记该日期已发送 */
  markSent(labelYmd: string): void;
}

function createFileStateStore(stateDir: string): DailyReportStateStore {
  return {
    isSent(labelYmd: string): boolean {
      try {
        return fs.existsSync(path.join(stateDir, `${labelYmd}.sent`));
      } catch {
        return false;
      }
    },
    markSent(labelYmd: string): void {
      try {
        fs.mkdirSync(stateDir, { recursive: true });
        fs.writeFileSync(
          path.join(stateDir, `${labelYmd}.sent`),
          new Date().toISOString(),
          "utf8",
        );
      } catch (err) {
        logStructured({
          event: "daily_report_state_write_failed",
          labelYmd,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}

export function createDailyReportDigestScheduler(deps?: {
  config?: DailyReportDigestConfig;
  /**
   * 仅供测试或需要动态配置来源的调用方注入。生产默认每次扫描均从配置文件重读，
   * 让工作台名单变更在下一次群早报自动生效，无需重启机器人。
   */
  loadConfig?: () => DailyReportDigestConfig;
  stateStore?: DailyReportStateStore;
  fetchImpl?: typeof fetch;
}) {
  const staticConfig = deps?.config;
  const loadConfig = () => staticConfig ?? deps?.loadConfig?.() ?? loadDailyReportDigestConfig().config;
  const config = loadConfig();
  const stateStore = deps?.stateStore ?? createFileStateStore(config.stateDir);
  let timer: NodeJS.Timeout | undefined;
  let scanning = false;

  async function runScan(now: Date = new Date()): Promise<void> {
    if (scanning) return;
    // 名单由工作台直接写入配置文件；每次扫描前重读，避免群早报继续使用进程启动时的旧名单。
    const currentConfig = loadConfig();
    if (!currentConfig.enabled) return;
    if (!isDailyReportSendWindow(now, currentConfig)) return;

    const range = resolveReportRange(now, currentConfig.timezone);
    if (stateStore.isSent(range.labelYmd)) return;

    scanning = true;
    try {
      const result = await runDailyReportDigest(currentConfig, {
        fetchImpl: deps?.fetchImpl,
        now,
      });
      if (result.ok) {
        stateStore.markSent(range.labelYmd);
      }
      logStructured({
        event: "daily_report_scan_done",
        labelYmd: range.labelYmd,
        ok: result.ok,
        submittedCount: result.submittedCount,
        missingCount: result.missingCount,
        errorCount: result.errorCount,
      });
    } catch (err) {
      logStructured({
        event: "daily_report_scan_failed",
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      scanning = false;
    }
  }

  return {
    config,
    runScan,
    startIntervalLoop() {
      if (!config.enabled) return;
      if (timer) return;
      void runScan().catch(() => undefined);
      timer = setInterval(() => {
        void runScan().catch(() => undefined);
      }, config.scanIntervalMs);
    },
    stopIntervalLoop() {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    },
  };
}
