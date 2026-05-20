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

/** Client-side `fmtTime` for inline SSR scripts (self-contained; no `esc` dependency). */
export function buildWorkbenchFmtTimeClientJs(): string {
  return `
  function wbEsc(v){
    return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function fmtTime(iso){
    try {
      var raw = String(iso || '').trim();
      if (!raw) return wbEsc('—');
      var d = new Date(raw);
      if (!isFinite(d.getTime())) return wbEsc('—');
      var p = new Intl.DateTimeFormat('zh-CN', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).formatToParts(d);
      function pick(t){ for (var i=0;i<p.length;i++) if (p[i].type===t) return p[i].value; return ''; }
      return wbEsc(pick('year')+'-'+pick('month')+'-'+pick('day')+' '+pick('hour')+':'+pick('minute'));
    } catch(e){ return wbEsc('—'); }
  }`.trim();
}
