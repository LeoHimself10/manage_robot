/** Fixed zh-CN display for workbench lists, details, and event timelines. */

const ZH_LOCALE = "zh-CN";

export function formatWorkbenchDateTime(iso: string | undefined | null): string {
  const raw = String(iso ?? "").trim();
  if (!raw) return "—";
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat(ZH_LOCALE, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}`;
}

/** Client-side `fmtTime` body for inline SSR scripts (returns escaped HTML-safe string). */
export function buildWorkbenchFmtTimeClientJs(): string {
  return `
  function fmtTime(iso){
    try {
      var raw = String(iso || '').trim();
      if (!raw) return esc('—');
      var d = new Date(raw);
      if (!isFinite(d.getTime())) return esc('—');
      var p = new Intl.DateTimeFormat('zh-CN', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).formatToParts(d);
      function pick(t){ for (var i=0;i<p.length;i++) if (p[i].type===t) return p[i].value; return ''; }
      return esc(pick('year')+'-'+pick('month')+'-'+pick('day')+' '+pick('hour')+':'+pick('minute'));
    } catch(e){ return esc('—'); }
  }`.trim();
}
