import { apiGet, apiPost, apiPatch, apiDelete } from "../services/RpgClubApiClient.js";

export interface IBotVotingInfoEntry {
  roundNumber: number;
  nominationListId: number | null;
  nextVoteAt: Date;
  fiveDayReminderSent: boolean;
  oneDayReminderSent: boolean;
  voteEndsAt: Date | null;
  voteDeadline: Date | null;
  votingOpen: boolean;
  votingEnded: boolean;
}

type VotingInfoApiData = {
  round_number: number;
  nomination_list_id: number | null;
  next_vote_at: string;
  five_day_reminder_sent: boolean;
  one_day_reminder_sent: boolean;
  vote_ends_at: string | null;
  vote_deadline: string | null;
  voting_open: boolean;
  voting_ended: boolean;
};

type VotingInfoResponse = { data: VotingInfoApiData };
type VotingInfoListResponse = { data: VotingInfoApiData[] };

function mapApiData(d: VotingInfoApiData): IBotVotingInfoEntry {
  return {
    roundNumber: Number(d.round_number),
    nominationListId: d.nomination_list_id != null ? Number(d.nomination_list_id) : null,
    nextVoteAt: new Date(d.next_vote_at),
    fiveDayReminderSent: Boolean(d.five_day_reminder_sent),
    oneDayReminderSent: Boolean(d.one_day_reminder_sent),
    voteEndsAt: d.vote_ends_at ? new Date(d.vote_ends_at) : null,
    voteDeadline: d.vote_deadline ? new Date(d.vote_deadline) : null,
    votingOpen: Boolean(d.voting_open),
    votingEnded: Boolean(d.voting_ended),
  };
}

function normalizeRoundNumber(roundNumber: number): number {
  const r = Number(roundNumber);
  if (!Number.isFinite(r) || r <= 0) {
    throw new Error("Invalid round number for BOT_VOTING_INFO.");
  }
  return r;
}

function normalizeDate(value: Date | string): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error("Invalid Date value for NEXT_VOTE_AT.");
    }
    return value;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Invalid date string for NEXT_VOTE_AT.");
  }
  return d;
}

export default class BotVotingInfo {
  static async getAll(): Promise<IBotVotingInfoEntry[]> {
    const response = await apiGet<VotingInfoListResponse>("/api/v1/voting_info");
    return (response?.data ?? []).map(mapApiData);
  }

  static async getByRound(roundNumber: number): Promise<IBotVotingInfoEntry | null> {
    const round = normalizeRoundNumber(roundNumber);
    const response = await apiGet<VotingInfoResponse>(`/api/v1/voting_info/${round}`);
    return response ? mapApiData(response.data) : null;
  }

  static async getCurrentRound(): Promise<IBotVotingInfoEntry | null> {
    const response = await apiGet<VotingInfoResponse>("/api/v1/voting_info/current");
    return response ? mapApiData(response.data) : null;
  }

  static async setRoundInfo(
    roundNumber: number,
    nextVoteAt: Date | string,
    nominationListId: number | null,
  ): Promise<void> {
    const round = normalizeRoundNumber(roundNumber);
    const nextVote = normalizeDate(nextVoteAt);
    // Re-dating a round restarts its reminder cycle. The row may already exist
    // when voting was opened first-party (openVotingRound suppresses the
    // nomination reminders), so the flags must be reset explicitly here.
    const body = {
      nomination_list_id: nominationListId,
      next_vote_at: nextVote.toISOString(),
      five_day_reminder_sent: false,
      one_day_reminder_sent: false,
    };
    const updated = await apiPatch<VotingInfoResponse>(`/api/v1/voting_info/${round}`, {
      data: body,
    });
    if (!updated) {
      await apiPost<VotingInfoResponse>("/api/v1/voting_info", {
        data: { round_number: round, ...body },
      });
    }
  }

  /**
   * Upserts the voting_info row that opens first-party voting for a round.
   * The API treats next_vote_at as the round's vote-open instant, so creating
   * this row is what opens the round's voting window server-side. Reminder
   * flags are set so the nomination reminder service does not fire stale
   * reminders against the just-opened round.
   */
  static async openVotingRound(
    roundNumber: number,
    opensAt: Date | string,
  ): Promise<void> {
    const round = normalizeRoundNumber(roundNumber);
    const opens = normalizeDate(opensAt);
    const body = {
      next_vote_at: opens.toISOString(),
      five_day_reminder_sent: true,
      one_day_reminder_sent: true,
    };
    const updated = await apiPatch<VotingInfoResponse>(`/api/v1/voting_info/${round}`, {
      data: body,
    });
    if (!updated) {
      await apiPost<VotingInfoResponse>("/api/v1/voting_info", {
        data: { round_number: round, ...body },
      });
    }
  }

  /** Overrides the round's default (Sunday) voting deadline, e.g. to close early. */
  static async updateVoteEndsAt(
    roundNumber: number,
    voteEndsAt: Date | string,
  ): Promise<void> {
    const round = normalizeRoundNumber(roundNumber);
    const endsAt = normalizeDate(voteEndsAt);
    const result = await apiPatch<VotingInfoResponse>(`/api/v1/voting_info/${round}`, {
      data: { vote_ends_at: endsAt.toISOString() },
    });
    if (!result) {
      throw new Error(
        `No voting_info record found for round ${round} when updating vote_ends_at.`,
      );
    }
  }

  static async markReminderSent(
    roundNumber: number,
    reminder: "fiveDay" | "oneDay",
  ): Promise<void> {
    const round = normalizeRoundNumber(roundNumber);
    const field = reminder === "fiveDay" ? "five_day_reminder_sent" : "one_day_reminder_sent";
    const result = await apiPatch<VotingInfoResponse>(`/api/v1/voting_info/${round}`, {
      data: { [field]: true },
    });
    if (!result) {
      throw new Error(`No voting_info record found for round ${round} when marking ${field}.`);
    }
  }

  static async updateNextVoteAt(
    roundNumber: number,
    nextVoteAt: Date | string,
  ): Promise<void> {
    const round = normalizeRoundNumber(roundNumber);
    const nextVote = normalizeDate(nextVoteAt);
    const result = await apiPatch<VotingInfoResponse>(`/api/v1/voting_info/${round}`, {
      data: { next_vote_at: nextVote.toISOString() },
    });
    if (!result) {
      throw new Error(
        `No voting_info record found for round ${round} when updating next_vote_at.`,
      );
    }
  }

  static async updateNominationListId(
    roundNumber: number,
    nominationListId: number | null,
  ): Promise<void> {
    const round = normalizeRoundNumber(roundNumber);
    const result = await apiPatch<VotingInfoResponse>(`/api/v1/voting_info/${round}`, {
      data: { nomination_list_id: nominationListId },
    });
    if (!result) {
      throw new Error(
        `No voting_info record found for round ${round} when updating nomination_list_id.`,
      );
    }
  }

  static async deleteRound(roundNumber: number): Promise<number> {
    const round = normalizeRoundNumber(roundNumber);
    const result = await apiDelete<{ deleted: boolean }>(`/api/v1/voting_info/${round}`);
    return result?.deleted ? 1 : 0;
  }
}
