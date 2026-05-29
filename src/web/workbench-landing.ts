/**
 * Root URL (`/`) and `/workbench` unauthenticated entry — DingTalk auto-login.
 * `/health` stays plain `ok` for probes.
 */
export {
  renderWorkbenchDingTalkEntryHtml,
  renderWorkbenchLandingPageHtml as renderWorkbenchRootLandingHtml,
} from "./workbench-login-shell";
