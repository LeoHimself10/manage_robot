/**
 * Browser bundle: assistant Markdown → HTML for performance chat bubbles.
 * Build: npm run build:performance-chat-markdown
 */
import { formatWorkbenchAssistantHtml } from "./workbench-markdown-lite";

declare global {
  interface Window {
    formatPerfAssistantHtml?: (raw: string) => string;
  }
}

window.formatPerfAssistantHtml = formatWorkbenchAssistantHtml;
