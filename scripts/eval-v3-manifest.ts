import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface EvalV3Manifest {
  id: string;
  version: string;
  description: string;
  groups: Record<
    string,
    {
      label: string;
      runner: string;
      fixtureRoot?: string;
      manifestFile?: string;
      chainIds: string[];
      crossFilter?: string;
      tags?: string[];
    }
  >;
  spotTags: Record<
    string,
    {
      label: string;
      runner?: string;
      runners?: string[];
      scenarioIds?: string[];
      scenarioFilter?: string;
    }
  >;
  integration: {
    "meeting-import": { scenarios: string[] };
  };
  release: {
    criticalStages: string[];
    nonCriticalStages: string[];
  };
}

const MANIFEST_PATH = join(process.cwd(), "fixtures/eval-v3/manifest.json");

let cached: EvalV3Manifest | undefined;

export function loadEvalV3Manifest(): EvalV3Manifest {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as EvalV3Manifest;
  return cached;
}

export function resolveChainGroup(group: string): string[] {
  const m = loadEvalV3Manifest();
  const g = m.groups[group];
  if (!g) throw new Error(`Unknown EVAL_CHAIN_GROUP=${group}`);
  return g.chainIds;
}

export function resolveSpotTags(tag: string): string[] {
  if (tag === "all") return Object.keys(loadEvalV3Manifest().spotTags);
  const t = loadEvalV3Manifest().spotTags[tag];
  if (!t) throw new Error(`Unknown EVAL_TAG=${tag}`);
  return [tag];
}
