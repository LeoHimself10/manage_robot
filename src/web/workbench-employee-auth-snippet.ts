/** Shared client JS for employee workbench session recovery (401 → login). */
export function buildWorkbenchEmployeeAuthClientJs(): string {
  return `
  var wbLoginSource = null;
  function wbSafeNextPath() {
    try {
      var p = location.pathname + location.search;
      if (p.indexOf('/workbench/employee') === 0) return p;
    } catch (e) {}
    return '/workbench/employee?view=new';
  }
  function wbRedirectOnAuthFailure() {
    var next = encodeURIComponent(wbSafeNextPath());
    if (wbLoginSource === 'external_password') {
      location.href = '/workbench/external/login?next=' + next;
      return;
    }
    location.href = '/workbench';
  }
  function wbIsSessionExpiredResponse(res, data) {
    if (!res || res.status !== 401) return false;
    var err = String((data && data.error) || '');
    if (err === 'Session required' || err === 'External session required' || err === 'Unauthorized') {
      return true;
    }
    return err === '';
  }
  function wbCheckAuthResponse(res, data) {
    if (!wbIsSessionExpiredResponse(res, data)) return false;
    wbRedirectOnAuthFailure();
    return true;
  }
  function wbRememberLoginSource(data) {
    if (data && data.loginSource) wbLoginSource = data.loginSource;
  }
  `;
}
