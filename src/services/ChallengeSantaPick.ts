import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
} from "@discordjs/builders";
import { ButtonStyle, MessageFlags, TextInputStyle } from "discord-api-types/v10";
import { DateTime } from "luxon";
import { buildTextContainer, buildTextDisplay } from "../functions/ComponentsV2Utils.js";
import {
  CHALLENGE_TIME_ZONE,
  escapeChallengeText,
  listJoin,
  memberName,
} from "../functions/ChallengeCopy.js";
import {
  buildSantaPickId,
  SANTA_PICK_QUERY_MAX,
} from "../functions/ChallengeCustomIds.js";
import {
  DISCORD_SELECT_OPTIONS_MAX,
  truncateDescription,
  truncateLabel,
} from "../config/textLimits.js";
import {
  challengeRefusalText,
  type IChallenge,
  type IChallengeMember,
} from "./ChallengeApi.js";
import type { IChallengeView } from "./ChallengeBrowse.js";
import {
  CHALLENGE_EDITION_API,
  type IChallengeEditionApi,
  type ISantaBacklogEntry,
  type ISantaTaste,
  type ISantaView,
} from "./ChallengeEditionApi.js";
import type { ChallengeRunResult } from "./ChallengeRuns.js";
import type { IChallengeDm } from "./ChallengeSeasons.js";
import { resolveEdition, type ISantaSignupDeps, type SantaTarget } from "./ChallengeSignup.js";
import { editionDay, editionName } from "./ChallengeSignupPosts.js";
import { commandMention } from "./CommandMentionService.js";
import { plural } from "../utilities/TextUtils.js";
import { payloadEdition, payloadMember, payloadUserId } from "./ChallengePayloads.js";

// A Santa's pick from Discord (spec api#376, bot#1552), design 7C "Gift tags": a private
// view of the recipient's eligible backlog (what the API serves: their backlog minus the
// games they have Cleared) with taste hints, a select that records the pick, pages of 25
// and a search; and the pick reminder DM. The API decides who is a Santa, what may be
// picked and until when; its refusals are shown as given, with the request and response.

export interface ISantaPickDeps {
  editions?: Pick<IChallengeEditionApi, "getSanta" | "pick">;
  challenges?: ISantaSignupDeps["challenges"];
}

/** The page and search a view shows; page 1 and the whole list unless said. */
export interface ISantaPage {
  page?: number;
  query?: string;
}

/** The search modal's text input. */
export const SANTA_SEARCH_FIELD = "santa-search";

/** The recipient's name, escaped for a message. */
function recipientName(member: IChallengeMember): string {
  return escapeChallengeText(memberName(member));
}

/** The backlog's games, each once (a game can be in a backlog on two platforms). */
function uniqueGames(backlog: readonly ISantaBacklogEntry[]): ISantaBacklogEntry[] {
  const seen = new Set<number>();
  return backlog.filter((entry) => {
    if (seen.has(entry.gamedb_game_id)) return false;
    seen.add(entry.gamedb_game_id);
    return true;
  });
}

/**
 * "-# To help you choose · Lufia plays most on PlayStation 2 · Their top genres: A, B and
 * C", or null when the API knows neither.
 */
export function tasteLine(name: string, taste: ISantaTaste | null | undefined): string | null {
  const parts: string[] = [];
  if (taste?.platform) {
    parts.push(`${name} plays most on ${escapeChallengeText(taste.platform.platform_name)}`);
  }
  const genres = (taste?.genres ?? []).map((genre) => escapeChallengeText(genre.name));
  if (genres.length) {
    parts.push(`${genres.length === 1 ? "Their top genre" : "Their top genres"}: ` +
      listJoin(genres));
  }
  return parts.length ? `-# To help you choose · ${parts.join(" · ")}` : null;
}

/** The view's main line: what to do, or what was picked, and when it is revealed. */
function statusLine(view: ISantaView, name: string): string {
  const closes = editionDay(view.pick_deadline_on);
  const revealed = `${editionName(view)} is revealed on ${editionDay(view.reveal_on)}`;
  const game = view.pick?.game ? `**${escapeChallengeText(view.pick.game.title)}**` : null;
  if (view.picks_open) {
    return game
      ? `You picked ${game} for ${name}. Nobody else sees this. You can change it until ` +
        `picks close on ${closes}. ${revealed}.`
      : "Pick one game from their backlog. Nobody else sees this. Picks close on " +
        `${closes}, and ${revealed}.`;
  }
  if (!game) return `Picks are closed, and nothing could be picked for ${name}.`;
  return view.pick?.picked_randomly
    ? `Picks are closed. ${game} was picked for ${name} at random.`
    : `Picks are closed. You picked ${game} for ${name}.`;
}

/**
 * "PlayStation 2 · about 50 hours": a select option's second line, the release year in
 * place of a HowLongToBeat time the game doesn't have.
 */
function optionDescription(entry: ISantaBacklogEntry): string | null {
  const hours = typeof entry.hours === "number" && entry.hours > 0
    ? `about ${plural(Math.max(1, Math.round(entry.hours)), "hour")}`
    : null;
  const length = hours ?? entry.game?.initial_release_date?.slice(0, 4);
  const parts = [entry.platform?.platform_name, length].filter((part): part is string => !!part);
  return parts.length ? truncateDescription(parts.join(" · ")) : null;
}

function button(label: string, customId: string, style = ButtonStyle.Secondary): ButtonBuilder {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
}

/**
 * The Santa's view: who they pick for, how it stands, the taste hints, then (while picks
 * are open) one page of the recipient's backlog as a select, paging and search buttons.
 */
export function buildSantaPickView(view: ISantaView, at: ISantaPage = {}): IChallengeView {
  const name = recipientName(view.recipient);
  const query = (at.query ?? "").trim().slice(0, SANTA_PICK_QUERY_MAX);
  const games = uniqueGames(view.backlog ?? []);
  const pages = Math.max(1, Math.ceil(games.length / DISCORD_SELECT_OPTIONS_MAX));
  const page = Math.min(Math.max(1, at.page ?? 1), pages);
  const shown = games.slice(
    (page - 1) * DISCORD_SELECT_OPTIONS_MAX,
    page * DISCORD_SELECT_OPTIONS_MAX,
  );

  const lines = [`## You're ${name}'s Santa`, statusLine(view, name)];
  if (view.picks_open && !games.length) {
    lines.push(query
      ? `No game in ${name}'s backlog matches "${escapeChallengeText(query)}".`
      : `${name}'s backlog has no games they haven't Cleared, so there is nothing to pick ` +
        `yet. Check back before ${editionDay(view.pick_deadline_on)}.`);
  }
  const container = buildTextContainer(lines.join("\n"));
  const hints = [
    tasteLine(name, view.taste),
    view.picks_open && query && games.length
      ? `-# ${plural(games.length, "game")} in ${name}'s backlog ` +
        `${games.length === 1 ? "matches" : "match"} "${escapeChallengeText(query)}".`
      : null,
  ].filter((line): line is string => !!line);
  if (hints.length) container.addTextDisplayComponents(buildTextDisplay(hints.join("\n")));

  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
  if (view.picks_open) {
    if (shown.length) {
      const picked = view.pick?.game?.game_id;
      const label = `Pick a game for ${memberName(view.recipient)}`;
      const select = new StringSelectMenuBuilder()
        .setCustomId(buildSantaPickId("choose", view.edition_id, page, query))
        .setPlaceholder(truncateLabel(pages > 1 ? `${label} (${page} of ${pages})` : label))
        .addOptions(shown.map((entry) => {
          const option = new StringSelectMenuOptionBuilder()
            .setLabel(truncateLabel(entry.game?.title ?? `Game ${entry.gamedb_game_id}`))
            .setValue(String(entry.gamedb_game_id))
            .setDefault(entry.gamedb_game_id === picked);
          const description = optionDescription(entry);
          if (description) option.setDescription(description);
          return option;
        }));
      rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
    }
    const buttons: ButtonBuilder[] = [];
    if (pages > 1) {
      buttons.push(
        button("Previous", buildSantaPickId("page", view.edition_id, page - 1, query))
          .setDisabled(page <= 1),
        button("More games", buildSantaPickId("page", view.edition_id, page + 1, query))
          .setDisabled(page >= pages),
      );
    }
    if (games.length || query) {
      buttons.push(button(
        "Search their backlog",
        buildSantaPickId("search", view.edition_id, page, query),
      ));
    }
    if (query) buttons.push(button("Show all", buildSantaPickId("page", view.edition_id, 1)));
    if (buttons.length) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons));
  }

  return {
    components: [container.toJSON(), ...rows.map((row) => row.toJSON())],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

/** The search modal, prefilled with the search shown now. */
export function buildSantaSearchModal(editionId: number, query: string): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId(SANTA_SEARCH_FIELD)
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(SANTA_PICK_QUERY_MAX);
  if (query) input.setValue(query.slice(0, SANTA_PICK_QUERY_MAX));
  return new ModalBuilder()
    .setCustomId(buildSantaPickId("search-modal", editionId, 1))
    .setTitle("Search their backlog")
    .addLabelComponents(new LabelBuilder()
      .setLabel("Game title")
      .setDescription("Leave it empty to show the whole backlog.")
      .setTextInputComponent(input));
}

/**
 * /challenge santa pick, the reminder's Pick now, and the paging and search buttons: the
 * acting member's Santa view of the Edition (named, or found by its Challenge).
 */
export async function santaPickReply(
  target: SantaTarget & ISantaPage,
  deps: ISantaPickDeps = {},
): Promise<ChallengeRunResult> {
  const found = await resolveEdition(target, "pick", deps);
  if (!("editionId" in found)) return found;
  const api = deps.editions ?? CHALLENGE_EDITION_API;
  const query = (target.query ?? "").trim().slice(0, SANTA_PICK_QUERY_MAX);
  let view: ISantaView | null;
  try {
    view = await api.getSanta(found.editionId, target.actingUserId, query || undefined);
  } catch (err: unknown) {
    return { error: challengeRefusalText(err, "Could not read your Secret Santa pick.") };
  }
  if (!view) {
    return { view: buildGoneView() };
  }
  return { view: buildSantaPickView(view, { page: target.page, query }) };
}

function buildGoneView(): IChallengeView {
  return {
    components: [
      buildTextContainer("That Edition is gone, so there is nothing to pick.").toJSON(),
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

/** The select: records (or changes) the pick, then shows the view with it. */
export async function santaChooseReply(
  input: { editionId: number; actingUserId: string; gameId: number } & ISantaPage,
  deps: ISantaPickDeps = {},
): Promise<ChallengeRunResult> {
  const api = deps.editions ?? CHALLENGE_EDITION_API;
  try {
    const view = await api.pick(input.editionId, input.actingUserId, input.gameId);
    if (!input.query) return { view: buildSantaPickView(view, { page: input.page }) };
    // A search's list: read it again, since the PUT answers with the whole backlog.
    const narrowed = await api.getSanta(input.editionId, input.actingUserId, input.query);
    return { view: buildSantaPickView(narrowed ?? view, input) };
  } catch (err: unknown) {
    return { error: challengeRefusalText(err, "Could not record your pick.") };
  }
}

/** The start of a club day (picks close then), as Unix seconds. */
function clubDayStart(isoDate: string): number {
  return DateTime.fromISO(isoDate, { zone: CHALLENGE_TIME_ZONE }).toUnixInteger();
}

/**
 * Payload `{ event: "pick_reminder", user_id, challenge, edition, recipient, days_left }`:
 * the DM to a Santa who hasn't picked, two days before the deadline, with Pick now. The
 * API sends it only to Santas who keep Challenge DMs on.
 */
export async function pickReminderDm(payload: Record<string, unknown>): Promise<IChallengeDm> {
  const userId = payloadUserId(payload);
  const edition = payloadEdition(payload);
  const recipient = payloadMember(payload, "recipient");
  const challenge = (payload.challenge as IChallenge | undefined) ?? null;
  const challengeName = escapeChallengeText(challenge?.name ?? edition.challenge.name);
  const name = recipientName(recipient);
  const deadline = edition.pick_deadline_on;
  const container = new ContainerBuilder()
    .addTextDisplayComponents(buildTextDisplay(
      `## ${challengeName}: pick ${name}'s game\n` +
        `You haven't picked yet. Picks close <t:${clubDayStart(deadline)}:R>, on ` +
        `${editionDay(deadline)}. If you don't pick, a random game from ${name}'s backlog ` +
        "is picked for them.",
    ))
    .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      button("Pick now", buildSantaPickId("open", edition.id), ButtonStyle.Primary),
    ))
    .addTextDisplayComponents(buildTextDisplay(
      `-# Turn Challenge DMs off with ${commandMention("challenge dms")}`,
    ));
  return {
    userId,
    post: {
      components: [container.toJSON()],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    },
    about: `the pick reminder for "${edition.challenge.name}" ${edition.year} ` +
      `(Edition ${edition.id})`,
  };
}
