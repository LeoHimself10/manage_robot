/** Shared client JS for manager ↔ employee workbench view switching. */
export function buildWorkbenchViewSwitchClientJs(): string {
  return `
  async function wbSwitchView(view, redirectTo) {
    var res = await fetch('/api/workbench/switch-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ view: view }),
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || !data.ok) {
      throw new Error(data.error || ('HTTP ' + res.status));
    }
    window.location.href = redirectTo || data.redirectTo || '/workbench';
  }
  function wbBindViewSwitchLink(id, view, redirectTo) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', function (ev) {
      ev.preventDefault();
      void wbSwitchView(view, redirectTo).catch(function (err) {
        alert(err && err.message ? err.message : String(err));
      });
    });
  }
`;
}
