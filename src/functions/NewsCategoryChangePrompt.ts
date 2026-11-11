import { StringSelectMenuBuilder } from "discord.js";
import { ContainerBuilder, TextDisplayBuilder } from "@discordjs/builders";
import { NEWS_CATEGORY_PICK_PREFIX } from "../config/customIdPrefixes.js";
import {
  NEWS_CATEGORY_KEYS,
  NEWS_CATEGORY_NAMES,
  NEWS_CATEGORY_THREADS,
  type NewsCategoryKey,
  type NewsCategoryThreads,
  type NewsPlaces,
} from "../config/newsHub.js";
import { MAX_CONTAINER_TEXT } from "../config/textLimits.js";
import { parseCustomIdSegments, validateCustomId } from "../utilities/CustomIdUtils.js";
import { buildComponentsV2Flags, safeV2TextContent } from "./ComponentsV2Utils.js";
import { newsItemFrom, type INewsMessage } from "./NewsItem.js";
import { sharedStateCommandRefusal } from "./SharedStateCommandGuard.js";
import { buildSelectOptions, buildSelectRow } from "./uiComponents.js";

// The private prompt of the "Change news category" message command (spec api#367,
// bot#1541): the seven News Categories to choose from. The picker's custom ID carries the
// message, so a choice made after a bot restart still works.

export const NOT_A_NEWS_ITEM_MESSAGE = "This message isn't a News Item.";

const PROMPT_TEXT = "**Change news category**\nChoose the News Category this news belongs in. " +
  "Its copy moves to that category's thread.";

export function isNewsCategoryKey(value: string): value is NewsCategoryKey {
  return (NEWS_CATEGORY_KEYS as readonly string[]).includes(value);
}

/** Which message a category choice is for. */
export interface INewsCategoryPickTarget {
  channelId: string;
  messageId: string;
}

export function buildNewsCategoryPickId(channelId: string, messageId: string): string {
  return validateCustomId(`${NEWS_CATEGORY_PICK_PREFIX}:${channelId}:${messageId}`);
}

export function parseNewsCategoryPickId(customId: string): INewsCategoryPickTarget | null {
  if (!customId.startsWith(`${NEWS_CATEGORY_PICK_PREFIX}:`)) return null;
  const [channelId, messageId] = parseCustomIdSegments(customId, 2) ?? [];
  const snowflake = /^\d+$/;
  if (!snowflake.test(channelId ?? "") || !snowflake.test(messageId ?? "")) return null;
  return { channelId, messageId };
}

/** The private prompt: a short explanation and a menu of the seven News Categories. */
export function buildNewsCategoryPrompt(
  channelId: string,
  messageId: string,
  threads: NewsCategoryThreads = NEWS_CATEGORY_THREADS,
): { components: ContainerBuilder[]; flags: number } {
  const select = new StringSelectMenuBuilder()
    .setCustomId(buildNewsCategoryPickId(channelId, messageId))
    .setPlaceholder("Choose a News Category")
    .addOptions(buildSelectOptions(NEWS_CATEGORY_KEYS.map((key) => ({
      label: NEWS_CATEGORY_NAMES[key],
      value: key,
      emoji: threads[key].emoji,
    }))));
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeV2TextContent(PROMPT_TEXT, MAX_CONTAINER_TEXT)),
    )
    .addActionRowComponents(buildSelectRow(select).toJSON());
  return { components: [container], flags: buildComponentsV2Flags(true) };
}

/**
 * Why the command refuses before showing the prompt, or null to show it. Test mode refuses
 * (it shares the production API). A message outside the News Channel, or one there with
 * no link and no image, cannot be a News Item; the bot's own posts there (`/news share`)
 * can, and the API has the last word on every choice.
 */
export function newsCategoryPromptRefusal(
  message: INewsMessage,
  places: NewsPlaces,
  botUserId: string,
  testMode: boolean,
): string | null {
  const testRefusal = sharedStateCommandRefusal("Change news category", testMode);
  if (testRefusal) return testRefusal;
  if (!places.has(message.channelId)) return NOT_A_NEWS_ITEM_MESSAGE;
  if (message.author.id === botUserId) return null;
  return newsItemFrom(message, places) ? null : NOT_A_NEWS_ITEM_MESSAGE;
}
