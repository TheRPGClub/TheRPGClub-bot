import type { ISqlEntry } from "./types.js";

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
};
