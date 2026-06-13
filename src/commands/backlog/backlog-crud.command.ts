import {
  ApplicationCommandOptionType,
  CommandInteraction,
  MessageFlags,
} from "discord.js";
import {
  Discord,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";
import UserGameBacklog from "../../classes/UserGameBacklog.js";
import {
  autocompleteGameCompletionPlatformStandardFirst,
  resolveGameCompletionPlatformId,
} from "../game-completion/completion-autocomplete.utils.js";
import {
  safeDeferReply,
  safeReply,
  sanitizeUserInput,
} from "../../functions/InteractionUtils.js";
import { resolveCollectionGameForAdd } from "../collection/collection-game-resolve.utils.js";
import { buildTextReply } from "../../functions/ComponentsV2Utils.js";
import { createIgdbSession } from "../../services/IGDB/IgdbSelectService.js";
import Game from "../../classes/Game.js";
import {
  autocompleteBacklogEntry,
  autocompleteBacklogGameTitle,
  parseBacklogEntryAutocompleteValue,
} from "./backlog-autocomplete.utils.js";

@Discord()
@SlashGroup({ description: "Manage your game backlog", name: "backlog" })
@SlashGroup("backlog")
export class BacklogCrudCommand {
  @Slash({ name: "add", description: "Add a game to your backlog" })
  async add(
    @SlashOption({
      name: "title",
      description: "Game title from GameDB",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteBacklogGameTitle,
    })
    gameIdRaw: string,
    @SlashOption({
      name: "platform",
      description: "Platform you plan to play on",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: autocompleteGameCompletionPlatformStandardFirst,
    })
    platformRaw: string | undefined,
    @SlashOption({
      name: "notes",
      description: "Optional notes",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    notes: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const platformId = platformRaw !== undefined
      ? await resolveGameCompletionPlatformId(platformRaw)
      : null;

    if (platformRaw !== undefined && !platformId) {
      await safeReply(interaction, "Invalid platform selection.");
      return;
    }

    const sanitizedNotes = notes
      ? sanitizeUserInput(notes, { preserveNewlines: true, maxLength: 500 })
      : null;

    let resolution;
    try {
      resolution = await resolveCollectionGameForAdd(gameIdRaw);
    } catch (err: any) {
      await safeReply(interaction, err?.message ?? "Invalid game selection.");
      return;
    }

    if (resolution.kind === "choose") {
      const { components } = createIgdbSession(
        interaction.user.id,
        resolution.options,
        async (selectionInteraction, igdbId) => {
          try {
            const imported = await Game.importGameFromIgdb(igdbId);
            const created = await UserGameBacklog.addEntry({
              userId: interaction.user.id,
              gameId: imported.gameId,
              platformId,
              notes: sanitizedNotes,
            });

            const platformLabel = created.platformName ?? (platformId ? `Platform #${platformId}` : "");
            const platformSuffix = platformLabel ? ` (${platformLabel})` : "";
            await safeReply(selectionInteraction, {
              ...buildTextReply(
                `Imported and added **${created.title}**${platformSuffix} to your backlog.`,
                true,
              ),
              __forceFollowUp: true,
            });
          } catch (err: any) {
            await safeReply(selectionInteraction, {
              ...buildTextReply(
                err?.message ?? "Failed to import from IGDB and add backlog entry.",
                true,
              ),
              __forceFollowUp: true,
            });
          }
        },
      );

      await safeReply(interaction, {
        content:
          `No exact GameDB match found for "${resolution.titleQuery}". ` +
          "Select the correct IGDB game to import:",
        components,
      });
      return;
    }

    try {
      const created = await UserGameBacklog.addEntry({
        userId: interaction.user.id,
        gameId: resolution.gameId,
        platformId,
        notes: sanitizedNotes,
      });

      const platformLabel = created.platformName ?? (platformId ? `Platform #${platformId}` : "");
      const platformSuffix = platformLabel ? ` (${platformLabel})` : "";
      await safeReply(interaction, `Added **${created.title}**${platformSuffix} to your backlog.`);
    } catch (err: any) {
      await safeReply(interaction, err?.message ?? "Failed to add backlog entry.");
    }
  }

  @Slash({ name: "edit", description: "Edit one of your backlog entries" })
  async edit(
    @SlashOption({
      name: "entry",
      description: "Backlog entry",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteBacklogEntry,
    })
    entryRaw: string,
    @SlashOption({
      name: "platform",
      description: "New platform",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: autocompleteGameCompletionPlatformStandardFirst,
    })
    platformRaw: string | undefined,
    @SlashOption({
      name: "notes",
      description: "New notes",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    notes: string | undefined,
    @SlashOption({
      name: "clear_notes",
      description: "Clear notes",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    clearNotes: boolean | undefined,
    @SlashOption({
      name: "sort_order",
      description: "Sort order (lower numbers appear first)",
      type: ApplicationCommandOptionType.Integer,
      required: false,
    })
    sortOrder: number | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const entryId = parseBacklogEntryAutocompleteValue(entryRaw);
    if (!entryId) {
      await safeReply(interaction, "Invalid backlog entry selection.");
      return;
    }

    const updates: {
      platformId?: number | null;
      notes?: string | null;
      sortOrder?: number | null;
    } = {};

    if (platformRaw !== undefined) {
      const platformId = await resolveGameCompletionPlatformId(platformRaw);
      if (!platformId) {
        await safeReply(interaction, "Invalid platform selection.");
        return;
      }
      updates.platformId = platformId;
    }

    if (clearNotes) {
      updates.notes = null;
    } else if (notes !== undefined) {
      updates.notes = sanitizeUserInput(notes, { preserveNewlines: true, maxLength: 500 });
    }

    if (sortOrder !== undefined) {
      updates.sortOrder = sortOrder;
    }

    if (!Object.keys(updates).length) {
      await safeReply(interaction, "Provide at least one field to update.");
      return;
    }

    try {
      const updated = await UserGameBacklog.updateEntryForUser(
        entryId,
        interaction.user.id,
        updates,
      );
      if (!updated) {
        await safeReply(interaction, "Backlog entry was not found.");
        return;
      }

      const platformLabel = updated.platformName ?? "No platform";
      await safeReply(interaction, `Updated **${updated.title}** (${platformLabel}) in your backlog.`);
    } catch (err: any) {
      await safeReply(interaction, err?.message ?? "Failed to update backlog entry.");
    }
  }

  @Slash({ name: "remove", description: "Remove one of your backlog entries" })
  async remove(
    @SlashOption({
      name: "entry",
      description: "Backlog entry",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteBacklogEntry,
    })
    entryRaw: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const entryId = parseBacklogEntryAutocompleteValue(entryRaw);
    if (!entryId) {
      await safeReply(interaction, "Invalid backlog entry selection.");
      return;
    }

    const existing = await UserGameBacklog.getEntryForUser(entryId, interaction.user.id);
    if (!existing) {
      await safeReply(interaction, "Backlog entry was not found.");
      return;
    }

    const deleted = await UserGameBacklog.removeEntryForUser(entryId, interaction.user.id);
    if (!deleted) {
      await safeReply(interaction, "Failed to remove that backlog entry.");
      return;
    }

    await safeReply(interaction, `Removed **${existing.title}** from your backlog.`);
  }
}
