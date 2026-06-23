/** 能力评估页 — ChatGPT 风格全屏对话布局 */
export const COMPETENCY_EVAL_PAGE_CSS = `
/* ---------- shell integration ---------- */
body.wb-has-rail.page-shell--comp-eval {
  --ce-bg: #f9f9f9;
  --ce-surface: #ffffff;
  --ce-border: #e5e5e5;
  --ce-text: #0d0d0d;
  --ce-muted: #6e6e80;
  --ce-user-bg: #f4f4f4;
  --ce-accent: #10a37f;
  --ce-accent-hover: #0d8c6d;
  --ce-send-idle: #d9d9e3;
  --ce-thread-max: 46rem;
  --ce-font: "Söhne", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, Cantarell, "Noto Sans", sans-serif;
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
  display: flex;
  flex-direction: column;
  font-family: var(--ce-font);
  color: var(--ce-text);
  background: var(--ce-bg);
}
#compEvalChatCard.ce-root { border: none; background: transparent; box-shadow: none; }

.ce-topbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--ce-border);
  background: var(--ce-surface);
  z-index: 2;
}
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
  box-shadow: 0 1px 2px rgba(0,0,0,.08);
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
@media (max-width: 640px) { .ce-topbar-sub { display: none; } }
.ce-topbar-spacer { flex: 1; min-width: 8px; }
.ce-rubric-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: min(280px, 40vw);
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
.ce-rubric-pill svg { flex-shrink: 0; opacity: 0.75; }
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
  transition: background .15s ease, border-color .15s ease, box-shadow .15s ease;
}
.ce-upload-btn:hover {
  background: #fafafa;
  border-color: #d4d4d4;
  box-shadow: 0 1px 2px rgba(0,0,0,.04);
}
.ce-upload-btn svg { opacity: 0.7; }

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
  line-height: 1.25;
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
  line-height: 1.45;
  color: var(--ce-text);
  text-align: left;
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease, transform .12s ease;
}
.ce-suggest:hover {
  background: #fafafa;
  border-color: #d4d4d4;
}
.ce-suggest:active { transform: scale(0.98); }
.ce-suggest-label {
  display: block;
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 4px;
}
.ce-suggest-hint {
  display: block;
  font-size: 12px;
  color: var(--ce-muted);
}

/* ---------- messages ---------- */
.ce-msg {
  display: flex;
  gap: 16px;
  padding: 20px 0;
  animation: ce-fade-in .35s ease both;
}
.ce-msg + .ce-msg { border-top: none; }
.ce-msg.is-user {
  justify-content: flex-end;
}
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
.ce-msg-body p { margin: 0 0 10px; }
.ce-msg-body p:last-child { margin-bottom: 0; }
.ce-msg-body ul, .ce-msg-body ol { margin: 8px 0; padding-left: 1.25rem; }
.ce-msg-body code {
  font-size: 0.9em;
  background: #f4f4f4;
  padding: 2px 6px;
  border-radius: 4px;
}
.ce-msg-body pre {
  background: #1e1e1e;
  color: #e4e4e7;
  padding: 12px 14px;
  border-radius: 10px;
  overflow-x: auto;
  font-size: 13px;
}
.ce-stream-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: var(--ce-accent);
  animation: ce-cursor .9s step-end infinite;
}

/* typing indicator */
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
  border-top: 1px solid transparent;
}
.ce-composer-wrap {
  max-width: var(--ce-thread-max);
  margin: 0 auto;
  width: 100%;
}
.ce-composer {
  display: flex;
  align-items: flex-end;
  gap: 0;
  padding: 10px 10px 10px 6px;
  border-radius: 26px;
  border: 1px solid var(--ce-border);
  background: var(--ce-surface);
  box-shadow:
    0 0 0 1px rgba(0,0,0,.02),
    0 4px 16px rgba(0,0,0,.06);
  transition: border-color .15s ease, box-shadow .15s ease;
}
.ce-composer:focus-within {
  border-color: #c5c5d2;
  box-shadow:
    0 0 0 1px rgba(0,0,0,.03),
    0 8px 24px rgba(0,0,0,.08);
}
.ce-attach {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  margin: 2px 2px 2px 4px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  cursor: pointer;
  color: var(--ce-muted);
  transition: background .15s ease, color .15s ease;
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
  padding: 8px 8px 8px 4px;
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
  transition: background .15s ease, transform .1s ease;
}
.ce-send:not(:disabled) {
  background: var(--ce-text);
}
.ce-send:not(:disabled):hover { background: #2d2d2d; }
.ce-send:active:not(:disabled) { transform: scale(0.94); }
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

@media (max-width: 640px) {
  .ce-thread { padding: 16px 14px 24px; }
  .ce-footer { padding: 8px 12px 12px; }
  .ce-topbar { padding: 8px 12px; }
  .ce-upload-text { display: none; }
}
`;
