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
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 11px 12px;
  border: 1px solid #93c5fd;
  border-radius: 10px;
  background: #eff6ff;
}
body.manager-chat-v2-page .quality-planning-enhancer[hidden] { display: none; }
body.manager-chat-v2-page .quality-planning-enhancer > div { min-width: 0; }
body.manager-chat-v2-page .quality-planning-enhancer strong { display: block; color: #1e3a8a; font-size: 14px; }
body.manager-chat-v2-page .quality-planning-enhancer span { display: block; margin-top: 3px; color: #475569; font-size: 12px; line-height: 1.55; }
body.manager-chat-v2-page .quality-planning-enhancer .btn { min-height: 40px; flex: 0 0 auto; }

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
`;
