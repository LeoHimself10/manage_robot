import { renderWorkbenchPage, type WorkbenchShellRole } from "./workbench-shell";
import { HISTORICAL_FEEDBACK_TAXONOMY_V0 } from "../quality/ai-original-assessment/historical-feedback-taxonomy-v0";
import { QUALITY_MA_WORKBENCH_STYLES } from "./quality-ma-workbench-styles";
import { QUALITY_MA_WORKBENCH_CLIENT } from "./quality-ma-workbench-client";

export interface QualityMaWorkbenchPageParams {
  role: WorkbenchShellRole;
  userId: string;
  displayName?: string;
  isTest?: boolean;
  initialSourceKey?: string;
  readonly?: boolean;
}

function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function renderQualityMaWorkbenchPage(params: QualityMaWorkbenchPageParams): string {
  const bootstrap = inlineJson({
    initialSourceKey: params.initialSourceKey ?? "",
    readonly: params.readonly === true,
    taxonomy: HISTORICAL_FEEDBACK_TAXONOMY_V0.categories,
  });
  return renderWorkbenchPage({
    role: params.role, activeNav: "quality-tracking", title: "反馈与质量跟踪",
    pageTitle: "反馈与质量跟踪", sessionUserId: params.userId, userLabel: params.displayName,
    hideMainHead: true, mainBodyClass: "wb-main-body--ma", extraCss: QUALITY_MA_WORKBENCH_STYLES,
    mainHtml: `<main class="ma-workbench" id="maWorkbench">
      <header class="ma-hero"><div><span class="ma-eyebrow">FEEDBACK WORKBENCH</span><h1>反馈与质量跟踪</h1><p>查看员工原始反馈，确认研判，并持续跟踪质量事件的处理结果。</p></div><div class="ma-hero-tags">${params.displayName ? `<span class="ma-tag blue" id="maViewerIdentity">${escapeHtml(params.displayName)}</span>` : ''}<span class="ma-tag amber">钉钉 OA 待接入</span><span class="ma-tag">来源只读</span>${params.isTest ? '<span class="ma-tag amber">本地测试数据</span>' : ''}</div></header>
      <div id="maPageMessage" class="ma-status-banner" role="status" aria-live="polite" hidden></div>
      <section class="ma-metrics" aria-label="反馈分类" id="maMetrics">
        <button type="button" class="ma-metric is-active" data-scope="all"><span>全部反馈</span><strong data-count="all">—</strong><small>员工提交后的全部来源记录</small></button>
        <button type="button" class="ma-metric" data-scope="pending"><span>待我研判</span><strong data-count="pending">—</strong><small>已确认选入，等待研判与推送</small></button>
        <button type="button" class="ma-metric" data-scope="progress"><span>跟踪处理中</span><strong data-count="progress">—</strong><small>查看初析、任务与验收进度</small></button>
        <button type="button" class="ma-metric" data-scope="closed"><span>已关闭</span><strong data-count="closed">—</strong><small>回溯结论、证据与完整记录</small></button>
      </section>
      <section class="ma-panel" aria-labelledby="maListTitle"><header class="ma-panel-head"><div><h2 id="maListTitle">全部反馈</h2><p class="ma-quiet" id="maListHelp">点击一条反馈，在该行下方查看原始资料。</p></div><button type="button" class="ma-btn" id="maRefresh">刷新数据</button></header>
        <form class="ma-toolbar" id="maSearchForm"><div class="ma-search"><label for="maSearch" class="ma-quiet" hidden>搜索编号或问题</label><input type="search" id="maSearch" aria-label="搜索审批编号、事件编号、问题、型号或批次" placeholder="搜索审批编号、事件编号、问题、型号或批次" autocomplete="off"></div><button type="submit" class="ma-btn primary">搜索</button><button type="button" class="ma-btn quiet" id="maResetSearch" hidden>清空</button></form>
        <div class="ma-result" id="maResultSummary" aria-live="polite">正在读取反馈…</div>
        <table class="ma-table" aria-label="反馈列表"><thead><tr><th>反馈 / 事件编号</th><th>问题摘要</th><th>提交人员 / 时间</th><th>当前进度</th><th>资料</th></tr></thead><tbody id="maRows"><tr><td colspan="5"><div class="ma-loading">正在读取反馈…</div></td></tr></tbody></table>
        <footer class="ma-pagination"><span id="maPageInfo">—</span><div class="ma-actions"><button class="ma-btn" type="button" id="maPrevPage" aria-label="上一页">上一页</button><button class="ma-btn" type="button" id="maNextPage" aria-label="下一页">下一页</button></div></footer>
      </section>
      <dialog class="ma-dialog" id="maConfirmDialog" aria-labelledby="maConfirmTitle"><header class="ma-dialog-head"><h2 id="maConfirmTitle">确认</h2><button type="button" class="ma-close" data-close-dialog="maConfirmDialog" aria-label="关闭确认窗口">×</button></header><div class="ma-dialog-body"><div id="maConfirmBody"></div><div class="ma-error" id="maConfirmError" role="alert" hidden></div></div><footer class="ma-dialog-footer"><button type="button" class="ma-btn" data-close-dialog="maConfirmDialog">取消</button><button type="button" class="ma-btn primary" id="maConfirmAction">确认</button></footer></dialog>
      <dialog class="ma-dialog ma-preview-dialog" id="maPreviewDialog" aria-labelledby="maPreviewTitle"><header class="ma-dialog-head"><h2 id="maPreviewTitle">附件预览</h2><button type="button" class="ma-close" data-close-dialog="maPreviewDialog" aria-label="关闭附件预览">×</button></header><div class="ma-dialog-body" id="maPreviewBody"></div><footer class="ma-dialog-footer"><a class="ma-btn" id="maPreviewDownload" download>下载附件</a><button type="button" class="ma-btn" data-close-dialog="maPreviewDialog">关闭</button></footer></dialog>
      <template id="maBootstrap">${bootstrap}</template>
    </main>`,
    scriptHtml: `<script>${QUALITY_MA_WORKBENCH_CLIENT}</script>`,
  });
}
