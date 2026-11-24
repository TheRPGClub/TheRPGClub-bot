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
  poolProgressText,
} from "../functions/ChallengeCopy.js";
import { challengePageUrl } from "../config/website.js";
import { plural } from "../utilities/TextUtils.js";
import type { IChallenge, IChallengeRun, IPoolGame } from "./ChallengeApi.js";
import type { IChallengePost } from "./ChallengeAnnouncements.js";
import { commandMention } from "./CommandMentionService.js";
import { payloadChallenge, payloadRun, payloadUserId } from "./ChallengePayloads.js";
import type { IChallengeDm } from "./ChallengeSeasons.js";

// The Pool's DMs (spec api#442, bot#1567). `pool_goal_changed` goes to each member with an
// Active Run when a Pool edit adds Core Games or raises the Optional target, one per save
// (design 2B "One proposal at a time": the change as a card with the first new Core Game's
// cover, the Run's new progress, and the opt-out).

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
