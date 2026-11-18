import {
  ApplicationCommandOptionType,
  MessageFlags,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type CommandInteraction,
} from "discord.js";
import { ButtonComponent, Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { CODEX_LORE_PREFIX } from "../../config/customIdPrefixes.js";
import {
  parseCodexEntryOption,
  parseCodexLoreId,
} from "../../functions/CodexCustomIds.js";
import { resolveFeatureGate } from "../../functions/FeatureGate.js";
import {
  safeDeferReply,
  safeDeferUpdate,
  safeRespond,
} from "../../functions/InteractionUtils.js";
import { codexView } from "../../services/CodexFunFacts.js";
import {
  loreChoices,
  loreReadReply,
  pageTurnRefusal,
} from "../../services/CodexReading.js";
import { featureGateSource } from "../../services/FeatureAccessService.js";
import {
  replyPrivately,
  showButtonResult,
  showCommandResult,
} from "./codex-read.utils.js";

// /codex lore read (spec api#397, bot#1563, design 3B+3C+3D): a Lore Entry, a page at a
// time. Private by default with Post this page; `public: True` posts it. The buttons hold
// the Lore Entry, page and the member who ran it, so they work after a restart.

/**
 * Autocomplete for `entry:`. The feature gate passes autocomplete through, so it is checked
 * here: a member the Club Codex is hidden from is offered nothing.
 */
async function autocompleteLore(interaction: AutocompleteInteraction): Promise<void> {
  const decision = await resolveFeatureGate(
    { type: "command", name: interaction.commandName },
    interaction.user.id,
    featureGateSource,
  );
  if (decision === "not_available") {
    await safeRespond(interaction, []);
    return;
  }
  const focused = interaction.options.getFocused(true);
  await safeRespond(interaction, await loreChoices({ query: String(focused?.value ?? "") }));
}

@Discord()
@SlashGroup({ name: "lore", description: "Read Club Lore", root: "codex" })
@SlashGroup("lore", "codex")
export class CodexLoreCommand {
  @Slash({ name: "read", description: "Read a Lore Entry, a story about the club" })
  async read(
    @SlashOption({
      name: "entry",
      description: "The Lore Entry",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteLore,
    })
    entryRaw: string,
    @SlashOption({
      name: "public",
      description: "Post it in the channel instead of showing it only to you",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    isPublic: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const posted = isPublic === true;
    await safeDeferReply(interaction, posted ? {} : { flags: MessageFlags.Ephemeral });
    const result = await loreReadReply({
      entryId: parseCodexEntryOption(entryRaw),
      page: 1,
      ownerId: interaction.user.id,
      visibility: posted ? "public" : "private",
    });
    await showCommandResult(interaction, result, posted);
  }

  @ButtonComponent({ id: new RegExp(`^${CODEX_LORE_PREFIX}:`) })
  async pageButton(interaction: ButtonInteraction): Promise<void> {
    const target = parseCodexLoreId(interaction.customId);
    if (!target) {
      await replyPrivately(interaction, codexView("This button is out of date."));
      return;
    }
    const refusal = pageTurnRefusal(target, interaction.user.id);
    if (refusal) {
      await replyPrivately(interaction, refusal);
      return;
    }
    if (!(await safeDeferUpdate(interaction))) return;
    const post = target.action === "post";
    const result = await loreReadReply({
      ...target,
      visibility: post ? "public" : target.visibility,
    });
    await showButtonResult(interaction, result, post);
  }
}
