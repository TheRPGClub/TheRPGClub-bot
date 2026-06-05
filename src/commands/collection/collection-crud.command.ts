import {
  ApplicationCommandOptionType,
  CommandInteraction,
  MessageFlags,
} from "discord.js";
import {
  Discord,
  Slash,
  SlashChoice,
  SlashGroup,
  SlashOption,
} from "discordx";
import UserGameCollection, {
  COLLECTION_OWNERSHIP_TYPES,
  type CollectionOwnershipType,
} from "../../classes/UserGameCollection.js";
import Member from "../../classes/Member.js";
import {
  autocompleteGameCompletionPlatformStandardFirst,
  resolveGameCompletionPlatformId,
} from "../game-completion/completion-autocomplete.utils.js";
import {
  safeDeferReply,
  safeReply,
  sanitizeUserInput,
} from "../../functions/InteractionUtils.js";
import {
  COMPLETION_TYPES,
  type CompletionType,
  parseCompletionDateInput,
} from "../profile.command.js";
import { saveCompletion } from "../../functions/CompletionHelpers.js";
import { createIgdbSession } from "../../services/IGDB/IgdbSelectService.js";
import Game from "../../classes/Game.js";
import {
  autocompleteCollectionEntry,
  autocompleteCollectionGameTitle,
  parseCollectionEntryAutocompleteValue,
} from "./collection-autocomplete.utils.js";
import { resolveCollectionGameForAdd } from "./collection-game-resolve.utils.js";
import { buildTextReply } from "../../functions/ComponentsV2Utils.js";

@Discord()
@SlashGroup({ description: "Manage your game collection", name: "collection" })
@SlashGroup("collection")
export class CollectionCrudCommand {
  @Slash({ name: "add", description: "Add a game you own to your collection" })
  async add(
    @SlashOption({
      name: "title",
      description: "Game title from GameDB",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteCollectionGameTitle,
    })
    gameIdRaw: string,
    @SlashOption({
      name: "platform",
      description: "Owned platform",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteGameCompletionPlatformStandardFirst,
    })
    platformRaw: string,
    @SlashChoice(
      ...COLLECTION_OWNERSHIP_TYPES.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      name: "ownership_type",
      description: "Ownership metadata",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    ownershipType: CollectionOwnershipType,
    @SlashOption({
      name: "note",
      description: "Optional note",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    note: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const platformId = await resolveGameCompletionPlatformId(platformRaw);
    if (!platformId) {
      await safeReply(interaction, "Invalid platform selection.");
      return;
    }

    const sanitizedNote = note
      ? sanitizeUserInput(note, { preserveNewlines: true, maxLength: 500 })
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
            const created = await UserGameCollection.addEntry({
              userId: interaction.user.id,
              gameId: imported.gameId,
              platformId,
              ownershipType,
              note: sanitizedNote,
            });

            const platformLabel = created.platformName ?? `Platform #${platformId}`;
            await safeReply(selectionInteraction, {
              ...buildTextReply(
                `Imported and added **${created.title}** (${platformLabel}, ` +
                `${created.ownershipType}) to your collection.`,
                true,
              ),
              __forceFollowUp: true,
            });
          } catch (err: any) {
            await safeReply(selectionInteraction, {
              ...buildTextReply(
                err?.message ?? "Failed to import from IGDB and add collection entry.",
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

    const resolvedGame = resolution;

    try {
      const created = await UserGameCollection.addEntry({
        userId: interaction.user.id,
        gameId: resolvedGame.gameId,
        platformId,
        ownershipType,
        note: sanitizedNote,
      });

      const platformLabel = created.platformName ?? `Platform #${platformId}`;
      await safeReply(interaction, 
        `Added **${created.title}** (${platformLabel}, ${created.ownershipType}) ` +
        `to your collection.`,
      );
    } catch (err: any) {
      await safeReply(interaction, err?.message ?? "Failed to add collection entry.");
    }
  }

  @Slash({ name: "edit", description: "Edit one of your collection entries" })
  async edit(
    @SlashOption({
      name: "entry",
      description: "Collection entry",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteCollectionEntry,
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
    @SlashChoice(
      ...COLLECTION_OWNERSHIP_TYPES.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      name: "ownership_type",
      description: "New ownership type",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    ownershipType: CollectionOwnershipType | undefined,
    @SlashOption({
      name: "note",
      description: "New note",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    note: string | undefined,
    @SlashOption({
      name: "clear_note",
      description: "Clear note",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    clearNote: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const entryId = parseCollectionEntryAutocompleteValue(entryRaw);
    if (!entryId) {
      await safeReply(interaction, "Invalid collection entry selection.");
      return;
    }

    const updates: {
      platformId?: number | null;
      ownershipType?: CollectionOwnershipType;
      note?: string | null;
    } = {};

    if (platformRaw !== undefined) {
      const platformId = await resolveGameCompletionPlatformId(platformRaw);
      if (!platformId) {
        await safeReply(interaction, "Invalid platform selection.");
        return;
      }
      updates.platformId = platformId;
    }

    if (ownershipType !== undefined) {
      updates.ownershipType = ownershipType;
    }

    if (clearNote) {
      updates.note = null;
    } else if (note !== undefined) {
      updates.note = sanitizeUserInput(note, { preserveNewlines: true, maxLength: 500 });
    }

    if (!Object.keys(updates).length) {
      await safeReply(interaction, "Provide at least one field to update.");
      return;
    }

    try {
      const updated = await UserGameCollection.updateEntryForUser(
        entryId,
        interaction.user.id,
        updates,
      );
      if (!updated) {
        await safeReply(interaction, "Collection entry was not found.");
        return;
      }

      const platformLabel = updated.platformName ?? "Unknown platform";
      await safeReply(interaction, 
        `Updated **${updated.title}** (${platformLabel}, ${updated.ownershipType}).`,
      );
    } catch (err: any) {
      await safeReply(interaction, err?.message ?? "Failed to update collection entry.");
    }
  }

  @Slash({ name: "remove", description: "Remove one of your collection entries" })
  async remove(
    @SlashOption({
      name: "entry",
      description: "Collection entry",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteCollectionEntry,
    })
    entryRaw: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const entryId = parseCollectionEntryAutocompleteValue(entryRaw);
    if (!entryId) {
      await safeReply(interaction, "Invalid collection entry selection.");
      return;
    }

    const existing = await UserGameCollection.getEntryForUser(entryId, interaction.user.id);
    if (!existing) {
      await safeReply(interaction, "Collection entry was not found.");
      return;
    }

    const deleted = await UserGameCollection.removeEntryForUser(entryId, interaction.user.id);
    if (!deleted) {
      await safeReply(interaction, "Failed to remove that collection entry.");
      return;
    }

    await safeReply(interaction, `Removed **${existing.title}** from your collection.`);
  }

  @Slash({
    name: "to-now-playing",
    description: "Add a collection entry to your now-playing list",
  })
  async toNowPlaying(
    @SlashOption({
      name: "entry",
      description: "Collection entry",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteCollectionEntry,
    })
    entryRaw: string,
    @SlashOption({
      name: "note_override",
      description: "Override note for now-playing",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    noteOverride: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const entryId = parseCollectionEntryAutocompleteValue(entryRaw);
    if (!entryId) {
      await safeReply(interaction, "Invalid collection entry selection.");
      return;
    }

    const entry = await UserGameCollection.getEntryForUser(entryId, interaction.user.id);
    if (!entry) {
      await safeReply(interaction, "Collection entry was not found.");
      return;
    }

    if (!entry.platformId) {
      await safeReply(interaction, 
        "This entry does not have a platform. Update it before adding.",
      );
      return;
    }

    const note = noteOverride !== undefined
      ? sanitizeUserInput(noteOverride, { preserveNewlines: true, maxLength: 500 })
      : entry.note;

    try {
      await Member.addNowPlaying(interaction.user.id, entry.gameId, entry.platformId, note);
      await safeReply(interaction, 
        `Added **${entry.title}** (${entry.platformName ?? "Unknown platform"}) ` +
        "to your now-playing list.",
      );
    } catch (err: any) {
      await safeReply(interaction, err?.message ?? "Failed to add entry to now-playing.");
    }
  }

  @Slash({ name: "to-completion", description: "Log a completion from a collection entry" })
  async toCompletion(
    @SlashOption({
      name: "entry",
      description: "Collection entry",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteCollectionEntry,
    })
    entryRaw: string,
    @SlashChoice(
      ...COMPLETION_TYPES.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      name: "completion_type",
      description: "Type of completion",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    completionType: CompletionType,
    @SlashOption({
      name: "completion_date",
      description: "YYYY-MM-DD, today, or unknown",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    completionDateRaw: string | undefined,
    @SlashOption({
      name: "final_playtime_hours",
      description: "Playtime in hours",
      type: ApplicationCommandOptionType.Number,
      required: false,
    })
    finalPlaytimeHours: number | undefined,
    @SlashOption({
      name: "note",
      description: "Optional completion note",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    note: string | undefined,
    @SlashOption({
      name: "announce",
      description: "Announce completion",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    announce: boolean | undefined,
    @SlashOption({
      name: "remove_from_now_playing",
      description: "Remove game from now-playing",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    removeFromNowPlaying: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const entryId = parseCollectionEntryAutocompleteValue(entryRaw);
    if (!entryId) {
      await safeReply(interaction, "Invalid collection entry selection.");
      return;
    }

    const entry = await UserGameCollection.getEntryForUser(entryId, interaction.user.id);
    if (!entry) {
      await safeReply(interaction, "Collection entry was not found.");
      return;
    }

    const completionDateInput = completionDateRaw
      ? sanitizeUserInput(completionDateRaw, { preserveNewlines: false })
      : undefined;

    let completedAt: Date | null;
    try {
      completedAt = parseCompletionDateInput(completionDateInput);
    } catch (err: any) {
      await safeReply(interaction, err?.message ?? "Invalid completion date.");
      return;
    }

    if (
      finalPlaytimeHours !== undefined &&
      (Number.isNaN(finalPlaytimeHours) || finalPlaytimeHours < 0)
    ) {
      await safeReply(interaction, "Final playtime must be a non-negative number.");
      return;
    }

    const completionNote = note !== undefined
      ? sanitizeUserInput(note, { preserveNewlines: true, maxLength: 500 }) || null
      : entry.note;

    const doRemoveFromNowPlaying = removeFromNowPlaying ?? true;
    await saveCompletion(
      interaction,
      interaction.user.id,
      entry.gameId,
      entry.platformId,
      completionType,
      completedAt,
      finalPlaytimeHours ?? null,
      completionNote,
      entry.title,
      announce,
      false,
      doRemoveFromNowPlaying,
    );
  }
}

