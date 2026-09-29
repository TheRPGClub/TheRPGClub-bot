/**
 * Settings and clients the conductor's handlers share. Set once by the entry
 * point before login, so handlers never read the environment themselves.
 */
import type { IConductorSettings } from "./ConductorConfig.js";
import type { GitHubPullClient } from "./GitHubPullClient.js";

export interface IConductorRuntime {
  settings: IConductorSettings;
  github: GitHubPullClient;
}

let runtime: IConductorRuntime | null = null;

export function setConductorRuntime(value: IConductorRuntime): void {
  runtime = value;
}

export function getConductorRuntime(): IConductorRuntime {
  if (!runtime) throw new Error("Conductor runtime used before the entry point set it.");
  return runtime;
}
