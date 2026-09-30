/**
 * The commit the conductor is running, logged at startup so the live version is
 * visible. A deployed release has no `.git`, so scripts/conductor/deploy.sh writes
 * the commit to a `REVISION` file at its root; a run from a checkout asks git.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The repository root: this file lives in `src/conductor/`. */
const DEFAULT_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export interface IRevisionSources {
  readRevisionFile: (root: string) => string;
  gitHead: (root: string) => string;
}

const DEFAULT_SOURCES: IRevisionSources = {
  readRevisionFile: (root) => readFileSync(`${root}/REVISION`, "utf8"),
  gitHead: (root) =>
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
};

function commitFrom(read: () => string): string | null {
  try {
    const value = read().trim();
    return COMMIT_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** The running commit's full sha, or "unknown" when neither source names one. */
export function readConductorRevision(
  root: string = DEFAULT_ROOT,
  sources: IRevisionSources = DEFAULT_SOURCES,
): string {
  return (
    commitFrom(() => sources.readRevisionFile(root)) ??
    commitFrom(() => sources.gitHead(root)) ??
    "unknown"
  );
}
