import type { SqlEntry } from "./types.js";

const VOTING_COLS = `ROUND_NUMBER,
                NOMINATION_LIST_ID,
                NEXT_VOTE_AT,
                FIVE_DAY_REMINDER_SENT,
                ONE_DAY_REMINDER_SENT`;

const VOTING_COLS_PG = `round_number,
                nomination_list_id,
                next_vote_at,
                five_day_reminder_sent,
                one_day_reminder_sent`;

export const BotVotingInfoSql = {
  getAll: {
    oracle: `SELECT ${VOTING_COLS}
         FROM BOT_VOTING_INFO
        ORDER BY ROUND_NUMBER`,
    postgres: `SELECT ${VOTING_COLS_PG}
         FROM bot_voting_info
        ORDER BY round_number`,
  } satisfies SqlEntry,

  getByRound: {
    oracle: `SELECT ${VOTING_COLS}
         FROM BOT_VOTING_INFO
        WHERE ROUND_NUMBER = :round`,
    postgres: `SELECT ${VOTING_COLS_PG}
         FROM bot_voting_info
        WHERE round_number = :round`,
  } satisfies SqlEntry,

  getCurrentRound: {
    oracle: `SELECT ${VOTING_COLS}
         FROM BOT_VOTING_INFO
        WHERE ROUND_NUMBER = (
          SELECT MAX(ROUND_NUMBER) FROM BOT_VOTING_INFO
        )`,
    postgres: `SELECT ${VOTING_COLS_PG}
         FROM bot_voting_info
        WHERE round_number = (
          SELECT MAX(round_number) FROM bot_voting_info
        )`,
  } satisfies SqlEntry,

  updateRoundInfo: {
    oracle: `UPDATE BOT_VOTING_INFO
            SET NOMINATION_LIST_ID = :nominationListId,
                NEXT_VOTE_AT = :nextVoteAt
          WHERE ROUND_NUMBER = :round`,
    postgres: `UPDATE bot_voting_info
            SET nomination_list_id = :nominationListId,
                next_vote_at = :nextVoteAt
          WHERE round_number = :round`,
  } satisfies SqlEntry,

  insertRoundInfo: {
    oracle: `INSERT INTO BOT_VOTING_INFO (
           ROUND_NUMBER,
           NOMINATION_LIST_ID,
           NEXT_VOTE_AT,
           FIVE_DAY_REMINDER_SENT,
           ONE_DAY_REMINDER_SENT
         ) VALUES (
           :round,
           :nominationListId,
           :nextVoteAt,
           0,
           0
         )`,
    postgres: `INSERT INTO bot_voting_info (
           round_number,
           nomination_list_id,
           next_vote_at,
           five_day_reminder_sent,
           one_day_reminder_sent
         ) VALUES (
           :round,
           :nominationListId,
           :nextVoteAt,
           false,
           false
         )`,
  } satisfies SqlEntry,

  markReminderSent: (column: string) =>
    ({
      oracle: `UPDATE BOT_VOTING_INFO
          SET ${column} = 1
        WHERE ROUND_NUMBER = :round`,
      postgres: `UPDATE bot_voting_info
          SET ${column.toLowerCase()} = true
        WHERE round_number = :round`,
    }) satisfies SqlEntry,

  updateNextVoteAt: {
    oracle: `UPDATE BOT_VOTING_INFO
          SET NEXT_VOTE_AT = :nextVoteAt
        WHERE ROUND_NUMBER = :round`,
    postgres: `UPDATE bot_voting_info
          SET next_vote_at = :nextVoteAt
        WHERE round_number = :round`,
  } satisfies SqlEntry,

  updateNominationListId: {
    oracle: `UPDATE BOT_VOTING_INFO
          SET NOMINATION_LIST_ID = :nominationListId
        WHERE ROUND_NUMBER = :round`,
    postgres: `UPDATE bot_voting_info
          SET nomination_list_id = :nominationListId
        WHERE round_number = :round`,
  } satisfies SqlEntry,

  deleteRound: {
    oracle: `DELETE FROM BOT_VOTING_INFO
        WHERE ROUND_NUMBER = :round`,
    postgres: `DELETE FROM bot_voting_info
        WHERE round_number = :round`,
  } satisfies SqlEntry,
};
