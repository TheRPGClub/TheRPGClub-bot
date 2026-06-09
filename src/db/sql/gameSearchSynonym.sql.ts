import type { SqlEntry } from "./types.js";

const SYNONYM_COLS = `TERM_ID, GROUP_ID, TERM_TEXT, TERM_NORM, CREATED_AT, CREATED_BY`;
const SYNONYM_COLS_PG = `term_id, group_id, term_text, term_norm, created_at, created_by`;

export const GameSearchSynonymSql = {
  getGroupIdsForTerm: {
    oracle: `SELECT GROUP_ID
         FROM GAMEDB_SEARCH_SYNONYMS
        WHERE TERM_NORM = :termNorm`,
    postgres: `SELECT group_id
         FROM gamedb_search_synonyms
        WHERE term_norm = :termNorm`,
  } satisfies SqlEntry,

  listGroupTerms: {
    oracle: `SELECT ${SYNONYM_COLS}
         FROM GAMEDB_SEARCH_SYNONYMS
        WHERE GROUP_ID = :groupId
        ORDER BY TERM_TEXT ASC`,
    postgres: `SELECT ${SYNONYM_COLS_PG}
         FROM gamedb_search_synonyms
        WHERE group_id = :groupId
        ORDER BY term_text ASC`,
  } satisfies SqlEntry,

  getTermsForQuery: (placeholders: string) =>
    ({
      oracle: `SELECT DISTINCT TERM_TEXT
           FROM GAMEDB_SEARCH_SYNONYMS
          WHERE GROUP_ID IN (${placeholders})
          ORDER BY TERM_TEXT ASC`,
      postgres: `SELECT DISTINCT term_text
           FROM gamedb_search_synonyms
          WHERE group_id IN (${placeholders})
          ORDER BY term_text ASC`,
    }) satisfies SqlEntry,

  listSynonyms: {
    oracle: `SELECT ${SYNONYM_COLS}
         FROM GAMEDB_SEARCH_SYNONYMS
        WHERE (:searchQuery IS NULL
           OR LOWER(TERM_TEXT) LIKE :searchQuery
           OR TERM_NORM LIKE :normalizedQuery)
        ORDER BY GROUP_ID ASC, TERM_TEXT ASC
        FETCH FIRST :limit ROWS ONLY`,
    postgres: `SELECT ${SYNONYM_COLS_PG}
         FROM gamedb_search_synonyms
        WHERE (:searchQuery IS NULL
           OR LOWER(term_text) LIKE :searchQuery
           OR term_norm LIKE :normalizedQuery)
        ORDER BY group_id ASC, term_text ASC
        LIMIT :limit`,
  } satisfies SqlEntry,

  countSynonymGroups: {
    oracle: `SELECT COUNT(DISTINCT GROUP_ID) AS CNT
         FROM GAMEDB_SEARCH_SYNONYMS
        WHERE (:searchQuery IS NULL
           OR LOWER(TERM_TEXT) LIKE :searchQuery
           OR TERM_NORM LIKE :normalizedQuery)`,
    postgres: `SELECT COUNT(DISTINCT group_id) AS cnt
         FROM gamedb_search_synonyms
        WHERE (:searchQuery IS NULL
           OR LOWER(term_text) LIKE :searchQuery
           OR term_norm LIKE :normalizedQuery)`,
  } satisfies SqlEntry,

  listGroupIdsForSearch: {
    oracle: `SELECT DISTINCT GROUP_ID
           FROM GAMEDB_SEARCH_SYNONYMS
          WHERE (:searchQuery IS NULL
             OR LOWER(TERM_TEXT) LIKE :searchQuery
             OR TERM_NORM LIKE :normalizedQuery)
          ORDER BY GROUP_ID ASC
          OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
    postgres: `SELECT DISTINCT group_id
           FROM gamedb_search_synonyms
          WHERE (:searchQuery IS NULL
             OR LOWER(term_text) LIKE :searchQuery
             OR term_norm LIKE :normalizedQuery)
          ORDER BY group_id ASC
          LIMIT :limit OFFSET :offset`,
  } satisfies SqlEntry,

  listTermsInGroups: (placeholders: string) =>
    ({
      oracle: `SELECT ${SYNONYM_COLS}
           FROM GAMEDB_SEARCH_SYNONYMS
          WHERE GROUP_ID IN (${placeholders})
          ORDER BY GROUP_ID ASC, TERM_TEXT ASC`,
      postgres: `SELECT ${SYNONYM_COLS_PG}
           FROM gamedb_search_synonyms
          WHERE group_id IN (${placeholders})
          ORDER BY group_id ASC, term_text ASC`,
    }) satisfies SqlEntry,

  insertSynonymGroup: {
    oracle: `INSERT INTO GAMEDB_SEARCH_SYNONYM_GROUPS (CREATED_BY)
           VALUES (:createdBy)
           RETURNING GROUP_ID INTO :groupId`,
    postgres: `INSERT INTO gamedb_search_synonym_groups (created_by)
           VALUES (:createdBy)
           RETURNING group_id`,
  } satisfies SqlEntry,

  insertSynonymTerm: {
    oracle: `INSERT INTO GAMEDB_SEARCH_SYNONYMS
               (GROUP_ID, TERM_TEXT, TERM_NORM, CREATED_BY)
             VALUES (:groupId, :termText, :termNorm, :createdBy)`,
    postgres: `INSERT INTO gamedb_search_synonyms
               (group_id, term_text, term_norm, created_by)
             VALUES (:groupId, :termText, :termNorm, :createdBy)`,
  } satisfies SqlEntry,

  updateSynonymTerm: {
    oracle: `UPDATE GAMEDB_SEARCH_SYNONYMS
            SET TERM_TEXT = :termText,
                TERM_NORM = :termNorm
          WHERE TERM_ID = :termId`,
    postgres: `UPDATE gamedb_search_synonyms
            SET term_text = :termText,
                term_norm = :termNorm
          WHERE term_id = :termId`,
  } satisfies SqlEntry,

  checkGroupExists: {
    oracle: `SELECT COUNT(*) AS CNT
           FROM GAMEDB_SEARCH_SYNONYM_GROUPS
          WHERE GROUP_ID = :groupId`,
    postgres: `SELECT COUNT(*) AS cnt
           FROM gamedb_search_synonym_groups
          WHERE group_id = :groupId`,
  } satisfies SqlEntry,

  deleteSynonymsByGroup: {
    oracle: `DELETE FROM GAMEDB_SEARCH_SYNONYMS WHERE GROUP_ID = :groupId`,
    postgres: `DELETE FROM gamedb_search_synonyms WHERE group_id = :groupId`,
  } satisfies SqlEntry,

  getSynonymById: {
    oracle: `SELECT ${SYNONYM_COLS}
         FROM GAMEDB_SEARCH_SYNONYMS
        WHERE TERM_ID = :termId`,
    postgres: `SELECT ${SYNONYM_COLS_PG}
         FROM gamedb_search_synonyms
        WHERE term_id = :termId`,
  } satisfies SqlEntry,

  deleteGroup: {
    oracle: `DELETE FROM GAMEDB_SEARCH_SYNONYM_GROUPS WHERE GROUP_ID = :groupId`,
    postgres: `DELETE FROM gamedb_search_synonym_groups WHERE group_id = :groupId`,
  } satisfies SqlEntry,

  getSynonymGroupId: {
    oracle: `SELECT GROUP_ID
           FROM GAMEDB_SEARCH_SYNONYMS
          WHERE TERM_ID = :termId`,
    postgres: `SELECT group_id
           FROM gamedb_search_synonyms
          WHERE term_id = :termId`,
  } satisfies SqlEntry,

  countSynonymsInGroup: {
    oracle: `SELECT COUNT(*) AS CNT
             FROM GAMEDB_SEARCH_SYNONYMS
            WHERE GROUP_ID = :groupId`,
    postgres: `SELECT COUNT(*) AS cnt
             FROM gamedb_search_synonyms
            WHERE group_id = :groupId`,
  } satisfies SqlEntry,

  deleteSynonymById: {
    oracle: `DELETE FROM GAMEDB_SEARCH_SYNONYMS WHERE TERM_ID = :termId`,
    postgres: `DELETE FROM gamedb_search_synonyms WHERE term_id = :termId`,
  } satisfies SqlEntry,
};

export const GameSearchSynonymDraftSql = {
  createDraft: {
    oracle: `INSERT INTO GAMEDB_SEARCH_SYNONYM_DRAFTS (USER_ID, PAIRS_JSON)
       VALUES (:userId, :pairsJson)
       RETURNING DRAFT_ID INTO :draftId`,
    postgres: `INSERT INTO gamedb_search_synonym_drafts (user_id, pairs_json)
       VALUES (:userId, :pairsJson)
       RETURNING draft_id`,
  } satisfies SqlEntry,

  getDraft: {
    oracle: `SELECT DRAFT_ID, USER_ID, PAIRS_JSON, CREATED_AT, UPDATED_AT
         FROM GAMEDB_SEARCH_SYNONYM_DRAFTS
        WHERE DRAFT_ID = :draftId`,
    postgres: `SELECT draft_id, user_id, pairs_json, created_at, updated_at
         FROM gamedb_search_synonym_drafts
        WHERE draft_id = :draftId`,
  } satisfies SqlEntry,

  updateDraft: {
    oracle: `UPDATE GAMEDB_SEARCH_SYNONYM_DRAFTS
            SET PAIRS_JSON = :pairsJson,
                UPDATED_AT = CURRENT_TIMESTAMP
          WHERE DRAFT_ID = :draftId`,
    postgres: `UPDATE gamedb_search_synonym_drafts
            SET pairs_json = :pairsJson,
                updated_at = CURRENT_TIMESTAMP
          WHERE draft_id = :draftId`,
  } satisfies SqlEntry,

  deleteDraft: {
    oracle: `DELETE FROM GAMEDB_SEARCH_SYNONYM_DRAFTS WHERE DRAFT_ID = :draftId`,
    postgres: `DELETE FROM gamedb_search_synonym_drafts WHERE draft_id = :draftId`,
  } satisfies SqlEntry,
};
