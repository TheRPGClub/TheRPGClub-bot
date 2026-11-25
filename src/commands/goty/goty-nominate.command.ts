import {
  ApplicationCommandOptionType,
  MessageFlags,
  type AutocompleteInteraction,
  type CommandInteraction,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import GameSearchService from "../../classes/GameSearchService.js";
import Game from "../../classes/Game.js";
import { buildErrorReply, buildTextReply } from "../../functions/ComponentsV2Utils.js";
import { formatGameTitleWithYear } from "../../functions/GameTitleAutocompleteUtils.js";
import {
  safeDeferReply,
  safeReply,
  safeRespond,
  sanitizeUserInput,
} from "../../functions/InteractionUtils.js";
import { DISCORD_SELECT_OPTIONS_MAX } from "../../config/textLimits.js";
import {
  gotyNominateChoices,
  gotyNominateReply,
  resolveGotyNominateGame,
  type IGotyGameLookup,
} from "../../services/GotyNominations.js";
import { GOTY_VOTE_API } from "../../services/GotyVoteApi.js";
import { buildCaughtErrorMessage } from "../../utilities/ApiErrorUtils.js";

// /goty nominate (bot#1580): nominate a game for this year's Game of the Year, with no
// reason. The autocomplete marks games the year can't take; the API has the last word.

async function autocompleteGotyGame(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const query = sanitizeUserInput(String(focused?.value ?? ""), { preserveNewlines: false })
    .trim();
  if (!query) {
    await safeRespond(interaction, []);
    return;
  }
  const games = await GameSearchService.searchGamesAutocomplete(query);
  const choices = await gotyNominateChoices(
    games.slice(0, DISCORD_SELECT_OPTIONS_MAX).map((game) => ({
      id: game.id,
      label: formatGameTitleWithYear(game),
    })),
    { api: GOTY_VOTE_API },
  );
  await safeRespond(interaction, choices);
}

const GAME_LOOKUP: IGotyGameLookup = {
  getGameById: (id) => Game.getGameById(id),
  searchGames: (title) => GameSearchService.searchGames(title),
};

@Discord()
@SlashGroup("goty")
export class GotyNominateCommand {
  @Slash({ name: "nominate", description: "Nominate a game for this year's Game of the Year" })
  async nominate(
    @SlashOption({
      name: "game",
      description: "The game (autocomplete from GameDB; ineligible games are marked)",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteGotyGame,
    })
    rawGame: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    const input = sanitizeUserInput(rawGame, { preserveNewlines: false, maxLength: 256 });
    if (!input) {
      await safeReply(interaction, buildTextReply("Pick a game from the list.", true));
      return;
    }
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    let resolved: { id: number | null; found: string[] };
    try {
      resolved = await resolveGotyNominateGame(input, GAME_LOOKUP);
    } catch (err: unknown) {
      await safeReply(
        interaction,
        buildErrorReply(buildCaughtErrorMessage("Could not search GameDB.", err), true),
      );
      return;
    }
    if (resolved.id === null) {
      const found = resolved.found.length
        ? resolved.found.map((title) => `"${title}"`).join(", ")
        : "no results";
      await safeReply(interaction, buildTextReply(
        `I could not find one GameDB game for "${input}" (GameDB search returned: ${found}). ` +
          "Pick a game from the list, or add it to GameDB first.",
        true,
      ));
      return;
    }
    const reply = await gotyNominateReply(GOTY_VOTE_API, {
      userId: interaction.user.id,
      gameId: resolved.id,
    });
    if ("error" in reply) await safeReply(interaction, buildErrorReply(reply.error, true));
    else if ("text" in reply) await safeReply(interaction, buildTextReply(reply.text, true));
    else await safeReply(interaction, reply.view);
  }
}
