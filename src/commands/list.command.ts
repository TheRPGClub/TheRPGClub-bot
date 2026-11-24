import {
  ApplicationCommandOptionType,
  MessageFlags,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type CommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  SelectMenuComponent,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";
import { GAME_LIST_ADD_PREFIX, GAME_LIST_PAGE_PREFIX } from "../config/customIdPrefixes.js";
import { buildErrorReply } from "../functions/ComponentsV2Utils.js";
import {
  parseGameListAddId,
  parseGameListOption,
  parseGameListPageId,
} from "../functions/GameListCustomIds.js";
import {
  isAutocompleteGated,
  replaceWithPrivateReply,
  safeDeferReply,
  safeDeferUpdate,
  safeEditReply,
  safeFollowUpIfSettled,
  safeRespond,
  type AnyRepliable,
} from "../functions/InteractionUtils.js";
import {
  addGameReply,
  addListChoices,
  addToListPrompt,
  gameListViewReply,
  notice,
  viewListChoices,
  type GameListResult,
  type IChoice,
  type IGameListPage,
} from "../services/GameLists.js";
import { autocompleteGameDbViewTitle } from "./gamedb/gamedb-utils.js";
import { parsePositiveId } from "../functions/CustomIdUtils.js";

// /list (spec api#442, bot#1568): read a Game List and add games to your own. The whole
// command, its components and the game view's Add to a Game List belong to the game_lists
// Feature (config/featureGate.ts). Every component holds what it acts on and reads for
// whoever clicks, so it still works after a restart.

type ChoiceSource = (input: { query: string; actingUserId: string }) => Promise<IChoice[]>;

function listAutocomplete(source: ChoiceSource) {
  return async (interaction: AutocompleteInteraction): Promise<void> => {
    if (await isAutocompleteGated(interaction)) {
      await safeRespond(interaction, []);
      return;
    }
    const focused = interaction.options.getFocused(true);
    await safeRespond(interaction, await source({
      query: String(focused?.value ?? ""),
      actingUserId: interaction.user.id,
    }));
  };
}

/** `list:` and `game:` share /list add; each gets its own choices. */
async function autocompleteAdd(interaction: AutocompleteInteraction): Promise<void> {
  if (interaction.options.getFocused(true).name === "game") {
    await autocompleteGameDbViewTitle(interaction);
    return;
  }
  await listAutocomplete(addListChoices)(interaction);
}

/** A page as a message: its view and shelf picture, replacing any earlier picture. */
function pagePayload(page: IGameListPage, isPrivate: boolean): object {
  const flags = isPrivate ? page.view.flags | MessageFlags.Ephemeral : page.view.flags;
  return { ...page.view, flags, files: page.files, attachments: [] };
}

/** The member's own copy of a notice or an error. */
function privately(result: Exclude<GameListResult, { page: IGameListPage }>): object {
  if ("error" in result) return buildErrorReply(result.error, true);
  return { ...result.notice, flags: result.notice.flags | MessageFlags.Ephemeral };
}

/** Fills a deferred reply that is only for the member. */
async function showPrivateResult(
  interaction: AnyRepliable,
  result: GameListResult,
): Promise<void> {
  await safeEditReply(
    interaction,
    "page" in result ? pagePayload(result.page, true) : privately(result),
  );
}

/**
 * The game view's Add to a Game List button: a private select of the member's lists.
 * Called by the game view's action handler (gamedb-view.command.ts).
 */
export async function showAddToListPrompt(
  interaction: ButtonInteraction,
  game: { id: number; title: string },
): Promise<void> {
  await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
  const result = await addToListPrompt({
    gameId: game.id,
    gameTitle: game.title,
    actingUserId: interaction.user.id,
  });
  await showPrivateResult(interaction, result);
}

@Discord()
@SlashGroup({ name: "list", description: "Game Lists: read one, or add a game to yours" })
@SlashGroup("list")
export class GameListCommand {
  @Slash({ name: "view", description: "Show a Game List" })
  async view(
    @SlashOption({
      name: "list",
      description: "The Game List: yours first, then the club's and other members'",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: listAutocomplete(viewListChoices),
    })
    listRaw: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, {});
    const result = await gameListViewReply({
      listId: parseGameListOption(listRaw),
      page: 1,
      readerId: interaction.user.id,
    });
    if ("page" in result && !result.page.private) {
      await safeEditReply(interaction, pagePayload(result.page, false));
      return;
    }
    // A Private list, a notice or an error is only ever for the member.
    await replaceWithPrivateReply(
      interaction,
      "page" in result ? pagePayload(result.page, true) : privately(result),
    );
  }

  @Slash({ name: "add", description: "Add a game to one of your Game Lists" })
  async add(
    @SlashOption({
      name: "game",
      description: "The game, from GameDB",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteAdd,
    })
    gameRaw: string,
    @SlashOption({
      name: "list",
      description: "One of your Game Lists",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteAdd,
    })
    listRaw: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const result = await addGameReply({
      listId: parseGameListOption(listRaw),
      gameId: parsePositiveId(gameRaw),
      actingUserId: interaction.user.id,
    });
    await showPrivateResult(interaction, result);
  }

  @ButtonComponent({ id: new RegExp(`^${GAME_LIST_PAGE_PREFIX}:`) })
  async pageButton(interaction: ButtonInteraction): Promise<void> {
    const target = parseGameListPageId(interaction.customId);
    if (!(await safeDeferUpdate(interaction))) return;
    const result: GameListResult = target
      ? await gameListViewReply({ ...target, readerId: interaction.user.id })
      : notice("This button is out of date. Run /list view again.");
    const onPrivateMessage = interaction.message.flags.has(MessageFlags.Ephemeral);
    if ("page" in result && (onPrivateMessage || !result.page.private)) {
      await safeEditReply(interaction, pagePayload(result.page, onPrivateMessage));
      return;
    }
    await safeFollowUpIfSettled(
      interaction,
      "page" in result ? pagePayload(result.page, true) : privately(result),
    );
  }

  @SelectMenuComponent({ id: new RegExp(`^${GAME_LIST_ADD_PREFIX}:`) })
  async addSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    if (!(await safeDeferUpdate(interaction))) return;
    const result = await addGameReply({
      listId: parseGameListOption(interaction.values[0]),
      gameId: parseGameListAddId(interaction.customId),
      actingUserId: interaction.user.id,
    });
    await showPrivateResult(interaction, result);
  }
}
