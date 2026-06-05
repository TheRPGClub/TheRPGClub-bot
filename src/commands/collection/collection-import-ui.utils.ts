import { ActionRowBuilder, ButtonStyle } from "discord.js";
import {
  ButtonBuilder as V2ButtonBuilder,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import Game from "../../classes/Game.js";
import {
  flattenErrorMessages,
} from "../imports/import-scaffold.service.js";
import { safeV2TextContent } from "../../functions/ComponentsV2Utils.js";
import type { ImportCandidate } from "../../functions/ImportCandidateUtils.js";

export async function buildImportCandidatesContainer(params: {
  ownerId: string;
  importId: number;
  itemId: number;
  headerText: string;
  headerHelpText?: string | null;
  candidates: ImportCandidate[];
  buildChooseCustomId: (params: {
    ownerId: string;
    importId: number;
    itemId: number;
    gameId: number;
  }) => string;
  logPrefix: string;
}): Promise<ContainerBuilder> {
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeV2TextContent(params.headerText, 250)),
    ...(params.headerHelpText
      ? [new TextDisplayBuilder().setContent(safeV2TextContent(params.headerHelpText, 1000))]
      : []),
  );
  if (!params.candidates.length) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("No GameDB matches found yet."),
    );
    return container;
  }

  const gameIds = params.candidates.map((entry) => entry.gameId);
  const games = await Game.getGamesByIds(gameIds);
  const gamesWithPlatforms = await Game.attachPlatformsToGames(games);
  const gameMeta = new Map<number, { year: string; platforms: string }>();
  for (const game of gamesWithPlatforms) {
    const year = game.initialReleaseDate
      ? String(game.initialReleaseDate.getFullYear())
      : "TBD";
    const platformText = game.platforms.length
      ? game.platforms
        .map((platform) => platform.abbreviation ?? platform.name)
        .slice(0, 3)
        .join(", ")
      : "No platforms";
    gameMeta.set(game.id, { year, platforms: platformText });
  }

  params.candidates.forEach((entry) => {
    const metadata = gameMeta.get(entry.gameId) ?? {
      year: "TBD",
      platforms: "No platforms",
    };
    const sectionText = safeV2TextContent(
      `**${entry.title}**\n` +
      `-# **Release Year:** ${metadata.year} | **Platforms:** ${metadata.platforms} | ` +
      `**GameDB ID:** ${entry.gameId}`,
      900,
    );
    try {
      const section = new SectionBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(safeV2TextContent(sectionText, 900)),
      );
      section.setButtonAccessory(
        new V2ButtonBuilder()
          .setCustomId(
            params.buildChooseCustomId({
              ownerId: params.ownerId,
              importId: params.importId,
              itemId: params.itemId,
              gameId: entry.gameId,
            }),
          )
          .setLabel("Choose")
          .setStyle(ButtonStyle.Primary),
      );
      section.toJSON();
      container.addSectionComponents(section);
    } catch (error) {
      const messages = flattenErrorMessages(error);
      console.error(
        `[${params.logPrefix}] candidate section validation failed`,
        JSON.stringify({
          importId: params.importId,
          itemId: params.itemId,
          gameDbGameId: entry.gameId,
          titleLength: entry.title.length,
          sectionTextLength: sectionText.length,
          messages,
        }),
      );
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          safeV2TextContent(`**${entry.title}** | #${entry.gameId}`, 300),
        ),
      );
    }
  });

  return container;
}

export function buildImportIgdbContainer(params: {
  searchTitle: string;
  igdbRows: ActionRowBuilder<any>[];
  noResultsText: string | null;
}): ContainerBuilder {
  const igdbSearchUrl =
    `https://www.igdb.com/search?utf8=%E2%9C%93&type=1&q=${encodeURIComponent(params.searchTitle)}`;
  const igdbLink = `[Search IGDB for ${params.searchTitle}](${igdbSearchUrl})`;
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent("### Import Game From IGDB"),
  );
  for (const row of params.igdbRows) {
    container.addActionRowComponents(row.toJSON());
  }
  if (params.noResultsText) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeV2TextContent(params.noResultsText, 1000)),
    );
  }
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      safeV2TextContent(
        `Not seeing the right title? ${igdbLink}, find the **IGDB ID** and enter it using the button below.`,
        1000,
      ),
    ),
  );
  return container;
}

export function buildImportReasonSummary(
  reasonCounts: Record<string, number>,
  labels: Record<string, string>,
): string[] {
  return Object.entries(reasonCounts)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reason, count]) => `${labels[reason] ?? reason.toLowerCase()}: ${count}`);
}
