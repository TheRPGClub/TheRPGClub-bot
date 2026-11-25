import { ButtonStyle, escapeMarkdown, type ActionRowBuilder } from "discord.js";
import { ContainerBuilder, type ButtonBuilder } from "@discordjs/builders";
import axios from "axios";
import {
  buildComponentsV2Flags,
  buildDivider,
  buildTextDisplay,
} from "../functions/ComponentsV2Utils.js";
import { buildActionButton, buildButtonRow } from "../functions/uiComponents.js";
import { toUnixTimestamp } from "../functions/DateFormatUtils.js";
import { DISCORD_BUTTON_LABEL_MAX } from "../config/textLimits.js";
import { GOTY_NOMINATION_WITHDRAW_PREFIX } from "../config/customIdPrefixes.js";
import { gotyPageUrl } from "../config/website.js";
import { buildApiErrorMessage, buildApiRefusalMessage } from "../utilities/ApiErrorUtils.js";
import { validateCustomId } from "../utilities/CustomIdUtils.js";
import { isPositiveInt, truncateWithEllipsis } from "../utilities/ValidationUtils.js";
import { plural } from "../utilities/TextUtils.js";
import type {
  IGotyEligibility,
  IGotyNomination,
  IGotyVoteApi,
  IGotyVoteSummary,
} from "./GotyVoteApi.js";

// /goty nominate and /goty nominations (bot#1580): Game of the Year nominations, with no
// reason, up to three per member. The API owns every rule (window, eligibility, cap); the
// bot shows its refusals as given. Withdraw buttons sit only on the member's own private
// view, and a press re-checks through the API that the nomination is theirs, so the ids
// alone (year, nomination, which view) carry everything a press needs across restarts.

/** The API's cap (Goty::Nominate::CAP); it does not send it, so the count line uses this. */
export const GOTY_NOMINATION_CAP = 3;

/** Which view a Withdraw press redraws: all nominations, or the member's own. */
export type GotyNominationsScope = "all" | "mine";

const SCOPE_SEGMENT: Record<GotyNominationsScope, string> = { all: "a", mine: "m" };

/** Room for the nominations list inside one Components V2 message. */
const LIST_TEXT_BUDGET = 3000;

export interface IGotyWithdrawTarget {
  year: number;
  nominationId: number;
  scope: GotyNominationsScope;
}

export function buildGotyWithdrawId(target: IGotyWithdrawTarget): string {
  return validateCustomId(
    `${GOTY_NOMINATION_WITHDRAW_PREFIX}:${target.year}:${target.nominationId}:` +
      SCOPE_SEGMENT[target.scope],
  );
}

export function parseGotyWithdrawId(customId: string): IGotyWithdrawTarget | null {
  const [prefix, rawYear, rawId, rawScope] = customId.split(":");
  if (prefix !== GOTY_NOMINATION_WITHDRAW_PREFIX) return null;
  const year = Number(rawYear);
  const nominationId = Number(rawId);
  const scope = rawScope === "a" ? "all" : rawScope === "m" ? "mine" : null;
  if (!isPositiveInt(year) || !isPositiveInt(nominationId) || !scope) return null;
  return { year, nominationId, scope };
}

/**
 * The GOTY Vote nominations are about: the one taking nominations, else the newest still
 * under way, else the newest. Null when the club has none yet.
 */
export function pickNominationsGotyVote(votes: IGotyVoteSummary[]): IGotyVoteSummary | null {
  return votes.find((vote) => vote.nominations_open) ??
    votes.find((vote) => vote.phase !== "decided") ??
    votes[0] ??
    null;
}

function discordTime(iso: string, style: "F" | "R"): string {
  return `<t:${toUnixTimestamp(new Date(iso))}:${style}>`;
}

function gameTitle(nomination: IGotyNomination): string {
  return nomination.game?.title ?? `Game #${nomination.gamedb_game_id}`;
}

/** Why nominations are not open for `vote`, or null while they are. */
export function nominationsClosedText(vote: IGotyVoteSummary): string | null {
  if (vote.nominations_open) return null;
  const when = (iso: string): string => `${discordTime(iso, "F")} (${discordTime(iso, "R")})`;
  if (vote.phase === "upcoming") {
    return `Game of the Year nominations for ${vote.name} open ${when(vote.nominations_open_at)}.`;
  }
  return `Game of the Year nominations for ${vote.name} are closed: they ended when voting ` +
    `opened ${discordTime(vote.voting_opens_at, "F")}.`;
}

function windowText(vote: IGotyVoteSummary): string {
  return vote.nominations_open
    ? `Nominations close when voting opens ${discordTime(vote.voting_opens_at, "F")} ` +
      `(${discordTime(vote.voting_opens_at, "R")}).`
    : nominationsClosedText(vote) ?? "";
}

/** "You have used 2 of your 3 nominations." */
export function usedText(count: number): string {
  return `You have used ${count} of your ${GOTY_NOMINATION_CAP} nominations.`;
}

/** A private Components V2 message: a reply, or a view update. */
export interface IGotyNominationsView {
  components: (ContainerBuilder | ActionRowBuilder<ButtonBuilder>)[];
  flags: number;
  allowedMentions: { parse: [] };
}

function view(
  body: ContainerBuilder,
  rows: ActionRowBuilder<ButtonBuilder>[] = [],
): IGotyNominationsView {
  return {
    components: [body, ...rows],
    flags: buildComponentsV2Flags(true),
    allowedMentions: { parse: [] },
  };
}

function withdrawRow(
  vote: IGotyVoteSummary,
  own: IGotyNomination[],
  scope: GotyNominationsScope,
): ActionRowBuilder<ButtonBuilder>[] {
  if (!vote.nominations_open || !own.length) return [];
  const buttons = own.slice(0, GOTY_NOMINATION_CAP).map((nomination) =>
    buildActionButton({
      customId: buildGotyWithdrawId({ year: vote.year, nominationId: nomination.id, scope }),
      label: truncateWithEllipsis(`Withdraw ${gameTitle(nomination)}`, DISCORD_BUTTON_LABEL_MAX),
      style: ButtonStyle.Secondary,
    }));
  return [buildButtonRow(...buttons)];
}

function ownListText(own: IGotyNomination[]): string {
  if (!own.length) return "You have not nominated anything yet.";
  return own.map((nomination) => `- **${escapeMarkdown(gameTitle(nomination))}**`).join("\n");
}

/** The member's own nominations, with a Withdraw button each while nominations are open. */
export function buildOwnNominationsView(
  vote: IGotyVoteSummary,
  own: IGotyNomination[],
  notice: string | null = null,
): IGotyNominationsView {
  const body = new ContainerBuilder();
  if (notice) {
    body.addTextDisplayComponents(buildTextDisplay(notice));
    body.addSeparatorComponents(buildDivider());
  }
  body.addTextDisplayComponents(buildTextDisplay([
    `### Your Game of the Year nominations: ${vote.name}`,
    usedText(own.length),
    "",
    ownListText(own),
  ].join("\n")));
  body.addSeparatorComponents(buildDivider());
  body.addTextDisplayComponents(buildTextDisplay(windowText(vote)));
  return view(body, withdrawRow(vote, own, "mine"));
}

interface INominatedGame {
  title: string;
  nominators: string[];
}

/** Each nominated game once, in the order first nominated (the ballot's order). */
function groupByGame(nominations: IGotyNomination[]): INominatedGame[] {
  const games = new Map<number, INominatedGame>();
  for (const nomination of nominations) {
    const entry = games.get(nomination.gamedb_game_id) ??
      { title: gameTitle(nomination), nominators: [] };
    entry.nominators.push(nomination.user_id);
    games.set(nomination.gamedb_game_id, entry);
  }
  return [...games.values()];
}

function allListText(nominations: IGotyNomination[]): string {
  const games = groupByGame(nominations);
  if (!games.length) return "Nobody has nominated a game yet.";
  const lines: string[] = [];
  let used = 0;
  for (const [index, game] of games.entries()) {
    const line = `${index + 1}. **${escapeMarkdown(game.title)}**, nominated by ` +
      game.nominators.map((id) => `<@${id}>`).join(", ");
    if (used + line.length > LIST_TEXT_BUDGET) {
      const rest = games.length - index;
      lines.push(`...and ${plural(rest, "more game")}. See them all on ${gotyPageUrl()}`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

/**
 * Every Game of the Year nomination for the year, grouped by game with who nominated it,
 * then the member's own count and Withdraw buttons.
 */
export function buildAllNominationsView(
  vote: IGotyVoteSummary,
  nominations: IGotyNomination[],
  userId: string,
  notice: string | null = null,
): IGotyNominationsView {
  const own = nominations.filter((nomination) => nomination.user_id === userId);
  const members = new Set(nominations.map((nomination) => nomination.user_id)).size;
  const games = groupByGame(nominations).length;
  const body = new ContainerBuilder();
  if (notice) {
    body.addTextDisplayComponents(buildTextDisplay(notice));
    body.addSeparatorComponents(buildDivider());
  }
  body.addTextDisplayComponents(buildTextDisplay([
    `## ${vote.name}: Game of the Year nominations`,
    games
      ? `${plural(games, "game")} nominated by ${plural(members, "member")}.`
      : "No nominations yet.",
  ].join("\n")));
  body.addSeparatorComponents(buildDivider());
  body.addTextDisplayComponents(buildTextDisplay(allListText(nominations)));
  body.addSeparatorComponents(buildDivider());
  body.addTextDisplayComponents(buildTextDisplay(
    `${usedText(own.length)}\n${windowText(vote)}`,
  ));
  return view(body, withdrawRow(vote, own, "all"));
}

/** A command's or press's reply: a view, plain text, or an error with request blocks. */
export type GotyNominationsReply =
  | { view: IGotyNominationsView }
  | { text: string }
  | { error: string };

const NO_VOTE_TEXT = "There is no GOTY Vote yet. Each year's opens for nominations on January 1.";

async function findVote(
  api: IGotyVoteApi,
  year: number | null,
): Promise<IGotyVoteSummary | null | { error: string }> {
  let votes: IGotyVoteSummary[];
  try {
    votes = await api.listVotes();
  } catch (err: unknown) {
    return { error: buildApiRefusalMessage(err, "Could not read the GOTY Votes.") };
  }
  if (year === null) return pickNominationsGotyVote(votes);
  return votes.find((vote) => vote.year === year) ?? null;
}

function noVoteText(year: number | null): string {
  return year === null ? NO_VOTE_TEXT : `There is no GOTY Vote for ${year}.`;
}

/** /goty nominations [year] [mine]: the year's nominations, or the member's own. */
export async function gotyNominationsReply(
  api: IGotyVoteApi,
  input: { userId: string; year: number | null; scope: GotyNominationsScope },
  notice: string | null = null,
): Promise<GotyNominationsReply> {
  const vote = await findVote(api, input.year);
  if (!vote) return { text: noVoteText(input.year) };
  if ("error" in vote) return vote;
  let nominations: IGotyNomination[];
  try {
    nominations = await api.listNominations(
      vote.year,
      input.scope === "mine" ? input.userId : undefined,
    );
  } catch (err: unknown) {
    return { error: buildApiRefusalMessage(err, "Could not read the nominations.") };
  }
  return {
    view: input.scope === "mine"
      ? buildOwnNominationsView(vote, nominations, notice)
      : buildAllNominationsView(vote, nominations, input.userId, notice),
  };
}

/** The API's refusal code, when it sent one. */
function refusalCode(err: unknown): string | null {
  if (!axios.isAxiosError(err)) return null;
  const code = (err.response?.data as { error?: unknown } | undefined)?.error;
  return typeof code === "string" ? code : null;
}

function refusalMessage(err: unknown): string | null {
  if (!axios.isAxiosError(err)) return null;
  const message = (err.response?.data as { message?: unknown } | undefined)?.message;
  return typeof message === "string" && message.trim() ? message.trim() : null;
}

/**
 * The reply for a refused nomination. A game released in another year leads with that
 * year ("Released in 2025."), read from the eligibility check, before the API's words.
 */
async function nominateRefusal(
  api: IGotyVoteApi,
  err: unknown,
  gameId: number,
  year: number,
): Promise<string> {
  const message = refusalMessage(err);
  if (refusalCode(err) === "not_released_in_year" && message) {
    const released = await api.eligibility(gameId, year).then(
      (check) => check.released_on ?? null,
      () => null,
    );
    const lead = released ? `Released in ${released.slice(0, 4)}. ` : "";
    return buildApiErrorMessage(`${lead}${message}`, err, { devPing: false });
  }
  return buildApiRefusalMessage(err, "Could not nominate that game.");
}

/**
 * /goty nominate: nominates the game for the GOTY Vote taking nominations, then shows the
 * member's own nominations and how many of their three they have used.
 */
export async function gotyNominateReply(
  api: IGotyVoteApi,
  input: { userId: string; gameId: number },
): Promise<GotyNominationsReply> {
  const vote = await findVote(api, null);
  if (!vote) return { text: NO_VOTE_TEXT };
  if ("error" in vote) return vote;
  const closed = nominationsClosedText(vote);
  if (closed) return { text: closed };

  let own: IGotyNomination[];
  try {
    own = await api.listNominations(vote.year, input.userId);
  } catch (err: unknown) {
    return { error: buildApiRefusalMessage(err, "Could not read your nominations.") };
  }
  const already = own.find((nomination) => nomination.gamedb_game_id === input.gameId);
  if (already) {
    const notice = `You already nominated **${escapeMarkdown(gameTitle(already))}** ` +
      `for Game of the Year ${vote.year}.`;
    return { view: buildOwnNominationsView(vote, own, notice) };
  }

  let saved: IGotyNomination;
  try {
    saved = await api.nominate(vote.year, input.userId, input.gameId);
  } catch (err: unknown) {
    return { error: await nominateRefusal(api, err, input.gameId, vote.year) };
  }
  const notice = `Nominated **${escapeMarkdown(gameTitle(saved))}** for Game of the Year ` +
    `${vote.year}.`;
  return { view: buildOwnNominationsView(vote, [...own, saved], notice) };
}

/**
 * A Withdraw press: withdraws the member's own nomination and redraws the view it was on.
 * A nomination that is not theirs (or is already gone) is refused, and the view redrawn.
 */
export async function gotyWithdrawReply(
  api: IGotyVoteApi,
  target: IGotyWithdrawTarget,
  userId: string,
): Promise<GotyNominationsReply> {
  const redraw = (notice: string): Promise<GotyNominationsReply> =>
    gotyNominationsReply(api, { userId, year: target.year, scope: target.scope }, notice);

  let own: IGotyNomination[];
  try {
    own = await api.listNominations(target.year, userId);
  } catch (err: unknown) {
    return { error: buildApiRefusalMessage(err, "Could not read your nominations.") };
  }
  const nomination = own.find((entry) => entry.id === target.nominationId);
  if (!nomination) {
    return redraw("That nomination is not yours, or it was already withdrawn.");
  }
  try {
    await api.withdrawNomination(target.year, nomination.id);
  } catch (err: unknown) {
    return { error: buildApiRefusalMessage(err, "Could not withdraw that nomination.") };
  }
  return redraw(`Withdrew **${escapeMarkdown(gameTitle(nomination))}**.`);
}

// --- Autocomplete: mark games that can't be nominated for the year. ---

/** A game the GameDB search found, with its label (title and year). */
export interface IGotyGameChoice {
  id: number;
  label: string;
}

const ELIGIBILITY_TTL_MS = 10 * 60_000;
const VOTES_TTL_MS = 60_000;
/** Autocomplete must answer within 3 seconds; checks still out by then show unmarked. */
const ELIGIBILITY_DEADLINE_MS = 1800;

interface ICached<T> {
  value: T;
  at: number;
}

/** Caches kept between keystrokes, so a member typing does not re-check the same games. */
export interface IGotyAutocompleteCache {
  votes: ICached<IGotyVoteSummary[]> | null;
  eligibility: Map<string, ICached<IGotyEligibility>>;
}

export function createGotyAutocompleteCache(): IGotyAutocompleteCache {
  return { votes: null, eligibility: new Map() };
}

const SHARED_CACHE = createGotyAutocompleteCache();

export interface IGotyAutocompleteDeps {
  api: IGotyVoteApi;
  cache?: IGotyAutocompleteCache;
  now?: () => number;
  deadlineMs?: number;
}

/** Why a game can't be nominated, for its autocomplete label. */
export function ineligibleMark(eligibility: IGotyEligibility): string | null {
  if (eligibility.eligible) return null;
  if (eligibility.reason === "release_unknown") return "not eligible: no known release";
  const year = eligibility.released_on?.slice(0, 4);
  return year ? `not eligible: released ${year}` : "not eligible";
}

async function cachedVotes(deps: IGotyAutocompleteDeps, now: number): Promise<IGotyVoteSummary[]> {
  const cache = deps.cache ?? SHARED_CACHE;
  if (cache.votes && now - cache.votes.at < VOTES_TTL_MS) return cache.votes.value;
  const votes = await deps.api.listVotes();
  cache.votes = { value: votes, at: now };
  return votes;
}

async function cachedEligibility(
  deps: IGotyAutocompleteDeps,
  gameId: number,
  year: number,
  now: number,
): Promise<IGotyEligibility | null> {
  const cache = deps.cache ?? SHARED_CACHE;
  const key = `${year}:${gameId}`;
  const hit = cache.eligibility.get(key);
  if (hit && now - hit.at < ELIGIBILITY_TTL_MS) return hit.value;
  try {
    const value = await deps.api.eligibility(gameId, year);
    cache.eligibility.set(key, { value, at: now });
    return value;
  } catch {
    return null;
  }
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * The autocomplete choices for /goty nominate: eligible games first, each ineligible one
 * marked with why ("not eligible: released 2025"). Discord can't grey a choice out, so the
 * mark is in its name. With no GOTY Vote, or when a check fails or runs late, the game is
 * shown unmarked and the API decides on submit.
 */
export async function gotyNominateChoices(
  games: IGotyGameChoice[],
  deps: IGotyAutocompleteDeps,
): Promise<{ name: string; value: string }[]> {
  const now = (deps.now ?? Date.now)();
  let year: number | null = null;
  try {
    year = pickNominationsGotyVote(await cachedVotes(deps, now))?.year ?? null;
  } catch {
    year = null;
  }
  const checks = year === null
    ? games.map(() => null)
    : await withDeadline(
      Promise.all(games.map((game) => cachedEligibility(deps, game.id, year, now))),
      deps.deadlineMs ?? ELIGIBILITY_DEADLINE_MS,
    ) ?? games.map(() => null);
  const choices = games.map((game, index) => {
    const check = checks[index];
    const mark = check ? ineligibleMark(check) : null;
    return {
      eligible: mark === null,
      name: truncateWithEllipsis(mark ? `${game.label} [${mark}]` : game.label, 100),
      value: String(game.id),
    };
  });
  return [
    ...choices.filter((choice) => choice.eligible),
    ...choices.filter((choice) => !choice.eligible),
  ].map(({ name, value }) => ({ name, value }));
}
