import type { SqlEntry } from "./types.js";

export const SuggestionSql = {
  create: {
    oracle: `INSERT INTO RPG_CLUB_SUGGESTIONS (TITLE, DETAILS, LABELS, CREATED_BY, CREATED_BY_NAME)
       VALUES (:title, :details, :labels, :createdBy, :createdByName)
       RETURNING SUGGESTION_ID INTO :id`,
    postgres: ``,
  } satisfies SqlEntry,

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
    postgres: ``,
  } satisfies SqlEntry,

  count: {
    oracle: `SELECT COUNT(*) AS TOTAL FROM RPG_CLUB_SUGGESTIONS`,
    postgres: ``,
  } satisfies SqlEntry,

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
    postgres: ``,
  } satisfies SqlEntry,

  delete: {
    oracle: `DELETE FROM RPG_CLUB_SUGGESTIONS WHERE SUGGESTION_ID = :id`,
    postgres: ``,
  } satisfies SqlEntry,
};

export const SuggestionReviewSessionSql = {
  create: {
    oracle: `INSERT INTO RPG_CLUB_SUGGESTION_REVIEW_SESSIONS
         (SESSION_ID, REVIEWER_ID, SUGGESTION_IDS, CURRENT_INDEX, TOTAL_COUNT)
       VALUES (:sessionId, :reviewerId, :suggestionIds, :currentIndex, :totalCount)`,
    postgres: ``,
  } satisfies SqlEntry,

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
    postgres: ``,
  } satisfies SqlEntry,

  update: {
    oracle: `UPDATE RPG_CLUB_SUGGESTION_REVIEW_SESSIONS
        SET REVIEWER_ID = :reviewerId,
            SUGGESTION_IDS = :suggestionIds,
            CURRENT_INDEX = :currentIndex,
            TOTAL_COUNT = :totalCount
      WHERE SESSION_ID = :sessionId`,
    postgres: ``,
  } satisfies SqlEntry,

  delete: {
    oracle: `DELETE FROM RPG_CLUB_SUGGESTION_REVIEW_SESSIONS WHERE SESSION_ID = :sessionId`,
    postgres: ``,
  } satisfies SqlEntry,

  deleteForReviewer: {
    oracle: `DELETE FROM RPG_CLUB_SUGGESTION_REVIEW_SESSIONS WHERE REVIEWER_ID = :reviewerId`,
    postgres: ``,
  } satisfies SqlEntry,

  deleteExpired: {
    oracle: `DELETE FROM RPG_CLUB_SUGGESTION_REVIEW_SESSIONS WHERE CREATED_AT < :cutoff`,
    postgres: ``,
  } satisfies SqlEntry,
};
