import {
  ApplicationCommandOptionType,
  MessageFlags,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type CommandInteraction,
} from "discord.js";
import { ButtonComponent, Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { PLAYTIME_UNDO_PREFIX } from "../config/customIdPrefixes.js";
import { buildErrorReply, buildTextReply } from "../functions/ComponentsV2Utils.js";
import { parsePositiveId } from "../functions/CustomIdUtils.js";
import {
  safeDeferReply,
  safeDeferUpdate,
  safeEditReply,
  safeFollowUpIfSettled,
  safeReply,
  safeRespond,
  sanitizeUserInput,
  type AnyRepliable,
} from "../functions/InteractionUtils.js";
import GameSearchService from "../classes/GameSearchService.js";
import {
  resolveGameCompletionPlatformId,
} from "./game-completion/completion-autocomplete.utils.js";
import { autocompleteGameDbViewTitle } from "./gamedb/gamedb-utils.js";
import {
  addPlaytimeReply,
  myPlaytimeReply,
  parsePlaytimeUndoId,
  PLAYTIME_OTHER_PLATFORM,
  playtimePlatformChoicesFor,
  undoPlaytimeReply,
  type IPlaytimeGame,
  type PlaytimeResult,
} from "../services/Playtime.js";

// /playtime add and the game view's My Playtime (spec api#457, bot#1572, design 5B and 6B).
// Playtime is ungated, so nothing here is in config/featureGate.ts. Undo carries what it
// undoes in its custom ID and works after a restart.

/** `title` and `platform` share /playtime add; each gets its own choices. */
async function autocompletePlaytimeAdd(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name === "title") {
    await autocompleteGameDbViewTitle(interaction);
    return;
  }
  const query = sanitizeUserInput(String(focused.value ?? ""), { preserveNewlines: false });
  await safeRespond(interaction, await playtimePlatformChoicesFor({
    query,
    userId: interaction.user.id,
    gameId: parsePositiveId(interaction.options.getString("title") ?? undefined),
  }));
}

/** The game ID from the title option: a picked choice, or a title typed out exactly. */
async function resolvePlaytimeGameId(raw: string): Promise<number | null> {
  const picked = parsePositiveId(raw);
  if (picked !== null) return picked;
  const title = sanitizeUserInput(raw, { preserveNewlines: false }).trim().toLowerCase();
  if (!title) return null;
  const results = await GameSearchService.searchGames(title);
  return results.find((game) => game.title.toLowerCase() === title)?.id ?? null;
}

/** The platform ID from its option: null for Other, undefined when it names none. */
async function resolvePlaytimePlatformId(raw: string): Promise<number | null | undefined> {
  if (raw.trim().toLowerCase() === PLAYTIME_OTHER_PLATFORM) return null;
  return (await resolveGameCompletionPlatformId(raw)) ?? undefined;
}

/** Fills a deferred private reply. */
async function showPrivateResult(
  interaction: AnyRepliable,
  result: PlaytimeResult,
): Promise<void> {
  await safeEditReply(
    interaction,
    "view" in result ? result.view : buildErrorReply(result.error, true),
  );
}

/**
 * The game view's My Playtime button: the presser's own Playtime, privately. Called by the
 * game view's action handler (gamedb-view.command.ts).
 */
export async function showMyPlaytime(
  interaction: ButtonInteraction,
  game: IPlaytimeGame,
): Promise<void> {
  await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
  await showPrivateResult(
    interaction,
    await myPlaytimeReply({ userId: interaction.user.id, game }),
  );
}

@Discord()
@SlashGroup({ name: "playtime", description: "Your Playtime: record time no Provider sees" })
@SlashGroup("playtime")
export class PlaytimeCommand {
  @Slash({ name: "add", description: "Add to (or set) your Manual Playtime for a game" })
  async add(
    @SlashOption({
      name: "title",
      description: "The game, from GameDB",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompletePlaytimeAdd,
    })
    titleRaw: string,
    @SlashOption({
      name: "platform",
      description: "The platform you played on (yours first)",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompletePlaytimeAdd,
    })
    platformRaw: string,
    @SlashOption({
      name: "hours",
      description: "Hours to add (e.g. 3 or 1.5), or the new total with set:true",
      type: ApplicationCommandOptionType.Number,
      required: true,
      minValue: 0,
    })
    hours: number,
    @SlashOption({
      name: "set",
      description: "Set this platform's total to these hours instead of adding",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    set: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const result = await addPlaytimeReply({
      userId: interaction.user.id,
      gameId: await resolvePlaytimeGameId(titleRaw),
      platformId: await resolvePlaytimePlatformId(platformRaw),
      hours,
      set: set ?? false,
    });
    await showPrivateResult(interaction, result);
  }

  @ButtonComponent({ id: new RegExp(`^${PLAYTIME_UNDO_PREFIX}:`) })
  async undoButton(interaction: ButtonInteraction): Promise<void> {
    const undo = parsePlaytimeUndoId(interaction.customId);
    if (!undo) {
      await safeReply(interaction, buildTextReply("This button is out of date.", true));
      return;
    }
    if (undo.userId !== interaction.user.id) {
      await safeReply(interaction, buildTextReply("This Undo isn't yours.", true));
      return;
    }
    if (!(await safeDeferUpdate(interaction))) return;
    const result = await undoPlaytimeReply(undo);
    if ("view" in result) {
      await safeEditReply(interaction, result.view);
      return;
    }
    await safeFollowUpIfSettled(interaction, buildErrorReply(result.error, true));
  }
}
