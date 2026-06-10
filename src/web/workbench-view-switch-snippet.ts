/** Shared client JS for manager ↔ employee ↔ admin workbench view switching. */
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
  function wbBindViewSwitchLinks() {
    document.querySelectorAll('[data-wb-view]').forEach(function (el) {
      if (el.hasAttribute('hidden')) return;
      if (el.getAttribute('data-wb-switch-disabled') === '1') return;
      if (el.getAttribute('data-wb-view-bound') === '1') return;
      el.setAttribute('data-wb-view-bound', '1');
      el.addEventListener('click', function (ev) {
        ev.preventDefault();
        var view = el.getAttribute('data-wb-view') || '';
        var redirectTo = el.getAttribute('data-wb-redirect') || '';
        void wbSwitchView(view, redirectTo || undefined).catch(function (err) {
          alert(err && err.message ? err.message : String(err));
        });
      });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wbBindViewSwitchLinks);
  } else {
    wbBindViewSwitchLinks();
  }
`;
}
