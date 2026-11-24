import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "@discordjs/builders";
import {
  ButtonStyle,
  SeparatorSpacingSize,
  type APIMessageTopLevelComponent,
} from "discord-api-types/v10";
import { escapeMarkdown } from "discord.js";
import { DateTime } from "luxon";
import {
  DISCORD_SELECT_OPTIONS_MAX,
  DISCORD_V2_TEXT_MAX,
  truncateLabel,
} from "../config/textLimits.js";
import { gameListPageUrl, newGameListUrl } from "../config/website.js";
import { CLUB_TIME_ZONE } from "../functions/ClubDate.js";
import {
  buildComponentsV2View,
  buildTextContainer,
  buildTextDisplay,
  type IComponentsV2View,
} from "../functions/ComponentsV2Utils.js";
import { buildGameListAddId, buildGameListPageId } from "../functions/GameListCustomIds.js";
import { buildApiRefusalMessage } from "../utilities/ApiErrorUtils.js";
import { logError } from "../utilities/LogUtils.js";
import { plural } from "../utilities/TextUtils.js";
import { composeRunShelf, type ShelfTile } from "./ChallengeShelfImage.js";
import {
  GAME_LIST_API,
  type IGameList,
  type IGameListApi,
  type IGameListEntry,
} from "./GameListApi.js";
import { fetchImageBuffer } from "./GameImageService.js";

// Game Lists in Discord (spec api#442, bot#1568): /list view, /list add and the game view's
// Add to a Game List. Reordering and notes stay on the website, so replies point there.
// Design pick 3 (3B + 3C): a page of the list leads with its covers on the shelf (the Run
// Finished shelf, drawn by ChallengeShelfImage), then the games as text with their years
// and notes, without a card per game.

/** Games on a page of /list view: two rows of five on the shelf. */
export const GAME_LIST_PAGE_SIZE = 10;

/** Ends a note cut to fit the page. */
const NOTE_ELLIPSIS = "…";

export interface IGameListDeps {
  api?: IGameListApi;
  /** A cover's bytes from its URL, or null when it can't be read. */
  coverImage?: (url: string) => Promise<Buffer | null>;
  /** The shelf PNG from its tiles. */
  composeShelf?: (tiles: readonly ShelfTile[]) => Promise<Buffer>;
}

/** A page of a list: the view, its shelf picture, and whether only the reader may see it. */
export interface IGameListPage {
  view: IComponentsV2View;
  files: { name: string; data: Buffer }[];
  /** A Private list: shown only to whoever asked, never in the channel. */
  private: boolean;
}

/**
 * What to show: a `page` of the list, a `notice` only the member should see, or an error
 * (the request and response).
 */
export type GameListResult =
  | { page: IGameListPage }
  | { notice: IComponentsV2View }
  | { error: string };

export interface IChoice {
  name: string;
  value: string;
}

/** A reply of text only the member sees, with an optional row of buttons. */
export function notice(
  text: string,
  buttons: ButtonBuilder[] = [],
): { notice: IComponentsV2View } {
  const components: APIMessageTopLevelComponent[] = [buildTextContainer(text).toJSON()];
  if (buttons.length) {
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons).toJSON());
  }
  return { notice: buildComponentsV2View(components) };
}

function linkButton(label: string, url: string): ButtonBuilder {
  return new ButtonBuilder().setLabel(label).setURL(url).setStyle(ButtonStyle.Link);
}

function pageButton(label: string, customId: string, disabled: boolean): ButtonBuilder {
  return new ButtonBuilder()
    .setLabel(label)
    .setCustomId(customId)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled);
}

/** "Mara", "the club". */
export function listOwnerName(list: IGameList): string {
  if (!list.owner) return "the club";
  return list.owner.global_name || list.owner.username;
}

const SORT_LABELS: Readonly<Record<IGameList["sort"], string>> = {
  ranked: "ranked",
  alphabetical: "A to Z",
  added: "by date added",
};

/** "Mara · 10 games · Private": who owns it (when asked), its size, and Private. */
function listDetails(list: IGameList, withOwner: boolean): string {
  const parts: string[] = [];
  if (withOwner) parts.push(list.club ? "The club" : listOwnerName(list));
  parts.push(plural(list.entry_count, "game"));
  if (list.visibility === "private") parts.push("Private");
  return parts.join(" · ");
}

/** An autocomplete line: "Top 10 of all time · Mara · 10 games". */
function choiceName(list: IGameList, withOwner: boolean): string {
  return truncateLabel(`${list.name} · ${listDetails(list, withOwner)}`);
}

function nameHas(list: IGameList, query: string): boolean {
  return list.name.toLowerCase().includes(query.trim().toLowerCase());
}

/** `lists` without a repeat of an earlier ID, at most 25. */
function distinct(lists: readonly IGameList[]): IGameList[] {
  const seen = new Set<number>();
  const kept: IGameList[] = [];
  for (const list of lists) {
    if (seen.has(list.id)) continue;
    seen.add(list.id);
    kept.push(list);
  }
  return kept.slice(0, DISCORD_SELECT_OPTIONS_MAX);
}

/**
 * Autocomplete for /list view's `list:`: the lists the member can see whose name holds what
 * they typed, their own first, then the club's and other members' (the API's order).
 * Nothing on a failed read.
 */
export async function viewListChoices(
  input: { query: string; actingUserId: string },
  deps: IGameListDeps = {},
): Promise<IChoice[]> {
  const api = deps.api ?? GAME_LIST_API;
  try {
    const [own, found] = await Promise.all([
      api.ownLists(input.actingUserId),
      api.search(input.query, input.actingUserId),
    ]);
    const lists = distinct([...own.filter((l) => nameHas(l, input.query)), ...found]);
    return lists.map((list) => ({ name: choiceName(list, true), value: String(list.id) }));
  } catch (err: unknown) {
    logError("GameLists.viewListChoices", err);
    return [];
  }
}

/**
 * The lists a member may add games to: their own, then the club's for staff (the API's
 * `viewer.can_edit` decides), most recently changed first.
 */
async function editableLists(actingUserId: string, api: IGameListApi): Promise<IGameList[]> {
  const [own, club] = await Promise.all([
    api.ownLists(actingUserId),
    api.clubLists(actingUserId),
  ]);
  return distinct([...own, ...club].filter((list) => list.viewer.can_edit));
}

/**
 * Autocomplete for /challenge create's `from-list:` (bot#1569): the member's own lists, or,
 * for a club-hosted Challenge, the club's lists they may edit (a list links only to a
 * Challenge its owner hosts). Nothing on a failed read, such as the Feature hidden.
 */
export async function startListChoices(
  input: { query: string; actingUserId: string; clubHosted: boolean },
  deps: IGameListDeps = {},
): Promise<IChoice[]> {
  const api = deps.api ?? GAME_LIST_API;
  try {
    const lists = input.clubHosted
      ? (await api.clubLists(input.actingUserId)).filter((list) => list.viewer.can_edit)
      : await api.ownLists(input.actingUserId);
    return distinct(lists.filter((list) => nameHas(list, input.query)))
      .map((list) => ({ name: choiceName(list, false), value: String(list.id) }));
  } catch (err: unknown) {
    logError("GameLists.startListChoices", err);
    return [];
  }
}

/** Autocomplete for /list add's `list:`: the lists the member may add to. */
export async function addListChoices(
  input: { query: string; actingUserId: string },
  deps: IGameListDeps = {},
): Promise<IChoice[]> {
  const api = deps.api ?? GAME_LIST_API;
  try {
    const lists = (await editableLists(input.actingUserId, api))
      .filter((list) => nameHas(list, input.query));
    return lists.map((list) => ({ name: choiceName(list, list.club), value: String(list.id) }));
  } catch (err: unknown) {
    logError("GameLists.addListChoices", err);
    return [];
  }
}

function releaseYear(entry: IGameListEntry): string {
  const date = entry.game.initial_release_date;
  if (!date) return "";
  const year = DateTime.fromISO(date, { zone: "utc" }).year;
  return Number.isFinite(year) ? ` (${year})` : "";
}

function addedOn(entry: IGameListEntry): string {
  const added = DateTime.fromISO(entry.added_at, { zone: "utc" }).setZone(CLUB_TIME_ZONE);
  return added.isValid ? `added ${added.toFormat("d LLL yyyy")}` : "";
}

/** A game's line: "**1.** Chrono Trigger (1995)", the number only on a ranked list. */
function entryHead(list: IGameList, entry: IGameListEntry, at: number): string {
  const rank = list.sort === "ranked" ? `**${at}.** ` : "";
  return `${rank}${escapeMarkdown(entry.game.title)}${releaseYear(entry)}`;
}

/** The small line under a game: when it was added (that sort only), then its note. */
function entrySub(list: IGameList, entry: IGameListEntry, noteMax: number): string {
  const parts: string[] = [];
  if (list.sort === "added") parts.push(addedOn(entry));
  const note = (entry.note ?? "").replace(/\s+/g, " ").trim();
  if (note) {
    const cut = note.length > noteMax ? `${note.slice(0, noteMax - 1)}${NOTE_ELLIPSIS}` : note;
    parts.push(escapeMarkdown(cut));
  }
  const text = parts.filter(Boolean).join(" · ");
  return text ? `\n-# ${text}` : "";
}

/**
 * The page's games as text, within `room` characters: every note in full when they fit,
 * else each cut to the same length.
 */
function entriesText(
  list: IGameList,
  entries: readonly IGameListEntry[],
  firstRank: number,
  room: number,
): string {
  const build = (noteMax: number): string => entries.map((entry, i) =>
    entryHead(list, entry, firstRank + i) + entrySub(list, entry, noteMax)).join("\n");
  let noteMax = 280;
  let text = build(noteMax);
  while (text.length > room && noteMax > 20) {
    noteMax = Math.floor(noteMax * 0.8);
    text = build(noteMax);
  }
  return text.length > room ? build(0) : text;
}

function byline(list: IGameList, at: number, pages: number): string {
  const owner = list.owner ? `<@${list.owner.user_id}>'s Game List` : "The club's Game List";
  const parts = [owner, SORT_LABELS[list.sort], plural(list.entry_count, "game")];
  if (list.visibility === "private") parts.push("Private");
  if (pages > 1) parts.push(`page ${at} of ${pages}`);
  return `-# ${parts.join(" · ")}`;
}

/** The page's covers on the shelf, or null when none has a cover (or it can't be drawn). */
async function shelfImage(
  entries: readonly IGameListEntry[],
  deps: IGameListDeps,
): Promise<Buffer | null> {
  const coverImage = deps.coverImage ?? fetchImageBuffer;
  const covers = await Promise.all(entries.map((entry) =>
    entry.game.cover_url ? coverImage(entry.game.cover_url) : Promise.resolve(null)));
  if (!covers.some(Boolean)) return null;
  const tiles: ShelfTile[] = entries.map((entry, i) => ({
    kind: "game",
    title: entry.game.title,
    cover: covers[i] ?? null,
  }));
  try {
    return await (deps.composeShelf ?? composeRunShelf)(tiles);
  } catch (err: unknown) {
    logError("GameLists.shelfImage", err);
    return null;
  }
}

/** One page of the list: the shelf, the heading, the games, then the buttons. */
export async function buildGameListPage(
  list: IGameList,
  page: number,
  deps: IGameListDeps = {},
): Promise<IGameListPage> {
  const entries = list.entries ?? [];
  const pages = Math.max(1, Math.ceil(entries.length / GAME_LIST_PAGE_SIZE));
  const at = Math.min(Math.max(page, 1), pages);
  const start = (at - 1) * GAME_LIST_PAGE_SIZE;
  const shown = entries.slice(start, start + GAME_LIST_PAGE_SIZE);

  const card = new ContainerBuilder();
  const image = await shelfImage(shown, deps);
  const fileName = `game-list-${list.id}-${at}.png`;
  if (image) {
    card.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder()
        .setURL(`attachment://${fileName}`)
        .setDescription(truncateLabel(`Covers of ${list.name}`)),
    ));
  }
  const description = at === 1 && list.description?.trim()
    ? `\n${escapeMarkdown(list.description.trim())}`
    : "";
  const heading = `## ${escapeMarkdown(list.name)}\n${byline(list, at, pages)}${description}`;
  card.addTextDisplayComponents(buildTextDisplay(heading));
  card.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
  );
  const body = shown.length
    ? entriesText(list, shown, start + 1, DISCORD_V2_TEXT_MAX - heading.length)
    : "No games in this list yet.";
  card.addTextDisplayComponents(buildTextDisplay(body));

  const row = new ActionRowBuilder<ButtonBuilder>();
  if (pages > 1) {
    // At either end the button points past it, so the two never share a custom ID.
    const first = at <= 1;
    const last = at >= pages;
    row.addComponents(
      pageButton("Previous", buildGameListPageId(list.id, first ? pages + 1 : at - 1), first),
      pageButton("Next", buildGameListPageId(list.id, last ? pages + 1 : at + 1), last),
    );
  }
  row.addComponents(linkButton("Open on the website", gameListPageUrl(list.id)));

  return {
    view: buildComponentsV2View([card.toJSON(), row.toJSON()]),
    files: image ? [{ name: fileName, data: image }] : [],
    private: list.visibility === "private",
  };
}

/**
 * /list view, and its Previous and Next: a page of the list for `readerId` (who the API
 * reads for, so a list they can't see is "not found"). A page past the end shows the last.
 */
export async function gameListViewReply(
  input: { listId: number | null; page: number; readerId: string },
  deps: IGameListDeps = {},
): Promise<GameListResult> {
  if (input.listId === null) return notice("Pick a Game List from the list.");
  const api = deps.api ?? GAME_LIST_API;
  let list: IGameList | null;
  try {
    list = await api.get(input.listId, input.readerId);
  } catch (err: unknown) {
    return { error: buildApiRefusalMessage(err, "Could not read that Game List.") };
  }
  if (!list) return notice("There is no such Game List, or it is Private.");
  return { page: await buildGameListPage(list, input.page, deps) };
}

/** "Open the list", the website's page where order and notes are changed. */
function openListButton(listId: number): ButtonBuilder {
  return linkButton("Open the list", gameListPageUrl(listId));
}

/**
 * /list add, and the game view's select: adds the game last on the list for the member. A
 * refusal (already in the list, list full, not theirs) comes back as the API words it.
 */
export async function addGameReply(
  input: { listId: number | null; gameId: number | null; actingUserId: string },
  deps: IGameListDeps = {},
): Promise<GameListResult> {
  if (input.gameId === null) return notice("Pick a game from the list.");
  if (input.listId === null) return notice("Pick one of your Game Lists from the list.");
  const api = deps.api ?? GAME_LIST_API;
  let entry: IGameListEntry;
  try {
    entry = await api.addGame(input.listId, input.gameId, input.actingUserId);
  } catch (err: unknown) {
    return { error: buildApiRefusalMessage(err, "Could not add that game to the list.") };
  }
  let list: IGameList | null = null;
  try {
    list = await api.get(input.listId, input.actingUserId);
  } catch (err: unknown) {
    logError("GameLists.addGameReply", err);
  }
  const title = `**${escapeMarkdown(entry.game.title)}**`;
  const where = list
    ? `**${escapeMarkdown(list.name)}** (${plural(list.entry_count, "game")})`
    : "the list";
  return notice(
    `Added ${title} to ${where}.\n-# Order and notes live on the website.`,
    [openListButton(input.listId)],
  );
}

/**
 * The game view's Add to a Game List: a select of the lists the member may add to, those
 * already holding the game marked (Discord can't disable an option; picking one gets the
 * refusal). With no list yet, a link to start one.
 */
export async function addToListPrompt(
  input: { gameId: number; gameTitle: string; actingUserId: string },
  deps: IGameListDeps = {},
): Promise<GameListResult> {
  const api = deps.api ?? GAME_LIST_API;
  let lists: IGameList[];
  let holding: Set<number>;
  try {
    const [editable, withGame] = await Promise.all([
      editableLists(input.actingUserId, api),
      api.listsWithGame(input.gameId, input.actingUserId),
    ]);
    lists = editable;
    holding = new Set(withGame.map((list) => list.id));
  } catch (err: unknown) {
    return { error: buildApiRefusalMessage(err, "Could not read your Game Lists.") };
  }
  if (!lists.length) {
    return notice(
      "You have no Game Lists yet. Start one on the website, then add games here.",
      [linkButton("Start a Game List", newGameListUrl())],
    );
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(buildGameListAddId(input.gameId))
    .setPlaceholder("Choose one of your lists")
    .addOptions(lists.map((list) => new StringSelectMenuOptionBuilder()
      .setLabel(truncateLabel(list.name))
      .setValue(String(list.id))
      .setDescription(truncateLabel(holding.has(list.id)
        ? "Already has this game"
        : listDetails(list, list.club)))));
  const text = `Add **${escapeMarkdown(input.gameTitle)}** to which list?\n` +
    "-# It goes at the end. Order and notes live on the website.";
  return {
    notice: buildComponentsV2View([
      buildTextContainer(text).toJSON(),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select).toJSON(),
    ]),
  };
}
