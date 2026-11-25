import { ContainerBuilder } from "@discordjs/builders";
import {
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputStyle,
  type Client,
  userMention,
} from "discord.js";
import { DateTime } from "luxon";
import {
  GOTY_AWARD_LABELS,
  isGotyAward,
  type GotyAwardKey,
  type IGotyAdminApi,
  type IGotyAdminNomination,
  type IGotyTie,
  type IGotyVoteAdminView,
  type IGotyVoteSchedule,
} from "../services/GotyVoteApi.js";
import { GOTM_NOMINATION_CHANNEL_ID } from "../config/nominationChannels.js";
import { POST_FEATURE_KEYS } from "../config/featureGate.js";
import { DISCORD_SELECT_OPTIONS_MAX } from "../config/textLimits.js";
import { routeFeaturePostFor } from "../services/FeaturePostRouting.js";
import { truncateWithEllipsis } from "../utilities/ValidationUtils.js";
import {
  buildComponentsV2Flags,
  buildTextContainer,
  buildTextDisplay,
  safeV2TextContent,
} from "./ComponentsV2Utils.js";
import type { FeatureState } from "./FeatureGate.js";
import { VOTE_TIME_ZONE } from "./VoteDateUtils.js";
import { buildSelectRow, buildTextInputLabel } from "./uiComponents.js";
import { toUnixTimestamp } from "./DateFormatUtils.js";

/**
 * Pieces of the GOTY Vote admin actions in /admin (bot#1583): date input, the tie prompt,
 * the nomination removal modal and its announcement. Custom ids carry everything a
 * handler needs, so a prompt still works after a restart.
 */

export const GOTY_TIE_SELECT_PREFIX = "admin-goty-tie-v1";
export const GOTY_NOM_DEL_MODAL_PREFIX = "admin-goty-nom-del-reason-v1";
export const GOTY_NOM_DEL_REASON_INPUT_ID = "admin-goty-nom-del-reason-input";
/** The API's limit on a removal reason (NominationsController::REMOVAL_REASON_MAX). */
export const GOTY_NOM_DEL_REASON_MAX = 250;

export const GOTY_TIE_SELECT_ID_PATTERN =
  /^admin-goty-tie-v1:\d{4}:(gotm|nr_gotm|game_of_the_year)$/;
export const GOTY_NOM_DEL_MODAL_ID_PATTERN = /^admin-goty-nom-del-reason-v1:\d{4}:\d+$/;

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export type GotyDateField = "nominationsOpenAt" | "votingOpensAt" | "votingClosesAt";

/** What a date without a time means for each date, matching the default schedule. */
const DATE_ONLY_TIME: Readonly<Record<GotyDateField, (day: DateTime) => DateTime>> = {
  nominationsOpenAt: (day) => day.startOf("day"),
  votingOpensAt: (day) => day.set({ hour: 12, minute: 0, second: 0, millisecond: 0 }),
  votingClosesAt: (day) => day.endOf("day"),
};

const DATE_TIME_FORMATS = [
  "yyyy-MM-dd HH:mm",
  "yyyy-MM-dd'T'HH:mm",
  "yyyy-MM-dd h:mm a",
  "yyyy-MM-dd ha",
  "M/d/yyyy HH:mm",
  "M/d/yyyy h:mm a",
];
const DATE_FORMATS = ["yyyy-MM-dd", "M/d/yyyy", "M-d-yyyy", "MMMM d, yyyy", "MMM d, yyyy"];

/**
 * A GOTY Vote date typed by an admin, in America/New_York. A date with a time is taken
 * as given; a date alone takes the default schedule's time for that date: nominations
 * open at midnight, voting opens at noon, voting closes at the end of the day.
 */
export function parseGotyDateInput(input: string, field: GotyDateField): Date | null {
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  for (const format of DATE_TIME_FORMATS) {
    const parsed = DateTime.fromFormat(trimmed, format, { zone: VOTE_TIME_ZONE });
    if (parsed.isValid) return parsed.toUTC().toJSDate();
  }
  for (const format of DATE_FORMATS) {
    const parsed = DateTime.fromFormat(trimmed, format, { zone: VOTE_TIME_ZONE });
    if (parsed.isValid) return DATE_ONLY_TIME[field](parsed).toUTC().toJSDate();
  }
  return null;
}

export const GOTY_DATE_LABELS: Readonly<Record<GotyDateField, string>> = {
  nominationsOpenAt: "nominations-open",
  votingOpensAt: "voting-open",
  votingClosesAt: "voting-close",
};

/** "Nominations for GOTY Vote 2027 open <date>.", for a GOTY Vote still upcoming. */
export function upcomingNominationsText(vote: IGotyVoteSchedule): string {
  return `Nominations for ${vote.name} open <t:${toUnixTimestamp(vote.nominationsOpenAt)}:F>.`;
}

export function describeGotySchedule(vote: IGotyVoteSchedule): string {
  const at = (date: Date): string => `<t:${toUnixTimestamp(date)}:F>`;
  return [
    `Nominations open: ${at(vote.nominationsOpenAt)}`,
    `Voting opens: ${at(vote.votingOpensAt)}`,
    `Voting closes: ${at(vote.votingClosesAt)}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Which GOTY Vote
// ---------------------------------------------------------------------------

export const NO_GOTY_VOTE = "No GOTY Vote is under way. The sweep creates each year's on " +
  "January 1. Name a year to act on a decided one.";

/**
 * The year an admin action works on: the one given, else the Current GOTY Vote's (the
 * API's rule, so January works on last year's vote while it takes nominations or votes).
 * Null when no GOTY Vote is undecided.
 */
export async function resolveGotyYear(
  api: IGotyAdminApi,
  year: number | undefined,
): Promise<number | null> {
  if (year !== undefined) return year;
  return (await api.current())?.year ?? null;
}

/** Why there is no GOTY Vote to act on: none for the year given, or none undecided. */
export function missingGotyVoteText(year: number | undefined): string {
  return year === undefined ? NO_GOTY_VOTE : `There is no GOTY Vote ${year}.`;
}

/** The GOTY Vote an admin action shows: the year given (null on 404), else the Current one. */
export function loadGotyVote(
  api: IGotyAdminApi,
  year: number | undefined,
): Promise<IGotyVoteAdminView | null> {
  return year === undefined ? api.current() : api.getVote(year);
}

// ---------------------------------------------------------------------------
// Tie prompt
// ---------------------------------------------------------------------------

export function buildGotyTieSelectId(year: number, award: GotyAwardKey): string {
  return `${GOTY_TIE_SELECT_PREFIX}:${year}:${award}`;
}

export function parseGotyTieSelectId(
  customId: string,
): { year: number; award: GotyAwardKey } | null {
  const [prefix, year, award] = customId.split(":");
  if (prefix !== GOTY_TIE_SELECT_PREFIX || !/^\d{4}$/.test(year ?? "")) return null;
  if (!isGotyAward(award)) return null;
  return { year: Number(year), award };
}

function buildTieContainer(year: number, tie: IGotyTie): ContainerBuilder {
  const text = `**${tie.name}** is tied between ` +
    `${tie.games.map((game) => game.title).join(", ")}. Pick the winner.`;
  const container = new ContainerBuilder()
    .addTextDisplayComponents(buildTextDisplay(safeV2TextContent(text, 1000)));
  const select = new StringSelectMenuBuilder()
    .setCustomId(buildGotyTieSelectId(year, tie.award))
    .setPlaceholder(truncateWithEllipsis(`Pick the ${tie.name} winner`, 150))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(tie.games.slice(0, DISCORD_SELECT_OPTIONS_MAX).map((game) => ({
      label: truncateWithEllipsis(game.title, 100),
      value: String(game.id),
    })));
  container.addActionRowComponents(buildSelectRow(select).toJSON());
  return container;
}

/**
 * The tie prompt for a GOTY Vote: a heading (with `lead`, e.g. who just picked what), then
 * a select per Award still tied. With no ties left it says so and lists the winners.
 */
export function buildGotyTiePrompt(
  vote: IGotyVoteAdminView,
  lead?: string,
): ContainerBuilder[] {
  const lines = [`## ${vote.name}: tie-break`];
  if (lead) lines.push(lead);
  if (vote.ties.length === 0) {
    lines.push(vote.decidedAt
      ? `${vote.name} is decided. The results post on their own.`
      : `${vote.name} has no tie waiting for an admin (phase: ${vote.phase}).`);
    if (vote.phase === "upcoming") lines.push(upcomingNominationsText(vote));
    if (vote.winners.length > 0) {
      lines.push(...vote.winners.map((winner) => `${winner.name}: ${winner.game.title}`));
    }
  } else if (vote.phase === "runoff") {
    lines.push("The runoff is still open. Picking a winner now settles that Award early.");
  }
  return [
    buildTextContainer(safeV2TextContent(lines.join("\n"), 3500)),
    ...vote.ties.map((tie) => buildTieContainer(vote.year, tie)),
  ];
}

// ---------------------------------------------------------------------------
// Nomination removal
// ---------------------------------------------------------------------------

export function buildGotyNomDeleteModalId(year: number, nominationId: number): string {
  return `${GOTY_NOM_DEL_MODAL_PREFIX}:${year}:${nominationId}`;
}

export function parseGotyNomDeleteModalId(
  customId: string,
): { year: number; nominationId: number } | null {
  const [prefix, year, id] = customId.split(":");
  if (prefix !== GOTY_NOM_DEL_MODAL_PREFIX || !/^\d{4}$/.test(year ?? "")) return null;
  const nominationId = Number(id);
  if (!Number.isInteger(nominationId) || nominationId <= 0) return null;
  return { year: Number(year), nominationId };
}

/**
 * The reason modal. It is built from the picked choice alone (no API read), since a modal
 * must be the interaction's first response within 3 seconds; the submit re-reads the
 * nomination before removing it.
 */
export function buildGotyNomDeleteModal(year: number, nominationId: number): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(buildGotyNomDeleteModalId(year, nominationId))
    .setTitle(`Delete GOTY Vote ${year} nomination`)
    .addLabelComponents(buildTextInputLabel({
      customId: GOTY_NOM_DEL_REASON_INPUT_ID,
      label: "Deletion reason",
      style: TextInputStyle.Paragraph,
      maxLength: GOTY_NOM_DEL_REASON_MAX,
      placeholder: "Why should this nomination be removed?",
    }));
}

/** An autocomplete choice's value: the nomination's year and id, `<year>:<id>`. */
export function buildGotyNominationChoiceValue(nomination: IGotyAdminNomination): string {
  return `${nomination.year}:${nomination.id}`;
}

/** A picked choice back to its year and id; null for a value not picked from the list. */
export function parseGotyNominationChoiceValue(
  raw: string,
): { year: number; nominationId: number } | null {
  const match = /^(\d{4}):(\d+)$/.exec(raw.trim());
  if (!match) return null;
  const nominationId = Number(match[2]);
  if (!Number.isSafeInteger(nominationId) || nominationId <= 0) return null;
  return { year: Number(match[1]), nominationId };
}

/** An autocomplete choice for a nomination: the game and who nominated it. */
export function gotyNominationChoiceName(nomination: IGotyAdminNomination): string {
  const title = nomination.gameTitle ?? `Game ${nomination.gameId}`;
  const who = nomination.userName ?? nomination.userId;
  return truncateWithEllipsis(`${title} (${who})`, 100);
}

export function filterGotyNominationChoices(
  nominations: IGotyAdminNomination[],
  query: string,
): { name: string; value: string }[] {
  const needle = query.trim().toLowerCase();
  return nominations
    .filter((nomination) => !needle ||
      gotyNominationChoiceName(nomination).toLowerCase().includes(needle))
    .slice(0, DISCORD_SELECT_OPTIONS_MAX)
    .map((nomination) => ({
      name: gotyNominationChoiceName(nomination),
      value: buildGotyNominationChoiceValue(nomination),
    }));
}

/** The removal notice, worded as the GOTM one is (buildNominationDeletedNotice). */
export function buildGotyNominationDeletedNotice(
  year: number,
  deletedByUserId: string,
  nominatorUserId: string,
  gameTitle: string | null,
  reason: string,
): string {
  const game = gameTitle ? ` "${gameTitle}"` : "";
  return `${userMention(deletedByUserId)} deleted ${userMention(nominatorUserId)}'s ` +
    `GOTY Vote ${year} Game of the Year nomination${game}. Reason: ${reason}`;
}

/** The year's Game of the Year nominations, one line per game with its nominators. */
export function buildGotyNominationListText(
  year: number,
  nominations: IGotyAdminNomination[],
): string {
  const heading = `## GOTY Vote ${year}: ${GOTY_AWARD_LABELS.game_of_the_year} nominations`;
  if (nominations.length === 0) return `${heading}\nNo nominations yet.`;
  const byGame = new Map<number, { title: string; userIds: string[] }>();
  for (const nomination of nominations) {
    const entry = byGame.get(nomination.gameId) ??
      { title: nomination.gameTitle ?? `Game ${nomination.gameId}`, userIds: [] };
    entry.userIds.push(nomination.userId);
    byGame.set(nomination.gameId, entry);
  }
  const lines = [...byGame.values()].map((entry, index) =>
    `${index + 1}. ${entry.title} (${entry.userIds.map((id) => userMention(id)).join(", ")})`);
  return [heading, ...lines].join("\n");
}

/** The removal post: the notice, then the year's list when it could be read. */
export function buildGotyNominationChangeComponents(
  year: number,
  content: string,
  nominations: IGotyAdminNomination[] | null,
): ContainerBuilder[] {
  const notice = buildTextContainer(safeV2TextContent(content, 3500));
  if (!nominations) return [notice];
  const list = buildGotyNominationListText(year, nominations);
  return [notice, buildTextContainer(safeV2TextContent(list, 3500))];
}

/**
 * Posts a removal notice and the refreshed list in the GOTM nomination channel, where the
 * GOTY Vote Feature routes it (the bot-dev channel in Preview, nowhere while Off). No
 * pings. `featureState` is a bot job's read; omitted, it is read here. `nominations` null
 * (the list could not be read) posts the notice alone, rather than a wrong empty list.
 */
export async function postGotyNominationChange(
  client: Client,
  year: number,
  content: string,
  nominations: IGotyAdminNomination[] | null,
  featureState?: FeatureState | null,
): Promise<void> {
  const channelId = await routeFeaturePostFor(
    POST_FEATURE_KEYS.gotyVote,
    GOTM_NOMINATION_CHANNEL_ID,
    { state: featureState },
  );
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isSendable()) {
    throw new Error(`Nomination channel ${channelId} is missing or the bot cannot post in it.`);
  }
  await channel.send({
    components: buildGotyNominationChangeComponents(year, content, nominations),
    flags: buildComponentsV2Flags(false),
    allowedMentions: { parse: [] },
  });
}
