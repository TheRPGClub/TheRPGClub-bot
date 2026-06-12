import type { ISqlEntry } from "./types.js";

const SYNONYM_COLS_PG = `term_id, group_id, term_text, term_norm, created_at, created_by`;

export const GameSearchSynonymSql = {
  getGroupIdsForTerm: {
    postgres: `SELECT group_id
         FROM gamedb_search_synonyms
        WHERE term_norm = :termNorm`,
  } satisfies ISqlEntry,

  listGroupTerms: {
    postgres: `SELECT ${SYNONYM_COLS_PG}
         FROM gamedb_search_synonyms
        WHERE group_id = :groupId
        ORDER BY term_text ASC`,
  } satisfies ISqlEntry,

  getTermsForQuery: (placeholders: string) =>
    ({
      postgres: `SELECT DISTINCT term_text
           FROM gamedb_search_synonyms
          WHERE group_id IN (${placeholders})
          ORDER BY term_text ASC`,
    }) satisfies ISqlEntry,

  listSynonyms: {
    postgres: `SELECT ${SYNONYM_COLS_PG}
         FROM gamedb_search_synonyms
        WHERE (:searchQuery IS NULL
           OR LOWER(term_text) LIKE :searchQuery
           OR term_norm LIKE :normalizedQuery)
        ORDER BY group_id ASC, term_text ASC
        LIMIT :limit`,
  } satisfies ISqlEntry,

  countSynonymGroups: {
    postgres: `SELECT COUNT(DISTINCT group_id) AS cnt
         FROM gamedb_search_synonyms
        WHERE (:searchQuery IS NULL
           OR LOWER(term_text) LIKE :searchQuery
           OR term_norm LIKE :normalizedQuery)`,
  } satisfies ISqlEntry,

  listGroupIdsForSearch: {
    postgres: `SELECT DISTINCT group_id
           FROM gamedb_search_synonyms
          WHERE (:searchQuery IS NULL
             OR LOWER(term_text) LIKE :searchQuery
             OR term_norm LIKE :normalizedQuery)
          ORDER BY group_id ASC
          LIMIT :limit OFFSET :offset`,
  } satisfies ISqlEntry,

  listTermsInGroups: (placeholders: string) =>
    ({
      postgres: `SELECT ${SYNONYM_COLS_PG}
           FROM gamedb_search_synonyms
          WHERE group_id IN (${placeholders})
          ORDER BY group_id ASC, term_text ASC`,
    }) satisfies ISqlEntry,

  insertSynonymGroup: {
    postgres: `INSERT INTO gamedb_search_synonym_groups (created_by)
           VALUES (:createdBy)
           RETURNING group_id`,
  } satisfies ISqlEntry,

  insertSynonymTerm: {
    postgres: `INSERT INTO gamedb_search_synonyms
               (group_id, term_text, term_norm, created_by)
             VALUES (:groupId, :termText, :termNorm, :createdBy)`,
  } satisfies ISqlEntry,

  updateSynonymTerm: {
    postgres: `UPDATE gamedb_search_synonyms
            SET term_text = :termText,
                term_norm = :termNorm
          WHERE term_id = :termId`,
  } satisfies ISqlEntry,

  checkGroupExists: {
    postgres: `SELECT COUNT(*) AS cnt
           FROM gamedb_search_synonym_groups
          WHERE group_id = :groupId`,
  } satisfies ISqlEntry,

  deleteSynonymsByGroup: {
    postgres: `DELETE FROM gamedb_search_synonyms WHERE group_id = :groupId`,
  } satisfies ISqlEntry,

  getSynonymById: {
    postgres: `SELECT ${SYNONYM_COLS_PG}
         FROM gamedb_search_synonyms
        WHERE term_id = :termId`,
  } satisfies ISqlEntry,

  deleteGroup: {
    postgres: `DELETE FROM gamedb_search_synonym_groups WHERE group_id = :groupId`,
  } satisfies ISqlEntry,

  getSynonymGroupId: {
    postgres: `SELECT group_id
           FROM gamedb_search_synonyms
          WHERE term_id = :termId`,
  } satisfies ISqlEntry,

  countSynonymsInGroup: {
    postgres: `SELECT COUNT(*) AS cnt
             FROM gamedb_search_synonyms
            WHERE group_id = :groupId`,
  } satisfies ISqlEntry,

  deleteSynonymById: {
    postgres: `DELETE FROM gamedb_search_synonyms WHERE term_id = :termId`,
  } satisfies ISqlEntry,
};

export const GameSearchSynonymDraftSql = {
  createDraft: {
    postgres: `INSERT INTO gamedb_search_synonym_drafts (user_id, pairs_json)
       VALUES (:userId, :pairsJson)
       RETURNING draft_id`,
  } satisfies ISqlEntry,

  getDraft: {
    postgres: `SELECT draft_id, user_id, pairs_json, created_at, updated_at
         FROM gamedb_search_synonym_drafts
        WHERE draft_id = :draftId`,
  } satisfies ISqlEntry,

  updateDraft: {
    postgres: `UPDATE gamedb_search_synonym_drafts
            SET pairs_json = :pairsJson,
                updated_at = CURRENT_TIMESTAMP
          WHERE draft_id = :draftId`,
  } satisfies ISqlEntry,

  deleteDraft: {
    postgres: `DELETE FROM gamedb_search_synonym_drafts WHERE draft_id = :draftId`,
  } satisfies ISqlEntry,
};
