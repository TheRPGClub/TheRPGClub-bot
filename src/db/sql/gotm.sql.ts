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
    postgres: `SELECT round_number,
            month_year,
            game_index,
            reddit_url,
            voting_results_message_id,
            gamedb_game_id
       FROM gotm_entries
      ORDER BY round_number, game_index`,
  } satisfies SqlEntry,

  getRowsByRound: {
    oracle: `SELECT ROUND_NUMBER,
              GAME_INDEX
         FROM GOTM_ENTRIES
        WHERE ROUND_NUMBER = :round
        ORDER BY GAME_INDEX`,
    postgres: `SELECT round_number,
              game_index
         FROM gotm_entries
        WHERE round_number = :round
        ORDER BY game_index`,
  } satisfies SqlEntry,

  updateField: (columnName: string) =>
    ({
      oracle: `UPDATE GOTM_ENTRIES
          SET ${columnName} = :value
        WHERE ROUND_NUMBER = :round
          AND GAME_INDEX = :gameIndex`,
      postgres: `UPDATE gotm_entries
          SET ${columnName.toLowerCase()} = :value
        WHERE round_number = :round
          AND game_index = :gameIndex`,
    }) satisfies SqlEntry,

  updateVotingResults: {
    oracle: `UPDATE GOTM_ENTRIES
        SET VOTING_RESULTS_MESSAGE_ID = :value
      WHERE ROUND_NUMBER = :round`,
    postgres: `UPDATE gotm_entries
        SET voting_results_message_id = :value
      WHERE round_number = :round`,
  } satisfies SqlEntry,

  checkRoundExists: {
    oracle: `SELECT COUNT(*) AS CNT
       FROM GOTM_ENTRIES
      WHERE ROUND_NUMBER = :round`,
    postgres: `SELECT COUNT(*) AS cnt
       FROM gotm_entries
      WHERE round_number = :round`,
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
    postgres: `INSERT INTO gotm_entries (
           round_number,
           month_year,
           game_index,
           reddit_url,
           voting_results_message_id,
           gamedb_game_id
         ) VALUES (
           :round,
           :monthYear,
           :gameIndex,
           :redditUrl,
           NULL,
           :gamedbGameId
         )`,
  } satisfies SqlEntry,

  deleteRound: {
    oracle: `DELETE FROM GOTM_ENTRIES
      WHERE ROUND_NUMBER = :round`,
    postgres: `DELETE FROM gotm_entries
      WHERE round_number = :round`,
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
    postgres: `SELECT round_number,
            month_year,
            game_index,
            reddit_url,
            voting_results_message_id,
            gamedb_game_id
       FROM nr_gotm_entries
      ORDER BY round_number, game_index`,
  } satisfies SqlEntry,

  getRowsByRound: {
    oracle: `SELECT NR_GOTM_ID,
              ROUND_NUMBER,
              GAME_INDEX
         FROM NR_GOTM_ENTRIES
        WHERE ROUND_NUMBER = :roundNumber
        ORDER BY GAME_INDEX`,
    postgres: `SELECT nr_gotm_id,
              round_number,
              game_index
         FROM nr_gotm_entries
        WHERE round_number = :roundNumber
        ORDER BY game_index`,
  } satisfies SqlEntry,

  updateByRowId: (columnName: string) =>
    ({
      oracle: `UPDATE NR_GOTM_ENTRIES
            SET ${columnName} = :bindValue
          WHERE NR_GOTM_ID = :rowIdValue`,
      postgres: `UPDATE nr_gotm_entries
            SET ${columnName.toLowerCase()} = :bindValue
          WHERE nr_gotm_id = :rowIdValue`,
    }) satisfies SqlEntry,

  updateByRound: (columnName: string) =>
    ({
      oracle: `UPDATE NR_GOTM_ENTRIES
          SET ${columnName} = :bindValue
        WHERE NR_GOTM_ID = :rowIdValue`,
      postgres: `UPDATE nr_gotm_entries
          SET ${columnName.toLowerCase()} = :bindValue
        WHERE nr_gotm_id = :rowIdValue`,
    }) satisfies SqlEntry,

  updateVotingResults: {
    oracle: `UPDATE NR_GOTM_ENTRIES
        SET VOTING_RESULTS_MESSAGE_ID = :bindValue
      WHERE ROUND_NUMBER = :roundNumber`,
    postgres: `UPDATE nr_gotm_entries
        SET voting_results_message_id = :bindValue
      WHERE round_number = :roundNumber`,
  } satisfies SqlEntry,

  checkRoundExists: {
    oracle: `SELECT COUNT(*) AS CNT
       FROM NR_GOTM_ENTRIES
      WHERE ROUND_NUMBER = :roundNumber`,
    postgres: `SELECT COUNT(*) AS cnt
       FROM nr_gotm_entries
      WHERE round_number = :roundNumber`,
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
    postgres: `INSERT INTO nr_gotm_entries (
           round_number,
           month_year,
           game_index,
           reddit_url,
           voting_results_message_id,
           gamedb_game_id
         ) VALUES (
           :roundNumber,
           :monthYear,
           :gameIndex,
           :redditUrl,
           NULL,
           :gamedbGameId
         )
         RETURNING nr_gotm_id`,
  } satisfies SqlEntry,

  deleteRound: {
    oracle: `DELETE FROM NR_GOTM_ENTRIES
      WHERE ROUND_NUMBER = :roundNumber`,
    postgres: `DELETE FROM nr_gotm_entries
      WHERE round_number = :roundNumber`,
  } satisfies SqlEntry,
};
