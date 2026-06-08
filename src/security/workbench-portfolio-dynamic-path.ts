export function resolveWorkbenchDynamicPortfolioManagersPath(): string {
  return (
    process.env.WORKBENCH_DYNAMIC_PORTFOLIO_IDS_FILE?.trim() ||
    "./data/workbench-portfolio-managers.json"
  );
}
