import type { SqlEntry } from "./types.js";

const SYNONYM_COLS = `TERM_ID, GROUP_ID, TERM_TEXT, TERM_NORM, CREATED_AT, CREATED_BY`;

export const GameSearchSynonymSql = {
  getGroupIdsForTerm: {
    oracle: `SELECT GROUP_ID
         FROM GAMEDB_SEARCH_SYNONYMS
        WHERE TERM_NORM = :termNorm`,
    postgres: ``,
  } satisfies SqlEntry,

  listGroupTerms: {
    oracle: `SELECT ${SYNONYM_COLS}
         FROM GAMEDB_SEARCH_SYNONYMS
        WHERE GROUP_ID = :groupId
        ORDER BY TERM_TEXT ASC`,
    postgres: ``,
  } satisfies SqlEntry,

  getTermsForQuery: (placeholders: string) =>
    ({
      oracle: `SELECT DISTINCT TERM_TEXT
           FROM GAMEDB_SEARCH_SYNONYMS
          WHERE GROUP_ID IN (${placeholders})
          ORDER BY TERM_TEXT ASC`,
      postgres: ``,
    }) satisfies SqlEntry,

  listSynonyms: {
    oracle: `SELECT ${SYNONYM_COLS}
         FROM GAMEDB_SEARCH_SYNONYMS
        WHERE (:searchQuery IS NULL
           OR LOWER(TERM_TEXT) LIKE :searchQuery
           OR TERM_NORM LIKE :normalizedQuery)
        ORDER BY GROUP_ID ASC, TERM_TEXT ASC
        FETCH FIRST :limit ROWS ONLY`,
    postgres: ``,
  } satisfies SqlEntry,

  countSynonymGroups: {
    oracle: `SELECT COUNT(DISTINCT GROUP_ID) AS CNT
         FROM GAMEDB_SEARCH_SYNONYMS
        WHERE (:searchQuery IS NULL
           OR LOWER(TERM_TEXT) LIKE :searchQuery
           OR TERM_NORM LIKE :normalizedQuery)`,
    postgres: ``,
  } satisfies SqlEntry,

  listGroupIdsForSearch: {
    oracle: `SELECT DISTINCT GROUP_ID
           FROM GAMEDB_SEARCH_SYNONYMS
          WHERE (:searchQuery IS NULL
             OR LOWER(TERM_TEXT) LIKE :searchQuery
             OR TERM_NORM LIKE :normalizedQuery)
          ORDER BY GROUP_ID ASC
          OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
    postgres: ``,
  } satisfies SqlEntry,

  listTermsInGroups: (placeholders: string) =>
    ({
      oracle: `SELECT ${SYNONYM_COLS}
           FROM GAMEDB_SEARCH_SYNONYMS
          WHERE GROUP_ID IN (${placeholders})
          ORDER BY GROUP_ID ASC, TERM_TEXT ASC`,
      postgres: ``,
    }) satisfies SqlEntry,

  insertSynonymGroup: {
    oracle: `INSERT INTO GAMEDB_SEARCH_SYNONYM_GROUPS (CREATED_BY)
           VALUES (:createdBy)
           RETURNING GROUP_ID INTO :groupId`,
    postgres: ``,
  } satisfies SqlEntry,

  insertSynonymTerm: {
    oracle: `INSERT INTO GAMEDB_SEARCH_SYNONYMS
               (GROUP_ID, TERM_TEXT, TERM_NORM, CREATED_BY)
             VALUES (:groupId, :termText, :termNorm, :createdBy)`,
    postgres: ``,
  } satisfies SqlEntry,

  updateSynonymTerm: {
    oracle: `UPDATE GAMEDB_SEARCH_SYNONYMS
            SET TERM_TEXT = :termText,
                TERM_NORM = :termNorm
          WHERE TERM_ID = :termId`,
    postgres: ``,
  } satisfies SqlEntry,

  checkGroupExists: {
    oracle: `SELECT COUNT(*) AS CNT
           FROM GAMEDB_SEARCH_SYNONYM_GROUPS
          WHERE GROUP_ID = :groupId`,
    postgres: ``,
  } satisfies SqlEntry,

  deleteSynonymsByGroup: {
    oracle: `DELETE FROM GAMEDB_SEARCH_SYNONYMS WHERE GROUP_ID = :groupId`,
    postgres: ``,
  } satisfies SqlEntry,

  getSynonymById: {
    oracle: `SELECT ${SYNONYM_COLS}
         FROM GAMEDB_SEARCH_SYNONYMS
        WHERE TERM_ID = :termId`,
    postgres: ``,
  } satisfies SqlEntry,

  deleteGroup: {
    oracle: `DELETE FROM GAMEDB_SEARCH_SYNONYM_GROUPS WHERE GROUP_ID = :groupId`,
    postgres: ``,
  } satisfies SqlEntry,

  getSynonymGroupId: {
    oracle: `SELECT GROUP_ID
           FROM GAMEDB_SEARCH_SYNONYMS
          WHERE TERM_ID = :termId`,
    postgres: ``,
  } satisfies SqlEntry,

  countSynonymsInGroup: {
    oracle: `SELECT COUNT(*) AS CNT
             FROM GAMEDB_SEARCH_SYNONYMS
            WHERE GROUP_ID = :groupId`,
    postgres: ``,
  } satisfies SqlEntry,

  deleteSynonymById: {
    oracle: `DELETE FROM GAMEDB_SEARCH_SYNONYMS WHERE TERM_ID = :termId`,
    postgres: ``,
  } satisfies SqlEntry,
};

export const GameSearchSynonymDraftSql = {
  createDraft: {
    oracle: `INSERT INTO GAMEDB_SEARCH_SYNONYM_DRAFTS (USER_ID, PAIRS_JSON)
       VALUES (:userId, :pairsJson)
       RETURNING DRAFT_ID INTO :draftId`,
    postgres: ``,
  } satisfies SqlEntry,

  getDraft: {
    oracle: `SELECT DRAFT_ID, USER_ID, PAIRS_JSON, CREATED_AT, UPDATED_AT
         FROM GAMEDB_SEARCH_SYNONYM_DRAFTS
        WHERE DRAFT_ID = :draftId`,
    postgres: ``,
  } satisfies SqlEntry,

  updateDraft: {
    oracle: `UPDATE GAMEDB_SEARCH_SYNONYM_DRAFTS
            SET PAIRS_JSON = :pairsJson,
                UPDATED_AT = CURRENT_TIMESTAMP
          WHERE DRAFT_ID = :draftId`,
    postgres: ``,
  } satisfies SqlEntry,

  deleteDraft: {
    oracle: `DELETE FROM GAMEDB_SEARCH_SYNONYM_DRAFTS WHERE DRAFT_ID = :draftId`,
    postgres: ``,
  } satisfies SqlEntry,
};
