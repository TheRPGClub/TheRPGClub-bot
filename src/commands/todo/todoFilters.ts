import type { IGithubIssue } from "../../services/GithubIssuesService.js";
import { sanitizeUserInput } from "../../functions/InteractionUtils.js";
import {
  TODO_LABELS,
  TODO_CREATE_TYPE_LABELS,
  type TodoLabel,
  type ListState,
  type ListDirection,
} from "./todoTypes.js";

export function sortIssuesByNumber(
  issues: IGithubIssue[],
  direction: ListDirection,
): IGithubIssue[] {
  const sorted = [...issues].sort((a, b) => a.number - b.number);
  return direction === "desc" ? sorted.reverse() : sorted;
}

export function normalizeStateFilters(filters: ListState[]): ListState[] {
  const normalized = filters.filter((state) => state === "open" || state === "closed");
  if (!normalized.length) {
    return ["open"];
  }
  return Array.from(new Set(normalized));
}

export function toIssueState(filters: ListState[]): ListState {
  const normalized = normalizeStateFilters(filters);
  if (normalized.length > 1) return "all";
  return normalized[0] ?? "open";
}

export function matchesIssueQuery(issue: IGithubIssue, query: string): boolean {
  const haystackParts = [
    issue.title,
    issue.body ?? "",
    issue.labels.join(" "),
    issue.author ?? "",
    issue.state,
    String(issue.number),
    issue.createdAt,
    issue.updatedAt,
    issue.closedAt ?? "",
  ];

  const haystack = haystackParts.join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function matchesIssueLabels(issue: IGithubIssue, labels: TodoLabel[]): boolean {
  if (!labels.length) return true;
  const issueLabels = issue.labels.map((label) => label.toLowerCase());
  return labels.some((label) => issueLabels.includes(label.toLowerCase()));
}

export function isBlockedIssue(issue: IGithubIssue): boolean {
  const issueLabels = issue.labels.map((label) => label.toLowerCase());
  return issueLabels.includes("blocked");
}

function sanitizeTodoText(value: string, preserveNewlines: boolean): string {
  return sanitizeUserInput(value, { preserveNewlines, allowUnderscore: true });
}

export function normalizeQuery(rawValue: string | undefined): string | undefined {
  if (!rawValue) return undefined;
  const sanitized = sanitizeTodoText(rawValue, false);
  return sanitized.length ? sanitized : undefined;
}

export function parseTodoLabels(rawValue: string | undefined): {
  labels: TodoLabel[];
  invalid: string[];
} {
  if (!rawValue) {
    return { labels: [], invalid: [] };
  }

  const tokens = rawValue
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const invalid: string[] = [];
  const labels: TodoLabel[] = [];

  tokens.forEach((token) => {
    const match = TODO_LABELS.find((label) => label.toLowerCase() === token.toLowerCase());
    if (match) {
      if (!labels.includes(match)) {
        labels.push(match);
      }
    } else {
      invalid.push(token);
    }
  });

  return { labels, invalid };
}

export function parseTodoCreateTypeLabels(values: readonly string[]): TodoLabel[] {
  const validValues = new Set(TODO_CREATE_TYPE_LABELS);
  return values
    .filter((value): value is (typeof TODO_CREATE_TYPE_LABELS)[number] => validValues.has(
      value as (typeof TODO_CREATE_TYPE_LABELS)[number],
    ))
    .filter((value, index, arr) => arr.indexOf(value) === index);
}
