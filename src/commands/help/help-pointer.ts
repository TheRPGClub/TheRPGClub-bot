import type { ActionRowBuilder, ContainerBuilder, StringSelectMenuBuilder } from "discord.js";
import { buildTextContainer } from "../../functions/ComponentsV2Utils.js";

type LegacyHelpResponse = {
  components: (ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder>)[];
  flags: number;
};

/**
 * Prefixes a notice onto the old per-group help subcommands, which stay for one release as
 * pointers to the merged /help (issue #1244). Remove them together with this helper.
 */
export function withLegacyHelpPointer<T extends LegacyHelpResponse>(
  response: T,
  legacyCommand: string,
  category: string,
): T {
  const notice =
    `\`${legacyCommand}\` is moving to \`/help category:${category}\` ` +
    "and will be removed in a future release.";
  return { ...response, components: [buildTextContainer(notice), ...response.components] };
}
