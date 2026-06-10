import type { AutocompleteInteraction, CommandInteraction } from "discord.js";
import { ApplicationCommandOptionType } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import { MediaGalleryBuilder, MediaGalleryItemBuilder } from "@discordjs/builders";
import { searchHltb, type HltbSearchResult } from "../scripts/SearchHltb.js";
import { COLOR_PRIMARY } from "../config/colors.js";
import Game from "../classes/Game.js";
import { getHltbCacheByGameId, upsertHltbCache } from "../classes/HltbCache.js";
import {
  deferWithPrivateFlag,
  safeReply,
  sanitizeUserInput,
} from "../functions/InteractionUtils.js";
import {
  buildTextReply,
  buildTitledContainer,
  buildFieldsText,
  buildComponentsV2Flags,
} from "../functions/ComponentsV2Utils.js";
import {
  formatGameTitleWithYear,
  getReleaseYear,
  parseTitleWithYear,
} from "../functions/GameTitleAutocompleteUtils.js";
import { DISCORD_SELECT_LABEL_MAX } from "../config/textLimits.js";

function buildKeepTypingOption(query: string): { name: string; value: string } {
  const label = `Keep typing: "${query}"`;
  return {
    name: label.slice(0, DISCORD_SELECT_LABEL_MAX),
    value: query,
  };
}

async function autocompleteHltbTitle(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  const query = sanitizeUserInput(rawQuery, { preserveNewlines: false }).trim();
  if (!query) {
    await interaction.respond([]);
    return;
  }
  const results = await Game.searchGamesAutocomplete(query);
  const resultOptions = results.slice(0, 24).map((game) => {
    const label = formatGameTitleWithYear(game);
    return {
      name: label.slice(0, DISCORD_SELECT_LABEL_MAX),
      value: label,
    };
  });
  const options = [buildKeepTypingOption(query), ...resultOptions];
  await interaction.respond(options);
}

@Discord()
export class hltb {
  @Slash({ description: "How Long to Beat™ Search" })
  async hltb(
    @SlashOption({
      description: "Game title (autocomplete from GameDB)",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
      autocomplete: autocompleteHltbTitle,
    })
    title: string,
    @SlashOption({
      description: "Send reply privately (only visible to you).",
      name: "private",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    privateFlag: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    title = sanitizeUserInput(title, { preserveNewlines: false });
    const ephemeral = privateFlag ?? false;
    await deferWithPrivateFlag(interaction, privateFlag);

    try {
      const result = await resolveHltbResult(title);
      await outputHltbResultsAsEmbed(interaction, result, title, { ephemeral });
  } catch {
      await safeReply(interaction, buildTextReply(
        `Sorry, there was an error searching for "${title}". Please try again later.`,
        ephemeral,
      ));
    }
  }
}

async function outputHltbResultsAsEmbed(
  interaction: CommandInteraction,
  result: HltbSearchResult | null,
  hltbQuery: string,
  options: { ephemeral: boolean },
) {

  if (result) {
    const hltb_result = result;

    const fields = [];
    if (hltb_result.singlePlayer) fields.push({ name: 'Single-Player', value: hltb_result.singlePlayer });
    if (hltb_result.coOp) fields.push({ name: 'Co-Op', value: hltb_result.coOp });
    if (hltb_result.vs) fields.push({ name: 'Vs.', value: hltb_result.vs });
    if (hltb_result.main) fields.push({ name: 'Main', value: hltb_result.main });
    if (hltb_result.mainSides) fields.push({ name: 'Main + Sides', value: hltb_result.mainSides });
    if (hltb_result.completionist) fields.push({ name: 'Completionist', value: hltb_result.completionist });

    const titleText = hltb_result.url
      ? `[How Long to Beat ${hltb_result.name}](${hltb_result.url})`
      : `How Long to Beat ${hltb_result.name}`;
    const bodyParts = [`*[HowLongToBeat™](https://howlongtobeat.com)*`];
    if (fields.length) bodyParts.push(buildFieldsText(fields));
    const container = buildTitledContainer(titleText, bodyParts.join("\n\n"), { color: COLOR_PRIMARY });
    if (hltb_result.imageUrl) {
      container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder().setURL(hltb_result.imageUrl),
        ),
      );
    }

    await safeReply(interaction, {
      components: [container],
      flags: buildComponentsV2Flags(options.ephemeral),
    });
  } else {
    await safeReply(interaction, buildTextReply(
      `Sorry, no results were found for "${hltbQuery}"`,
      options.ephemeral,
    ));
  }
}

async function resolveHltbResult(title: string): Promise<HltbSearchResult | null> {
  const parsedTitle = parseTitleWithYear(title.trim());
  const searchTerm = parsedTitle.title.trim();
  if (!searchTerm) return null;

  const matches = await Game.searchGames(searchTerm);
  const normalizedTitle = searchTerm.toLowerCase();
  const exactTitleMatches = matches.filter(
    (game) => game.title.toLowerCase() === normalizedTitle,
  );
  let candidate: (typeof matches)[number] | null = null;
  if (parsedTitle.hasYearSuffix && exactTitleMatches.length > 0) {
    if (parsedTitle.year !== null) {
      candidate = exactTitleMatches.find(
        (game) => getReleaseYear(game) === parsedTitle.year,
      ) ?? null;
    } else {
      candidate = exactTitleMatches.find(
        (game) => getReleaseYear(game) === null,
      ) ?? null;
    }
  }
  if (!candidate) {
    const exactMatch = exactTitleMatches[0] ?? null;
    candidate = exactMatch ?? (matches.length === 1 ? matches[0] : null);
  }

  if (candidate) {
    const cache = await getHltbCacheByGameId(candidate.id);
    if (cache) {
      return {
        name: cache.name ?? candidate.title,
        main: cache.main ?? "",
        mainSides: cache.mainSides ?? "",
        completionist: cache.completionist ?? "",
        singlePlayer: cache.singlePlayer ?? "",
        coOp: cache.coOp ?? "",
        vs: cache.vs ?? "",
        imageUrl: cache.imageUrl ?? undefined,
        url: cache.url ?? "",
      };
    }
  }

  const scraped = await searchHltb(searchTerm);
  if (!scraped) return null;

  if (candidate && candidate.initialReleaseDate) {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    if (candidate.initialReleaseDate <= sixMonthsAgo) {
      await upsertHltbCache(candidate.id, {
        name: scraped.name,
        url: scraped.url,
        imageUrl: scraped.imageUrl ?? null,
        main: scraped.main,
        mainSides: scraped.mainSides,
        completionist: scraped.completionist,
        singlePlayer: scraped.singlePlayer,
        coOp: scraped.coOp,
        vs: scraped.vs,
        sourceQuery: searchTerm,
      });
    }
  }

  return scraped;
}
