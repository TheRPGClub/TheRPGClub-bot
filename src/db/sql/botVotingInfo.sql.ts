import type { ISqlEntry } from "./types.js";

const VOTING_COLS_PG = `round_number AS "ROUND_NUMBER",
                nomination_list_id AS "NOMINATION_LIST_ID",
                next_vote_at AS "NEXT_VOTE_AT",
                five_day_reminder_sent AS "FIVE_DAY_REMINDER_SENT",
                one_day_reminder_sent AS "ONE_DAY_REMINDER_SENT"`;

export const BotVotingInfoSql = {
  getAll: {
    postgres: `SELECT ${VOTING_COLS_PG}
         FROM bot_voting_info
        ORDER BY round_number`,
  } satisfies ISqlEntry,

  getByRound: {
    postgres: `SELECT ${VOTING_COLS_PG}
         FROM bot_voting_info
        WHERE round_number = :round`,
  } satisfies ISqlEntry,

  getCurrentRound: {
    postgres: `SELECT ${VOTING_COLS_PG}
         FROM bot_voting_info
        WHERE round_number = (
          SELECT MAX(round_number) FROM bot_voting_info
        )`,
  } satisfies ISqlEntry,

  updateRoundInfo: {
    postgres: `UPDATE bot_voting_info
            SET nomination_list_id = :nominationListId,
                next_vote_at = :nextVoteAt
          WHERE round_number = :round`,
  } satisfies ISqlEntry,

  insertRoundInfo: {
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
  } satisfies ISqlEntry,

  markReminderSent: (column: string) =>
    ({
      postgres: `UPDATE bot_voting_info
          SET ${column.toLowerCase()} = true
        WHERE round_number = :round`,
    }) satisfies ISqlEntry,

  updateNextVoteAt: {
    postgres: `UPDATE bot_voting_info
          SET next_vote_at = :nextVoteAt
        WHERE round_number = :round`,
  } satisfies ISqlEntry,

  updateNominationListId: {
    postgres: `UPDATE bot_voting_info
          SET nomination_list_id = :nominationListId
        WHERE round_number = :round`,
  } satisfies ISqlEntry,

  deleteRound: {
    postgres: `DELETE FROM bot_voting_info
        WHERE round_number = :round`,
  } satisfies ISqlEntry,
};
