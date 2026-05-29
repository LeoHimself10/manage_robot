/** Inline client JS: mobile keyboard / scroll helpers for SSR workbench pages. */
export function buildWorkbenchKeyboardClientJs(): string {
  return `
  function wbScrollInputIntoView(input, scrollRoot) {
    if (!input) return;
    requestAnimationFrame(function () {
      try { input.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e0) {}
      if (scrollRoot) {
        var rootRect = scrollRoot.getBoundingClientRect();
        var inputRect = input.getBoundingClientRect();
        if (inputRect.bottom > rootRect.bottom - 12) {
          scrollRoot.scrollTop += inputRect.bottom - rootRect.bottom + 24;
        } else if (inputRect.top < rootRect.top + 12) {
          scrollRoot.scrollTop -= rootRect.top + 24 - inputRect.top;
        }
      }
    });
  }
  function wbAttachMobileInputScroll(input, scrollRoot) {
    if (!input) return function () {};
    var onFocus = function () { wbScrollInputIntoView(input, scrollRoot); };
    input.addEventListener('focus', onFocus);
    var vv = window.visualViewport;
    var onVv = function () {
      if (document.activeElement === input) wbScrollInputIntoView(input, scrollRoot);
    };
    if (vv) {
      vv.addEventListener('resize', onVv);
      vv.addEventListener('scroll', onVv);
    }
    return function () {
      input.removeEventListener('focus', onFocus);
      if (vv) {
        vv.removeEventListener('resize', onVv);
        vv.removeEventListener('scroll', onVv);
      }
    };
  }
  function wbAttachMobileInputScrollAll(root, scrollRoot) {
    if (!root) return function () {};
    var cleanups = [];
    root.querySelectorAll('input, textarea, select').forEach(function (el) {
      cleanups.push(wbAttachMobileInputScroll(el, scrollRoot || root));
    });
    return function () { cleanups.forEach(function (fn) { fn(); }); };
  }`.trim();
}
