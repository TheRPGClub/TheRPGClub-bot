import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  SectionBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import { ButtonStyle, MessageFlags } from "discord-api-types/v10";
import { buildDivider, buildTextDisplay } from "../functions/ComponentsV2Utils.js";
import {
  CHALLENGE_FORMAT_INKS,
  escapeChallengeText,
  listJoin,
  memberName,
  poolProgressText,
} from "../functions/ChallengeCopy.js";
import { buildChallengeProposalId } from "../functions/ChallengeCustomIds.js";
import { challengePageUrl } from "../config/website.js";
import { plural } from "../utilities/TextUtils.js";
import type { IChallenge, IChallengeRun, IPoolGame } from "./ChallengeApi.js";
import type { IChallengePost } from "./ChallengeAnnouncements.js";
import { commandMention } from "./CommandMentionService.js";
import { payloadChallenge, payloadRun, payloadUserId } from "./ChallengePayloads.js";
import type { IChallengeDm } from "./ChallengeSeasons.js";
import type { IPoolProposal } from "./ChallengeProposalApi.js";

// The Pool's DMs (spec api#442, bot#1567 and bot#1569), in design 2B "One proposal at a
// time": each a card with the game's cover. `pool_goal_changed` goes to each member with an
// Active Run when a Pool edit adds Core Games or raises the Optional target, one per save
// (the change, the Run's new progress, and the opt-out). `pool_proposal` tells the Host
// about a new Pool Proposal, or, for a club-hosted Challenge, is posted in #dev instead;
// `pool_proposal_accepted` tells the proposer theirs joined the Pool.

/** A raised Optional target, as the payload's `optional_target`. */
export interface ITargetChange {
  from: number;
  to: number;
}

function payloadGames(payload: Record<string, unknown>, key: string): IPoolGame[] {
  const games = payload[key];
  if (!Array.isArray(games)) return [];
  return games.filter((game): game is IPoolGame =>
    !!game && typeof game === "object" &&
    typeof (game as IPoolGame).game_id === "number" &&
    typeof (game as IPoolGame).title === "string");
}

function payloadTargetChange(payload: Record<string, unknown>): ITargetChange | null {
  const change = payload.optional_target as Partial<ITargetChange> | null | undefined;
  if (!change || typeof change !== "object") return null;
  const { from, to } = change;
  return typeof from === "number" && typeof to === "number" ? { from, to } : null;
}

/** "one more Core Game", "2 more Core Games". */
function more(count: number, noun: string): string {
  return count === 1 ? `one more ${noun}` : plural(count, `more ${noun}`);
}

/**
 * The goal-change DM: what the edit asks for now (each change on its own line), the Run's
 * progress against the new goal, a link to the Challenge, and the opt-out.
 */
export function buildPoolGoalChangedDm(
  challenge: IChallenge,
  run: IChallengeRun,
  change: { addedCore: readonly IPoolGame[]; target: ITargetChange | null },
): IChallengePost {
  const { addedCore, target } = change;
  const raisedBy = target ? Math.max(0, target.to - target.from) : 0;
  const asks = [
    addedCore.length ? more(addedCore.length, "Core Game") : null,
    raisedBy ? more(raisedBy, "Optional Game") : null,
  ].filter((part): part is string => part !== null);
  const name = escapeChallengeText(challenge.name);
  const changes: string[] = [];
  if (addedCore.length) {
    const titles = listJoin(addedCore.map((g) => `**${escapeChallengeText(g.title)}**`));
    changes.push(`> ${addedCore.length === 1 ? "New Core Game" : "New Core Games"}: ${titles}`);
  }
  if (target) changes.push(`> Optional Games to Clear: ${target.from} → ${target.to}`);
  const progress = poolProgressText(run.progress) ??
    `${run.progress.cleared} of ${run.progress.target} Cleared`;
  const text = buildTextDisplay([
    "### Your goal changed",
    asks.length ? `**${name}** now asks for ${listJoin(asks)}.` : `**${name}** changed its goal.`,
    ...changes,
    `Your Run: **${progress}**`,
  ].join("\n"));

  const container = new ContainerBuilder().setAccentColor(CHALLENGE_FORMAT_INKS.pool);
  const cover = addedCore.find((g) => !!g.cover_url)?.cover_url;
  if (cover) {
    const section = new SectionBuilder().addTextDisplayComponents(text);
    section.setThumbnailAccessory(new ThumbnailBuilder().setURL(cover));
    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(text);
  }
  container
    .addSeparatorComponents(buildDivider())
    .addTextDisplayComponents(buildTextDisplay(
      "-# You get this because you have a Run. Turn Challenge DMs off with " +
        `${commandMention("challenge dms")}.`,
    ));
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setURL(challengePageUrl(challenge.id))
      .setLabel("Open the Challenge")
      .setStyle(ButtonStyle.Link),
  );
  return {
    components: [container.toJSON(), row.toJSON()],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

/**
 * Payload `{ event: "pool_goal_changed", user_id, challenge, run, added_core_games,
 * optional_target, feature_key }`: the DM to a member whose Active Run's goal grew. The
 * API sends it only to members who keep Challenge DMs on.
 */
export async function poolGoalChangedDm(
  payload: Record<string, unknown>,
): Promise<IChallengeDm> {
  const userId = payloadUserId(payload);
  const challenge = payloadChallenge(payload);
  const run = payloadRun(payload);
  const addedCore = payloadGames(payload, "added_core_games");
  const target = payloadTargetChange(payload);
  return {
    userId,
    post: buildPoolGoalChangedDm(challenge, run, { addedCore, target }),
    about: `the goal change for "${challenge.name}" (Run ${run.id})`,
  };
}

/** The `proposal` of a job payload. */
function payloadProposal(payload: Record<string, unknown>): IPoolProposal {
  const proposal = payload.proposal as Partial<IPoolProposal> | undefined;
  if (
    !proposal || typeof proposal !== "object" || typeof proposal.id !== "number" ||
    !proposal.game || typeof proposal.game.title !== "string" ||
    !proposal.proposer || typeof proposal.proposer.user_id !== "string"
  ) {
    throw new Error(
      `Invalid payload: proposal must be a Pool Proposal, got ${JSON.stringify(proposal)}.`,
    );
  }
  return proposal as IPoolProposal;
}

/** The proposer's note as a quote, or nothing. */
function noteLines(proposal: IPoolProposal): string[] {
  const note = proposal.note?.trim();
  if (!note) return [];
  return note.split("\n").map((line) => `> ${escapeChallengeText(line)}`);
}

/** A Pool card: the text with the game's cover beside it when it has one. */
function poolCard(text: string, coverUrl: string | null | undefined): ContainerBuilder {
  const container = new ContainerBuilder().setAccentColor(CHALLENGE_FORMAT_INKS.pool);
  const display = buildTextDisplay(text);
  if (coverUrl) {
    const section = new SectionBuilder().addTextDisplayComponents(display);
    section.setThumbnailAccessory(new ThumbnailBuilder().setURL(coverUrl));
    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(display);
  }
  return container;
}

function openChallengeButton(challengeId: number): ButtonBuilder {
  return new ButtonBuilder()
    .setURL(challengePageUrl(challengeId))
    .setLabel("Open the Challenge")
    .setStyle(ButtonStyle.Link);
}

/** Opens the proposals one at a time, as a new private reply. */
function decideButton(challengeId: number): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildChallengeProposalId({ action: "view", ids: [challengeId, 1], reply: "new" }))
    .setLabel("Decide")
    .setStyle(ButtonStyle.Primary);
}

function post(container: ContainerBuilder, buttons: ButtonBuilder[]): IChallengePost {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
  return {
    components: [container.toJSON(), row.toJSON()],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

/**
 * The Host's DM about a new Pool Proposal: who proposed what, their note, how many wait
 * (when the payload knows), a Decide button, and the opt-out.
 */
export function buildPoolProposalDm(challenge: IChallenge, proposal: IPoolProposal):
  IChallengePost {
  const waiting = challenge.pending_proposals ?? 0;
  const lines = [
    "### New Pool Proposal",
    `<@${proposal.proposer.user_id}> proposed **${escapeChallengeText(proposal.game.title)}** ` +
      `for **${escapeChallengeText(challenge.name)}**.`,
    ...noteLines(proposal),
  ];
  if (waiting > 1) lines.push(`${plural(waiting, "proposal")} are waiting.`);
  const container = poolCard(lines.join("\n"), proposal.game.cover_url)
    .addSeparatorComponents(buildDivider())
    .addTextDisplayComponents(buildTextDisplay(
      "-# You get this because you host this Challenge. Turn Challenge DMs off with " +
        `${commandMention("challenge dms")}.`,
    ));
  return post(container, [decideButton(challenge.id), openChallengeButton(challenge.id)]);
}

/** The proposer's DM: their game joined the Pool, as what, and who accepted it. */
export function buildPoolProposalAcceptedDm(challenge: IChallenge, proposal: IPoolProposal):
  IChallengePost {
  const core = proposal.accepted_as === "core";
  const title = escapeChallengeText(proposal.game.title);
  const name = escapeChallengeText(challenge.name);
  const by = proposal.decider ? ` ${escapeChallengeText(memberName(proposal.decider))} ` +
    "accepted it." : "";
  const lines = [
    "### Proposal accepted",
    `**${title}** is now ${core ? "a Core Game" : "an Optional Game"} in **${name}**.${by}`,
    core
      ? "-# Every Run must Clear it now."
      : "-# If you have a Run, Clearing it counts.",
  ];
  return post(poolCard(lines.join("\n"), proposal.game.cover_url), [
    openChallengeButton(challenge.id),
  ]);
}

/**
 * A club-hosted Challenge's Pool Proposal, posted in #dev instead of a DM: the game, the
 * Challenge, who proposed it and their note. Staff decide where they see the whole Pool.
 */
export function buildPoolProposalDevPost(challenge: IChallenge, proposal: IPoolProposal):
  IChallengePost {
  const lines = [
    "### Pool Proposal · club-hosted",
    `**${escapeChallengeText(proposal.game.title)}**`,
    `for **${escapeChallengeText(challenge.name)}**, from <@${proposal.proposer.user_id}>`,
    ...noteLines(proposal),
    `-# Any Moderator or above can decide on the website or with ` +
      `${commandMention("challenge proposals")}.`,
  ];
  // A link, not a Decide button: #dev only lets the dev role use controls, and staff
  // decide where they can see the whole Pool (design 2B).
  return post(poolCard(lines.join("\n"), proposal.game.cover_url), [
    openChallengeButton(challenge.id),
  ]);
}

/** Whether a `pool_proposal` payload is for a club-hosted Challenge, so goes to #dev. */
export function isClubHostedProposal(payload: Record<string, unknown>): boolean {
  return payload.event === "pool_proposal" && payload.club_hosted === true;
}

/**
 * Payload `{ event: "pool_proposal", club_hosted: false, user_id, challenge, proposal }`:
 * the DM to the Host. The API sends it only when the Host keeps Challenge DMs on.
 */
export async function poolProposalDm(payload: Record<string, unknown>): Promise<IChallengeDm> {
  const userId = payloadUserId(payload);
  const challenge = payloadChallenge(payload);
  const proposal = payloadProposal(payload);
  return {
    userId,
    post: buildPoolProposalDm(challenge, proposal),
    about: `the Pool Proposal of "${proposal.game.title}" for "${challenge.name}"`,
  };
}

/**
 * Payload `{ event: "pool_proposal", club_hosted: true, challenge, proposal }` (no
 * user_id): the #dev post, and what it is for the job's result.
 */
export function poolProposalDevPost(payload: Record<string, unknown>):
  { post: IChallengePost; about: string } {
  const challenge = payloadChallenge(payload);
  const proposal = payloadProposal(payload);
  return {
    post: buildPoolProposalDevPost(challenge, proposal),
    about: `the Pool Proposal of "${proposal.game.title}" for "${challenge.name}"`,
  };
}

/**
 * Payload `{ event: "pool_proposal_accepted", user_id, challenge, proposal }`: the DM to the
 * proposer. The API sends it only when they keep Challenge DMs on.
 */
export async function poolProposalAcceptedDm(
  payload: Record<string, unknown>,
): Promise<IChallengeDm> {
  const userId = payloadUserId(payload);
  const challenge = payloadChallenge(payload);
  const proposal = payloadProposal(payload);
  return {
    userId,
    post: buildPoolProposalAcceptedDm(challenge, proposal),
    about: `the acceptance of "${proposal.game.title}" for "${challenge.name}"`,
  };
}
