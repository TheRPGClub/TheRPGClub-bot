import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SectionBuilder,
  SeparatorBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import {
  ButtonStyle,
  MessageFlags,
  SeparatorSpacingSize,
  type APIMessageTopLevelComponent,
} from "discord-api-types/v10";
import { escapeMarkdown } from "discord.js";
import {
  CLUB_LORE_INK,
  HISTORY_DESCRIPTION_MAX,
  HISTORY_KIND_INKS,
  HISTORY_PAGE_SIZE,
  LORE_AUTOCOMPLETE_READ,
  LORE_PAGE_TEXT_MAX,
  LORE_SEE_ALSO_MAX,
} from "../config/codex.js";
import { DISCORD_V2_TEXT_MAX, truncateLabel } from "../config/textLimits.js";
import {
  codexFunFactsUrl,
  codexHistoryUrl,
  loreEntryPageUrl,
} from "../config/website.js";
import {
  buildCodexHistoryId,
  buildCodexLoreId,
  type CodexReplyVisibility,
  type ICodexLoreTarget,
} from "../functions/CodexCustomIds.js";
import { cutAtSentence, splitLorePages } from "../functions/CodexLorePages.js";
import { formatCodexDate, HISTORY_KIND_LABELS } from "../functions/CodexText.js";
import {
  buildMaskedLink,
  buildTextDisplay,
} from "../functions/ComponentsV2Utils.js";
import { logError } from "../utilities/LogUtils.js";
import { plural } from "../utilities/TextUtils.js";
import {
  CODEX_READ_API,
  codexRefusalText,
  type ICodexEntry,
  type ICodexLink,
  type ICodexReadApi,
} from "./CodexApi.js";
import { codexView, type ICodexView } from "./CodexFunFacts.js";

// /codex lore read and /codex history (spec api#397, bot#1563). Lore Entries and History
// Events are written on the website; Discord only reads them. Design picks: a Lore Entry
// is 3B's jade Club Lore card with 3C's images on top of the first page and 3D's pages at
// its headings; Club History is 4B, a card per History Event in its Kind's ink.

export interface ICodexReadingDeps {
  api?: ICodexReadApi;
}

/**
 * What to show: a `page` the reply may show to whoever it is for (and Post this page may
 * share), a `notice` only the member should see, or an error (the request and response).
 */
export type CodexReadResult =
  | { page: ICodexView }
  | { notice: ICodexView }
  | { error: string };

function page(components: APIMessageTopLevelComponent[]): { page: ICodexView } {
  return {
    page: { components, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } },
  };
}

function separator(): SeparatorBuilder {
  return new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true);
}

function linkButton(label: string, url: string): ButtonBuilder {
  return new ButtonBuilder().setLabel(label).setURL(url).setStyle(ButtonStyle.Link);
}

function idButton(label: string, customId: string, disabled = false): ButtonBuilder {
  return new ButtonBuilder()
    .setLabel(label)
    .setCustomId(customId)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled);
}

/** Where a "See also" entry lives on the website. */
function linkUrl(link: ICodexLink): string {
  if (link.part === "lore_entry") return loreEntryPageUrl(link.id);
  return link.part === "history_event" ? codexHistoryUrl() : codexFunFactsUrl();
}

/**
 * Page buttons answer only the member who ran the command: anyone else gets this, privately.
 * Null for that member.
 */
export function pageTurnRefusal(
  target: { ownerId: string },
  clickerId: string,
): ICodexView | null {
  if (target.ownerId === clickerId) return null;
  return codexView(
    `Only <@${target.ownerId}> can turn these pages. Run the command to read it yourself.`,
  );
}

/**
 * Autocomplete for `entry:`: every Lore Entry by title (newest first, or those matching
 * what was typed, title matches first). The value is its ID. Nothing on a failed read.
 */
export async function loreChoices(
  input: { query: string },
  deps: ICodexReadingDeps = {},
): Promise<{ name: string; value: string }[]> {
  const api = deps.api ?? CODEX_READ_API;
  try {
    const found = await api.searchLore(input.query.trim(), LORE_AUTOCOMPLETE_READ);
    return found.map((e) => ({ name: truncateLabel(e.title), value: String(e.id) }));
  } catch (err: unknown) {
    logError("CodexReading.loreChoices", err);
    return [];
  }
}

/** "Club Lore · 12 August 2020 · by @author · page 2 of 3". */
function loreByline(entry: ICodexEntry, at: number, count: number): string {
  const parts = ["Club Lore"];
  const date = formatCodexDate(entry.occurred_on, entry.date_precision);
  if (date) parts.push(date);
  parts.push(`by <@${entry.author.user_id}>`);
  if (count > 1) parts.push(`page ${at} of ${count}`);
  return `-# ${parts.join(" · ")}`;
}

/**
 * A last page's "See also" in at most `room` characters: the first links that fit (up to
 * `LORE_SEE_ALSO_MAX`), then "and N more". Null when not even one link fits, which the
 * page budget rules out: a page's story, title and byline leave room for several.
 */
function seeAlso(links: readonly ICodexLink[], room: number): string | null {
  const shown: string[] = [];
  let best: string | null = null;
  for (const link of links.slice(0, LORE_SEE_ALSO_MAX)) {
    shown.push(buildMaskedLink(link.title, linkUrl(link)));
    const more = links.length - shown.length;
    const text = `-# See also · ${shown.join(" · ")}${more > 0 ? ` · and ${more} more` : ""}`;
    if (text.length > room) break;
    best = text;
  }
  return best;
}

function loreGallery(entry: ICodexEntry): MediaGalleryBuilder | null {
  const images = [...entry.images].sort((a, b) => a.position - b.position);
  if (!images.length) return null;
  return new MediaGalleryBuilder().addItems(...images.map((image, i) =>
    new MediaGalleryItemBuilder()
      .setURL(image.url)
      .setDescription(`Image ${i + 1} of ${images.length}`)));
}

function loreButtons(
  entry: ICodexEntry,
  target: Omit<ICodexLoreTarget, "action">,
  count: number,
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  const to = (at: number): string => buildCodexLoreId({ ...target, action: "page", page: at });
  if (count > 1) {
    // At either end the button points past it, so the two never share a custom ID.
    const first = target.page <= 1;
    const last = target.page >= count;
    row.addComponents(
      idButton("Previous", to(first ? count + 1 : target.page - 1), first),
      idButton("Next", to(last ? count + 1 : target.page + 1), last),
    );
  }
  if (target.visibility === "private") {
    row.addComponents(idButton("Post this page", buildCodexLoreId({ ...target, action: "post" })));
  }
  return row.addComponents(linkButton("Website", loreEntryPageUrl(entry.id)));
}

/** One page of a Lore Entry: the jade card, then its buttons. */
function lorePage(
  entry: ICodexEntry,
  input: { page: number; ownerId: string; visibility: CodexReplyVisibility },
): { page: ICodexView } {
  const pages = splitLorePages(entry.body, LORE_PAGE_TEXT_MAX);
  const at = Math.min(Math.max(input.page, 1), pages.length);
  const card = new ContainerBuilder().setAccentColor(CLUB_LORE_INK);
  const gallery = at === 1 ? loreGallery(entry) : null;
  if (gallery) card.addMediaGalleryComponents(gallery);
  const heading =
    `## ${escapeMarkdown(entry.title ?? "Lore Entry")}\n${loreByline(entry, at, pages.length)}`;
  const story = pages[at - 1] || "-# No story yet.";
  card.addTextDisplayComponents(buildTextDisplay(heading));
  card.addSeparatorComponents(separator());
  card.addTextDisplayComponents(buildTextDisplay(story));
  // Discord counts every text display in a message together, so See also gets what's left.
  const links = at === pages.length && entry.links.length
    ? seeAlso(entry.links, DISCORD_V2_TEXT_MAX - heading.length - story.length)
    : null;
  if (links) {
    card.addSeparatorComponents(separator());
    card.addTextDisplayComponents(buildTextDisplay(links));
  }
  const row = loreButtons(
    entry,
    { entryId: entry.id, page: at, ownerId: input.ownerId, visibility: input.visibility },
    pages.length,
  );
  return page([card.toJSON(), row.toJSON()]);
}

/**
 * /codex lore read, and its page buttons: a page of the Lore Entry for the member who ran
 * it (`ownerId`, who the API reads for). A page past the end shows the last one, so a
 * button still works after the story got shorter.
 */
export async function loreReadReply(
  input: {
    entryId: number | null;
    page: number;
    ownerId: string;
    visibility: CodexReplyVisibility;
  },
  deps: ICodexReadingDeps = {},
): Promise<CodexReadResult> {
  if (input.entryId === null) return { notice: codexView("Pick a Lore Entry from the list.") };
  const api = deps.api ?? CODEX_READ_API;
  let entry: ICodexEntry | null;
  try {
    entry = await api.getLoreEntry(input.entryId, input.ownerId);
  } catch (err: unknown) {
    return { error: codexRefusalText(err, "Could not read that Lore Entry.") };
  }
  if (!entry) {
    return {
      notice: codexView(`There is no Lore Entry ${input.entryId}. It may have been deleted.`),
    };
  }
  return lorePage(entry, input);
}

/** A History Event's description on its card, cut at a sentence end when it's long. */
function description(body: string | null): string {
  const text = (body ?? "").trim();
  if (!text) return "";
  const [head, rest] = cutAtSentence(text, HISTORY_DESCRIPTION_MAX);
  return `\n${head}${rest ? " …" : ""}`;
}

/** 4B: a History Event's card, accented in its Kind's ink, its first image as thumbnail. */
function historyCard(event: ICodexEntry): ContainerBuilder {
  const kind = event.kind ? HISTORY_KIND_LABELS[event.kind] : null;
  const meta = [kind, formatCodexDate(event.occurred_on, event.date_precision)]
    .filter(Boolean)
    .join(" · ");
  const text = buildTextDisplay([
    `### ${escapeMarkdown(event.title ?? "History Event")}`,
    meta ? `\n-# ${meta}` : "",
    description(event.body),
  ].join(""));
  const card = new ContainerBuilder();
  if (event.kind) card.setAccentColor(HISTORY_KIND_INKS[event.kind]);
  const image = [...event.images].sort((a, b) => a.position - b.position)[0];
  if (!image) return card.addTextDisplayComponents(text);
  const section = new SectionBuilder().addTextDisplayComponents(text);
  section.setThumbnailAccessory(new ThumbnailBuilder().setURL(image.url));
  return card.addSectionComponents(section);
}

/**
 * /codex history, and its Newer and Older buttons: Club History's latest History Events,
 * newest first, `HISTORY_PAGE_SIZE` to a page. A page past the end shows the last one.
 */
export async function historyReply(
  input: { page: number; ownerId: string; visibility: CodexReplyVisibility },
  deps: ICodexReadingDeps = {},
): Promise<CodexReadResult> {
  const api = deps.api ?? CODEX_READ_API;
  let events: ICodexEntry[];
  try {
    events = await api.listHistory(input.ownerId);
  } catch (err: unknown) {
    return { error: codexRefusalText(err, "Could not read Club History.") };
  }
  if (!events.length) return { notice: codexView("Club History has no History Events yet.") };

  const newestFirst = [...events].reverse();
  const pages = Math.ceil(newestFirst.length / HISTORY_PAGE_SIZE);
  const at = Math.min(Math.max(input.page, 1), pages);
  const start = (at - 1) * HISTORY_PAGE_SIZE;
  const shown = newestFirst.slice(start, start + HISTORY_PAGE_SIZE);
  const heading = at === 1
    ? `The latest ${plural(shown.length, "History Event")}`
    : `History Events ${start + 1} to ${start + shown.length} of ${newestFirst.length}, ` +
      "newest first";

  const row = new ActionRowBuilder<ButtonBuilder>();
  const to = (target: number): string =>
    buildCodexHistoryId({ page: target, ownerId: input.ownerId, visibility: input.visibility });
  if (at > 1) row.addComponents(idButton("Newer", to(at - 1)));
  if (at < pages) row.addComponents(idButton("Older", to(at + 1)));
  row.addComponents(linkButton("The full Club History", codexHistoryUrl()));

  return page([
    buildTextDisplay(`## Club History\n-# ${heading}`).toJSON(),
    ...shown.map((event) => historyCard(event).toJSON()),
    row.toJSON(),
  ]);
}
