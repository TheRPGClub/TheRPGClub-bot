import { parseCustomIdSegments } from "../../utilities/CustomIdUtils.js";
import {
  TODO_LIST_ID_PREFIX,
  TODO_LIST_BACK_ID_PREFIX,
  TODO_VIEW_ID_PREFIX,
  TODO_CREATE_BUTTON_PREFIX,
  TODO_CREATE_MODAL_PREFIX,
  TODO_CLOSE_BUTTON_PREFIX,
  TODO_CLOSE_SELECT_PREFIX,
  TODO_CLOSE_CANCEL_PREFIX,
  TODO_COMMENT_BUTTON_PREFIX,
  TODO_COMMENT_MODAL_PREFIX,
  TODO_EDIT_VIEW_BUTTON_PREFIX,
  TODO_EDIT_VIEW_MODAL_PREFIX,
  TODO_EDIT_TITLE_MODAL_PREFIX,
  TODO_EDIT_DESC_MODAL_PREFIX,
  TODO_CLOSE_VIEW_PREFIX,
  TODO_REOPEN_VIEW_PREFIX,
  TODO_LABEL_EDIT_SELECT_PREFIX,
  TODO_FILTER_BUTTON_PREFIX,
  TODO_FILTER_MODAL_PREFIX,
  TODO_OPEN_SELECT_PREFIX,
  TODO_REPO_SELECT_PREFIX,
} from "./todoTypes.js";

export function buildTodoListCustomId(payloadToken: string, page: number): string {
  return [TODO_LIST_ID_PREFIX, payloadToken, page].join(":");
}

export function buildTodoListBackId(payloadToken: string, page: number): string {
  return [TODO_LIST_BACK_ID_PREFIX, payloadToken, page].join(":");
}

export function buildTodoCreateButtonId(payloadToken: string, page: number): string {
  return [TODO_CREATE_BUTTON_PREFIX, payloadToken, page].join(":");
}

export function buildTodoCreateModalId(
  payloadToken: string,
  page: number,
  channelId: string,
  messageId: string,
): string {
  return [TODO_CREATE_MODAL_PREFIX, payloadToken, page, channelId, messageId].join(":");
}

export function buildTodoCloseButtonId(payloadToken: string, page: number): string {
  return [TODO_CLOSE_BUTTON_PREFIX, payloadToken, page].join(":");
}

export function buildTodoCloseSelectId(
  payloadToken: string,
  page: number,
  channelId: string,
  messageId: string,
): string {
  return [TODO_CLOSE_SELECT_PREFIX, payloadToken, page, channelId, messageId].join(":");
}

export function buildTodoCloseCancelId(payloadToken: string, page: number): string {
  return [TODO_CLOSE_CANCEL_PREFIX, payloadToken, page].join(":");
}

export function buildTodoCommentButtonId(
  payloadToken: string,
  page: number,
  issueNumber: number,
): string {
  return [TODO_COMMENT_BUTTON_PREFIX, payloadToken, page, issueNumber].join(":");
}

export function buildTodoEditViewButtonId(
  payloadToken: string,
  page: number,
  issueNumber: number,
): string {
  return [TODO_EDIT_VIEW_BUTTON_PREFIX, payloadToken, page, issueNumber].join(":");
}

export function buildTodoEditViewModalId(
  payloadToken: string,
  page: number,
  issueNumber: number,
  channelId: string,
  messageId: string,
): string {
  return [
    TODO_EDIT_VIEW_MODAL_PREFIX,
    payloadToken,
    page,
    issueNumber,
    channelId,
    messageId,
  ].join(":");
}

export function buildTodoCommentModalId(
  payloadToken: string,
  page: number,
  issueNumber: number,
  channelId: string,
  messageId: string,
): string {
  return [
    TODO_COMMENT_MODAL_PREFIX,
    payloadToken,
    page,
    issueNumber,
    channelId,
    messageId,
  ].join(":");
}

export function buildTodoEditTitleModalId(
  payloadToken: string,
  page: number,
  issueNumber: number,
  channelId: string,
  messageId: string,
): string {
  return [
    TODO_EDIT_TITLE_MODAL_PREFIX,
    payloadToken,
    page,
    issueNumber,
    channelId,
    messageId,
  ].join(":");
}

export function buildTodoEditDescModalId(
  payloadToken: string,
  page: number,
  issueNumber: number,
  channelId: string,
  messageId: string,
): string {
  return [
    TODO_EDIT_DESC_MODAL_PREFIX,
    payloadToken,
    page,
    issueNumber,
    channelId,
    messageId,
  ].join(":");
}

export function buildTodoCloseViewId(
  payloadToken: string,
  page: number,
  issueNumber: number,
): string {
  return [TODO_CLOSE_VIEW_PREFIX, payloadToken, page, issueNumber].join(":");
}

export function buildTodoReopenViewId(
  payloadToken: string,
  page: number,
  issueNumber: number,
): string {
  return [TODO_REOPEN_VIEW_PREFIX, payloadToken, page, issueNumber].join(":");
}

export function buildTodoLabelEditSelectId(
  payloadToken: string,
  page: number,
  issueNumber: number,
  channelId: string,
  messageId: string,
): string {
  return [
    TODO_LABEL_EDIT_SELECT_PREFIX,
    payloadToken,
    page,
    issueNumber,
    channelId,
    messageId,
  ].join(":");
}

export function buildTodoFilterButtonId(payloadToken: string, page: number): string {
  return [TODO_FILTER_BUTTON_PREFIX, payloadToken, page].join(":");
}

export function buildTodoFilterModalId(
  payloadToken: string,
  page: number,
  channelId: string,
  messageId: string,
): string {
  return [TODO_FILTER_MODAL_PREFIX, payloadToken, page, channelId, messageId].join(":");
}

export function buildTodoOpenSelectId(payloadToken: string, page: number): string {
  return [TODO_OPEN_SELECT_PREFIX, payloadToken, page].join(":");
}

export function buildTodoRepoSelectId(payloadToken: string, page: number): string {
  return [TODO_REPO_SELECT_PREFIX, payloadToken, page].join(":");
}

export function parseTodoListCustomId(
  id: string,
): { payloadToken: string; page: number } | null {
  if (!id.startsWith(`${TODO_LIST_ID_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(id, 2);
  if (!segs) return null;
  const [payloadToken, pageStr] = segs;
  const page = Number(pageStr);
  if (!payloadToken || !page) return null;
  return { payloadToken, page };
}

export function parseTodoListBackId(
  id: string,
): { payloadToken: string; page: number } | null {
  if (!id.startsWith(`${TODO_LIST_BACK_ID_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(id, 2);
  if (!segs) return null;
  const [payloadToken, pageStr] = segs;
  const page = Number(pageStr);
  if (!payloadToken || !page) return null;
  return { payloadToken, page };
}

export function parseTodoCreateButtonId(
  id: string,
  prefix: string,
): { payloadToken: string; page: number } | null {
  if (!id.startsWith(`${prefix}:`)) return null;
  const segs = parseCustomIdSegments(id, 2);
  if (!segs) return null;
  const [payloadToken, pageStr] = segs;
  const page = Number(pageStr);
  if (!payloadToken || !page) return null;
  return { payloadToken, page };
}

export function parseTodoCreateModalId(
  id: string,
  prefix: string,
): { payloadToken: string; page: number; channelId: string; messageId: string } | null {
  if (!id.startsWith(`${prefix}:`)) return null;
  const segs = parseCustomIdSegments(id, 4);
  if (!segs) return null;
  const [payloadToken, pageStr, channelId, messageId] = segs;
  const page = Number(pageStr);
  if (!payloadToken || !page || !channelId || !messageId) return null;
  return { payloadToken, page, channelId, messageId };
}

export function parseTodoCloseId(
  id: string,
  prefix: string,
): { payloadToken: string; page: number } | null {
  if (!id.startsWith(`${prefix}:`)) return null;
  const segs = parseCustomIdSegments(id, 2);
  if (!segs) return null;
  const [payloadToken, pageStr] = segs;
  const page = Number(pageStr);
  if (!payloadToken || !page) return null;
  return { payloadToken, page };
}

export function parseTodoCloseSelectId(
  id: string,
  prefix: string,
): { payloadToken: string; page: number; channelId: string; messageId: string } | null {
  if (!id.startsWith(`${prefix}:`)) return null;
  const segs = parseCustomIdSegments(id, 4);
  if (!segs) return null;
  const [payloadToken, pageStr, channelId, messageId] = segs;
  const page = Number(pageStr);
  if (!payloadToken || !page || !channelId || !messageId) return null;
  return { payloadToken, page, channelId, messageId };
}

export function parseTodoViewId(
  id: string,
): { payloadToken: string; page: number; issueNumber: number } | null {
  if (!id.startsWith(`${TODO_VIEW_ID_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(id, 3);
  if (!segs) return null;
  const [payloadToken, pageStr, issueStr] = segs;
  const page = Number(pageStr);
  const issueNumber = Number(issueStr);
  if (!payloadToken || !page || !issueNumber) return null;
  return { payloadToken, page, issueNumber };
}

export function parseTodoIssueActionId(
  id: string,
  prefix: string,
): { payloadToken: string; page: number; issueNumber: number } | null {
  if (!id.startsWith(`${prefix}:`)) return null;
  const segs = parseCustomIdSegments(id, 3);
  if (!segs) return null;
  const [payloadToken, pageStr, issueStr] = segs;
  const page = Number(pageStr);
  const issueNumber = Number(issueStr);
  if (!payloadToken || !page || !issueNumber) return null;
  return { payloadToken, page, issueNumber };
}

export function parseTodoIssueModalId(
  id: string,
  prefix: string,
): {
  payloadToken: string;
  page: number;
  issueNumber: number;
  channelId: string;
  messageId: string;
} | null {
  if (!id.startsWith(`${prefix}:`)) return null;
  const segs = parseCustomIdSegments(id, 5);
  if (!segs) return null;
  const [payloadToken, pageStr, issueStr, channelId, messageId] = segs;
  const page = Number(pageStr);
  const issueNumber = Number(issueStr);
  if (!payloadToken || !page || !issueNumber || !channelId || !messageId) return null;
  return { payloadToken, page, issueNumber, channelId, messageId };
}

export function parseTodoCloseViewId(
  id: string,
  prefix: string,
): { payloadToken: string; page: number; issueNumber: number } | null {
  return parseTodoIssueActionId(id, prefix);
}

export function parseTodoReopenViewId(
  id: string,
  prefix: string,
): { payloadToken: string; page: number; issueNumber: number } | null {
  return parseTodoIssueActionId(id, prefix);
}

export function parseTodoLabelEditId(
  id: string,
  prefix: string,
): { payloadToken: string; page: number; issueNumber: number } | null {
  return parseTodoIssueActionId(id, prefix);
}

export function parseTodoLabelEditSelectId(
  id: string,
  prefix: string,
): {
  payloadToken: string;
  page: number;
  issueNumber: number;
  channelId: string;
  messageId: string;
} | null {
  return parseTodoIssueModalId(id, prefix);
}

export function parseTodoSelectId(
  id: string,
  prefix: string,
): { payloadToken: string; page: number } | null {
  if (!id.startsWith(`${prefix}:`)) return null;
  const segs = parseCustomIdSegments(id, 2);
  if (!segs) return null;
  const [payloadToken, pageStr] = segs;
  const page = Number(pageStr);
  if (!payloadToken || !page) return null;
  return { payloadToken, page };
}

export function parseTodoFilterButtonId(
  id: string,
  prefix: string,
): { payloadToken: string; page: number } | null {
  return parseTodoSelectId(id, prefix);
}

export function parseTodoFilterModalId(
  id: string,
  prefix: string,
): { payloadToken: string; page: number; channelId: string; messageId: string } | null {
  if (!id.startsWith(`${prefix}:`)) return null;
  const segs = parseCustomIdSegments(id, 4);
  if (!segs) return null;
  const [payloadToken, pageStr, channelId, messageId] = segs;
  const page = Number(pageStr);
  if (!payloadToken || !page || !channelId || !messageId) return null;
  return { payloadToken, page, channelId, messageId };
}
