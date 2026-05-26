/** Inline client JS for workbench contact combo (manager tasks / task detail pages). */
export function buildWorkbenchContactComboClientJs(): string {
  return `
  function wbAttachContactCombo(cfg) {
    var input = typeof cfg.input === 'string' ? document.getElementById(cfg.input) : cfg.input;
    var ul = typeof cfg.optionsList === 'string' ? document.getElementById(cfg.optionsList) : cfg.optionsList;
    var hid = cfg.hiddenUserId
      ? (typeof cfg.hiddenUserId === 'string' ? document.getElementById(cfg.hiddenUserId) : cfg.hiddenUserId)
      : null;
    if (!input || !ul) return { destroy: function () {} };
    var minLen = cfg.minLength != null ? cfg.minLength : 1;
    var debounceMs = cfg.debounceMs != null ? cfg.debounceMs : 250;
    var resultKey = cfg.resultKey || 'contacts';
    var timer = null;
    var destroyed = false;
    function esc(s) {
      return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function close() {
      ul.hidden = true;
      ul.innerHTML = '';
    }
    function fb(msg, kind) {
      if (cfg.onFeedback) cfg.onFeedback(msg, kind || 'muted');
    }
    function selectLi(li) {
      var uid = li.getAttribute('data-user-id') || '';
      var name = li.getAttribute('data-name') || String(li.textContent || '').replace(/按部门匹配/g, '').trim();
      if (hid) hid.value = uid;
      input.value = name.split('·')[0].trim() || name;
      close();
      if (cfg.onSelect) cfg.onSelect({ userId: uid, name: name });
    }
    function renderRows(rows) {
      if (!rows.length) {
        close();
        fb('无匹配结果', 'muted');
        return;
      }
      ul.innerHTML = rows.map(function (c) {
        var dept = esc(c.departmentSummary || c.departmentName || '');
        var tag = c.matchedField === 'department' ? '<span class="combo-tag">按部门匹配</span>' : '';
        return '<li role="option" tabindex="-1" data-user-id="' + esc(c.userId) + '" data-name="' + esc(c.name || c.userId) + '">'
          + '<span>' + esc(c.name || c.userId) + ' · ' + dept + '</span>' + tag + '</li>';
      }).join('');
      ul.querySelectorAll('li[role="option"]').forEach(function (li) { li.removeAttribute('aria-selected'); });
      ul.hidden = false;
      fb('点击选择负责人', 'ok');
      ul.querySelectorAll('li[role="option"]').forEach(function (li) {
        li.addEventListener('mousedown', function (ev) {
          ev.preventDefault();
          selectLi(li);
        });
      });
    }
    async function runSearch() {
      if (destroyed) return;
      var kw = String(input.value || '').trim().toLowerCase();
      if (kw.length < minLen) {
        close();
        if (hid) hid.value = '';
        return;
      }
      fb('查找中…', 'muted');
      try {
        var url = typeof cfg.searchUrl === 'function' ? cfg.searchUrl(kw) : cfg.searchUrl;
        var res = await fetch(url);
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
        var rows = data[resultKey] || [];
        renderRows(rows.slice(0, 40));
      } catch (e) {
        close();
        fb(String(e && e.message ? e.message : e), 'err');
      }
    }
    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { void runSearch(); }, debounceMs);
    }
    function onInput() {
      if (hid) hid.value = '';
      schedule();
    }
    function onBlur() {
      setTimeout(close, 200);
    }
    function onKeydown(ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        close();
        return;
      }
      if (!ul || ul.hidden) return;
      var items = Array.prototype.slice.call(ul.querySelectorAll('li[role="option"]'));
      if (!items.length) return;
      var cur = items.findIndex(function (li) { return li.getAttribute('aria-selected') === 'true'; });
      if (cur < 0) cur = 0;
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        cur = (cur + 1) % items.length;
        items.forEach(function (li, i) { li.setAttribute('aria-selected', i === cur ? 'true' : 'false'); });
        items[cur].scrollIntoView({ block: 'nearest' });
        return;
      }
      if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        cur = (cur - 1 + items.length) % items.length;
        items.forEach(function (li, i) { li.setAttribute('aria-selected', i === cur ? 'true' : 'false'); });
        items[cur].scrollIntoView({ block: 'nearest' });
        return;
      }
      if (ev.key === 'Enter' && !ul.hidden) {
        var pick = items.find(function (li) { return li.getAttribute('aria-selected') === 'true'; }) || items[0];
        if (!pick) return;
        ev.preventDefault();
        selectLi(pick);
      }
    }
    input.addEventListener('input', onInput);
    input.addEventListener('blur', onBlur);
    input.addEventListener('keydown', onKeydown);
    return {
      destroy: function () {
        destroyed = true;
        if (timer) clearTimeout(timer);
        input.removeEventListener('input', onInput);
        input.removeEventListener('blur', onBlur);
        input.removeEventListener('keydown', onKeydown);
        close();
      }
    };
  }
`;
}
