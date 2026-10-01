import type {
  ActionRowBuilder,
  ContainerBuilder,
  MessageActionRowComponentBuilder,
} from "discord.js";
import { buildTextContainer } from "../../functions/ComponentsV2Utils.js";
import { linkCommandMentions } from "../../services/CommandMentionService.js";

type HelpResponse = {
  components: (ContainerBuilder | ActionRowBuilder<MessageActionRowComponentBuilder>)[];
  flags: number;
};

/** Puts a text notice above a help menu response, its command references clickable. */
export function withHelpNotice<T extends HelpResponse>(response: T, content: string): T {
  const notice = buildTextContainer(linkCommandMentions(content));
  return { ...response, components: [notice, ...response.components] };
}

/**
 * Prefixes a notice onto the old per-group help subcommands, which stay for one release as
 * pointers to the merged /help (issue #1244). Remove them together with this helper.
 */
export function withLegacyHelpPointer<T extends HelpResponse>(
  response: T,
  legacyCommand: string,
  category: string,
): T {
  return withHelpNotice(
    response,
    `\`${legacyCommand}\` is moving to \`/help category:${category}\` ` +
      "and will be removed in a future release.",
  );
}
