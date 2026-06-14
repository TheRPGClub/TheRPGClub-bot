import { decodeBase64Url, encodeWithMaxLength } from "../../functions/CustomIdUtils.js";
import { getTodoRepo, DEFAULT_TODO_REPO_CODE, isTodoRepoCode } from "../../config/repos.js";
import type { IGithubRepoTarget } from "../../services/GithubIssuesService.js";
import type { TodoRepoCode } from "../../config/repos.js";
import {
  TODO_LABEL_CODE_MAP,
  TODO_LABEL_CODE_TO_LABEL,
  type TodoLabel,
  type TodoListPayload,
} from "./todoTypes.js";
import { normalizeStateFilters } from "./todoFilters.js";

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function getRepoTarget(code: TodoRepoCode): IGithubRepoTarget {
  const repo = getTodoRepo(code);
  return { owner: repo.owner, name: repo.name };
}

export function encodeTodoLabels(labels: TodoLabel[]): string {
  return labels.map((label) => TODO_LABEL_CODE_MAP[label]).sort().join("");
}

export function decodeTodoLabels(value: string): TodoLabel[] {
  if (!value) return [];
  return value
    .split("")
    .map((token) => TODO_LABEL_CODE_TO_LABEL[token])
    .filter((label): label is TodoLabel => Boolean(label));
}

export function decodeTodoQuery(encoded: string | undefined): string | undefined {
  if (!encoded) return undefined;
  const decoded = decodeBase64Url(encoded);
  return decoded.length ? decoded : undefined;
}

export function encodeTodoQuery(query: string | undefined, maxLength: number): string {
  if (!query) return "";
  return encodeWithMaxLength(query, maxLength);
}

export function buildTodoPayloadToken(
  payload: Omit<TodoListPayload, "page">,
  maxLength: number,
): string {
  const stateCode = payload.state === "open"
    ? "o"
    : payload.state === "closed"
      ? "c"
      : "a";
  const sortCode = payload.sort === "created" ? "c" : "u";
  const dirCode = payload.direction === "asc" ? "a" : "d";
  const labelToken = encodeTodoLabels(payload.labels);
  const base = [
    `s${stateCode}`,
    `o${sortCode}`,
    `d${dirCode}`,
    `p${payload.perPage}`,
    `l${labelToken}`,
    `b${payload.excludeBlocked ? "1" : "0"}`,
    `u${payload.isPublic ? "1" : "0"}`,
    `r${payload.repo}`,
    "q",
  ].join(";");
  const maxQueryLength = Math.max(maxLength - base.length, 0);
  const queryToken = encodeTodoQuery(payload.query, maxQueryLength);
  return `${base}${queryToken}`;
}

export function parseTodoPayloadToken(
  token: string,
): Omit<TodoListPayload, "page"> | null {
  if (!token) return null;
  const parts = token.split(";");
  const map = new Map<string, string>();
  parts.forEach((part) => {
    if (!part) return;
    const key = part.slice(0, 1);
    const value = part.slice(1);
    map.set(key, value);
  });

  const stateCode = map.get("s");
  const sortCode = map.get("o");
  const dirCode = map.get("d");
  if (!stateCode || !sortCode || !dirCode) return null;
  const perPage = Number(map.get("p"));
  const labelToken = map.get("l") ?? "";
  const excludeBlocked = map.get("b") === "1";
  const isPublic = map.get("u") === "1";
  const repoCode = map.get("r");
  const repo = isTodoRepoCode(repoCode) ? repoCode : DEFAULT_TODO_REPO_CODE;
  const query = decodeTodoQuery(map.get("q"));

  const state = stateCode === "o" ? "open" : stateCode === "c" ? "closed" : "all";
  const sort = sortCode === "c" ? "created" : "updated";
  const direction = dirCode === "a" ? "asc" : "desc";

  if (!Number.isFinite(perPage) || perPage <= 0) return null;

  const labels = decodeTodoLabels(labelToken);
  const stateFilters = normalizeStateFilters(state === "all" ? ["open", "closed"] : [state]);

  return {
    perPage,
    state,
    stateFilters,
    labels,
    excludeBlocked,
    query,
    sort,
    direction,
    isPublic,
    repo,
  };
}
