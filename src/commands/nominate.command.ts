import type {
  AutocompleteInteraction,
  CommandInteraction,
  StringSelectMenuInteraction,
  TextBasedChannel,
} from "discord.js";
import {
  ApplicationCommandOptionType,
  MessageFlags,
  userMention,
} from "discord.js";
import { Discord, SelectMenuComponent, Slash, SlashChoice, SlashOption } from "discordx";
import type { NominationKind } from "../classes/Nomination.js";
import {
  getNominationForUser,
  listNominationsForRound,
  parseNominationKind,
  upsertNomination,
} from "../classes/Nomination.js";
import type { IGame } from "../types/GameTypes.js";
import { buildNominationListPayload } from "../functions/NominationListComponents.js";
import {
  buildComponentsV2Flags,
  buildTextContainer,
} from "../functions/ComponentsV2Utils.js";
import {
  formatGameTitleWithYear,
  resolveExactTitleMatch,
} from "../functions/GameTitleAutocompleteUtils.js";
import {
  areNominationsClosed,
  getUpcomingNominationWindow,
} from "../functions/NominationWindow.js";
import {
  deferWithPrivateFlag,
  PRIVATE_OPTION_DESCRIPTION,
  safeDeferReply,
  safeReply,
  sanitizeUserInput,
} from "../functions/InteractionUtils.js";
import { buildTextReply, safeV2TextContent } from "../functions/ComponentsV2Utils.js";
import { toUnixTimestamp } from "../functions/DateFormatUtils.js";
import {
  GOTM_NOMINATION_CHANNEL_ID,
  NR_GOTM_NOMINATION_CHANNEL_ID,
} from "../config/nominationChannels.js";
import { showGameProfileFromNomination } from "./gamedb.command.js";
import { isPositiveInt } from "../utilities/ValidationUtils.js";
import { DISCORD_SELECT_OPTIONS_MAX, truncateLabel } from "../config/textLimits.js";
import { logError } from "../utilities/LogUtils.js";
import GameSearchService from "../classes/GameSearchService.js";
import Game from "../classes/Game.js";

const NOMINATE_REASON_MAX_LENGTH = 1500;

async function autocompleteNominationTitle(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  const query = sanitizeUserInput(rawQuery, { preserveNewlines: false }).trim();
  if (!query) {
    await interaction.respond([]);
    return;
  }

  const results = await GameSearchService.searchGamesAutocomplete(query);
  await interaction.respond(
    results.slice(0, DISCORD_SELECT_OPTIONS_MAX).map((game) => ({
      name: truncateLabel(formatGameTitleWithYear(game)),
      value: String(game.id),
    })),
  );
}

async function resolveNominatedGameByTitle(
  searchTerm: string,
): Promise<{ game: IGame | null; candidates: IGame[] }> {
  const numericId = Number(searchTerm);
  if (isPositiveInt(numericId)) {
    const byId = await Game.getGameById(numericId);
    return { game: byId, candidates: byId ? [byId] : [] };
  }

  const existing = await GameSearchService.searchGames(searchTerm);
  return { game: resolveExactTitleMatch(existing, searchTerm), candidates: existing };
}

async function announceNominationList(
  interaction: CommandInteraction,
  kind: NominationKind,
  nominatorUserId: string,
  nominatedTitle: string,
  payload: Awaited<ReturnType<typeof buildNominationListPayload>>,
): Promise<void> {
  const channelId = kind === "gotm" ? GOTM_NOMINATION_CHANNEL_ID : NR_GOTM_NOMINATION_CHANNEL_ID;

  try {
    const channel = await interaction.client.channels.fetch(channelId);
    const textChannel: TextBasedChannel | null = channel?.isTextBased()
      ? (channel as TextBasedChannel)
      : null;
    if (!textChannel || !isSendableTextChannel(textChannel)) {
      return;
    }

    const nominationNotice = buildTextContainer(
        safeV2TextContent(`${userMention(nominatorUserId)} Nominated "${nominatedTitle}"!`, 1000),
      );

    await textChannel.send({
      components: [nominationNotice, ...payload.components],
      files: payload.files,
      flags: buildComponentsV2Flags(false),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    logError("NominateCommand.announceNominationList", error);
  }
}

type SendableTextChannel = TextBasedChannel & {
  send: (content: unknown) => Promise<unknown>;
};

function isSendableTextChannel(channel: TextBasedChannel | null): channel is SendableTextChannel {
  return Boolean(channel && typeof (channel as SendableTextChannel).send === "function");
}

@Discord()
export class NominateCommand {
  @Slash({ description: "Nominate a GameDB title for GOTM or NR-GOTM", name: "nominate" })
  async nominate(
    @SlashOption({
      autocomplete: autocompleteNominationTitle,
      description: "Game title (autocomplete from GameDB)",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    rawTitle: string,
    @SlashChoice(
      { name: "GOTM", value: "gotm" },
      { name: "NR-GOTM", value: "nr-gotm" },
    )
    @SlashOption({
      description: "Nomination type",
      name: "type",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    rawKind: string,
    @SlashOption({
      description: "Reason for your nomination",
      maxLength: NOMINATE_REASON_MAX_LENGTH,
      name: "reason",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    rawReason: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    const cleanedTitle = sanitizeUserInput(rawTitle, { preserveNewlines: false, maxLength: 256 });
    const cleanedReason = sanitizeUserInput(rawReason, { preserveNewlines: true });
    const selectedKind = parseNominationKind(rawKind);

    if (!cleanedTitle) {
      await safeReply(interaction, buildTextReply("Please provide a non-empty game title.", true));
      return;
    }

    if (!selectedKind) {
      await safeReply(interaction, buildTextReply("Please choose either GOTM or NR-GOTM.", true));
      return;
    }

    if (!cleanedReason) {
      await safeReply(interaction, buildTextReply("Reason is required.", true));
      return;
    }

    if (cleanedReason.length > NOMINATE_REASON_MAX_LENGTH) {
      await safeReply(
        interaction,
        buildTextReply(`Reason must be ${NOMINATE_REASON_MAX_LENGTH} characters or fewer.`, true),
      );
      return;
    }

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    try {
      const window = await getUpcomingNominationWindow();
      if (areNominationsClosed(window)) {
        const voteUnix = toUnixTimestamp(window.nextVoteAt);
        const closedMsg =
          `Nominations for Round ${window.targetRound} are closed. ` +
          `Voting is scheduled for <t:${voteUnix}:F>.`;
        await safeReply(interaction, buildTextReply(closedMsg, true));
        return;
      }

      const { game, candidates } = await resolveNominatedGameByTitle(cleanedTitle);
      if (!game) {
        const candidateList = candidates.length
          ? candidates.slice(0, 5).map((g) => `"${g.title}"`).join(", ")
          : "no results";
        const notFoundMsg =
          `I could not find a unique GameDB match for "${cleanedTitle}" ` +
          `(GameDB search returned: ${candidateList}). ` +
          "Please use the title autocomplete or add the game to GameDB first.";
        await safeReply(interaction, buildTextReply(notFoundMsg, true));
        return;
      }

      const existing = await getNominationForUser(
        selectedKind, window.targetRound, interaction.user.id,
      );
      const saved = await upsertNomination(
        selectedKind,
        window.targetRound,
        interaction.user.id,
        game.id,
        cleanedReason,
      );

      const replaced =
        existing && existing.gameTitle !== saved.gameTitle
          ? ` (replaced "${existing.gameTitle}")`
          : existing
            ? " (no change to title)"
            : "";
      const kindLabel = selectedKind === "gotm" ? "GOTM" : "NR-GOTM";

      const successMsg =
        `${existing ? "Updated" : "Recorded"} your ${kindLabel} nomination for Round ` +
        `${window.targetRound}: "${saved.gameTitle}".${replaced}`;
      await safeReply(interaction, buildTextReply(successMsg, true));

      const nominations = await listNominationsForRound(selectedKind, window.targetRound);
      const payload = await buildNominationListPayload(
        kindLabel,
        "/nominate",
        window,
        nominations,
        false,
      );
      await announceNominationList(
        interaction,
        selectedKind,
        interaction.user.id,
        saved.gameTitle,
        payload,
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await safeReply(
        interaction, buildTextReply(`Could not save your nomination: ${errorMessage}`, true),
      );
    }
  }

  @Slash({ description: "Show the current GOTM or NR-GOTM nominations", name: "noms" })
  async noms(
    @SlashChoice(
      { name: "GOTM", value: "gotm" },
      { name: "NR-GOTM", value: "nr-gotm" },
    )
    @SlashOption({
      description: "Nomination type",
      name: "type",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    rawKind: string,
    @SlashOption({
      description: PRIVATE_OPTION_DESCRIPTION,
      name: "private",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    privateFlag: boolean = false,
    interaction: CommandInteraction,
  ): Promise<void> {
    const selectedKind = parseNominationKind(rawKind);
    const ephemeral = privateFlag;

    if (!selectedKind) {
      await safeReply(interaction, buildTextReply("Please choose either GOTM or NR-GOTM.", true));
      return;
    }

    await deferWithPrivateFlag(interaction, privateFlag);

    try {
      const window = await getUpcomingNominationWindow();
      const nominations = await listNominationsForRound(selectedKind, window.targetRound);
      const kindLabel = selectedKind === "gotm" ? "GOTM" : "NR-GOTM";
      const payload = await buildNominationListPayload(
        kindLabel,
        "/nominate",
        window,
        nominations,
        false,
      );

      await safeReply(interaction, {
        components: payload.components,
        files: payload.files,
        flags: buildComponentsV2Flags(ephemeral),
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await safeReply(
        interaction, buildTextReply(`Could not load nominations: ${errorMessage}`, ephemeral),
      );
    }
  }
   
  @SelectMenuComponent({ id: /^gotm-nom-details:\d+$/ })
  async showGotmNominationDetails(interaction: StringSelectMenuInteraction): Promise<void> {
    await this.showNominationDetails(interaction);
  }
   
  @SelectMenuComponent({ id: /^nr-gotm-nom-details:\d+$/ })
  async showNrGotmNominationDetails(interaction: StringSelectMenuInteraction): Promise<void> {
    await this.showNominationDetails(interaction);
  }

  private async showNominationDetails(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const gameId = Number(interaction.values?.[0]);
    if (!isPositiveInt(gameId)) {
      await safeReply(interaction, buildTextReply("Invalid GameDB id.", true));
      return;
    }

    await showGameProfileFromNomination(interaction, gameId);
  }
}
