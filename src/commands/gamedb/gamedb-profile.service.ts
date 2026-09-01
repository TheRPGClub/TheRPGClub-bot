import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type CommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import {
  ButtonBuilder as V2ButtonBuilder,
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import { SeparatorSpacingSize } from "discord-api-types/v10";
import { safeReply } from "../../functions/InteractionUtils.js";
import {
  buildMaskedLink,
  buildTextReply,
  safeV2TextContent,
} from "../../functions/ComponentsV2Utils.js";
import { truncateWithEllipsis } from "../../utilities/ValidationUtils.js";
import { formatPlatformDisplayName } from "../../functions/PlatformDisplay.js";
import { formatTableDate } from "../../functions/DateFormatUtils.js";
import { renderUsernameWithEmoji } from "../../services/UserEmojiService.js";
import { padCommandName } from "../help.command.js";
import type { IGame, IRelease } from "../../types/GameTypes.js";
import GameProfileService from "../../classes/GameProfileService.js";
import {
  buildComponentsV2Flags,
  getSearchRowsFromComponents,
  isHltbImportEligible,
} from "./gamedb-utils.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
import { logError } from "../../utilities/LogUtils.js";
import { buildActionButton, buildButtonRow } from "../../functions/uiComponents.js";

export type GameProfileRenderContext = {
  guildId?: string;
  includeInlineButtons?: boolean;
  prefaceText?: string;
};

type GameProfileResult = {
  components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>>;
  files: AttachmentBuilder[];
  hasThread: boolean;
  featuredVideoUrl: string | null;
  isReleased: boolean;
};

export function chunkText(text: string, size: number): string[] {
  if (!text) return ["No description available."];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

export function formatQuotedDescription(description: string): string {
  if (!description.trim()) {
    return "> No description available.";
  }
  return description
    .split(/\r?\n/)
    .map((line) => (line.trim().length ? `> ${line}` : ""))
    .join("\n");
}

export function buildListFieldValue(lines: string[], maxLength: number): string {
  if (!lines.length) return "None";
  const output: string[] = [];
  let currentLength = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const nextLength = currentLength + line.length + 1;
    if (nextLength > maxLength) {
      const remaining = lines.length - i;
      output.push(`…and ${remaining} more`);
      break;
    }
    output.push(line);
    currentLength = nextLength;
  }

  return output.join();
}

export function trimTextDisplayContent(content: string): string {
  return truncateWithEllipsis(content, 4000);
}

export function isGameReleased(game: IGame, releases: IRelease[]): boolean {
  const releaseDates: Date[] = [];
  for (const release of releases) {
    if (release.releaseDate instanceof Date && !Number.isNaN(release.releaseDate.getTime())) {
      releaseDates.push(release.releaseDate);
    }
  }
  if (
    game.initialReleaseDate instanceof Date &&
    !Number.isNaN(game.initialReleaseDate.getTime())
  ) {
    releaseDates.push(game.initialReleaseDate);
  }

  if (!releaseDates.length) {
    return true;
  }

  const earliestReleaseTimestamp = releaseDates
    .map((releaseDate) => releaseDate.getTime())
    .reduce((earliest, current) => (current < earliest ? current : earliest));
  return earliestReleaseTimestamp <= Date.now();
}

export function buildGameProfileActionRow(
  gameId: number,
  featuredVideoUrl: string | null,
  disableVideo = false,
): ActionRowBuilder<ButtonBuilder>[] {
   
  const addNowPlaying = buildActionButton({
    customId: `gamedb-action:nowplaying:${gameId}`,
    label: "Add to Now Playing List",
    style: ButtonStyle.Primary,
  });
   
  const viewFeaturedVideo = buildActionButton({
    customId: `gamedb-action:video:${gameId}`,
    label: "View Featured Video",
    style: ButtonStyle.Secondary,
  }).setDisabled(disableVideo);
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const primaryButtons: ButtonBuilder[] = [addNowPlaying];
  if (featuredVideoUrl) {
    primaryButtons.push(viewFeaturedVideo);
  }
  primaryButtons.push(buildActionButton({
    customId: `gamedb-action:backlog:${gameId}`,
    label: "Add to Backlog",
    style: ButtonStyle.Secondary,
  }));
  rows.push(buildButtonRow(...primaryButtons));
  return rows;
}

export async function buildGameProfile(
  gameId: number,
  interaction?:
    | CommandInteraction
    | StringSelectMenuInteraction
    | ButtonInteraction
    | ModalSubmitInteraction
    | GameProfileRenderContext,
): Promise<GameProfileResult | null> {
  try {
    const profile = await GameProfileService.getGameProfile(gameId);
    if (!profile) {
      return null;
    }

    const {
      game,
      releases,
      associations,
      nowPlayingMembers,
      collectionOwners,
      completions,
      alternateVersions,
      threadIds,
      hltbCache,
      primaryImageUrl,
      series,
      developers,
      publishers,
    } = profile;

    const description = game.description || "No description available.";
    const container = new ContainerBuilder();
    const includeInlineButtons =
      (interaction as GameProfileRenderContext | undefined)?.includeInlineButtons ?? true;
    const prefaceText = (interaction as GameProfileRenderContext | undefined)?.prefaceText?.trim();

    const files: AttachmentBuilder[] = [];
    const isReleased = isGameReleased(game, releases);
    const primaryArt = game.imageData;
    if (primaryArt) {
      files.push(new AttachmentBuilder(primaryArt, { name: "game_image.png" }));
    }
    const apiImageUrl = primaryArt ? null : primaryImageUrl;

    const rpgClubSections: string[] = [];
    const pushRpgClubSection = (title: string, value: string | null): void => {
      if (!value) return;
      rpgClubSections.push(`**${title}:** ${value}`);
    };

    const gotmNomineesByRound = new Map<number, string[]>();
    associations.gotmNominations.forEach((nom) => {
      const list = gotmNomineesByRound.get(nom.round) ?? [];
      list.push(renderUsernameWithEmoji(nom.userId, nom.username));
      gotmNomineesByRound.set(nom.round, list);
    });
    const nrGotmNomineesByRound = new Map<number, string[]>();
    associations.nrGotmNominations.forEach((nom) => {
      const list = nrGotmNomineesByRound.get(nom.round) ?? [];
      list.push(renderUsernameWithEmoji(nom.userId, nom.username));
      nrGotmNomineesByRound.set(nom.round, list);
    });

    if (associations.gotmWins.length) {
      const lines = associations.gotmWins.map((win) => {
        const nominees = gotmNomineesByRound.get(win.round) ?? [];
        if (!nominees.length) {
          return `Round ${win.round}`;
        }
        return `Round ${win.round} (nominated by ${nominees.join(",  ")})`;
      });
      pushRpgClubSection("GOTM Round(s)", lines.join("\n"));
    }

    if (associations.nrGotmWins.length) {
      const lines = associations.nrGotmWins.map((win) => {
        const nominees = nrGotmNomineesByRound.get(win.round) ?? [];
        if (!nominees.length) {
          return `Round ${win.round}`;
        }
        return `Round ${win.round} (nominated by ${nominees.join(",  ")})`;
      });
      pushRpgClubSection("NR-GOTM Round(s)", lines.join("\n"));
    }

    const threadId = threadIds[0] ?? null;
    const headerLink = threadId
      ? `https://discord.com/channels/${interaction?.guildId ?? "@me"}/${threadId}`
      : null;
    const headerLines = [
      `## ${headerLink ? buildMaskedLink(game.title, headerLink) : game.title}`,
    ];

    const redditUrlRaw =
      associations.gotmWins.find((w) => w.redditUrl)?.redditUrl ??
      associations.nrGotmWins.find((w) => w.redditUrl)?.redditUrl ??
      null;
    const redditUrl = redditUrlRaw === "__NO_VALUE__" ? null : redditUrlRaw;
    if (redditUrl) {
      pushRpgClubSection("Reddit Discussion Thread", `[Reddit Link](${redditUrl})`);
    }

    if (nowPlayingMembers.length) {
      const MAX_NOW_PLAYING_DISPLAY = 12;
      const lines = nowPlayingMembers.slice(0, MAX_NOW_PLAYING_DISPLAY).map((member) => {
        const name = member.globalName ?? member.username ?? member.userId;
        return renderUsernameWithEmoji(member.userId, name);
      });

      if (nowPlayingMembers.length > MAX_NOW_PLAYING_DISPLAY) {
        const remaining = nowPlayingMembers.length - MAX_NOW_PLAYING_DISPLAY;
        lines.push(`…and ${remaining} more playing now.`);
      }

      pushRpgClubSection("Now Playing", lines.join(",  "));
    }

    if (collectionOwners.length) {
      const MAX_OWNERS_DISPLAY = 12;
      const lines = collectionOwners.slice(0, MAX_OWNERS_DISPLAY).map((member) => {
        const name = member.globalName ?? member.username ?? member.userId;
        return renderUsernameWithEmoji(member.userId, name);
      });

      if (collectionOwners.length > MAX_OWNERS_DISPLAY) {
        const remaining = collectionOwners.length - MAX_OWNERS_DISPLAY;
        lines.push(`…and ${remaining} more own this.`);
      }

      pushRpgClubSection("Owned By", lines.join(",  "));
    }

    if (completions.length) {
      const MAX_COMPLETIONS_DISPLAY = 12;
      const uniqueCompletions = new Map<string, (typeof completions)[number]>();
      completions.forEach((member) => {
        if (!uniqueCompletions.has(member.userId)) {
          uniqueCompletions.set(member.userId, member);
        }
      });
      const uniqueList = Array.from(uniqueCompletions.values());
      const lines = uniqueList.slice(0, MAX_COMPLETIONS_DISPLAY).map((member) => {
        const name = member.globalName ?? member.username ?? member.userId;
        return renderUsernameWithEmoji(member.userId, name);
      });

      if (uniqueList.length > MAX_COMPLETIONS_DISPLAY) {
        const remaining = uniqueList.length - MAX_COMPLETIONS_DISPLAY;
        lines.push(`…and ${remaining} more completed this.`);
      }

      pushRpgClubSection("Completed By", lines.join(",  "));
    }

    const gotmWinRounds = new Set(associations.gotmWins.map((win) => win.round));
    const nrGotmWinRounds = new Set(associations.nrGotmWins.map((win) => win.round));

    const gotmNominations = associations.gotmNominations.filter(
      (nom) => !gotmWinRounds.has(nom.round),
    );
    if (gotmNominations.length) {
      const lines = gotmNominations.map(
        (nom) => `Round ${nom.round} - ${renderUsernameWithEmoji(nom.userId, nom.username)}`,
      );
      pushRpgClubSection("GOTM Nominations", lines.join(",  "));
    }

    const nrGotmNominations = associations.nrGotmNominations.filter(
      (nom) => !nrGotmWinRounds.has(nom.round),
    );
    if (nrGotmNominations.length) {
      const lines = nrGotmNominations.map(
        (nom) => `Round ${nom.round} - ${renderUsernameWithEmoji(nom.userId, nom.username)}`,
      );
      pushRpgClubSection("NR-GOTM Nominations", lines.join(",  "));
    }

    const bodyParts: Array<{ content: string; accessory?: V2ButtonBuilder }> = [];
    bodyParts.push({ content: `**Description**\n${formatQuotedDescription(description)}` });

    const labelCandidates: string[] = [];
    let releasesByDate: Map<string, string[]> | null = null;

    if (releases.length > 0) {
      const sortedReleases = [...releases].sort((a, b) => {
        const aTime = a.releaseDate ? a.releaseDate.getTime() : Number.POSITIVE_INFINITY;
        const bTime = b.releaseDate ? b.releaseDate.getTime() : Number.POSITIVE_INFINITY;
        return aTime - bTime;
      });

      const releaseMap = new Map<string, string[]>();
      sortedReleases.forEach((r) => {
        const platformName = (formatPlatformDisplayName(r.platformName)
          ?? "Unknown Platform").trim();
        const regionName = (r.regionName || "Unknown Region").trim();
        const regionSuffix = regionName === "Worldwide" ? "" : ` (${regionName})`;
        const releaseDate = r.releaseDate ? formatTableDate(r.releaseDate) : "TBD";
        const format = r.format ? `(${r.format}) ` : "";
        const platformLabel = `${platformName} ${regionSuffix}${format}`.trim();
        const list = releaseMap.get(releaseDate) ?? [];
        list.push(platformLabel);
        releaseMap.set(releaseDate, list);
      });
      releasesByDate = releaseMap;
    }

    const canImportHltb = isHltbImportEligible(game, Boolean(hltbCache));
    const hltbLabels: string[] = [];

    if (releasesByDate) {
      labelCandidates.push(...releasesByDate.keys());
    }

    if (hltbCache) {
      if (hltbCache.main) hltbLabels.push("Main");
      if (hltbCache.mainSides) hltbLabels.push("Main + Sides");
      if (hltbCache.completionist) hltbLabels.push("Completionist");
      if (hltbCache.singlePlayer) hltbLabels.push("Single-Player");
      if (hltbCache.coOp) hltbLabels.push("Co-Op");
      if (hltbCache.vs) hltbLabels.push("Vs.");
    }

    labelCandidates.push(...hltbLabels);
    const padWidth = labelCandidates.reduce((max, label) => Math.max(max, label.length), 0) + 1;

    if (releasesByDate) {
      const releaseField = Array.from(releasesByDate.entries())
        .map(([dateLabel, platformsForDate]) =>
          `\n> **\`\` ${padCommandName(dateLabel, padWidth)}\`\`**  ` +
          platformsForDate.join(", "),
        )
        .join("");
      bodyParts.push({ content: `**Releases** ${releaseField}` });
    }

    if (hltbCache) {
      const hltbLines: string[] = [];
      if (hltbCache.main)
        hltbLines.push(
          `> **\`\` ${padCommandName("Main", padWidth)}\`\`**  ${hltbCache.main}`,
        );
      if (hltbCache.mainSides)
        hltbLines.push(
          `> **\`\` ${padCommandName("Main + Sides", padWidth)}\`\`**  ${hltbCache.mainSides}`,
        );
      if (hltbCache.completionist)
        hltbLines.push(
          `> **\`\` ${padCommandName("Completionist", padWidth)}\`\`**  ${hltbCache.completionist}`,
        );
      if (hltbCache.singlePlayer)
        hltbLines.push(
          `> **\`\` ${padCommandName("Single-Player", padWidth)}\`\`**  ${hltbCache.singlePlayer}`,
        );
      if (hltbCache.coOp)
        hltbLines.push(
          `> **\`\` ${padCommandName("Co-Op", padWidth)}\`\`**  ${hltbCache.coOp}`,
        );
      if (hltbCache.vs)
        hltbLines.push(
          `> **\`\` ${padCommandName("Vs.", padWidth)}\`\`**  ${hltbCache.vs}`,
        );
      if (hltbLines.length) {
        bodyParts.push({ content: `**HowLongToBeat™**\n${hltbLines.join("\n")}` });
      }
    } else if (canImportHltb && includeInlineButtons) {
      const importHltb = new V2ButtonBuilder()
        // eslint-disable-next-line local/custom-id-has-matching-handler
        .setCustomId(`gamedb-action:hltb-import:${gameId}`)
        .setLabel("Import HLTB Data")
        .setStyle(ButtonStyle.Secondary);
      bodyParts.push({
        content: "**HowLongToBeat™**\n> No HLTB data cached.",
        accessory: importHltb,
      });
    }

    const detailSections: string[] = [];

    if (developers.length) {
      detailSections.push(`**Developer:** ${developers.join(", ")}`);
    }
    if (publishers.length) {
      detailSections.push(`**Publisher:** ${publishers.join(", ")}`);
    }
    if (series) {
      detailSections.push(`**Series / Collection:** ${series}`);
    }

    if (alternateVersions.length) {
      const lines = alternateVersions.map(
        (alt) => `> **${alt.title}**`,
      );
      const value = buildListFieldValue(lines, 2000);
      detailSections.push(`**Alternate Versions** ${value}`);
    }

    if (detailSections.length) {
      bodyParts.push({ content: detailSections.join("\n") });
    }

    if (rpgClubSections.length) {
      bodyParts.push({ content: rpgClubSections.join("\n") });
    }

    const igdbIdText = game.igdbId ? String(game.igdbId) : "N/A";
    bodyParts.push({
      content: `-# GameDB ID: ${game.id} | IGDB ID: ${igdbIdText}`,
    });

    const headerBlock = trimTextDisplayContent(headerLines.join("\n"));
    const bodyBlocks = bodyParts
      .map((block) => ({
        content: trimTextDisplayContent(block.content),
        accessory: block.accessory,
      }))
      .filter((block) => block.content.length > 0);

    if (prefaceText) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          safeV2TextContent(trimTextDisplayContent(prefaceText), 3500),
        ),
      );
      container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true),
      );
    }

    const thumbnailUrl = primaryArt
      ? "attachment://game_image.png"
      : (apiImageUrl ?? game.coverUrl ?? null);

    if (thumbnailUrl) {
      if (headerBlock.length > 0) {
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(safeV2TextContent(headerBlock, 3500)),
        );
      }
      const [descriptionBlock, ...remainingBlocks] = bodyBlocks;
      if (descriptionBlock) {
        const descriptionSection = new SectionBuilder()
          .setThumbnailAccessory(
            new ThumbnailBuilder().setURL(thumbnailUrl),
          )
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              safeV2TextContent(descriptionBlock.content, 3500),
            ),
          );
        // eslint-disable-next-line local/section-builder-requires-accessory
        container.addSectionComponents(descriptionSection);
      }
      remainingBlocks.forEach((block) => {
        if (block.accessory) {
          const section = new SectionBuilder()
            .setButtonAccessory(block.accessory)
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(safeV2TextContent(block.content, 3500)),
            );
          // eslint-disable-next-line local/section-builder-requires-accessory
          container.addSectionComponents(section);
        } else {
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(safeV2TextContent(block.content, 3500)),
          );
        }
      });
    } else {
      if (headerBlock.length > 0) {
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(safeV2TextContent(headerBlock, 3500)),
        );
      }
      bodyBlocks.forEach((block) => {
        if (block.accessory) {
          const section = new SectionBuilder()
            .setButtonAccessory(block.accessory)
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(safeV2TextContent(block.content, 3500)),
            );
          // eslint-disable-next-line local/section-builder-requires-accessory
          container.addSectionComponents(section);
        } else {
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(safeV2TextContent(block.content, 3500)),
          );
        }
      });
    }

    return {
      components: [container],
      files,
      hasThread: Boolean(threadId),
      featuredVideoUrl: game.featuredVideoUrl ?? null,
      isReleased,
    };
  } catch (error: any) {
    logError("GamedbProfileService.buildGameProfile", error);
    return null;
  }
}

export async function showGameProfile(
  interaction: CommandInteraction | StringSelectMenuInteraction,
  gameId: number,
  includeActionsOverride?: boolean,
): Promise<void> {
  const profile = await buildGameProfile(gameId, interaction);
  if (!profile) {
    await safeReply(interaction, buildTextReply(`No game found with ID ${gameId}.`, true));
    return;
  }

  const includeActions = includeActionsOverride ?? (
    !("isMessageComponent" in interaction) ||
    !interaction.isMessageComponent()
  );
  const components = [...profile.components];
  if (includeActions) {
    components.push(
      ...buildGameProfileActionRow(
        gameId,
        profile.featuredVideoUrl,
      ),
    );
  }

  await safeReply(interaction, {
    files: profile.files,
    components,
    flags: buildComponentsV2Flags(false),
  });
}

export async function showGameProfileFromNomination(
  interaction: StringSelectMenuInteraction,
  gameId: number,
): Promise<void> {
  const profile = await buildGameProfile(gameId, interaction);
  if (!profile) {
    await safeReply(interaction, buildTextReply(`No game found with ID ${gameId}.`, true));
    return;
  }
  const components = [
    ...profile.components,
    ...buildGameProfileActionRow(
      gameId,
      profile.featuredVideoUrl,
    ),
  ];
  await safeReply(interaction, {
    files: profile.files,
    components,
    flags: buildComponentsV2Flags(true),
  });
}

export async function buildGameProfileMessagePayload(
  gameId: number,
  options?: {
    includeActions?: boolean;
    guildId?: string;
    prefaceText?: string;
  },
): Promise<{
  components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>>;
  files: AttachmentBuilder[];
} | null> {
  const includeActions = options?.includeActions ?? true;
  const profile = await buildGameProfile(gameId, {
    guildId: options?.guildId,
    includeInlineButtons: includeActions,
    prefaceText: options?.prefaceText,
  });
  if (!profile) {
    return null;
  }

  const components = [...profile.components];
  if (includeActions) {
    components.push(
      ...buildGameProfileActionRow(
        gameId,
        profile.featuredVideoUrl,
      ),
    );
  }

  return {
    // eslint-disable-next-line local/dynamic-components-require-chunking
    components,
    files: profile.files,
  };
}

export async function refreshGameProfileMessage(
  interaction: ButtonInteraction,
  gameId: number,
): Promise<void> {
  const profile = await buildGameProfile(gameId, interaction);
  if (!profile) return;
  const actionRows = buildGameProfileActionRow(
    gameId,
    profile.featuredVideoUrl,
  );
  const existingComponents = interaction.message?.components ?? [];
  const searchRows = getSearchRowsFromComponents(existingComponents);
  await safeReply(interaction, {
    files: profile.files,
    components: [...profile.components, ...actionRows, ...searchRows],
    flags: buildComponentsV2Flags(false),
  });
}

export async function updateGameProfileMessageById(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  channelId: string,
  messageId: string,
  gameId: number,
): Promise<void> {
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !("messages" in channel)) {
    return;
  }
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return;
  const profile = await buildGameProfile(gameId, interaction);
  if (!profile) return;
  const actionRows = buildGameProfileActionRow(
    gameId,
    profile.featuredVideoUrl,
  );
  const searchRows = getSearchRowsFromComponents(message.components ?? []);
  safeIgnore(message.edit({
    embeds: [],
    files: profile.files,
    components: [...profile.components, ...actionRows, ...searchRows],
  }));
}
