import type { SqlEntry } from "./types.js";

const VOTING_COLS = `ROUND_NUMBER,
                NOMINATION_LIST_ID,
                NEXT_VOTE_AT,
                FIVE_DAY_REMINDER_SENT,
                ONE_DAY_REMINDER_SENT`;

export const BotVotingInfoSql = {
  getAll: {
    oracle: `SELECT ${VOTING_COLS}
         FROM BOT_VOTING_INFO
        ORDER BY ROUND_NUMBER`,
    postgres: ``,
  } satisfies SqlEntry,

  getByRound: {
    oracle: `SELECT ${VOTING_COLS}
         FROM BOT_VOTING_INFO
        WHERE ROUND_NUMBER = :round`,
    postgres: ``,
  } satisfies SqlEntry,

  getCurrentRound: {
    oracle: `SELECT ${VOTING_COLS}
         FROM BOT_VOTING_INFO
        WHERE ROUND_NUMBER = (
          SELECT MAX(ROUND_NUMBER) FROM BOT_VOTING_INFO
        )`,
    postgres: ``,
  } satisfies SqlEntry,

  updateRoundInfo: {
    oracle: `UPDATE BOT_VOTING_INFO
            SET NOMINATION_LIST_ID = :nominationListId,
                NEXT_VOTE_AT = :nextVoteAt
          WHERE ROUND_NUMBER = :round`,
    postgres: ``,
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
    postgres: ``,
  } satisfies SqlEntry,

  markReminderSent: (column: string) =>
    ({
      oracle: `UPDATE BOT_VOTING_INFO
          SET ${column} = 1
        WHERE ROUND_NUMBER = :round`,
      postgres: ``,
    }) satisfies SqlEntry,

  updateNextVoteAt: {
    oracle: `UPDATE BOT_VOTING_INFO
          SET NEXT_VOTE_AT = :nextVoteAt
        WHERE ROUND_NUMBER = :round`,
    postgres: ``,
  } satisfies SqlEntry,

  updateNominationListId: {
    oracle: `UPDATE BOT_VOTING_INFO
          SET NOMINATION_LIST_ID = :nominationListId
        WHERE ROUND_NUMBER = :round`,
    postgres: ``,
  } satisfies SqlEntry,

  deleteRound: {
    oracle: `DELETE FROM BOT_VOTING_INFO
        WHERE ROUND_NUMBER = :round`,
    postgres: ``,
  } satisfies SqlEntry,
};
