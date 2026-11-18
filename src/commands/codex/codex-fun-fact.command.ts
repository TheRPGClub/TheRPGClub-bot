import {
  ApplicationCommandOptionType,
  MessageFlags,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type CommandInteraction,
} from "discord.js";
import { ButtonComponent, Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { FUN_FACT_MAX_LENGTH } from "../../config/codex.js";
import { CODEX_FUN_FACT_PREFIX } from "../../config/customIdPrefixes.js";
import { parseCodexFunFactId } from "../../functions/CodexCustomIds.js";
import { buildErrorReply } from "../../functions/ComponentsV2Utils.js";
import { resolveFeatureGate } from "../../functions/FeatureGate.js";
import {
  safeDeferReply,
  safeDeferUpdate,
  safeEditReply,
  safeRespond,
  type AnyRepliable,
} from "../../functions/InteractionUtils.js";
import { featureGateSource } from "../../services/FeatureAccessService.js";
import {
  addFunFactReply,
  codexView,
  deleteFunFactQuestion,
  deleteFunFactReply,
  editFunFactReply,
  funFactChoices,
  keepFunFactView,
  type CodexReplyResult,
  type FunFactPick,
} from "../../services/CodexFunFacts.js";

// /codex fun-fact add, edit and delete (spec api#397, bot#1561). Every reply is private.
// The text option is passed on as typed: Discord's @ autocomplete has already made each
// mention a `<@id>` token, which the API stores (sanitizeUserInput would strip them). The
// delete question's buttons hold the Fun Fact ID and the clicking member is who acts, so
// they work after a restart.

async function showResult(interaction: AnyRepliable, result: CodexReplyResult): Promise<void> {
  await safeEditReply(
    interaction,
    "view" in result ? result.view : buildErrorReply(result.error, false),
  );
}

/**
 * Autocomplete for `fact:`. The feature gate passes autocomplete through, so it is checked
 * here: a member the Club Codex is hidden from is offered nothing.
 */
async function autocompleteFact(
  interaction: AutocompleteInteraction,
  action: FunFactPick,
): Promise<void> {
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
  await safeRespond(interaction, await funFactChoices({
    actingUserId: interaction.user.id,
    query: String(focused?.value ?? ""),
    action,
  }));
}

@Discord()
@SlashGroup({ name: "fun-fact", description: "Add, edit or delete Fun Facts", root: "codex" })
@SlashGroup("fun-fact", "codex")
export class CodexFunFactCommand {
  @Slash({ name: "add", description: "Add a Fun Fact about the club or its members" })
  async add(
    @SlashOption({
      name: "text",
      description: "One or two sentences; @mention members as usual",
      type: ApplicationCommandOptionType.String,
      required: true,
      maxLength: FUN_FACT_MAX_LENGTH,
    })
    text: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    await showResult(
      interaction,
      await addFunFactReply({ text, actingUserId: interaction.user.id }),
    );
  }

  @Slash({ name: "edit", description: "Change the text of a Fun Fact" })
  async edit(
    @SlashOption({
      name: "fact",
      description: "The Fun Fact to edit",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: (interaction: AutocompleteInteraction) => autocompleteFact(interaction, "edit"),
    })
    factRaw: string,
    @SlashOption({
      name: "text",
      description: "Its new text; @mention members as usual",
      type: ApplicationCommandOptionType.String,
      required: true,
      maxLength: FUN_FACT_MAX_LENGTH,
    })
    text: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    await showResult(
      interaction,
      await editFunFactReply({ factRaw, text, actingUserId: interaction.user.id }),
    );
  }

  @Slash({ name: "delete", description: "Delete a Fun Fact" })
  async delete(
    @SlashOption({
      name: "fact",
      description: "The Fun Fact to delete",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: (interaction: AutocompleteInteraction) =>
        autocompleteFact(interaction, "delete"),
    })
    factRaw: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    await showResult(
      interaction,
      await deleteFunFactQuestion({ factRaw, actingUserId: interaction.user.id }),
    );
  }

  @ButtonComponent({ id: new RegExp(`^${CODEX_FUN_FACT_PREFIX}:`) })
  async deleteButton(interaction: ButtonInteraction): Promise<void> {
    if (!(await safeDeferUpdate(interaction))) return;
    const target = parseCodexFunFactId(interaction.customId);
    if (!target) {
      await safeEditReply(interaction, codexView("This button is out of date."));
      return;
    }
    if (target.action === "keep") {
      await safeEditReply(interaction, keepFunFactView());
      return;
    }
    await showResult(
      interaction,
      await deleteFunFactReply({ factId: target.factId, actingUserId: interaction.user.id }),
    );
  }
}
