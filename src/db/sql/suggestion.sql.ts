import type { ISqlEntry } from "./types.js";

export const SuggestionSql = {
  create: {
    postgres: `INSERT INTO rpg_club_suggestions (title, details, labels, created_by, created_by_name)
       VALUES (:title, :details, :labels, :createdBy, :createdByName)
       RETURNING suggestion_id`,
  } satisfies ISqlEntry,

  list: {
    postgres: `SELECT suggestion_id,
            title,
            details,
            labels,
            created_by,
            created_by_name,
            created_at,
            updated_at
       FROM rpg_club_suggestions
      ORDER BY created_at DESC, suggestion_id DESC
      LIMIT :limit`,
  } satisfies ISqlEntry,

  count: {
    postgres: `SELECT COUNT(*) AS total FROM rpg_club_suggestions`,
  } satisfies ISqlEntry,

  getById: {
    postgres: `SELECT suggestion_id,
            title,
            details,
            labels,
            created_by,
            created_by_name,
            created_at,
            updated_at
       FROM rpg_club_suggestions
      WHERE suggestion_id = :id`,
  } satisfies ISqlEntry,

  delete: {
    postgres: `DELETE FROM rpg_club_suggestions WHERE suggestion_id = :id`,
  } satisfies ISqlEntry,
};

export const SuggestionReviewSessionSql = {
  create: {
    postgres: `INSERT INTO rpg_club_suggestion_review_sessions
         (session_id, reviewer_id, suggestion_ids, current_index, total_count)
       VALUES (:sessionId, :reviewerId, :suggestionIds, :currentIndex, :totalCount)`,
  } satisfies ISqlEntry,

  getById: {
    postgres: `SELECT session_id,
            reviewer_id,
            suggestion_ids,
            current_index,
            total_count,
            created_at,
            updated_at
       FROM rpg_club_suggestion_review_sessions
      WHERE session_id = :sessionId`,
  } satisfies ISqlEntry,

  update: {
    postgres: `UPDATE rpg_club_suggestion_review_sessions
        SET reviewer_id = :reviewerId,
            suggestion_ids = :suggestionIds,
            current_index = :currentIndex,
            total_count = :totalCount
      WHERE session_id = :sessionId`,
  } satisfies ISqlEntry,

  delete: {
    postgres: `DELETE FROM rpg_club_suggestion_review_sessions WHERE session_id = :sessionId`,
  } satisfies ISqlEntry,

  deleteForReviewer: {
    postgres: `DELETE FROM rpg_club_suggestion_review_sessions WHERE reviewer_id = :reviewerId`,
  } satisfies ISqlEntry,

  deleteExpired: {
    postgres: `DELETE FROM rpg_club_suggestion_review_sessions WHERE created_at < :cutoff`,
  } satisfies ISqlEntry,
};
