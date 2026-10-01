import type { AttachmentBuilder } from "discord.js";
import {
  nominationKindLabel,
  type INominationEntry,
  type NominationKind,
} from "../classes/Nomination.js";
import type { VoteBallot } from "../classes/Vote.js";
import {
  buildNominationAttachments,
  nominationImageStorageKey,
} from "./NominationListComponents.js";

export interface IBallotVoteImage {
  /** The image as a file, when it was not stored; sent along with the panel. */
  files: AttachmentBuilder[];
  voteImageUrl: string | null;
}

/**
 * A voting panel's composed cover image. The main ballot shares the
 * nominations list's stored image, so an unchanged ballot reuses the one
 * already generated; a runoff's tied games are stored under their own key so
 * they never replace it. Unstored (the sandbox), the image goes as a file.
 */
export async function buildBallotVoteImage(
  kind: NominationKind,
  roundNumber: number,
  ballot: VoteBallot,
  nominations: INominationEntry[],
  stored: boolean,
): Promise<IBallotVoteImage> {
  const kindLabel = nominationKindLabel(kind);
  const mainKey = nominationImageStorageKey(kindLabel, roundNumber);
  const storageKey = !stored ? null : ballot === "runoff" ? `${mainKey}-runoff` : mainKey;
  return buildNominationAttachments(kindLabel, roundNumber, nominations, storageKey);
}
