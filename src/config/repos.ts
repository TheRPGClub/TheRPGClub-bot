/**
 * Registry of GitHub repositories the /todo command can browse.
 * Each repo is keyed by a single-character code so it can ride inside the
 * /todo payload token without inflating the custom ID length.
 */
export type TodoRepoCode = "b" | "a" | "w";

export interface ITodoRepo {
  code: TodoRepoCode;
  key: string;
  label: string;
  owner: string;
  name: string;
}

const BOT_OWNER = process.env.GITHUB_REPO_OWNER ?? "mfagerstrom";
const BOT_NAME = process.env.GITHUB_REPO_NAME ?? "RPGClub_GameDB";

export const DEFAULT_TODO_REPO_CODE: TodoRepoCode = "b";

export const TODO_REPOS: Record<TodoRepoCode, ITodoRepo> = {
  b: { code: "b", key: "bot", label: "bot", owner: BOT_OWNER, name: BOT_NAME },
  a: { code: "a", key: "api", label: "api", owner: "TheRPGClub", name: "TheRPGClub" },
  w: { code: "w", key: "www", label: "www", owner: "TheRPGClub", name: "TheRPGClub-www" },
};

export const TODO_REPO_CODES = Object.keys(TODO_REPOS) as TodoRepoCode[];

export function isTodoRepoCode(value: string | undefined): value is TodoRepoCode {
  return value === "b" || value === "a" || value === "w";
}

export function getTodoRepo(code: string | undefined): ITodoRepo {
  return isTodoRepoCode(code) ? TODO_REPOS[code] : TODO_REPOS[DEFAULT_TODO_REPO_CODE];
}
