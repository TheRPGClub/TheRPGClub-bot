import type { ISqlEntry } from "./types.js";

export const SuggestionSql = {
  create: {
    oracle: `INSERT INTO RPG_CLUB_SUGGESTIONS (TITLE, DETAILS, LABELS, CREATED_BY, CREATED_BY_NAME)
       VALUES (:title, :details, :labels, :createdBy, :createdByName)
       RETURNING SUGGESTION_ID INTO :id`,
    postgres: `INSERT INTO rpg_club_suggestions (title, details, labels, created_by, created_by_name)
       VALUES (:title, :details, :labels, :createdBy, :createdByName)
       RETURNING suggestion_id`,
  } satisfies ISqlEntry,

  list: {
    oracle: `SELECT SUGGESTION_ID,
            TITLE,
            DETAILS,
            LABELS,
            CREATED_BY,
            CREATED_BY_NAME,
            CREATED_AT,
            UPDATED_AT
       FROM RPG_CLUB_SUGGESTIONS
      ORDER BY CREATED_AT DESC, SUGGESTION_ID DESC
      FETCH FIRST :limit ROWS ONLY`,
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
    oracle: `SELECT COUNT(*) AS TOTAL FROM RPG_CLUB_SUGGESTIONS`,
    postgres: `SELECT COUNT(*) AS total FROM rpg_club_suggestions`,
  } satisfies ISqlEntry,

  getById: {
    oracle: `SELECT SUGGESTION_ID,
            TITLE,
            DETAILS,
            LABELS,
            CREATED_BY,
            CREATED_BY_NAME,
            CREATED_AT,
            UPDATED_AT
       FROM RPG_CLUB_SUGGESTIONS
      WHERE SUGGESTION_ID = :id`,
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
    oracle: `DELETE FROM RPG_CLUB_SUGGESTIONS WHERE SUGGESTION_ID = :id`,
    postgres: `DELETE FROM rpg_club_suggestions WHERE suggestion_id = :id`,
  } satisfies ISqlEntry,
};

export const SuggestionReviewSessionSql = {
  create: {
    oracle: `INSERT INTO RPG_CLUB_SUGGESTION_REVIEW_SESSIONS
         (SESSION_ID, REVIEWER_ID, SUGGESTION_IDS, CURRENT_INDEX, TOTAL_COUNT)
       VALUES (:sessionId, :reviewerId, :suggestionIds, :currentIndex, :totalCount)`,
    postgres: `INSERT INTO rpg_club_suggestion_review_sessions
         (session_id, reviewer_id, suggestion_ids, current_index, total_count)
       VALUES (:sessionId, :reviewerId, :suggestionIds, :currentIndex, :totalCount)`,
  } satisfies ISqlEntry,

  getById: {
    oracle: `SELECT SESSION_ID,
            REVIEWER_ID,
            SUGGESTION_IDS,
            CURRENT_INDEX,
            TOTAL_COUNT,
            CREATED_AT,
            UPDATED_AT
       FROM RPG_CLUB_SUGGESTION_REVIEW_SESSIONS
      WHERE SESSION_ID = :sessionId`,
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
    oracle: `UPDATE RPG_CLUB_SUGGESTION_REVIEW_SESSIONS
        SET REVIEWER_ID = :reviewerId,
            SUGGESTION_IDS = :suggestionIds,
            CURRENT_INDEX = :currentIndex,
            TOTAL_COUNT = :totalCount
      WHERE SESSION_ID = :sessionId`,
    postgres: `UPDATE rpg_club_suggestion_review_sessions
        SET reviewer_id = :reviewerId,
            suggestion_ids = :suggestionIds,
            current_index = :currentIndex,
            total_count = :totalCount
      WHERE session_id = :sessionId`,
  } satisfies ISqlEntry,

  delete: {
    oracle: `DELETE FROM RPG_CLUB_SUGGESTION_REVIEW_SESSIONS WHERE SESSION_ID = :sessionId`,
    postgres: `DELETE FROM rpg_club_suggestion_review_sessions WHERE session_id = :sessionId`,
  } satisfies ISqlEntry,

  deleteForReviewer: {
    oracle: `DELETE FROM RPG_CLUB_SUGGESTION_REVIEW_SESSIONS WHERE REVIEWER_ID = :reviewerId`,
    postgres: `DELETE FROM rpg_club_suggestion_review_sessions WHERE reviewer_id = :reviewerId`,
  } satisfies ISqlEntry,

  deleteExpired: {
    oracle: `DELETE FROM RPG_CLUB_SUGGESTION_REVIEW_SESSIONS WHERE CREATED_AT < :cutoff`,
    postgres: `DELETE FROM rpg_club_suggestion_review_sessions WHERE created_at < :cutoff`,
  } satisfies ISqlEntry,
};
