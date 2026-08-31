/**
 * Smart planning assistant v2 styles.
 *
 * Every selector is scoped to the manager chat body so the workbench shell and
 * every other manager/admin/employee page keep their existing presentation.
 */
export const MANAGER_CHAT_V2_CSS = String.raw`
body.manager-chat-v2-page {
  --mc-navy: #0b2340;
  --mc-navy-2: #12385f;
  --mc-blue: #1769e8;
  --mc-blue-soft: #eaf3ff;
  --mc-ink: #132238;
  --mc-muted: #64748b;
  --mc-line: #d9e3ef;
  --mc-canvas: #f3f7fb;
}

body.manager-chat-v2-page .chat-main.manager-chat-v2 {
  grid-template-columns: 244px minmax(0, 1fr) 276px;
  background: var(--mc-canvas);
  border-top: 1px solid #e2e8f0;
}

body.manager-chat-v2-page .chat-sidebar {
  width: auto;
  color: #fff;
  background:
    radial-gradient(circle at 10% 0%, rgba(39, 128, 235, 0.22), transparent 34%),
    linear-gradient(180deg, var(--mc-navy) 0%, #071a30 100%);
  border-right: 0;
}

body.manager-chat-v2-page .chat-sidebar-head {
  display: grid;
  gap: 12px;
  padding: 18px 16px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

body.manager-chat-v2-page .chat-sidebar-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

body.manager-chat-v2-page .chat-sidebar-title strong {
  font-size: 17px;
  letter-spacing: 0.02em;
}

body.manager-chat-v2-page .chat-sidebar-title span {
  font-size: 11px;
  color: #a8c5e5;
}

body.manager-chat-v2-page .chat-sidebar-head .btn {
  min-height: 42px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 10px;
  background: #1473ef;
  box-shadow: 0 10px 22px rgba(0, 77, 178, 0.26);
  font-weight: 700;
}

body.manager-chat-v2-page .chat-thread-list {
  gap: 5px;
  padding: 10px;
}

body.manager-chat-v2-page .chat-thread-item {
  padding: 11px 30px 11px 12px;
  border-color: transparent;
  color: #e6f0fb;
  background: transparent;
}

body.manager-chat-v2-page .chat-thread-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

body.manager-chat-v2-page .chat-thread-item.active {
  border-color: rgba(117, 179, 255, 0.35);
  background: linear-gradient(135deg, rgba(24, 116, 237, 0.82), rgba(20, 86, 173, 0.72));
  box-shadow: 0 10px 26px rgba(0, 18, 44, 0.24);
}

body.manager-chat-v2-page .chat-thread-title { color: #f7fbff; font-weight: 650; }
body.manager-chat-v2-page .chat-thread-preview { color: #a9c0d8; }
body.manager-chat-v2-page .chat-thread-item.active .chat-thread-preview { color: #d9eaff; }
body.manager-chat-v2-page .chat-thread-badge {
  color: #d5e7fb;
  background: rgba(255, 255, 255, 0.12);
}
body.manager-chat-v2-page .chat-thread-menu-btn { color: #c7dbef; }
body.manager-chat-v2-page .chat-thread-menu-btn:hover { background: rgba(255, 255, 255, 0.12); color: #fff; }
body.manager-chat-v2-page .chat-thread-dropdown { color: var(--mc-ink); }
body.manager-chat-v2-page .chat-sidebar-tip {
  color: #91aecb;
  background: rgba(1, 12, 25, 0.26);
  border-top-color: rgba(255, 255, 255, 0.08);
  line-height: 1.55;
}

body.manager-chat-v2-page .chat-pane {
  border: 0;
  border-radius: 0;
  background: #f8fafc;
  box-shadow: inset -1px 0 #dfe7f0;
}

body.manager-chat-v2-page .chat-pane-head--desktop {
  min-height: 68px;
  padding: 13px 22px;
  border-bottom: 1px solid var(--mc-line);
  background: rgba(255, 255, 255, 0.96);
}

body.manager-chat-v2-page .chat-pane-title {
  font-size: 23px;
  line-height: 1.2;
  color: var(--mc-ink);
  letter-spacing: -0.02em;
}

body.manager-chat-v2-page .chat-pane-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--mc-muted);
}

body.manager-chat-v2-page .chat-thread-badge {
  padding: 4px 9px;
}

body.manager-chat-v2-page .draft-context-bar {
  display: none !important;
}

body.manager-chat-v2-page .planning-context-card {
  margin: 14px 20px 0;
  padding: 0;
  border: 1px solid #cbdced;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(27, 56, 87, 0.06);
  flex-shrink: 0;
  overflow: hidden;
}

body.manager-chat-v2-page .planning-context-card[hidden] { display: none; }
body.manager-chat-v2-page .planning-context-card.is-quality {
  border-color: #b8cceb;
}
body.manager-chat-v2-page .planning-context-card.is-quality .planning-context-icon {
  color: #1e5ea8;
  background: #e8f1fc;
}

body.manager-chat-v2-page .planning-context-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 15px;
  border-bottom: 1px solid #edf2f7;
  background: linear-gradient(90deg, #f8fbff, #fff);
}

body.manager-chat-v2-page .planning-context-title {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

body.manager-chat-v2-page .planning-context-icon {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  color: var(--mc-blue);
  background: var(--mc-blue-soft);
  font-size: 16px;
  font-weight: 800;
  flex-shrink: 0;
}

body.manager-chat-v2-page .planning-context-title strong {
  display: block;
  overflow: hidden;
  color: var(--mc-ink);
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

body.manager-chat-v2-page .planning-context-title small {
  display: block;
  margin-top: 2px;
  color: var(--mc-muted);
  font-size: 11px;
}

body.manager-chat-v2-page .planning-context-toggle {
  min-width: 34px;
  height: 34px;
  border: 0;
  border-radius: 9px;
  color: #41617f;
  background: transparent;
  cursor: pointer;
}

body.manager-chat-v2-page .planning-context-toggle:hover { background: #eef5fc; }
body.manager-chat-v2-page .planning-context-card.is-collapsed .planning-context-body { display: none; }
body.manager-chat-v2-page .planning-context-card.is-collapsed .planning-context-toggle { transform: rotate(-90deg); }

body.manager-chat-v2-page .planning-context-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px 22px;
  padding: 13px 15px 15px;
}

body.manager-chat-v2-page .planning-context-copy { min-width: 0; }
body.manager-chat-v2-page .planning-context-copy span,
body.manager-chat-v2-page .planning-context-meta span {
  display: block;
  margin-bottom: 4px;
  color: #718198;
  font-size: 11px;
  font-weight: 700;
}
body.manager-chat-v2-page .planning-context-copy p {
  margin: 0;
  max-height: 4.9em;
  overflow: auto;
  color: #334155;
  font-size: 13px;
  line-height: 1.62;
  white-space: pre-wrap;
}
body.manager-chat-v2-page .planning-context-meta {
  min-width: 130px;
  color: var(--mc-ink);
  font-size: 13px;
}
body.manager-chat-v2-page .quality-planning-enhancer {
  display: block;
}
body.manager-chat-v2-page .quality-planning-enhancer[hidden] { display: none; }

body.manager-chat-v2-page .chat-stream {
  padding: 18px 20px 12px;
  scroll-behavior: smooth;
}

body.manager-chat-v2-page .msg-list {
  max-width: none;
  gap: 13px;
}

body.manager-chat-v2-page .msg-row--assistant .msg-bubble {
  max-width: min(760px, 92%);
}

body.manager-chat-v2-page .msg-row--user .msg-bubble {
  max-width: min(620px, 82%);
  border: 1px solid #d9e8fb;
  background: #eaf3ff;
  color: #17365f;
}

body.manager-chat-v2-page .msg-bubble--assistant {
  border-color: #e1e8f0;
  box-shadow: 0 5px 16px rgba(24, 49, 78, 0.05);
}

body.manager-chat-v2-page .msg-meta { color: #55718e; }

body.manager-chat-v2-page .legacy-task-table-details {
  margin-top: 10px;
  border: 1px solid #dce6f0;
  border-radius: 9px;
  background: #f8fbfe;
}
body.manager-chat-v2-page .legacy-task-table-details summary {
  padding: 9px 11px;
  color: #46637f;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
body.manager-chat-v2-page .legacy-task-table-details table { margin: 0; }

body.manager-chat-v2-page .planning-draft-board {
  display: grid;
  gap: 10px;
  margin: 18px 0 8px;
}
body.manager-chat-v2-page .planning-draft-board[hidden] { display: none; }
body.manager-chat-v2-page #planningTaskCards {
  display: grid;
  gap: 10px;
}

body.manager-chat-v2-page .planning-draft-board-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 14px;
  padding: 0 2px 2px;
}
body.manager-chat-v2-page .planning-draft-board-head h3 {
  margin: 0;
  color: var(--mc-ink);
  font-size: 17px;
}
body.manager-chat-v2-page .planning-draft-board-head p {
  margin: 4px 0 0;
  color: var(--mc-muted);
  font-size: 12px;
}
body.manager-chat-v2-page .planning-draft-state {
  padding: 5px 9px;
  border-radius: 999px;
  color: #9a5b00;
  background: #fff4d8;
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
}
body.manager-chat-v2-page .planning-draft-state.is-ready {
  color: #047857;
  background: #dff8ed;
}

body.manager-chat-v2-page .planning-task-card {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 12px;
  padding: 14px 15px;
  border: 1px solid var(--mc-line);
  border-left: 3px solid #f2b84b;
  border-radius: 11px;
  background: #fff;
  box-shadow: 0 5px 18px rgba(24, 49, 78, 0.045);
}
body.manager-chat-v2-page .planning-task-card.is-assigned { border-left-color: #2fb271; }
body.manager-chat-v2-page .planning-task-index {
  width: 31px;
  height: 31px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: var(--mc-blue);
  font-size: 13px;
  font-weight: 800;
  box-shadow: 0 5px 12px rgba(23, 105, 232, 0.22);
}
body.manager-chat-v2-page .planning-task-main { min-width: 0; }
body.manager-chat-v2-page .planning-task-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
body.manager-chat-v2-page .planning-task-title {
  margin: 0;
  color: var(--mc-ink);
  font-size: 15px;
  line-height: 1.4;
}
body.manager-chat-v2-page .planning-task-objective {
  margin: 5px 0 0;
  color: #53677d;
  font-size: 12px;
  line-height: 1.55;
}
body.manager-chat-v2-page .planning-task-objective span {
  margin-right: 7px;
  color: #708399;
  font-size: 11px;
  font-weight: 700;
}
body.manager-chat-v2-page .planning-assignee-button {
  min-height: 34px;
  padding: 6px 10px;
  border: 1px solid #a9c8ec;
  border-radius: 8px;
  color: #185eaf;
  background: #f7fbff;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
body.manager-chat-v2-page .planning-assignee-button:hover { border-color: var(--mc-blue); background: var(--mc-blue-soft); }
body.manager-chat-v2-page .planning-task-fields {
  display: grid;
  grid-template-columns: minmax(100px, 0.75fr) minmax(130px, 1fr) minmax(130px, 1fr) minmax(110px, 0.75fr);
  gap: 12px;
  margin-top: 12px;
}
body.manager-chat-v2-page .planning-task-field {
  min-width: 0;
  padding-left: 12px;
  border-left: 1px solid #e8eef5;
}
body.manager-chat-v2-page .planning-task-field:first-child { padding-left: 0; border-left: 0; }
body.manager-chat-v2-page .planning-task-field span {
  display: block;
  margin-bottom: 4px;
  color: #718198;
  font-size: 11px;
  font-weight: 700;
}
body.manager-chat-v2-page .planning-task-field strong,
body.manager-chat-v2-page .planning-task-field p {
  margin: 0;
  color: #334155;
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
body.manager-chat-v2-page .planning-task-field.is-missing strong,
body.manager-chat-v2-page .planning-task-field.is-missing p { color: #b26b00; }
body.manager-chat-v2-page .planning-task-assignee {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
body.manager-chat-v2-page .planning-task-avatar {
  width: 25px;
  height: 25px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: #2380d9;
  font-size: 11px;
  font-weight: 800;
}
body.manager-chat-v2-page .planning-task-avatar.is-pending {
  color: #99630e;
  background: #fff3ce;
  border: 1px dashed #e7b84d;
}
body.manager-chat-v2-page .planning-task-details {
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px dashed #dce5ee;
}
body.manager-chat-v2-page .planning-task-details summary {
  color: #5d748c;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
body.manager-chat-v2-page .planning-task-details p {
  margin: 7px 0 0;
  color: #475569;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
}

body.manager-chat-v2-page .chat-composer-wrap {
  padding: 10px 20px 14px;
  border-top: 1px solid var(--mc-line);
  background: rgba(255, 255, 255, 0.97);
}
body.manager-chat-v2-page .chat-composer-pill {
  min-height: 46px;
  border-color: #bdcfe3;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 6px 20px rgba(24, 49, 78, 0.06);
}
body.manager-chat-v2-page .chat-composer-pill:focus-within {
  border-color: #5ca1f2;
  box-shadow: 0 0 0 3px rgba(23, 105, 232, 0.1);
}
body.manager-chat-v2-page .chat-send-btn { background: var(--mc-blue); }

body.manager-chat-v2-page .draft-context-panel {
  width: auto;
  border: 0;
  border-radius: 0;
  background: #f8fafc;
  box-shadow: none;
}
body.manager-chat-v2-page .draft-context-panel::before { height: 0; }
body.manager-chat-v2-page .draft-panel-empty-wrap { padding: 26px 18px; }
body.manager-chat-v2-page .draft-panel-empty-title { font-size: 16px; color: var(--mc-ink); }
body.manager-chat-v2-page .draft-panel-empty { font-size: 12px; max-width: 24ch; }
body.manager-chat-v2-page .draft-panel__head { padding: 18px 16px 14px; }
body.manager-chat-v2-page .draft-panel__title { font-size: 18px; color: var(--mc-ink); }
body.manager-chat-v2-page .draft-count-badge {
  color: #165fae;
  background: var(--mc-blue-soft);
}
body.manager-chat-v2-page .draft-panel__meta { gap: 12px; }
body.manager-chat-v2-page .draft-assign-progress__bar { height: 8px; background: #e7edf4; }
body.manager-chat-v2-page .draft-assign-progress__fill { background: #2fb271; }
body.manager-chat-v2-page .draft-due-row {
  padding: 10px 11px;
  border: 1px solid #e2e9f1;
  border-radius: 9px;
  background: #fff;
}
body.manager-chat-v2-page .draft-panel__list {
  display: grid;
  align-content: start;
  gap: 8px;
  padding: 0 12px 12px;
}
body.manager-chat-v2-page .planning-check-item {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  min-height: 52px;
  padding: 9px 10px;
  border: 1px solid #e1e8f0;
  border-radius: 9px;
  background: #fff;
}
body.manager-chat-v2-page .planning-check-icon {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #94620b;
  background: #fff2ca;
  font-size: 13px;
  font-weight: 900;
}
body.manager-chat-v2-page .planning-check-item.is-ok .planning-check-icon {
  color: #fff;
  background: #2fb271;
}
body.manager-chat-v2-page .planning-check-copy strong { display: block; color: #27384b; font-size: 12px; }
body.manager-chat-v2-page .planning-check-copy small { display: block; margin-top: 2px; color: #7a8a9d; font-size: 10px; }
body.manager-chat-v2-page .btn-draft-edit-table { min-height: 40px; background: #fff; }
body.manager-chat-v2-page .draft-panel__foot { padding: 12px 14px 16px; }
body.manager-chat-v2-page .btn-draft-publish {
  min-height: 46px;
  border-radius: 9px;
  background: var(--mc-blue);
  box-shadow: 0 8px 18px rgba(23, 105, 232, 0.2);
}
body.manager-chat-v2-page .btn-draft-publish:disabled { box-shadow: none; }
body.manager-chat-v2-page .draft-panel-collapse-btn { display: none !important; }

body.manager-chat-v2-page .planning-person-modal .wb-modal { width: min(520px, calc(100vw - 32px)); }
body.manager-chat-v2-page .planning-person-task {
  margin: 0 0 14px;
  padding: 10px 12px;
  border-radius: 9px;
  color: #34516f;
  background: #f0f6fc;
  font-size: 13px;
  line-height: 1.55;
}
body.manager-chat-v2-page .planning-person-search {
  width: 100%;
  min-height: 42px;
  padding: 9px 11px;
  border: 1px solid #bdcde0;
  border-radius: 9px;
  font: inherit;
  font-size: 14px;
}
body.manager-chat-v2-page .planning-person-search:focus { outline: 3px solid rgba(23, 105, 232, 0.1); border-color: var(--mc-blue); }
body.manager-chat-v2-page .planning-person-results {
  display: grid;
  gap: 6px;
  max-height: 260px;
  margin-top: 10px;
  overflow: auto;
}
body.manager-chat-v2-page .planning-person-option {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid #e0e7ef;
  border-radius: 9px;
  text-align: left;
  background: #fff;
  cursor: pointer;
}
body.manager-chat-v2-page .planning-person-option:hover,
body.manager-chat-v2-page .planning-person-option.is-selected { border-color: #73aaf0; background: #edf5ff; }
body.manager-chat-v2-page .planning-person-option-avatar {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: #2978c8;
  font-weight: 800;
}
body.manager-chat-v2-page .planning-person-option strong { display: block; color: var(--mc-ink); font-size: 13px; }
body.manager-chat-v2-page .planning-person-option small { display: block; margin-top: 2px; color: #77889b; font-size: 11px; }
body.manager-chat-v2-page .planning-person-option em { color: #1769e8; font-size: 11px; font-style: normal; font-weight: 700; }
body.manager-chat-v2-page .planning-person-empty { padding: 20px; text-align: center; color: var(--mc-muted); font-size: 13px; }

@media (min-width: 1600px) {
  body.manager-chat-v2-page .chat-main.manager-chat-v2 { grid-template-columns: 276px minmax(0, 1fr) 306px; }
  body.manager-chat-v2-page .chat-pane-head--desktop { padding-left: 28px; padding-right: 28px; }
  body.manager-chat-v2-page .planning-context-card { margin-left: 26px; margin-right: 26px; }
  body.manager-chat-v2-page .chat-stream { padding-left: 28px; padding-right: 28px; }
  body.manager-chat-v2-page .chat-composer-wrap { padding-left: 28px; padding-right: 28px; }
}

@media (max-width: 1365px) and (min-width: 1181px) {
  body.manager-chat-v2-page .chat-main.manager-chat-v2 { grid-template-columns: 222px minmax(0, 1fr) 254px; }
  body.manager-chat-v2-page .chat-sidebar-title span { display: none; }
  body.manager-chat-v2-page .planning-task-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  body.manager-chat-v2-page .planning-task-field:nth-child(3) { padding-left: 0; border-left: 0; }
}

@media (max-width: 1180px) {
  body.manager-chat-v2-page .chat-main.manager-chat-v2 { grid-template-columns: minmax(0, 1fr) 260px; }
  body.manager-chat-v2-page .chat-mobile-top { display: grid; }
  body.manager-chat-v2-page .chat-pane-head--desktop { display: none; }
  body.manager-chat-v2-page .chat-sidebar {
    position: fixed;
    top: var(--appbar-h);
    bottom: 0;
    left: 0;
    z-index: 190;
    width: min(84vw, 310px);
    transform: translateX(-100%);
    transition: transform 0.24s ease;
    box-shadow: 12px 0 32px rgba(6, 23, 42, 0.26);
  }
  body.manager-chat-v2-page .chat-main.is-thread-drawer-open .chat-sidebar { transform: translateX(0); }
  body.manager-chat-v2-page .planning-context-card { margin: 10px 14px 0; }
  body.manager-chat-v2-page .chat-stream { padding: 15px 14px 10px; }
  body.manager-chat-v2-page .chat-composer-wrap { padding-left: 14px; padding-right: 14px; }
}

@media (max-width: 959px) {
  body.manager-chat-v2-page .chat-main.manager-chat-v2 { grid-template-columns: 1fr; }
  body.manager-chat-v2-page .planning-context-body { grid-template-columns: 1fr; }
  body.manager-chat-v2-page .quality-planning-enhancer { flex-direction: column; align-items: stretch; }
  body.manager-chat-v2-page .quality-planning-enhancer .btn { width: 100%; }
  body.manager-chat-v2-page .planning-task-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  body.manager-chat-v2-page .planning-task-field:nth-child(3) { padding-left: 0; border-left: 0; }
  body.manager-chat-v2-page .draft-context-panel { border-radius: 20px 20px 0 0; }
}

@media (max-width: 600px) {
  body.manager-chat-v2-page .planning-context-card { margin: 8px 10px 0; }
  body.manager-chat-v2-page .planning-context-body { padding: 11px 12px 13px; }
  body.manager-chat-v2-page .chat-stream { padding: 13px 10px 8px; }
  body.manager-chat-v2-page .planning-task-card { grid-template-columns: 31px minmax(0, 1fr); padding: 12px 11px; gap: 9px; }
  body.manager-chat-v2-page .planning-task-index { width: 28px; height: 28px; }
  body.manager-chat-v2-page .planning-task-title-row { align-items: flex-start; }
  body.manager-chat-v2-page .planning-task-fields { grid-template-columns: 1fr; }
  body.manager-chat-v2-page .planning-task-field,
  body.manager-chat-v2-page .planning-task-field:nth-child(3) { padding: 8px 0 0; border-left: 0; border-top: 1px solid #edf2f7; }
  body.manager-chat-v2-page .planning-task-field:first-child { padding-top: 0; border-top: 0; }
  body.manager-chat-v2-page .chat-composer-wrap { padding: 8px 10px calc(10px + env(safe-area-inset-bottom, 0px)); }
}

/* Quality-event side conversations: the robot is the primary planning surface. */
body.manager-chat-v2-page.quality-planning-mode {
  --qp-ink: #17202a;
  --qp-muted: #68717a;
  --qp-line: #d8d9d5;
  --qp-canvas: #f4f1e9;
  --qp-paper: #fffdf8;
  --qp-paper-strong: #ffffff;
  --qp-graphite: #242a2d;
  --qp-graphite-ink: #ffffff;
  --qp-warm: #f1dca4;
  --qp-warm-soft: #fbf3dd;
  --qp-copper: #a96721;
  --qp-green: #14725a;
  --qp-green-soft: #e8f4ef;
}

body.manager-chat-v2-page .chat-main.manager-chat-v2.is-quality-planning {
  grid-template-columns: 184px minmax(0, 1fr) 304px;
  color: var(--qp-ink);
  background: var(--qp-canvas);
}
body.manager-chat-v2-page .chat-main.manager-chat-v2.is-quality-planning.is-quality-history-collapsed {
  grid-template-columns: 58px minmax(0, 1fr) 304px;
}
body.manager-chat-v2-page .chat-main.is-quality-planning .chat-sidebar {
  color: #f7f4ec;
  background: #202b31;
  border-right: 1px solid #323c41;
}
body.manager-chat-v2-page .chat-main.is-quality-planning .chat-sidebar-head {
  padding: 15px 12px 13px;
  border-bottom-color: rgba(255, 255, 255, 0.1);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .chat-sidebar-title-copy {
  min-width: 0;
}
body.manager-chat-v2-page .chat-main.is-quality-planning .chat-sidebar-title strong {
  font-size: 15px;
  font-weight: 600;
}
body.manager-chat-v2-page .chat-main.is-quality-planning .chat-sidebar-title span {
  margin-top: 3px;
  color: #bdc7cb;
  font-size: 10px;
}
body.manager-chat-v2-page .quality-history-toggle {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  flex: 0 0 30px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  color: #f7f4ec;
  background: transparent;
  cursor: pointer;
}
body.manager-chat-v2-page .quality-history-toggle[hidden] { display: none; }
body.manager-chat-v2-page .quality-history-toggle svg { width: 16px; height: 16px; }
body.manager-chat-v2-page .chat-main.is-quality-planning .chat-sidebar-head .btn {
  min-height: 38px;
  border-color: #4a555a;
  color: #f7f4ec;
  background: #303a3f;
  box-shadow: none;
}
body.manager-chat-v2-page .chat-main.is-quality-planning .chat-thread-list { padding: 9px 8px; }
body.manager-chat-v2-page .chat-main.is-quality-planning .chat-thread-item {
  padding: 10px 28px 10px 10px;
  color: #f5f1e8;
}
body.manager-chat-v2-page .chat-main.is-quality-planning .chat-thread-item:hover {
  background: rgba(241, 220, 164, 0.08);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .chat-thread-item.active {
  border-color: rgba(241, 220, 164, 0.52);
  background: rgba(241, 220, 164, 0.13);
  box-shadow: none;
}
body.manager-chat-v2-page .chat-main.is-quality-planning .chat-thread-preview,
body.manager-chat-v2-page .chat-main.is-quality-planning .chat-thread-item.active .chat-thread-preview { color: #c7d0d4; }
body.manager-chat-v2-page .chat-main.is-quality-planning .chat-thread-badge {
  color: #f1dca4;
  background: rgba(241, 220, 164, 0.12);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .chat-sidebar-tip {
  color: #aeb9be;
  background: #182126;
  border-top-color: #323c41;
}
body.manager-chat-v2-page .chat-main.is-quality-planning.is-quality-history-collapsed .chat-sidebar-head {
  padding-inline: 9px;
}
body.manager-chat-v2-page .chat-main.is-quality-planning.is-quality-history-collapsed .chat-sidebar-title-copy,
body.manager-chat-v2-page .chat-main.is-quality-planning.is-quality-history-collapsed .chat-sidebar-head > .btn,
body.manager-chat-v2-page .chat-main.is-quality-planning.is-quality-history-collapsed .chat-thread-title,
body.manager-chat-v2-page .chat-main.is-quality-planning.is-quality-history-collapsed .chat-thread-preview,
body.manager-chat-v2-page .chat-main.is-quality-planning.is-quality-history-collapsed .chat-thread-badge,
body.manager-chat-v2-page .chat-main.is-quality-planning.is-quality-history-collapsed .chat-thread-menu-btn,
body.manager-chat-v2-page .chat-main.is-quality-planning.is-quality-history-collapsed .chat-sidebar-tip { display: none; }
body.manager-chat-v2-page .chat-main.is-quality-planning.is-quality-history-collapsed .quality-history-toggle svg { transform: rotate(180deg); }
body.manager-chat-v2-page .chat-main.is-quality-planning.is-quality-history-collapsed .chat-thread-item {
  min-height: 40px;
  padding: 8px;
}

body.manager-chat-v2-page .chat-main.is-quality-planning .chat-pane {
  background: var(--qp-canvas);
  box-shadow: inset -1px 0 var(--qp-line);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .chat-pane-head--desktop {
  min-height: 58px;
  border-bottom-color: var(--qp-line);
  background: var(--qp-paper-strong);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .chat-pane-title {
  color: var(--qp-ink);
  font-size: 20px;
  font-weight: 600;
}

body.manager-chat-v2-page .chat-main.is-quality-planning .planning-context-card {
  margin: 12px 14px 0;
  border-color: var(--qp-line);
  border-radius: 13px;
  background: var(--qp-paper-strong);
  box-shadow: none;
}
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-context-card.is-quality { border-color: var(--qp-line); }
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-context-head {
  padding: 10px 12px;
  border-bottom-color: var(--qp-line);
  background: var(--qp-paper-strong);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-context-card.is-collapsed .planning-context-head { border-bottom: 0; }
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-context-card.is-quality .planning-context-icon {
  color: var(--qp-copper);
  background: var(--qp-warm-soft);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-context-title strong {
  color: var(--qp-ink);
  font-weight: 600;
}
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-context-title small,
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-context-copy span,
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-context-meta span { color: var(--qp-muted); }
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-context-toggle {
  border: 1px solid var(--qp-line);
  color: var(--qp-ink);
  background: var(--qp-paper-strong);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-context-toggle:hover { background: var(--qp-warm-soft); }
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-context-body {
  grid-template-columns: minmax(0, 1fr) auto;
  padding: 0 12px 12px;
  color: var(--qp-ink);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-context-copy p {
  color: var(--qp-muted);
  font-size: 12px;
}
body.manager-chat-v2-page .quality-context-facts {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
body.manager-chat-v2-page .quality-context-facts[hidden] { display: none; }
body.manager-chat-v2-page .quality-context-fact {
  min-width: 0;
  padding: 9px 10px;
  border-left: 3px solid var(--qp-warm);
  background: var(--qp-warm-soft);
}
body.manager-chat-v2-page .quality-context-fact span,
body.manager-chat-v2-page .quality-context-fact strong { display: block; }
body.manager-chat-v2-page .quality-context-fact span {
  margin-bottom: 4px;
  color: var(--qp-muted);
  font-size: 11px;
}
body.manager-chat-v2-page .quality-context-fact strong {
  color: var(--qp-ink);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
}

body.manager-chat-v2-page .quality-planning-enhancer {
  flex: 0 0 auto;
  margin: 12px 14px 0;
  padding: 15px 16px;
  border: 1px solid #d1c29b;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(251, 243, 221, 0.95), rgba(255, 255, 255, 0.68) 72%), var(--qp-paper-strong);
}
body.manager-chat-v2-page .quality-planning-enhancer[hidden] { display: none; }
body.manager-chat-v2-page .quality-planning-enhancer-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
body.manager-chat-v2-page .quality-planning-seal {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  flex: 0 0 42px;
  border-radius: 50%;
  color: var(--qp-graphite-ink);
  background: var(--qp-graphite);
}
body.manager-chat-v2-page .quality-planning-seal svg { width: 20px; height: 20px; }
body.manager-chat-v2-page .quality-planning-copy {
  min-width: 0;
  margin-right: auto;
}
body.manager-chat-v2-page .quality-planning-copy h2 {
  margin: 0 0 5px;
  color: var(--qp-ink);
  font-size: 18px;
  font-weight: 600;
  line-height: 1.35;
}
body.manager-chat-v2-page .quality-planning-copy p {
  margin: 0;
  color: var(--qp-muted);
  font-size: 13px;
  line-height: 1.55;
}
body.manager-chat-v2-page .quality-planning-primary {
  min-height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 0 0 auto;
  padding: 9px 14px;
  border: 0;
  border-radius: 10px;
  color: var(--qp-graphite-ink);
  background: var(--qp-graphite);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
body.manager-chat-v2-page .quality-planning-primary svg { width: 17px; height: 17px; }
body.manager-chat-v2-page .quality-planning-primary:disabled { cursor: not-allowed; opacity: 0.48; }
body.manager-chat-v2-page .quality-planning-status {
  min-height: 30px;
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 11px;
  color: var(--qp-muted);
  font-size: 12px;
}
body.manager-chat-v2-page .quality-planning-pulse {
  width: 8px;
  height: 8px;
  display: none;
  flex: 0 0 8px;
  border-radius: 50%;
  background: var(--qp-copper);
  animation: qualityPlanningPulse 0.9s ease-in-out infinite alternate;
}
body.manager-chat-v2-page .quality-planning-enhancer.is-working .quality-planning-pulse { display: block; }
body.manager-chat-v2-page .quality-planning-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 8px;
}
body.manager-chat-v2-page .quality-planning-suggestion {
  min-height: 32px;
  padding: 6px 10px;
  border: 1px solid var(--qp-line);
  border-radius: 999px;
  color: var(--qp-ink);
  background: var(--qp-paper-strong);
  font-size: 12px;
  cursor: pointer;
}
body.manager-chat-v2-page .quality-planning-suggestion:hover:not(:disabled) {
  border-color: var(--qp-copper);
  color: var(--qp-copper);
  background: var(--qp-warm-soft);
}
body.manager-chat-v2-page .quality-planning-suggestion:disabled { cursor: not-allowed; opacity: 0.42; }

body.manager-chat-v2-page .chat-main.is-quality-planning .chat-stream {
  padding: 14px 14px 10px;
  background: var(--qp-canvas);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .msg-list { gap: 9px; }
body.manager-chat-v2-page .chat-main.is-quality-planning .msg-row--assistant .msg-bubble,
body.manager-chat-v2-page .chat-main.is-quality-planning .msg-row--user .msg-bubble {
  max-width: min(760px, 94%);
  border-color: var(--qp-line);
  color: var(--qp-ink);
  background: var(--qp-paper-strong);
  box-shadow: none;
}
body.manager-chat-v2-page .chat-main.is-quality-planning .msg-row--user .msg-bubble { background: var(--qp-warm-soft); }
body.manager-chat-v2-page .chat-main.is-quality-planning .msg-meta { color: var(--qp-muted); }
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-draft-board { margin-top: 16px; }
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-draft-board-head h3 {
  color: var(--qp-ink);
  font-weight: 600;
}
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-draft-board-head p { color: var(--qp-muted); }
body.manager-chat-v2-page .planning-draft-count {
  display: inline-flex;
  margin-left: 7px;
  padding: 4px 8px;
  border-radius: 999px;
  color: var(--qp-copper);
  background: var(--qp-warm-soft);
  font-size: 11px;
  font-weight: 600;
  vertical-align: 2px;
}
body.manager-chat-v2-page .planning-draft-count[hidden] { display: none; }
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-draft-state {
  color: var(--qp-copper);
  background: var(--qp-warm-soft);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-draft-state.is-ready {
  color: var(--qp-green);
  background: var(--qp-green-soft);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-task-card {
  border-color: var(--qp-line);
  border-left-color: var(--qp-copper);
  border-radius: 11px;
  background: var(--qp-paper-strong);
  box-shadow: none;
}
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-task-card.is-assigned { border-left-color: var(--qp-green); }
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-task-index {
  color: var(--qp-graphite-ink);
  background: var(--qp-graphite);
  box-shadow: none;
}
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-task-title,
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-task-field strong,
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-task-field p { color: var(--qp-ink); }
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-task-objective,
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-task-field span,
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-task-details summary,
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-task-details p { color: var(--qp-muted); }
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-assignee-button {
  border-color: var(--qp-line);
  color: var(--qp-ink);
  background: var(--qp-paper);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-assignee-button:hover {
  border-color: var(--qp-copper);
  color: var(--qp-copper);
  background: var(--qp-warm-soft);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-task-avatar {
  color: #fff;
  background: var(--qp-green);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-task-avatar.is-pending {
  color: var(--qp-copper);
  background: var(--qp-warm-soft);
  border-color: var(--qp-copper);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-task-field.is-missing strong,
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-task-field.is-missing p { color: var(--qp-copper); }
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-task-field,
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-task-details { border-color: var(--qp-line); }

body.manager-chat-v2-page .chat-main.is-quality-planning .chat-composer-wrap {
  border-top-color: var(--qp-line);
  background: rgba(255, 253, 248, 0.97);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .chat-composer-pill {
  border-color: var(--qp-line);
  border-radius: 11px;
  box-shadow: none;
}
body.manager-chat-v2-page .chat-main.is-quality-planning .chat-composer-pill:focus-within {
  border-color: var(--qp-copper);
  box-shadow: 0 0 0 3px rgba(169, 103, 33, 0.1);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .chat-send-btn {
  color: var(--qp-graphite-ink);
  background: var(--qp-graphite);
}

body.manager-chat-v2-page .chat-main.is-quality-planning .draft-context-panel {
  border-left: 1px solid var(--qp-line);
  background: var(--qp-paper-strong);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .draft-panel__title { color: var(--qp-ink); }
body.manager-chat-v2-page .chat-main.is-quality-planning .draft-count-badge {
  color: var(--qp-copper);
  background: var(--qp-warm-soft);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .draft-assign-progress__bar { background: var(--qp-line); }
body.manager-chat-v2-page .chat-main.is-quality-planning .draft-assign-progress__fill { background: var(--qp-green); }
body.manager-chat-v2-page .chat-main.is-quality-planning .draft-due-row,
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-check-item {
  border-color: var(--qp-line);
  background: var(--qp-paper);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-check-icon {
  color: var(--qp-copper);
  background: var(--qp-warm-soft);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-check-item.is-ok .planning-check-icon {
  color: var(--qp-green);
  background: var(--qp-green-soft);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-check-copy strong { color: var(--qp-ink); }
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-check-copy small { color: var(--qp-muted); }
body.manager-chat-v2-page .chat-main.is-quality-planning .draft-panel__list {
  display: block;
  padding: 0 10px 8px;
}
body.manager-chat-v2-page .quality-panel-section {
  border-bottom: 1px solid var(--qp-line);
}
body.manager-chat-v2-page .quality-panel-section-head {
  width: 100%;
  min-height: 58px;
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 9px;
  padding: 10px 4px;
  border: 0;
  color: var(--qp-ink);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
body.manager-chat-v2-page .quality-panel-section-head:hover { background: rgba(169, 103, 33, 0.05); }
body.manager-chat-v2-page .quality-panel-section.is-locked .quality-panel-section-head {
  cursor: not-allowed;
  opacity: 0.62;
  background: rgba(246, 243, 237, 0.72);
}
body.manager-chat-v2-page .quality-panel-section.is-locked .quality-panel-section-head:hover { background: rgba(246, 243, 237, 0.72); }
body.manager-chat-v2-page .quality-panel-section.is-locked .planning-check-icon {
  color: var(--qp-muted);
  border-color: var(--qp-line);
  background: transparent;
}
body.manager-chat-v2-page .quality-panel-section.is-locked .quality-panel-chevron { visibility: hidden; }
body.manager-chat-v2-page .quality-panel-section-head .planning-check-icon {
  width: 24px;
  height: 24px;
  font-size: 12px;
}
body.manager-chat-v2-page .quality-panel-chevron {
  color: var(--qp-muted);
  font-size: 14px;
  text-align: center;
  transition: transform 160ms ease;
}
body.manager-chat-v2-page .quality-panel-section.is-open .quality-panel-chevron { transform: rotate(180deg); }
body.manager-chat-v2-page .quality-panel-section-body {
  padding: 0 4px 13px 35px;
}
body.manager-chat-v2-page .quality-panel-detail-list,
body.manager-chat-v2-page .quality-person-list,
body.manager-chat-v2-page .quality-person-results {
  display: grid;
  gap: 7px;
}
body.manager-chat-v2-page .quality-panel-detail-row,
body.manager-chat-v2-page .quality-person-row,
body.manager-chat-v2-page .quality-person-option {
  border: 1px solid var(--qp-line);
  border-radius: 8px;
  color: var(--qp-ink);
  background: var(--qp-paper);
}
body.manager-chat-v2-page .quality-panel-detail-row {
  width: 100%;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 9px;
  text-align: left;
  cursor: pointer;
}
body.manager-chat-v2-page .quality-panel-detail-row:hover,
body.manager-chat-v2-page .quality-person-row:hover { border-color: var(--qp-copper); }
body.manager-chat-v2-page .quality-panel-task-no {
  width: 23px;
  height: 23px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  color: var(--qp-muted);
  background: var(--qp-paper-strong);
  font-size: 10px;
  font-weight: 700;
}
body.manager-chat-v2-page .quality-panel-detail-row strong,
body.manager-chat-v2-page .quality-panel-detail-row small,
body.manager-chat-v2-page .quality-person-task strong,
body.manager-chat-v2-page .quality-person-task small,
body.manager-chat-v2-page .quality-person-option strong,
body.manager-chat-v2-page .quality-person-option small { display: block; }
body.manager-chat-v2-page .quality-panel-detail-row strong,
body.manager-chat-v2-page .quality-person-task strong,
body.manager-chat-v2-page .quality-person-option strong {
  color: var(--qp-ink);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.4;
}
body.manager-chat-v2-page .quality-panel-detail-row small,
body.manager-chat-v2-page .quality-person-task small,
body.manager-chat-v2-page .quality-person-option small {
  margin-top: 3px;
  color: var(--qp-muted);
  font-size: 10px;
  line-height: 1.45;
}
body.manager-chat-v2-page .quality-person-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  padding: 8px;
}
body.manager-chat-v2-page .quality-person-task {
  min-width: 0;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 0;
  border: 0;
  color: var(--qp-ink);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
body.manager-chat-v2-page .quality-person-change,
body.manager-chat-v2-page .quality-person-back {
  border: 0;
  color: var(--qp-copper);
  background: transparent;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
}
body.manager-chat-v2-page .quality-person-change { padding: 5px 2px; }
body.manager-chat-v2-page .quality-person-picker h4 {
  margin: 12px 0 0;
  color: var(--qp-ink);
  font-size: 15px;
}
body.manager-chat-v2-page .quality-person-picker > p {
  margin: 4px 0 12px;
  color: var(--qp-muted);
  font-size: 11px;
  line-height: 1.5;
}
body.manager-chat-v2-page .quality-person-picker > label {
  display: block;
  margin-bottom: 6px;
  color: var(--qp-ink);
  font-size: 10px;
  font-weight: 700;
}
body.manager-chat-v2-page .quality-person-search {
  width: 100%;
  min-height: 38px;
  padding: 8px 10px;
  border: 1px solid var(--qp-line);
  border-radius: 8px;
  color: var(--qp-ink);
  background: var(--qp-paper);
  font-size: 12px;
  outline: none;
}
body.manager-chat-v2-page .quality-person-search:focus { border-color: var(--qp-copper); }
body.manager-chat-v2-page .quality-person-results { margin-top: 9px; }
body.manager-chat-v2-page .quality-person-source {
  color: var(--qp-muted);
  font-size: 10px;
  font-weight: 700;
}
body.manager-chat-v2-page .quality-person-option {
  width: 100%;
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 9px;
  text-align: left;
  cursor: pointer;
}
body.manager-chat-v2-page .quality-person-option:hover { border-color: var(--qp-copper); background: var(--qp-warm-soft); }
body.manager-chat-v2-page .quality-person-option:disabled { cursor: wait; opacity: 0.55; }
body.manager-chat-v2-page .quality-person-option em {
  color: var(--qp-copper);
  font-size: 10px;
  font-style: normal;
  font-weight: 700;
}
body.manager-chat-v2-page .quality-person-avatar {
  width: 29px;
  height: 29px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--qp-copper);
  background: var(--qp-warm-soft);
  font-size: 11px;
  font-weight: 700;
}
body.manager-chat-v2-page .quality-person-empty,
body.manager-chat-v2-page .quality-person-scope-note,
body.manager-chat-v2-page .quality-panel-feedback {
  padding: 9px;
  color: var(--qp-muted);
  background: var(--qp-paper-strong);
  font-size: 10px;
  line-height: 1.55;
}
body.manager-chat-v2-page .quality-person-scope-note { margin-top: 10px; }
body.manager-chat-v2-page .quality-panel-feedback { margin-top: 8px; color: var(--qp-copper); }
body.manager-chat-v2-page .quality-panel-feedback.is-ok { color: var(--qp-green); }
body.manager-chat-v2-page .quality-acceptance-intro {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 9px;
  margin-bottom: 10px;
  padding: 10px;
  border-left: 3px solid var(--qp-copper);
  background: var(--qp-warm-soft);
}
body.manager-chat-v2-page .quality-acceptance-intro strong {
  display: block;
  color: var(--qp-ink);
  font-size: 11px;
  line-height: 1.45;
}
body.manager-chat-v2-page .quality-acceptance-intro p {
  margin: 4px 0 0;
  color: var(--qp-muted);
  font-size: 10px;
  line-height: 1.55;
}
body.manager-chat-v2-page .quality-acceptance-ai {
  min-height: 32px;
  padding: 6px 9px;
  border: 0;
  border-radius: 7px;
  color: var(--qp-graphite-ink);
  background: var(--qp-graphite);
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
}
body.manager-chat-v2-page .quality-acceptance-ai:disabled { cursor: not-allowed; opacity: 0.46; }
body.manager-chat-v2-page .quality-acceptance-list { display: grid; gap: 9px; }
body.manager-chat-v2-page .quality-acceptance-card {
  padding: 10px;
  border: 1px solid var(--qp-line);
  border-radius: 9px;
  background: var(--qp-paper);
}
body.manager-chat-v2-page .quality-acceptance-card.is-missing { border-top-color: var(--qp-copper); }
body.manager-chat-v2-page .quality-acceptance-card.is-complete { border-top-color: var(--qp-green); }
body.manager-chat-v2-page .quality-acceptance-card > header {
  display: grid;
  grid-template-columns: 23px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  margin-bottom: 10px;
}
body.manager-chat-v2-page .quality-acceptance-card > header strong,
body.manager-chat-v2-page .quality-acceptance-card > header small { display: block; }
body.manager-chat-v2-page .quality-acceptance-card > header strong {
  color: var(--qp-ink);
  font-size: 11px;
  line-height: 1.4;
}
body.manager-chat-v2-page .quality-acceptance-card > header small {
  margin-top: 2px;
  color: var(--qp-muted);
  font-size: 9px;
  line-height: 1.4;
}
body.manager-chat-v2-page .quality-acceptance-card > header em {
  color: var(--qp-copper);
  font-size: 9px;
  font-style: normal;
  font-weight: 700;
}
body.manager-chat-v2-page .quality-acceptance-card.is-complete > header em { color: var(--qp-green); }
body.manager-chat-v2-page .quality-acceptance-card > label { display: block; margin-top: 8px; }
body.manager-chat-v2-page .quality-acceptance-card > label > span {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 7px;
  margin-bottom: 5px;
  color: var(--qp-ink);
  font-size: 10px;
  font-weight: 700;
}
body.manager-chat-v2-page .quality-acceptance-card > label > span small {
  color: var(--qp-muted);
  font-size: 9px;
  font-weight: 500;
}
body.manager-chat-v2-page .quality-acceptance-card textarea {
  width: 100%;
  min-height: 70px;
  resize: vertical;
  padding: 8px 9px;
  border: 1px solid var(--qp-line);
  border-radius: 7px;
  color: var(--qp-ink);
  background: var(--qp-paper-strong);
  font: inherit;
  font-size: 11px;
  line-height: 1.55;
  outline: none;
}
body.manager-chat-v2-page .quality-acceptance-card textarea:focus {
  border-color: var(--qp-copper);
  box-shadow: 0 0 0 2px rgba(169, 103, 33, 0.1);
}
body.manager-chat-v2-page .quality-acceptance-card > footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
}
body.manager-chat-v2-page .quality-acceptance-card > footer span {
  color: var(--qp-muted);
  font-size: 9px;
  line-height: 1.4;
}
body.manager-chat-v2-page .quality-acceptance-card > footer button {
  min-height: 30px;
  flex: 0 0 auto;
  padding: 5px 9px;
  border: 1px solid var(--qp-line);
  border-radius: 7px;
  color: var(--qp-ink);
  background: var(--qp-paper-strong);
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
}
body.manager-chat-v2-page .quality-acceptance-card > footer button:hover:not(:disabled) {
  border-color: var(--qp-copper);
  color: var(--qp-copper);
}
body.manager-chat-v2-page .quality-acceptance-card > footer button:disabled { cursor: wait; opacity: 0.55; }
body.manager-chat-v2-page .chat-main.is-quality-planning .planning-task-card.is-panel-focused {
  border-color: var(--qp-copper);
  background: var(--qp-warm-soft);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .btn-draft-edit-table {
  border-color: var(--qp-line);
  color: var(--qp-ink);
  background: var(--qp-paper);
}
body.manager-chat-v2-page .chat-main.is-quality-planning .btn-draft-publish {
  color: var(--qp-graphite-ink);
  background: var(--qp-graphite);
  box-shadow: none;
}
body.manager-chat-v2-page .chat-main.is-quality-planning .btn-draft-publish:disabled {
  color: #8a8d8c;
  border-color: #d8d7d2;
  background: #e9e7e1;
  cursor: not-allowed;
  opacity: 1;
}
body.manager-chat-v2-page .chat-main.is-quality-planning .draft-foot-caption { color: var(--qp-muted); }
body.manager-chat-v2-page.quality-planning-mode .wb-modal .btn-primary {
  border-color: var(--qp-graphite);
  color: var(--qp-graphite-ink);
  background: var(--qp-graphite);
}
body.manager-chat-v2-page.quality-planning-mode .planning-person-search:focus {
  outline-color: rgba(169, 103, 33, 0.12);
  border-color: var(--qp-copper);
}
body.manager-chat-v2-page.quality-planning-mode .planning-person-option:hover,
body.manager-chat-v2-page.quality-planning-mode .planning-person-option.is-selected {
  border-color: var(--qp-copper);
  background: var(--qp-warm-soft);
}

@keyframes qualityPlanningPulse {
  to { transform: scale(1.7); opacity: 0.4; }
}

@media (max-width: 1365px) and (min-width: 1181px) {
  body.manager-chat-v2-page .chat-main.manager-chat-v2.is-quality-planning { grid-template-columns: 168px minmax(0, 1fr) 288px; }
  body.manager-chat-v2-page .chat-main.manager-chat-v2.is-quality-planning.is-quality-history-collapsed { grid-template-columns: 58px minmax(0, 1fr) 288px; }
  body.manager-chat-v2-page .chat-main.is-quality-planning .chat-sidebar-title span { display: block; }
}

@media (max-width: 1180px) {
  body.manager-chat-v2-page .chat-main.manager-chat-v2.is-quality-planning,
  body.manager-chat-v2-page .chat-main.manager-chat-v2.is-quality-planning.is-quality-history-collapsed { grid-template-columns: minmax(0, 1fr) 280px; }
  body.manager-chat-v2-page .chat-main.is-quality-planning .quality-history-toggle { display: none; }
  body.manager-chat-v2-page .chat-main.is-quality-planning .planning-context-card,
  body.manager-chat-v2-page .chat-main.is-quality-planning .quality-planning-enhancer { margin-left: 12px; margin-right: 12px; }
}

@media (max-width: 959px) {
  body.manager-chat-v2-page .chat-main.manager-chat-v2.is-quality-planning,
  body.manager-chat-v2-page .chat-main.manager-chat-v2.is-quality-planning.is-quality-history-collapsed { grid-template-columns: 1fr; }
  body.manager-chat-v2-page .quality-planning-enhancer-head { flex-wrap: wrap; }
  body.manager-chat-v2-page .quality-planning-primary { width: 100%; }
  body.manager-chat-v2-page .quality-context-facts { grid-template-columns: 1fr; }
}

@media (max-width: 600px) {
  body.manager-chat-v2-page .chat-main.is-quality-planning .planning-context-card,
  body.manager-chat-v2-page .chat-main.is-quality-planning .quality-planning-enhancer { margin: 8px 10px 0; }
  body.manager-chat-v2-page .quality-planning-enhancer { padding: 13px 12px; }
  body.manager-chat-v2-page .quality-planning-copy h2 { font-size: 16px; }
  body.manager-chat-v2-page .quality-planning-seal { width: 36px; height: 36px; flex-basis: 36px; }
}

@media (prefers-reduced-motion: reduce) {
  body.manager-chat-v2-page .quality-planning-pulse { animation: none; }
}
`;
