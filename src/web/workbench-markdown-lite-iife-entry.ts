/**
 * Browser bundle entry: exposes {@link formatWorkbenchAssistantHtml} on `globalThis`
 * for inline scripts on the manager chat page (e.g. thread preview hint).
 */
import { formatWorkbenchAssistantHtml } from "./workbench-markdown-lite";

(globalThis as Record<string, unknown>).formatWorkbenchAssistantHtml = formatWorkbenchAssistantHtml;
