import type { ISqlEntry } from "./types.js";

export const GotmSql = {
  loadAll: {
    postgres: `SELECT round_number,
            month_year,
            game_index,
            reddit_url,
            voting_results_message_id,
            gamedb_game_id
       FROM gotm_entries
      ORDER BY round_number, game_index`,
  } satisfies ISqlEntry,

  getRowsByRound: {
    postgres: `SELECT round_number,
              game_index
         FROM gotm_entries
        WHERE round_number = :round
        ORDER BY game_index`,
  } satisfies ISqlEntry,

  updateField: (columnName: string) =>
    ({
      postgres: `UPDATE gotm_entries
          SET ${columnName.toLowerCase()} = :value
        WHERE round_number = :round
          AND game_index = :gameIndex`,
    }) satisfies ISqlEntry,

  updateVotingResults: {
    postgres: `UPDATE gotm_entries
        SET voting_results_message_id = :value
      WHERE round_number = :round`,
  } satisfies ISqlEntry,

  checkRoundExists: {
    postgres: `SELECT COUNT(*) AS cnt
       FROM gotm_entries
      WHERE round_number = :round`,
  } satisfies ISqlEntry,

  insertRound: {
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
  } satisfies ISqlEntry,

  deleteRound: {
    postgres: `DELETE FROM gotm_entries
      WHERE round_number = :round`,
  } satisfies ISqlEntry,
};

export const NrGotmSql = {
  loadAll: {
    postgres: `SELECT round_number,
            month_year,
            game_index,
            reddit_url,
            voting_results_message_id,
            gamedb_game_id
       FROM nr_gotm_entries
      ORDER BY round_number, game_index`,
  } satisfies ISqlEntry,

  getRowsByRound: {
    postgres: `SELECT nr_gotm_id,
              round_number,
              game_index
         FROM nr_gotm_entries
        WHERE round_number = :roundNumber
        ORDER BY game_index`,
  } satisfies ISqlEntry,

  updateByRowId: (columnName: string) =>
    ({
      postgres: `UPDATE nr_gotm_entries
            SET ${columnName.toLowerCase()} = :bindValue
          WHERE nr_gotm_id = :rowIdValue`,
    }) satisfies ISqlEntry,

  updateByRound: (columnName: string) =>
    ({
      postgres: `UPDATE nr_gotm_entries
          SET ${columnName.toLowerCase()} = :bindValue
        WHERE nr_gotm_id = :rowIdValue`,
    }) satisfies ISqlEntry,

  updateVotingResults: {
    postgres: `UPDATE nr_gotm_entries
        SET voting_results_message_id = :bindValue
      WHERE round_number = :roundNumber`,
  } satisfies ISqlEntry,

  checkRoundExists: {
    postgres: `SELECT COUNT(*) AS cnt
       FROM nr_gotm_entries
      WHERE round_number = :roundNumber`,
  } satisfies ISqlEntry,

  insertRound: {
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
  } satisfies ISqlEntry,

  deleteRound: {
    postgres: `DELETE FROM nr_gotm_entries
      WHERE round_number = :roundNumber`,
  } satisfies ISqlEntry,
};
