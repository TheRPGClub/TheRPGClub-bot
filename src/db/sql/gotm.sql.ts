import type { SqlEntry } from "./types.js";

export const GotmSql = {
  loadAll: {
    oracle: `SELECT ROUND_NUMBER,
            MONTH_YEAR,
            GAME_INDEX,
            REDDIT_URL,
            VOTING_RESULTS_MESSAGE_ID,
            GAMEDB_GAME_ID
       FROM GOTM_ENTRIES
      ORDER BY ROUND_NUMBER, GAME_INDEX`,
    postgres: ``,
  } satisfies SqlEntry,

  getRowsByRound: {
    oracle: `SELECT ROUND_NUMBER,
              GAME_INDEX
         FROM GOTM_ENTRIES
        WHERE ROUND_NUMBER = :round
        ORDER BY GAME_INDEX`,
    postgres: ``,
  } satisfies SqlEntry,

  updateField: (columnName: string) =>
    ({
      oracle: `UPDATE GOTM_ENTRIES
          SET ${columnName} = :value
        WHERE ROUND_NUMBER = :round
          AND GAME_INDEX = :gameIndex`,
      postgres: ``,
    }) satisfies SqlEntry,

  updateVotingResults: {
    oracle: `UPDATE GOTM_ENTRIES
        SET VOTING_RESULTS_MESSAGE_ID = :value
      WHERE ROUND_NUMBER = :round`,
    postgres: ``,
  } satisfies SqlEntry,

  checkRoundExists: {
    oracle: `SELECT COUNT(*) AS CNT
       FROM GOTM_ENTRIES
      WHERE ROUND_NUMBER = :round`,
    postgres: ``,
  } satisfies SqlEntry,

  insertRound: {
    oracle: `INSERT INTO GOTM_ENTRIES (
           ROUND_NUMBER,
           MONTH_YEAR,
           GAME_INDEX,
           REDDIT_URL,
           VOTING_RESULTS_MESSAGE_ID,
           GAMEDB_GAME_ID
         ) VALUES (
           :round,
           :monthYear,
           :gameIndex,
           :redditUrl,
           NULL,
           :gamedbGameId
         )`,
    postgres: ``,
  } satisfies SqlEntry,

  deleteRound: {
    oracle: `DELETE FROM GOTM_ENTRIES
      WHERE ROUND_NUMBER = :round`,
    postgres: ``,
  } satisfies SqlEntry,
};

export const NrGotmSql = {
  loadAll: {
    oracle: `SELECT ROUND_NUMBER,
            MONTH_YEAR,
            GAME_INDEX,
            REDDIT_URL,
            VOTING_RESULTS_MESSAGE_ID,
            GAMEDB_GAME_ID
       FROM NR_GOTM_ENTRIES
      ORDER BY ROUND_NUMBER, GAME_INDEX`,
    postgres: ``,
  } satisfies SqlEntry,

  getRowsByRound: {
    oracle: `SELECT NR_GOTM_ID,
              ROUND_NUMBER,
              GAME_INDEX
         FROM NR_GOTM_ENTRIES
        WHERE ROUND_NUMBER = :roundNumber
        ORDER BY GAME_INDEX`,
    postgres: ``,
  } satisfies SqlEntry,

  updateByRowId: (columnName: string) =>
    ({
      oracle: `UPDATE NR_GOTM_ENTRIES
            SET ${columnName} = :bindValue
          WHERE NR_GOTM_ID = :rowIdValue`,
      postgres: ``,
    }) satisfies SqlEntry,

  updateByRound: (columnName: string) =>
    ({
      oracle: `UPDATE NR_GOTM_ENTRIES
          SET ${columnName} = :bindValue
        WHERE NR_GOTM_ID = :rowIdValue`,
      postgres: ``,
    }) satisfies SqlEntry,

  updateVotingResults: {
    oracle: `UPDATE NR_GOTM_ENTRIES
        SET VOTING_RESULTS_MESSAGE_ID = :bindValue
      WHERE ROUND_NUMBER = :roundNumber`,
    postgres: ``,
  } satisfies SqlEntry,

  checkRoundExists: {
    oracle: `SELECT COUNT(*) AS CNT
       FROM NR_GOTM_ENTRIES
      WHERE ROUND_NUMBER = :roundNumber`,
    postgres: ``,
  } satisfies SqlEntry,

  insertRound: {
    oracle: `INSERT INTO NR_GOTM_ENTRIES (
           ROUND_NUMBER,
           MONTH_YEAR,
           GAME_INDEX,
           REDDIT_URL,
           VOTING_RESULTS_MESSAGE_ID,
           GAMEDB_GAME_ID
         ) VALUES (
           :roundNumber,
           :monthYear,
           :gameIndex,
           :redditUrl,
           NULL,
           :gamedbGameId
         )
         RETURNING NR_GOTM_ID INTO :outId`,
    postgres: ``,
  } satisfies SqlEntry,

  deleteRound: {
    oracle: `DELETE FROM NR_GOTM_ENTRIES
      WHERE ROUND_NUMBER = :roundNumber`,
    postgres: ``,
  } satisfies SqlEntry,
};
