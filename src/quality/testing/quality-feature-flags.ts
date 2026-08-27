function enabled(value: unknown): boolean {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

export function isQualityRolePanelsEnabled(): boolean {
  return enabled(process.env.QUALITY_EVENT_ROLE_PANELS_ENABLED);
}

export function isQualityTestActorsEnabled(): boolean {
  return enabled(process.env.QUALITY_TEST_ACTORS_ENABLED);
}
