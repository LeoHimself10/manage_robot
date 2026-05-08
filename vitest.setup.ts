/** Default-off demo JSONL audit during Vitest runs (explicit tests re-enable path). */
process.env.AUDIT_DEMO_DISABLED = "1";

/** Default-off plan disk snapshots during Vitest (plan-store tests opt in). */
process.env.PLAN_SNAPSHOT_DISABLED = "1";

/** Skip PII masking in Markdown under test unless a test clears this. */
process.env.CONTENT_FILTER_DISABLED = "1";
