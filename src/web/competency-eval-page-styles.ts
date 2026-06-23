/** 能力评估页 — ChatGPT 风格：侧栏会话 + 全屏对话 */
export const COMPETENCY_EVAL_PAGE_CSS = `
/* ---------- shell integration ---------- */
body.wb-has-rail.page-shell--comp-eval {
  --ce-bg: #f9f9f9;
  --ce-surface: #ffffff;
  --ce-sidebar-bg: #f4f4f4;
  --ce-sidebar-hover: #ececec;
  --ce-sidebar-active: #e8e8e8;
  --ce-border: #e5e5e5;
  --ce-text: #0d0d0d;
  --ce-muted: #6e6e80;
  --ce-user-bg: #f4f4f4;
  --ce-accent: #10a37f;
  --ce-send-idle: #d9d9e3;
  --ce-thread-max: 48rem;
  --ce-sidebar-w: 260px;
  --ce-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, Cantarell, "Noto Sans", sans-serif;
}
body.wb-has-rail.page-shell--comp-eval .wb-main {
  min-height: 0;
  display: flex;
  flex-direction: column;
}
body.wb-has-rail.page-shell--comp-eval .wb-main-body {
  padding: 0;
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
  background: var(--ce-bg);
}

/* ---------- root layout ---------- */
.ce-root {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: grid;
  grid-template-columns: var(--ce-sidebar-w) minmax(0, 1fr);
  font-family: var(--ce-font);
  color: var(--ce-text);
  background: var(--ce-bg);
  position: relative;
}
#compEvalChatCard.ce-root { border: none; background: transparent; box-shadow: none; }

.ce-sidebar-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(15, 23, 42, 0.35);
}
.ce-root.is-sidebar-open .ce-sidebar-backdrop { display: block; }

/* ---------- session sidebar ---------- */
.ce-sidebar {
  grid-column: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--ce-sidebar-bg);
  border-right: 1px solid var(--ce-border);
  z-index: 50;
}
.ce-sidebar-head {
  flex-shrink: 0;
  padding: 12px 10px 10px;
}
.ce-new-session {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 14px;
  border: 1px solid var(--ce-border);
  border-radius: 10px;
  background: var(--ce-surface);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--ce-text);
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease;
}
.ce-new-session:hover { background: #fafafa; border-color: #d4d4d4; }
.ce-session-list {
  list-style: none;
  margin: 0;
  padding: 6px 8px 12px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ce-session-empty {
  padding: 16px 10px;
  font-size: 12px;
  color: var(--ce-muted);
  text-align: center;
  line-height: 1.45;
}
.ce-session-item {
  position: relative;
  border-radius: 10px;
  cursor: pointer;
  transition: background .12s ease;
}
.ce-session-item:hover { background: var(--ce-sidebar-hover); }
.ce-session-item.is-active { background: var(--ce-sidebar-active); }
.ce-session-btn {
  display: block;
  width: 100%;
  padding: 10px 36px 10px 12px;
  border: none;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  color: var(--ce-text);
}
.ce-session-title {
  display: block;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ce-session-meta {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  color: var(--ce-muted);
}
.ce-session-del {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--ce-muted);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity .12s ease, background .12s ease;
}
.ce-session-item:hover .ce-session-del { opacity: 1; }
.ce-session-del:hover { background: rgba(0,0,0,.06); color: var(--ce-text); }
.ce-sidebar-tip {
  flex-shrink: 0;
  padding: 10px 12px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--ce-muted);
  border-top: 1px solid var(--ce-border);
}

/* ---------- main pane ---------- */
.ce-main {
  grid-column: 2;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--ce-bg);
}
.ce-topbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--ce-border);
  background: var(--ce-surface);
  z-index: 2;
}
.ce-sidebar-toggle {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--ce-text);
  font-size: 18px;
  cursor: pointer;
  display: none;
  place-items: center;
}
.ce-sidebar-toggle:hover { background: #f4f4f4; }
.ce-topbar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.ce-logo {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: linear-gradient(145deg, #10a37f 0%, #1a7f64 100%);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.ce-topbar-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.02em;
  white-space: nowrap;
}
.ce-topbar-sub {
  font-size: 12px;
  color: var(--ce-muted);
  white-space: nowrap;
}
.ce-topbar-spacer { flex: 1; min-width: 8px; }
.ce-rubric-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: min(280px, 36vw);
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid #c8e6d9;
  background: #ecfdf5;
  color: #065f46;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ce-rubric-pill[hidden] { display: none !important; }
.ce-upload-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px solid var(--ce-border);
  background: var(--ce-surface);
  font-size: 13px;
  font-weight: 500;
  color: var(--ce-text);
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease;
}
.ce-upload-btn:hover { background: #fafafa; border-color: #d4d4d4; }

/* ---------- scroll / thread ---------- */
.ce-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scroll-behavior: smooth;
}
.ce-thread {
  max-width: var(--ce-thread-max);
  margin: 0 auto;
  padding: 28px 20px 32px;
  width: 100%;
  box-sizing: border-box;
}

.ce-empty {
  text-align: center;
  padding: 48px 12px 24px;
  animation: ce-fade-in .45s ease both;
}
.ce-empty h2 {
  margin: 0;
  font-size: clamp(22px, 4vw, 28px);
  font-weight: 600;
  letter-spacing: -0.03em;
}
.ce-empty p {
  margin: 10px auto 0;
  max-width: 28rem;
  font-size: 15px;
  line-height: 1.5;
  color: var(--ce-muted);
}
.ce-suggestions {
  margin-top: 28px;
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  max-width: 36rem;
  margin-left: auto;
  margin-right: auto;
}
.ce-suggest {
  appearance: none;
  border: 1px solid var(--ce-border);
  background: var(--ce-surface);
  border-radius: 14px;
  padding: 14px 16px;
  font: inherit;
  font-size: 13px;
  color: var(--ce-text);
  text-align: left;
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease;
}
.ce-suggest:hover { background: #fafafa; border-color: #d4d4d4; }
.ce-suggest-label { display: block; font-weight: 600; margin-bottom: 4px; }
.ce-suggest-hint { display: block; font-size: 12px; color: var(--ce-muted); }

/* ---------- messages ---------- */
.ce-msg {
  display: flex;
  gap: 16px;
  padding: 20px 0;
  animation: ce-fade-in .35s ease both;
}
.ce-msg.is-user { justify-content: flex-end; }
.ce-msg.is-user .ce-msg-inner {
  max-width: min(85%, 32rem);
  background: var(--ce-user-bg);
  border-radius: 20px;
  padding: 12px 16px;
  font-size: 15px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.ce-msg.is-assistant .ce-avatar {
  background: linear-gradient(145deg, #10a37f, #1a7f64);
  color: #fff;
}
.ce-avatar {
  width: 30px;
  height: 30px;
  border-radius: 4px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  font-size: 10px;
  font-weight: 700;
  margin-top: 2px;
}
.ce-msg-body {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  line-height: 1.65;
  color: var(--ce-text);
}

/* markdown in assistant bubbles */
.ce-msg-body .msg-md-p { margin: 0 0 10px; }
.ce-msg-body .msg-md-p:last-child { margin-bottom: 0; }
.ce-msg-body .msg-md-h { margin: 16px 0 8px; font-weight: 600; line-height: 1.3; }
.ce-msg-body .msg-md-h1 { font-size: 1.25rem; }
.ce-msg-body .msg-md-h2 { font-size: 1.1rem; }
.ce-msg-body .msg-md-h3 { font-size: 1rem; }
.ce-msg-body .msg-md-ul, .ce-msg-body .msg-md-ol { margin: 8px 0 12px; padding-left: 1.35rem; }
.ce-msg-body .msg-md-li { margin: 4px 0; }
.ce-msg-body .msg-md-bq {
  margin: 10px 0;
  padding: 8px 14px;
  border-left: 3px solid #d4d4d4;
  color: var(--ce-muted);
  background: #fafafa;
  border-radius: 0 8px 8px 0;
}
.ce-msg-body .msg-md-code {
  font-size: 0.88em;
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.ce-msg-body .msg-md-pre {
  margin: 10px 0;
  background: #1e1e1e;
  color: #e4e4e7;
  padding: 14px 16px;
  border-radius: 12px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.5;
}
.ce-msg-body .msg-md-a { color: #2563eb; text-decoration: none; }
.ce-msg-body .msg-md-a:hover { text-decoration: underline; }

/* tables — full-width scroll, sticky header, readable cells */
.ce-msg-body .msg-md-table-wrap {
  margin: 14px 0 18px;
  overflow-x: auto;
  max-width: 100%;
  -webkit-overflow-scrolling: touch;
  border-radius: 12px;
  border: 1px solid var(--ce-border);
  background: var(--ce-surface);
  box-shadow: 0 1px 3px rgba(0,0,0,.04);
}
.ce-msg-body .msg-md-table {
  width: 100%;
  min-width: min(100%, 520px);
  border-collapse: collapse;
  font-size: 13px;
  line-height: 1.45;
}
.ce-msg-body .msg-md-table thead {
  position: sticky;
  top: 0;
  z-index: 1;
}
.ce-msg-body .msg-md-table th {
  padding: 10px 14px;
  text-align: left;
  font-weight: 600;
  font-size: 12px;
  color: #374151;
  background: #f3f4f6;
  border-bottom: 1px solid var(--ce-border);
  white-space: nowrap;
}
.ce-msg-body .msg-md-table td {
  padding: 10px 14px;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid #f0f0f0;
  color: var(--ce-text);
  min-width: 72px;
  max-width: 280px;
  white-space: normal;
  word-break: break-word;
}
.ce-msg-body .msg-md-table tbody tr:nth-child(even) td { background: #fafafa; }
.ce-msg-body .msg-md-table tbody tr:hover td { background: #f5f5f5; }
.ce-msg-body .msg-md-table tr:last-child td { border-bottom: none; }
.ce-msg-body .msg-md-table th:first-child,
.ce-msg-body .msg-md-table td:first-child { padding-left: 16px; }
.ce-msg-body .msg-md-table th:last-child,
.ce-msg-body .msg-md-table td:last-child { padding-right: 16px; }

.ce-stream-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: var(--ce-accent);
  animation: ce-cursor .9s step-end infinite;
}
.ce-typing {
  display: flex;
  gap: 5px;
  align-items: center;
  padding: 4px 0;
}
.ce-typing i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #b4b4b4;
  animation: ce-bounce 1.2s ease-in-out infinite;
}
.ce-typing i:nth-child(2) { animation-delay: .15s; }
.ce-typing i:nth-child(3) { animation-delay: .3s; }

/* ---------- footer / composer ---------- */
.ce-footer {
  flex-shrink: 0;
  padding: 12px 20px 16px;
  background: linear-gradient(to top, var(--ce-bg) 70%, transparent);
}
.ce-composer-wrap {
  max-width: var(--ce-thread-max);
  margin: 0 auto;
  width: 100%;
}
.ce-composer {
  display: flex;
  align-items: flex-end;
  padding: 10px 10px 10px 6px;
  border-radius: 26px;
  border: 1px solid var(--ce-border);
  background: var(--ce-surface);
  box-shadow: 0 4px 16px rgba(0,0,0,.06);
}
.ce-composer:focus-within {
  border-color: #c5c5d2;
  box-shadow: 0 8px 24px rgba(0,0,0,.08);
}
.ce-attach {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  margin: 2px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  cursor: pointer;
  color: var(--ce-muted);
}
.ce-attach:hover { background: #f4f4f4; color: var(--ce-text); }
.ce-composer textarea {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  font: inherit;
  font-size: 15px;
  line-height: 1.45;
  padding: 8px;
  max-height: 200px;
  color: var(--ce-text);
}
.ce-composer textarea::placeholder { color: #9b9ba7; }
.ce-send {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  margin: 2px;
  border: none;
  border-radius: 50%;
  display: grid;
  place-items: center;
  cursor: pointer;
  background: var(--ce-send-idle);
  color: #fff;
}
.ce-send:not(:disabled) { background: var(--ce-text); }
.ce-send:not(:disabled):hover { background: #2d2d2d; }
.ce-send:disabled { cursor: not-allowed; opacity: 0.85; }
.ce-hint {
  margin: 8px 0 0;
  text-align: center;
  font-size: 11px;
  color: var(--ce-muted);
}

@keyframes ce-fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes ce-bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.45; }
  40% { transform: translateY(-5px); opacity: 1; }
}
@keyframes ce-cursor {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

@media (max-width: 900px) {
  .ce-root { grid-template-columns: minmax(0, 1fr); }
  .ce-sidebar {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    width: min(var(--ce-sidebar-w), 88vw);
    transform: translateX(-105%);
    transition: transform .22s ease;
    box-shadow: 4px 0 24px rgba(0,0,0,.12);
  }
  .ce-root.is-sidebar-open .ce-sidebar { transform: translateX(0); }
  .ce-sidebar-toggle { display: grid; }
  .ce-main { grid-column: 1; }
  .ce-topbar-sub { display: none; }
  .ce-upload-text { display: none; }
}
@media (max-width: 640px) {
  .ce-thread { padding: 16px 14px 24px; }
  .ce-footer { padding: 8px 12px 12px; }
  .ce-topbar { padding: 8px 12px; }
  .ce-msg-body .msg-md-table td { max-width: 200px; font-size: 12px; padding: 8px 10px; }
  .ce-msg-body .msg-md-table th { font-size: 11px; padding: 8px 10px; }
}
`;
