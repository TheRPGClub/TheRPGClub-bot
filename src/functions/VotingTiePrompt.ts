import { StringSelectMenuBuilder, type APIMessageTopLevelComponent } from "discord.js";
import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import {
  isVotingRoundCategory,
  VOTING_ROUND_CATEGORIES,
  type IVotingRound,
  type IVotingRoundTieGame,
  type VotingRoundCategory,
} from "../classes/VotingRounds.js";
import {
  DISCORD_SELECT_OPTIONS_MAX,
  DISCORD_V2_COMPONENTS_MAX,
  MAX_SECTION_TEXT,
} from "../config/textLimits.js";
import { validateCustomId } from "../utilities/CustomIdUtils.js";
import { buildTextContainer, safeV2TextContent } from "./ComponentsV2Utils.js";
import { buildSelectOptions, buildSelectRow } from "./uiComponents.js";

export const TIE_BREAK_SELECT_PREFIX = "admin-vote-tie";

export const VOTING_CATEGORY_LABEL: Record<VotingRoundCategory, "GOTM" | "NR-GOTM"> = {
  gotm: "GOTM",
  nr_gotm: "NR-GOTM",
};

export interface ITieBreakTarget {
  roundNumber: number;
  category: VotingRoundCategory;
}

/** Round and category live in the id, so a prompt still works after a restart. */
export function buildTieBreakSelectId(roundNumber: number, category: VotingRoundCategory): string {
  return validateCustomId(`${TIE_BREAK_SELECT_PREFIX}:${roundNumber}:${category}`);
}

export function parseTieBreakSelectId(customId: string): ITieBreakTarget | null {
  const [prefix, rawRound, category, ...rest] = customId.split(":");
  const roundNumber = Number(rawRound);
  if (
    prefix !== TIE_BREAK_SELECT_PREFIX ||
    rest.length > 0 ||
    !Number.isInteger(roundNumber) ||
    roundNumber <= 0 ||
    !category ||
    !isVotingRoundCategory(category)
  ) {
    return null;
  }
  return { roundNumber, category };
}

export function buildTiePendingText(round: IVotingRound): string {
  return [
    `## Round ${round.roundNumber} voting ended in a tie`,
    "An admin needs to pick the winner for each tied category below. Pick more than one " +
      "game to make them joint winners. The round is decided, and nominations for the " +
      "next one open, once every tie is broken.",
  ].join("\n");
}

function tiedCategories(
  round: IVotingRound,
): Array<{ category: VotingRoundCategory; games: IVotingRoundTieGame[] }> {
  return VOTING_ROUND_CATEGORIES.flatMap((category) => {
    const games = (round.pendingTies[category] ?? []).slice(0, DISCORD_SELECT_OPTIONS_MAX);
    return games.length ? [{ category, games }] : [];
  });
}

function buildTieSelect(
  roundNumber: number,
  category: VotingRoundCategory,
  games: IVotingRoundTieGame[],
): StringSelectMenuBuilder {
  return new StringSelectMenuBuilder()
    .setCustomId(buildTieBreakSelectId(roundNumber, category))
    .setPlaceholder(`Pick the ${VOTING_CATEGORY_LABEL[category]} winner(s)`)
    .setMinValues(1)
    .setMaxValues(games.length)
    .addOptions(
      buildSelectOptions(games.map((game) => ({ label: game.title, value: String(game.gameId) }))),
    );
}

function buildCategoryContainer(
  roundNumber: number,
  category: VotingRoundCategory,
  games: IVotingRoundTieGame[],
  withCovers: boolean,
): ContainerBuilder {
  const heading = `### ${VOTING_CATEGORY_LABEL[category]} tie`;
  const container = new ContainerBuilder();
  if (withCovers) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeV2TextContent(heading, MAX_SECTION_TEXT)),
    );
    for (const game of games) {
      const text = new TextDisplayBuilder().setContent(
        safeV2TextContent(`**${game.title}**`, MAX_SECTION_TEXT),
      );
      if (game.coverUrl) {
        const section = new SectionBuilder().addTextDisplayComponents(text);
        section.setThumbnailAccessory(new ThumbnailBuilder().setURL(game.coverUrl));
        container.addSectionComponents(section);
      } else {
        container.addTextDisplayComponents(text);
      }
    }
  } else {
    const lines = games.map((game) => `- **${game.title}**`);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeV2TextContent([heading, ...lines].join("\n"), 3500)),
    );
  }
  return container.addActionRowComponents(
    buildSelectRow(buildTieSelect(roundNumber, category, games)).toJSON(),
  );
}

/**
 * Components each category container adds: the container, heading, select and
 * its row, plus three per game with a cover (section, text, thumbnail) or one
 * without, or one list text in place of the per-game entries.
 */
function countCategoryComponents(games: IVotingRoundTieGame[], withCovers: boolean): number {
  if (!withCovers) return 4;
  return 4 + games.reduce((sum, game) => sum + (game.coverUrl ? 3 : 1), 0);
}

/**
 * The admin tie-break prompt: a header, then one container per tied category
 * with its games and a select to pick the winners. Covers are dropped when
 * they would push the message past Discord's component limit.
 */
export function buildTiePromptComponents(round: IVotingRound): ContainerBuilder[] {
  const ties = tiedCategories(round);
  const headerCount = 2;
  const withCovers =
    headerCount +
      ties.reduce((sum, tie) => sum + countCategoryComponents(tie.games, true), 0) <=
    DISCORD_V2_COMPONENTS_MAX;
  return [
    buildTextContainer(buildTiePendingText(round)),
    ...ties.map((tie) =>
      buildCategoryContainer(round.roundNumber, tie.category, tie.games, withCovers),
    ),
  ];
}

export function buildResolvedTieContainer(
  category: VotingRoundCategory,
  winnerTitles: string[],
  adminId: string,
): ContainerBuilder {
  const label = VOTING_CATEGORY_LABEL[category];
  const winners = winnerTitles.map((title) => `**${title}**`).join(", ");
  const noun = winnerTitles.length === 1 ? "winner" : "joint winners";
  return buildTextContainer(
    `### ${label} tie broken\n${winners} picked as the ${label} ${noun} by <@${adminId}>.`,
  );
}

function containsCustomId(node: unknown, customId: string): boolean {
  if (!node || typeof node !== "object") return false;
  if ((node as { custom_id?: unknown }).custom_id === customId) return true;
  const children = (node as { components?: unknown }).components;
  return Array.isArray(children) && children.some((child) => containsCustomId(child, customId));
}

/**
 * The prompt's components with the container holding `customId` swapped for
 * `replacement`, leaving the other categories' selects in place.
 */
export function replaceTieCategoryContainer(
  components: APIMessageTopLevelComponent[],
  customId: string,
  replacement: ContainerBuilder,
): APIMessageTopLevelComponent[] {
  return components.map((component) =>
    containsCustomId(component, customId) ? replacement.toJSON() : component,
  );
}
