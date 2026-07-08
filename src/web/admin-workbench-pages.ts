import { renderWorkbenchPage } from "./workbench-shell";
import { isWorkbenchManagerGroupsEnabled } from "../security/workbench-manager-groups";

export const ADMIN_PERMISSIONS_CSS = `
.admin-perm-hub {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.admin-perm-hero {
  padding: 18px 20px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background:
    linear-gradient(135deg, rgba(15, 118, 110, 0.07) 0%, rgba(255, 255, 255, 0) 52%),
    linear-gradient(180deg, #fff 0%, #f8fafc 100%);
  box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04);
}
.admin-perm-hero h2 {
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--text);
}
.admin-perm-hero p {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--muted);
  max-width: 62ch;
}
.admin-perm-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(280px, 0.95fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 960px) {
  .admin-perm-grid { grid-template-columns: 1fr; }
}
.admin-perm-panel {
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
  overflow: hidden;
}
.admin-perm-panel__head {
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--border);
  background: #fbfdff;
}
.admin-perm-panel__head h3 {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.admin-perm-panel__head p {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--muted);
}
.admin-perm-panel__body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.admin-perm-search {
  display: grid;
  gap: 10px;
}
.admin-perm-search label {
  display: grid;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}
.admin-perm-combo {
  position: relative;
}
.admin-perm-combo input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
  background: #fff;
}
.admin-perm-combo input:focus {
  outline: none;
  border-color: var(--accent, #2563eb);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
}
.admin-perm-combo__menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 280px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.14);
  padding: 4px;
}
.admin-perm-combo__opt {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 9px;
  cursor: pointer;
}
.admin-perm-combo__opt:hover,
.admin-perm-combo__opt.is-active {
  background: rgba(37, 99, 235, 0.08);
}
.admin-perm-combo__av {
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: #4338ca;
  background: rgba(99, 102, 241, 0.14);
}
.admin-perm-combo__txt {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1 1 auto;
}
.admin-perm-combo__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.admin-perm-combo__dept {
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
}
.admin-perm-combo__tags {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 600;
  color: #0f766e;
  background: rgba(15, 118, 110, 0.1);
  padding: 2px 8px;
  border-radius: 999px;
}
.admin-perm-combo__empty {
  padding: 12px;
  text-align: center;
  font-size: 13px;
  color: var(--muted);
}
.admin-perm-selected {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(37, 99, 235, 0.25);
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(37, 99, 235, 0.05), #fff 72%);
}
.admin-perm-selected__av {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  color: #4338ca;
  background: rgba(99, 102, 241, 0.16);
}
.admin-perm-selected__meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1 1 auto;
}
.admin-perm-selected__name {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
}
.admin-perm-selected__sub {
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.admin-perm-selected__clear {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: none;
  background: rgba(15, 23, 42, 0.06);
  color: var(--muted);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.admin-perm-selected__clear:hover {
  background: rgba(15, 23, 42, 0.12);
  color: var(--text);
}
.admin-perm-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
@media (max-width: 640px) {
  .admin-perm-actions { grid-template-columns: 1fr; }
}
.admin-perm-action {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: #fff;
}
.admin-perm-action.is-portfolio {
  border-color: rgba(15, 118, 110, 0.22);
  background: linear-gradient(180deg, rgba(15, 118, 110, 0.04), #fff 72%);
}
.admin-perm-action.is-manager-group {
  grid-column: 1 / -1;
  border-color: rgba(79, 70, 229, 0.2);
  background: linear-gradient(180deg, rgba(79, 70, 229, 0.04), #fff 72%);
}
.admin-perm-action__title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}
.admin-perm-action__hint {
  font-size: 11px;
  line-height: 1.45;
  color: var(--muted);
  min-height: 2.9em;
}
.admin-perm-action label {
  display: grid;
  gap: 5px;
  font-size: 11px;
  font-weight: 700;
  color: #475569;
}
.admin-perm-action input[type="text"],
.admin-perm-action select {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
  font-size: 12px;
  background: #fff;
}
.admin-perm-action__fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.admin-perm-action__fields label:first-child {
  grid-column: 1 / -1;
}
.admin-perm-check {
  display: flex !important;
  flex-direction: row;
  align-items: center;
  gap: 8px !important;
  font-weight: 600 !important;
}
.admin-perm-check input {
  width: auto;
}
.admin-perm-action__buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
@media (max-width: 640px) {
  .admin-perm-action__fields { grid-template-columns: 1fr; }
}
.admin-perm-lists {
  display: grid;
  gap: 14px;
}
.admin-perm-list-card {
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
  overflow: hidden;
}
.admin-perm-list-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  background: #fbfdff;
}
.admin-perm-list-card__head h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 800;
}
.admin-perm-count {
  font-size: 11px;
  font-weight: 700;
  color: var(--muted);
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef2f7;
}
.admin-perm-list-card__body {
  padding: 8px 14px 12px;
  max-height: 320px;
  overflow: auto;
}
.admin-perm-row {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}
.admin-perm-row:last-child { border-bottom: none; }
.admin-perm-av {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--admin-soft);
  color: var(--admin);
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 800;
}
.admin-perm-av.is-portfolio {
  background: rgba(15, 118, 110, 0.12);
  color: #0f766e;
}
.admin-perm-row__name {
  font-size: 13px;
  font-weight: 700;
  line-height: 1.25;
}
.admin-perm-row__id {
  font-size: 11px;
  color: var(--muted);
  word-break: break-all;
}
.admin-perm-tag {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
  padding: 3px 7px;
  border-radius: 999px;
  white-space: nowrap;
}
.admin-perm-tag.is-dynamic {
  background: rgba(37, 99, 235, 0.1);
  color: #1d4ed8;
}
.admin-perm-tag.is-env {
  background: rgba(100, 116, 139, 0.12);
  color: #475569;
}
.admin-perm-footnote {
  font-size: 11px;
  line-height: 1.5;
  color: var(--muted);
  padding: 0 2px;
}
`;

function buildAdminPermissionsClientJs(managerGroupsEnabled: boolean): string {
  const managerGroupStateJs = managerGroupsEnabled ? "  var managerGroupRows = [];\n" : "";
  const reloadPermissionsJs = managerGroupsEnabled
    ? "Promise.all([loadManagers(), loadPortfolioManagers(), loadManagerGroups()])"
    : "Promise.all([loadManagers(), loadPortfolioManagers()])";
  const managerGroupClientJs = managerGroupsEnabled ? `
  function selectedManagerGroupId() {
    var sel = document.getElementById('managerGroupMemberSelect');
    return sel ? String(sel.value || '').trim() : '';
  }

  function renderManagerGroupSelect() {
    var sel = document.getElementById('managerGroupMemberSelect');
    if (!sel) return;
    var previous = sel.value || '';
    sel.innerHTML = '<option value="">选择主管组</option>' + managerGroupRows.map(function (g) {
      return '<option value="' + esc(g.groupId) + '">' + esc(g.name || g.groupId) + '</option>';
    }).join('');
    if (previous && managerGroupRows.some(function (g) { return g.groupId === previous; })) {
      sel.value = previous;
    }
  }

  function renderManagerGroups() {
    var mount = document.getElementById('managerGroupListMount');
    var countEl = document.getElementById('managerGroupCount');
    if (!mount) return;
    if (countEl) countEl.textContent = String(managerGroupRows.length);
    renderManagerGroupSelect();
    if (!managerGroupRows.length) {
      mount.innerHTML = '<div class="empty-state" style="padding:12px 0;margin:0;">暂无主管组</div>';
      return;
    }
    mount.innerHTML = managerGroupRows.map(function (g) {
      var memberCount = (g.memberUserIds || []).length;
      var members = (g.members || []).map(function (m) { return m.name || m.userId; }).filter(Boolean).join('、');
      var meta = esc(g.groupId) + ' · 成员 ' + esc(String(memberCount)) + ' · 任务 ' + esc(String(g.taskCount || 0)) + ' · 项目 ' + esc(String(g.projectCount || 0));
      if (members) meta += '<br>' + esc(members);
      return '<div class="admin-perm-row">'
        + '<span class="admin-perm-av">' + esc(permInitial(g.name || g.groupId)) + '</span>'
        + '<div><div class="admin-perm-row__name">' + esc(g.name || g.groupId) + '</div><div class="admin-perm-row__id">' + meta + '</div></div>'
        + '<button type="button" class="btn btn-ghost btn-sm" data-manager-group-select="' + esc(g.groupId) + '">' + (g.status === 'inactive' ? '停用' : '启用') + '</button>'
        + '</div>';
    }).join('');
    Array.prototype.forEach.call(mount.querySelectorAll('[data-manager-group-select]'), function (node) {
      node.addEventListener('click', function () {
        var sel = document.getElementById('managerGroupMemberSelect');
        if (sel) sel.value = node.getAttribute('data-manager-group-select') || '';
      });
    });
  }

  async function loadManagerGroups() {
    var res = await fetch('/api/workbench/admin/manager-groups');
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
    managerGroupRows = data.groups || [];
    renderManagerGroups();
  }

  async function createManagerGroup() {
    var nameEl = document.getElementById('managerGroupName');
    var descEl = document.getElementById('managerGroupDesc');
    var portfolioEl = document.getElementById('managerGroupPortfolio');
    var name = String(nameEl && nameEl.value || '').trim();
    if (!name) {
      setFb('permFeedback', '请填写主管组名称', 'err');
      return;
    }
    var res = await fetch('/api/workbench/admin/manager-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        description: String(descEl && descEl.value || '').trim(),
        portfolioEnabled: Boolean(portfolioEl && portfolioEl.checked)
      })
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
    if (nameEl) nameEl.value = '';
    if (descEl) descEl.value = '';
    if (portfolioEl) portfolioEl.checked = false;
    setFb('permFeedback', '已创建主管组：' + name, 'ok');
    await Promise.all([loadManagerGroups(), loadManagers()]);
  }

  async function saveManagerGroupMember(enabled) {
    if (!selectedUser || !selectedUser.userId) {
      setFb('permFeedback', '请先搜索并点选一位员工', 'err');
      return;
    }
    var groupId = selectedManagerGroupId();
    if (!groupId) {
      setFb('permFeedback', '请选择主管组', 'err');
      return;
    }
    var res = await fetch('/api/workbench/admin/manager-groups/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: groupId, userId: selectedUser.userId, enabled: enabled })
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
    selectedUser.isManager = enabled || selectedUser.isManager;
    renderSelected();
    setFb('permFeedback', (enabled ? '已加入主管组：' : '已移出主管组：') + (selectedUser.name || selectedUser.userId), 'ok');
    await Promise.all([loadManagerGroups(), loadManagers()]);
  }
` : "";
  const managerGroupListenersJs = managerGroupsEnabled ? `
  document.getElementById('createManagerGroupBtn').addEventListener('click', function () {
    void createManagerGroup().catch(function (e) {
      setFb('permFeedback', String(e && e.message ? e.message : e), 'err');
    });
  });
  document.getElementById('addManagerGroupMemberBtn').addEventListener('click', function () {
    void saveManagerGroupMember(true).catch(function (e) {
      setFb('permFeedback', String(e && e.message ? e.message : e), 'err');
    });
  });
  document.getElementById('removeManagerGroupMemberBtn').addEventListener('click', function () {
    void saveManagerGroupMember(false).catch(function (e) {
      setFb('permFeedback', String(e && e.message ? e.message : e), 'err');
    });
  });
` : "";
  return `<script>
(function () {
  function setFb(id, msg, kind) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'feedback ' + (kind || 'muted');
  }
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function permInitial(name) {
    var t = String(name || '').trim();
    return t ? t.slice(0, 1) : '—';
  }
  function renderRows(mountId, countId, rows, emptyText, avClass) {
    var mount = document.getElementById(mountId);
    var countEl = document.getElementById(countId);
    if (!mount) return;
    if (countEl) countEl.textContent = String(rows.length);
    if (!rows.length) {
      mount.innerHTML = '<div class="empty-state" style="padding:12px 0;margin:0;">' + esc(emptyText) + '</div>';
      return;
    }
    mount.innerHTML = rows.map(function (row) {
      var name = row.name ? esc(row.name) : '—';
      var tag = row.source === 'env'
        ? '<span class="admin-perm-tag is-env">环境变量</span>'
        : '<span class="admin-perm-tag is-dynamic">动态</span>';
      return '<div class="admin-perm-row">'
        + '<span class="admin-perm-av ' + (avClass || '') + '">' + esc(permInitial(name)) + '</span>'
        + '<div><div class="admin-perm-row__name">' + name + '</div><div class="admin-perm-row__id">' + esc(row.userId) + '</div></div>'
        + tag
        + '</div>';
    }).join('');
  }

  var selectedUser = null;
  var searchTimer = null;
  var activeIndex = -1;
  var currentResults = [];
${managerGroupStateJs}

  function comboInput() { return document.getElementById('employeeKeyword'); }
  function comboMenu() { return document.getElementById('employeeOptions'); }

  function closeMenu() {
    var menu = comboMenu();
    if (menu) { menu.hidden = true; menu.innerHTML = ''; }
    comboInput().setAttribute('aria-expanded', 'false');
    activeIndex = -1;
    currentResults = [];
  }

  function renderSelected() {
    var box = document.getElementById('employeeSelected');
    if (!box) return;
    if (!selectedUser) { box.hidden = true; return; }
    box.hidden = false;
    document.getElementById('selectedAvatar').textContent = permInitial(selectedUser.name || selectedUser.userId);
    document.getElementById('selectedName').textContent = selectedUser.name || selectedUser.userId;
    var tags = [];
    if (selectedUser.isManager) tags.push('主管');
    if (selectedUser.isPortfolioManager) tags.push('项目管理主管');
    var sub = (selectedUser.departmentName || '-') + (tags.length ? ' · ' + tags.join('、') : '') + ' · ' + selectedUser.userId;
    document.getElementById('selectedSub').textContent = sub;
  }

  function pickUser(emp) {
    selectedUser = emp;
    comboInput().value = emp.name || emp.userId;
    renderSelected();
    closeMenu();
  }

  function clearSelected() {
    selectedUser = null;
    comboInput().value = '';
    renderSelected();
    closeMenu();
  }

  function renderMenu() {
    var menu = comboMenu();
    if (!menu) return;
    if (!currentResults.length) {
      menu.innerHTML = '<div class="admin-perm-combo__empty">未找到匹配员工</div>';
      menu.hidden = false;
      comboInput().setAttribute('aria-expanded', 'true');
      return;
    }
    menu.innerHTML = currentResults.map(function (e, i) {
      var tags = [];
      if (e.isManager) tags.push('主管');
      if (e.isPortfolioManager) tags.push('项目管理主管');
      var tagHtml = tags.length ? '<span class="admin-perm-combo__tags">' + esc(tags.join('、')) + '</span>' : '';
      return '<div class="admin-perm-combo__opt' + (i === activeIndex ? ' is-active' : '') + '" role="option" data-idx="' + i + '">'
        + '<span class="admin-perm-combo__av">' + esc(permInitial(e.name || e.userId)) + '</span>'
        + '<span class="admin-perm-combo__txt"><span class="admin-perm-combo__name">' + esc(e.name || e.userId) + '</span>'
        + '<span class="admin-perm-combo__dept">' + esc(e.departmentName || '-') + '</span></span>'
        + tagHtml
        + '</div>';
    }).join('');
    menu.hidden = false;
    comboInput().setAttribute('aria-expanded', 'true');
    Array.prototype.forEach.call(menu.querySelectorAll('.admin-perm-combo__opt'), function (node) {
      node.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        var idx = parseInt(node.getAttribute('data-idx'), 10);
        if (currentResults[idx]) pickUser(currentResults[idx]);
      });
    });
  }

  async function runSearch() {
    var keyword = (comboInput().value || '').trim();
    try {
      var res = await fetch('/api/workbench/admin/employees?keyword=' + encodeURIComponent(keyword));
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      currentResults = data.employees || [];
      activeIndex = -1;
      renderMenu();
    } catch (e) {
      setFb('permFeedback', String(e && e.message ? e.message : e), 'err');
    }
  }

  function scheduleSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { void runSearch(); }, 220);
  }

  async function loadManagers() {
    var res = await fetch('/api/workbench/admin/managers');
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
    var dynamicIds = new Set((data.dynamicManagers || []).map(function (row) { return row.userId; }));
    var rows = (data.effectiveManagers || []).map(function (row) {
      var item = typeof row === 'string' ? { userId: row, name: '' } : row;
      return {
        userId: item.userId,
        name: item.name || '',
        source: dynamicIds.has(item.userId) ? 'dynamic' : 'env',
      };
    });
    renderRows('managerListMount', 'managerCount', rows, '暂无主管', '');
  }

  async function loadPortfolioManagers() {
    var res = await fetch('/api/workbench/admin/portfolio-managers');
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
    var dynamicIds = new Set((data.dynamicPortfolioManagers || []).map(function (r) { return r.userId; }));
    var rows = (data.effectivePortfolioManagers || []).map(function (row) {
      return {
        userId: row.userId,
        name: row.name || '',
        source: dynamicIds.has(row.userId) ? 'dynamic' : 'env',
      };
    });
    renderRows('portfolioListMount', 'portfolioCount', rows, '暂无项目管理主管', 'is-portfolio');
  }

${managerGroupClientJs}

  async function savePermission(kind, enabled) {
    if (!selectedUser || !selectedUser.userId) {
      setFb('permFeedback', '请先搜索并点选一位员工', 'err');
      return;
    }
    var userId = selectedUser.userId;
    var url = kind === 'portfolio' ? '/api/workbench/admin/portfolio-managers' : '/api/workbench/admin/managers';
    setFb('permFeedback', '保存中…', 'muted');
    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: userId, enabled: enabled })
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
    var label = kind === 'portfolio' ? '项目管理主管' : '主管';
    setFb('permFeedback', (enabled ? '已授予' : '已移除') + (selectedUser.name || userId) + ' 的' + label + '权限', 'ok');
    if (kind === 'portfolio') selectedUser.isPortfolioManager = enabled;
    else selectedUser.isManager = enabled;
    renderSelected();
    await ${reloadPermissionsJs};
  }

  var inputEl = comboInput();
  inputEl.addEventListener('input', function () {
    if (selectedUser && inputEl.value !== (selectedUser.name || selectedUser.userId)) {
      selectedUser = null;
      renderSelected();
    }
    scheduleSearch();
  });
  inputEl.addEventListener('focus', function () {
    if (!comboMenu().hidden) return;
    void runSearch();
  });
  inputEl.addEventListener('keydown', function (ev) {
    var menu = comboMenu();
    if (menu.hidden || !currentResults.length) return;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      activeIndex = Math.min(activeIndex + 1, currentResults.length - 1);
      renderMenu();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      renderMenu();
    } else if (ev.key === 'Enter') {
      if (activeIndex >= 0 && currentResults[activeIndex]) {
        ev.preventDefault();
        pickUser(currentResults[activeIndex]);
      }
    } else if (ev.key === 'Escape') {
      closeMenu();
    }
  });
  document.addEventListener('click', function (ev) {
    var combo = document.querySelector('.admin-perm-combo');
    if (combo && !combo.contains(ev.target)) closeMenu();
  });
  document.getElementById('clearSelectedBtn').addEventListener('click', clearSelected);

  document.getElementById('grantManagerBtn').addEventListener('click', function () {
    void savePermission('manager', true).catch(function (e) {
      setFb('permFeedback', String(e && e.message ? e.message : e), 'err');
    });
  });
  document.getElementById('revokeManagerBtn').addEventListener('click', function () {
    void savePermission('manager', false).catch(function (e) {
      setFb('permFeedback', String(e && e.message ? e.message : e), 'err');
    });
  });
  document.getElementById('grantPortfolioBtn').addEventListener('click', function () {
    void savePermission('portfolio', true).catch(function (e) {
      setFb('permFeedback', String(e && e.message ? e.message : e), 'err');
    });
  });
  document.getElementById('revokePortfolioBtn').addEventListener('click', function () {
    void savePermission('portfolio', false).catch(function (e) {
      setFb('permFeedback', String(e && e.message ? e.message : e), 'err');
    });
  });
${managerGroupListenersJs}
  document.getElementById('logoutBtn').addEventListener('click', async function () {
    var res = await fetch('/api/workbench/logout', { method: 'POST' });
    var data = {};
    try { data = await res.json(); } catch (e) {}
    window.location.href = (data && data.redirectTo) ? data.redirectTo : '/workbench';
  });

  void ${reloadPermissionsJs}.catch(function (e) {
    setFb('permFeedback', String(e && e.message ? e.message : e), 'err');
  });
})();
</script>`;
}

export function renderAdminPermissionsPage(params: {
  userLabel?: string;
  sessionUserId?: string;
}): string {
  const managerGroupsEnabled = isWorkbenchManagerGroupsEnabled();
  const managerGroupActionHtml = managerGroupsEnabled ? `
            <div class="admin-perm-action is-manager-group">
              <div class="admin-perm-action__title">主管组</div>
              <div class="admin-perm-action__hint">创建组后，可将选中的员工加入或移出对应主管组。</div>
              <div class="admin-perm-action__fields">
                <label>组名
                  <input id="managerGroupName" type="text" placeholder="如：商务部主管组" />
                </label>
                <label>说明
                  <input id="managerGroupDesc" type="text" placeholder="可选" />
                </label>
                <label class="admin-perm-check">
                  <input id="managerGroupPortfolio" type="checkbox" /> 启用项目管理能力
                </label>
              </div>
              <div class="admin-perm-action__buttons">
                <button class="btn btn-primary btn-sm" id="createManagerGroupBtn" type="button">新建主管组</button>
              </div>
              <label>成员主管组
                <select id="managerGroupMemberSelect">
                  <option value="">选择主管组</option>
                </select>
              </label>
              <div class="admin-perm-action__buttons">
                <button class="btn btn-secondary btn-sm" id="addManagerGroupMemberBtn" type="button">加入选中员工</button>
                <button class="btn btn-ghost btn-sm" id="removeManagerGroupMemberBtn" type="button">移出选中员工</button>
              </div>
            </div>` : "";
  const managerGroupListHtml = managerGroupsEnabled ? `
        <section class="admin-perm-list-card">
          <div class="admin-perm-list-card__head">
            <h4>主管组</h4>
            <span class="admin-perm-count" id="managerGroupCount">0</span>
          </div>
          <div class="admin-perm-list-card__body" id="managerGroupListMount">加载中…</div>
        </section>` : "";
  return renderWorkbenchPage({
    role: "admin",
    activeNav: "adm-perms",
    title: "权限中心",
    pageTitle: "权限中心",
    description: "维护主管与项目管理主管身份；动态名单与环境变量合并生效。",
    userLabel: params.userLabel,
    sessionUserId: params.sessionUserId,
    extraCss: ADMIN_PERMISSIONS_CSS,
    mainHtml: `
  <div class="admin-perm-hub">
    <section class="admin-perm-hero">
      <h2>权限中心</h2>
      <p>在此授予或移除<strong>主管</strong>与<strong>项目管理主管</strong>身份。动态变更立即生效；环境变量名单需运维更新后重建容器。</p>
    </section>

    <div class="admin-perm-grid">
      <section class="admin-perm-panel">
        <div class="admin-perm-panel__head">
          <h3>添加或调整权限</h3>
          <p>输入姓名或部门即时搜索，点选员工后选择要授予或移除的权限。</p>
        </div>
        <div class="admin-perm-panel__body">
          <div class="admin-perm-search">
            <label>员工
              <div class="admin-perm-combo">
                <input id="employeeKeyword" type="text" autocomplete="off" role="combobox"
                  aria-expanded="false" aria-controls="employeeOptions"
                  placeholder="输入姓名或部门即时搜索…" />
                <div class="admin-perm-combo__menu" id="employeeOptions" role="listbox" hidden></div>
              </div>
            </label>
            <div class="admin-perm-selected" id="employeeSelected" hidden>
              <span class="admin-perm-selected__av" id="selectedAvatar">—</span>
              <div class="admin-perm-selected__meta">
                <div class="admin-perm-selected__name" id="selectedName">—</div>
                <div class="admin-perm-selected__sub" id="selectedSub">—</div>
              </div>
              <button type="button" class="admin-perm-selected__clear" id="clearSelectedBtn" aria-label="清除选择">×</button>
            </div>
          </div>
          <div class="admin-perm-actions">
            <div class="admin-perm-action">
              <div class="admin-perm-action__title">主管权限</div>
              <div class="admin-perm-action__hint">可使用主管工作台、任务规划与发放。</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button class="btn btn-primary btn-sm" id="grantManagerBtn" type="button">授予主管</button>
                <button class="btn btn-ghost btn-sm" id="revokeManagerBtn" type="button">移除主管</button>
              </div>
            </div>
            <div class="admin-perm-action is-portfolio">
              <div class="admin-perm-action__title">项目管理主管</div>
              <div class="admin-perm-action__hint">可使用项目总览、会议入库与大项目归档能力。</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button class="btn btn-primary btn-sm" id="grantPortfolioBtn" type="button">授予项目管理主管</button>
                <button class="btn btn-ghost btn-sm" id="revokePortfolioBtn" type="button">移除项目管理主管</button>
              </div>
            </div>
${managerGroupActionHtml}
          </div>
          <div class="feedback muted" id="permFeedback"></div>
        </div>
      </section>

      <div class="admin-perm-lists">
        <section class="admin-perm-list-card">
          <div class="admin-perm-list-card__head">
            <h4>主管名单</h4>
            <span class="admin-perm-count" id="managerCount">0</span>
          </div>
          <div class="admin-perm-list-card__body" id="managerListMount">加载中…</div>
        </section>
        <section class="admin-perm-list-card">
          <div class="admin-perm-list-card__head">
            <h4>项目管理主管</h4>
            <span class="admin-perm-count" id="portfolioCount">0</span>
          </div>
          <div class="admin-perm-list-card__body" id="portfolioListMount">加载中…</div>
        </section>
${managerGroupListHtml}
      </div>
    </div>

    <p class="admin-perm-footnote">标签「环境变量」表示来自服务器配置，无法在此页移除；「动态」表示通过本页或 Agent 维护，可在此页撤销。</p>
  </div>`,
    scriptHtml: buildAdminPermissionsClientJs(managerGroupsEnabled),
  });
}

export function renderAdminWorkbenchPage(params: {
  userLabel?: string;
  sessionUserId?: string;
}): string {
  return renderWorkbenchPage({
    role: "admin",
    activeNav: "adm-tasks",
    title: "全公司正式任务",
    pageTitle: "管理员工作台",
    description: "跨部门检索 · 只读审计 · 权限维护请前往「权限中心」",
    userLabel: params.userLabel,
    sessionUserId: params.sessionUserId,
    mainHtml: `
  <section class="kpis kpis--3" aria-live="polite" style="max-width:480px;margin-bottom:16px;">
    <div class="kpi"><div class="lbl">正式任务总数</div><div class="val" id="kpiTotal">—</div></div>
    <div class="kpi"><div class="lbl">进行中主任务</div><div class="val" id="kpiActive">—</div></div>
    <div class="kpi"><div class="lbl">阻塞子任务</div><div class="val" id="kpiBlocked">—</div></div>
  </section>

  <div class="card mgr-list-toolbar form-stack" role="search" aria-label="任务筛选">
    <label>业务编号<input id="taskNoFilter" placeholder="例如 TASK-20260512-0001" /></label>
    <label>状态
      <select id="statusFilter">
        <option value="">全部</option>
        <option value="ASSIGNED">待处理</option>
        <option value="CHANGES_REQUESTED">待修改</option>
        <option value="IN_PROGRESS">进行中</option>
        <option value="BLOCKED">阻塞</option>
        <option value="DONE">已完成</option>
        <option value="REJECTED">已拒绝</option>
      </select>
    </label>
    <label>发起部门<input id="deptFilter" placeholder="例如 研发部" /></label>
    <label>负责人<input id="assigneeFilter" placeholder="输入姓名的一部分" /></label>
    <label>标题关键词<input id="keywordFilter" placeholder="任务标题中的关键词" /></label>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-primary btn-sm" id="queryBtn" type="button">查询任务</button>
      <button class="btn btn-ghost btn-sm" type="button" id="adminClearFilters">清除</button>
    </div>
  </div>
  <div class="feedback muted" id="taskFeedback"></div>
  <div class="card" style="overflow:hidden;margin-top:14px;">
    <div id="taskTableMount" class="empty-state" style="padding:16px;">暂无数据</div>
  </div>`,
    scriptHtml: `<script>
(function () {
  function setFb(id, msg, kind) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'feedback ' + (kind || 'muted');
  }
  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = String(value);
  }
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  async function loadMetrics() {
    try {
      var res = await fetch('/api/workbench/admin/metrics');
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var m = data.metrics || {};
      setText('kpiTotal', m.totalTasks || 0);
      setText('kpiActive', m.activeTasks || 0);
      setText('kpiBlocked', m.blockedSubtasks || 0);
    } catch (e) {
      setFb('taskFeedback', String(e && e.message ? e.message : e), 'err');
    }
  }

  async function loadTasks() {
    setFb('taskFeedback', '加载中…', 'muted');
    try {
      var status = (document.getElementById('statusFilter').value || '').trim();
      var department = (document.getElementById('deptFilter').value || '').trim();
      var taskNo = (document.getElementById('taskNoFilter').value || '').trim();
      var assignee = (document.getElementById('assigneeFilter').value || '').trim();
      var keyword = (document.getElementById('keywordFilter').value || '').trim();
      var url = '/api/workbench/admin/tasks?status=' + encodeURIComponent(status)
        + '&department=' + encodeURIComponent(department)
        + '&taskNo=' + encodeURIComponent(taskNo)
        + '&assignee=' + encodeURIComponent(assignee)
        + '&keyword=' + encodeURIComponent(keyword);
      var res = await fetch(url);
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var tasks = data.tasks || [];
      if (!tasks.length) {
        document.getElementById('taskTableMount').innerHTML = '暂无匹配任务';
        setFb('taskFeedback', '无匹配结果', 'muted');
        return;
      }
      var rows = tasks.map(function (t) {
        var detail = '<a class="btn btn-ghost btn-sm" href="/workbench/admin/task?taskNo=' + encodeURIComponent(t.taskNo || '') + '">详情</a>';
        var mgr = (t.managerDisplayName || '').trim();
        var mgrCell = mgr ? esc(mgr) : esc('—');
        return '<tr>'
          + '<td><code>' + esc(t.taskNo || '—') + '</code></td>'
          + '<td>' + esc(t.title) + '</td>'
          + '<td>' + mgrCell + '</td>'
          + '<td>' + esc(t.initiatorDepartment || '未配置部门') + '</td>'
          + '<td>' + esc(t.statusLabel || t.status) + '</td>'
          + '<td>' + esc(t.updatedAt || '') + '</td>'
          + '<td>' + detail + '</td>'
          + '</tr>';
      }).join('');
      document.getElementById('taskTableMount').innerHTML = '<div class="table-wrap"><table class="data"><thead><tr><th>业务编号</th><th>标题</th><th>主管</th><th>发起部门</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      setFb('taskFeedback', '已更新', 'ok');
    } catch (e) {
      setFb('taskFeedback', String(e && e.message ? e.message : e), 'err');
    }
  }

  document.getElementById('queryBtn').addEventListener('click', function () {
    void loadTasks();
  });
  var clearBtn = document.getElementById('adminClearFilters');
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      ['taskNoFilter','deptFilter','assigneeFilter','keywordFilter'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.value = '';
      });
      var st = document.getElementById('statusFilter');
      if (st) st.value = '';
      void loadTasks();
    });
  }
  document.getElementById('logoutBtn').addEventListener('click', async function () {
    var res = await fetch('/api/workbench/logout', { method: 'POST' });
    var data = {};
    try { data = await res.json(); } catch (e) {}
    window.location.href = (data && data.redirectTo) ? data.redirectTo : '/workbench';
  });

  void loadMetrics();
  void loadTasks();
})();
</script>`,
  });
}
