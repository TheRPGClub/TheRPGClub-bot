import type { TodoRepoCode } from "../../config/repos.js";

export const TODO_LABELS = [
  "New Feature",
  "Improvement",
  "Bug",
  "Blocked",
  "refactor",
  "documentation",
  "duplicate",
  "invalid",
  "wontfix",
] as const;
export const LIST_STATES = ["open", "closed", "all"] as const;
export const LIST_SORTS = ["created", "updated"] as const;
export const LIST_DIRECTIONS = ["asc", "desc"] as const;

export type TodoLabel = (typeof TODO_LABELS)[number];
export type ListState = (typeof LIST_STATES)[number];
export type ListSort = (typeof LIST_SORTS)[number];
export type ListDirection = (typeof LIST_DIRECTIONS)[number];

export const MAX_COMMENT_PREVIEW_LENGTH = 500;
export const MAX_TODO_IMAGES_PER_VIEW = 10;

export const TODO_LIST_ID_PREFIX = "todo-list-page";
export const TODO_LIST_BACK_ID_PREFIX = "todo-list-back";
export const TODO_VIEW_ID_PREFIX = "todo-view";
export const TODO_CREATE_BUTTON_PREFIX = "todo-create-button";
export const TODO_CREATE_MODAL_PREFIX = "todo-create-modal";
export const TODO_CLOSE_BUTTON_PREFIX = "todo-close-button";
export const TODO_CLOSE_SELECT_PREFIX = "todo-close-select";
export const TODO_CLOSE_CANCEL_PREFIX = "todo-close-cancel";
export const TODO_COMMENT_BUTTON_PREFIX = "todo-comment-button";
export const TODO_COMMENT_MODAL_PREFIX = "todo-comment-modal";
export const TODO_COMMENT_INPUT_ID = "todo-comment-input";
export const TODO_EDIT_VIEW_BUTTON_PREFIX = "todo-edit-view-button";
export const TODO_EDIT_VIEW_MODAL_PREFIX = "todo-edit-view-modal";
export const TODO_EDIT_TITLE_BUTTON_PREFIX = "todo-edit-title-button";
export const TODO_EDIT_TITLE_MODAL_PREFIX = "todo-edit-title-modal";
export const TODO_EDIT_TITLE_INPUT_ID = "todo-edit-title-input";
export const TODO_EDIT_DESC_BUTTON_PREFIX = "todo-edit-desc-button";
export const TODO_EDIT_DESC_MODAL_PREFIX = "todo-edit-desc-modal";
export const TODO_EDIT_DESC_INPUT_ID = "todo-edit-desc-input";
export const TODO_CLOSE_VIEW_PREFIX = "todo-close-view";
export const TODO_REOPEN_VIEW_PREFIX = "todo-reopen-view";
export const TODO_LABEL_EDIT_BUTTON_PREFIX = "todo-label-edit-button";
export const TODO_LABEL_EDIT_SELECT_PREFIX = "todo-label-edit-select";
export const TODO_FILTER_BUTTON_PREFIX = "todo-filter-button";
export const TODO_FILTER_MODAL_PREFIX = "todo-filter-modal";
export const TODO_FILTER_STATE_ID = "todo-filter-state";
export const TODO_FILTER_LABEL_ID = "todo-filter-label-field";
export const TODO_FILTER_QUERY_ID = "todo-filter-query";
export const TODO_FILTER_SORT_ID = "todo-filter-sort";
export const TODO_OPEN_SELECT_PREFIX = "todo-open-select";
export const TODO_REPO_SELECT_PREFIX = "todo-repo-select";
export const TODO_FILTER_LABEL_ALL = "__all__";
export const TODO_FILTER_LABEL_NOT_BLOCKED = "__not_blocked__";
export const TODO_REVIEW_SUGGESTIONS_BUTTON_ID = "todo-review-suggestions";
export const TODO_CREATE_TITLE_ID = "todo-create-title";
export const TODO_CREATE_BODY_ID = "todo-create-body";
export const TODO_CREATE_TYPE_ID = "todo-create-type";
export const TODO_PAYLOAD_TOKEN_MAX_LENGTH = 30;

export const TODO_CREATE_TYPE_LABELS = [
  "New Feature",
  "Improvement",
  "Bug",
  "Blocked",
] as const;

export type TodoListPayload = {
  page: number;
  perPage: number;
  state: ListState;
  stateFilters: ListState[];
  labels: TodoLabel[];
  excludeBlocked: boolean;
  query?: string;
  sort: ListSort;
  direction: ListDirection;
  isPublic: boolean;
  repo: TodoRepoCode;
};

export const TODO_LABEL_CODE_MAP: Record<TodoLabel, string> = {
  "New Feature": "N",
  Improvement: "I",
  Bug: "B",
  Blocked: "K",
  refactor: "R",
  documentation: "D",
  duplicate: "U",
  invalid: "V",
  wontfix: "W",
};
export const TODO_LABEL_CODE_TO_LABEL: Record<string, TodoLabel> = {
  N: "New Feature",
  I: "Improvement",
  B: "Bug",
  K: "Blocked",
  R: "refactor",
  D: "documentation",
  U: "duplicate",
  V: "invalid",
  W: "wontfix",
};
