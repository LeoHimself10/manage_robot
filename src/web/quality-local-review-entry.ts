import type { QualityPerspective } from "../quality/testing/quality-test-actors";

/** Navigation for the connected local review UI, after normal session/capability checks. */
export function localQualityReviewEntry(input: {
  url: URL;
  perspective: QualityPerspective | null;
  readonly: boolean;
}, environment: NodeJS.ProcessEnv = process.env): string | null {
  if (environment.QUALITY_LOCAL_REVIEW_UI_ENABLED !== "1" || input.readonly) return null;
  if (input.url.protocol !== "http:"
    || !["127.0.0.1", "localhost", "[::1]"].includes(input.url.hostname)) return null;
  if (!["/workbench/quality", "/workbench/quality/review"].includes(input.url.pathname)) return null;
  // Existing record IDs belong to the original data store, not the new UI's record keys.
  if (["eventId", "sourceKey", "nodeId", "managerUserId"].some(key => input.url.searchParams.has(key))) return null;
  if (input.perspective === "aftersales") return "http://127.0.0.1:8808/ma-workbench/";
  if (input.perspective === "quality_management") return "http://127.0.0.1:8809/";
  return null;
}
