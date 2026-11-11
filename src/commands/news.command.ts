import {
  ApplicationCommandOptionType,
  type Attachment,
  type CommandInteraction,
  MessageFlags,
} from "discord.js";
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";

import {
  NEWS_CATEGORY_KEYS,
  NEWS_CATEGORY_NAMES,
  NEWS_COMMAND,
  NEWS_SHARE_COMMENT_MAX,
  NEWS_SHARE_LINK_MAX,
  NEWS_SHARE_SUBCOMMAND,
  type NewsCategoryKey,
} from "../config/newsHub.js";
import { buildErrorReply, buildTextReply } from "../functions/ComponentsV2Utils.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import {
  createNewsShareDeps,
  shareNewsReply,
  type INewsShareReply,
} from "../services/NewsShare.js";
import { buildAnyErrorMessage } from "../utilities/ApiErrorUtils.js";

const CATEGORY_CHOICES = NEWS_CATEGORY_KEYS.map((key) => ({
  name: NEWS_CATEGORY_NAMES[key],
  value: key,
}));

/** The member's name as the club sees it: their server nickname when there is one. */
function sharerName(interaction: CommandInteraction): string {
  return interaction.inCachedGuild()
    ? interaction.member.displayName
    : interaction.user.displayName;
}

/**
 * `/news` (spec api#367): members share news through the bot. It belongs to the News Hub
 * Feature, so the feature gate makes it staff-only in Preview and refuses it while Off.
 */
@Discord()
@SlashGroup({ description: "Share game news with the club", name: NEWS_COMMAND })
@SlashGroup(NEWS_COMMAND)
export class NewsCommand {
  @Slash({
    description: "Share a news link in the News Channel, choosing its category if you like",
    name: NEWS_SHARE_SUBCOMMAND,
  })
  async share(
    @SlashOption({
      description: "The news link (an http or https address)",
      name: "link",
      required: true,
      type: ApplicationCommandOptionType.String,
      maxLength: NEWS_SHARE_LINK_MAX,
    })
    link: string,
    @SlashChoice(...CATEGORY_CHOICES)
    @SlashOption({
      description: "The News Category; leave it out and the bot picks one",
      name: "category",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    categoryKey: NewsCategoryKey | undefined,
    @SlashOption({
      description: "What you want to say about it",
      name: "comment",
      required: false,
      type: ApplicationCommandOptionType.String,
      maxLength: NEWS_SHARE_COMMENT_MAX,
    })
    comment: string | undefined,
    @SlashOption({
      description: "An image to post with it",
      name: "image",
      required: false,
      type: ApplicationCommandOptionType.Attachment,
    })
    image: Attachment | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    // Waiting for the link preview can take up to 10 seconds.
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    let reply: INewsShareReply;
    try {
      reply = await shareNewsReply({
        sharer: { id: interaction.user.id, name: sharerName(interaction) },
        link: link.trim(),
        categoryKey: categoryKey ?? null,
        comment: comment?.trim() || null,
        image: image
          ? { url: image.url, name: image.name, contentType: image.contentType }
          : null,
      }, createNewsShareDeps(interaction.client));
    } catch (error: unknown) {
      reply = { text: buildAnyErrorMessage("Could not share your news", error), failed: true };
    }
    const payload = reply.failed
      ? buildErrorReply(reply.text, true)
      : buildTextReply(reply.text, true);
    await safeReply(interaction, payload);
  }
}
