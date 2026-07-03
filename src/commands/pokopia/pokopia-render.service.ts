import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import { resolveAssetPath } from "../../functions/AssetPath.js";
import { safeV2TextContent } from "../../functions/ComponentsV2Utils.js";
import { buildActionButton, buildButtonRow } from "../../functions/uiComponents.js";
import {
  buildOptionalPrevNextRowWithIds,
  buildPageFooterText,
} from "../../functions/PaginationUtils.js";
import { POKOPIA_LIST_PAGE_SIZE } from "../../config/pagination.js";
import { DISCORD_BUTTON_LABEL_MAX } from "../../config/textLimits.js";
import { truncateWithEllipsis } from "../../utilities/ValidationUtils.js";
import {
  getHabitatBySlug,
  getPokemonByNumber,
  getSortedHabitats,
  getSortedPokemon,
  type IPokopiaHabitat,
  type PokopiaSortField,
  type PokopiaSortOrder,
} from "./pokopia-data.service.js";
import {
  buildPokopiaBackId,
  buildPokopiaDetailId,
  buildPokopiaListNavId,
} from "./pokopia-customid.utils.js";
import {
  getHabitatEmoji,
  getLitterDropEmoji,
  getPokemonEmoji,
} from "../../services/PokopiaEmojiService.js";

type PokopiaComponent = ContainerBuilder | ActionRowBuilder<ButtonBuilder> | TextDisplayBuilder;

const BUTTONS_PER_ROW = 1;

function chunkButtons(buttons: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += BUTTONS_PER_ROW) {
    rows.push(buildButtonRow(...buttons.slice(i, i + BUTTONS_PER_ROW)));
  }
  return rows;
}

export interface IPokopiaPayload {
  components: PokopiaComponent[];
  files: AttachmentBuilder[];
}

function paginateComponents(...components: Array<PokopiaComponent | null>): PokopiaComponent[] {
  return components.filter((c): c is PokopiaComponent => c !== null);
}

function pokedexImagePath(sprite: string): string {
  return resolveAssetPath("images", "pokopia", "pokedex", sprite);
}

function habitatImagePath(image: string): string {
  return resolveAssetPath("images", "pokopia", "habitat_dex", image);
}

function attach(path: string, name: string): AttachmentBuilder {
  return new AttachmentBuilder(path, { name });
}

function formatLitterDrop(image: string | null, name: string | null): string | null {
  if (!image || !name) return null;
  const emoji = getLitterDropEmoji(image);
  const emojiText = emoji ? `<:${emoji.name}:${emoji.id}> ` : "";
  return `${emojiText}${name}`;
}

function formatPokemonRef(pokemon: { number: string; name: string }): string {
  const emoji = getPokemonEmoji(pokemon.number);
  const emojiText = emoji ? `<:${emoji.name}:${emoji.id}> ` : "";
  return `${emojiText}${pokemon.number} ${pokemon.name}`;
}

interface IPaginateResult<T> {
  pageItems: T[];
  safePage: number;
  totalPages: number;
}

function paginate<T>(items: T[], page: number): IPaginateResult<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / POKOPIA_LIST_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = safePage * POKOPIA_LIST_PAGE_SIZE;
  return { pageItems: items.slice(start, start + POKOPIA_LIST_PAGE_SIZE), safePage, totalPages };
}

export function buildPokemonListPayload(
  ownerId: string,
  sort: PokopiaSortField,
  order: PokopiaSortOrder,
  page: number,
): IPokopiaPayload {
  const all = getSortedPokemon(sort, order);
  const { pageItems, safePage, totalPages } = paginate(all, page);

  const files: AttachmentBuilder[] = [];
  const footer = buildPageFooterText(safePage, totalPages, `${all.length} Pokemon`);

  const itemButtons = pageItems.map((pokemon) => {
    const label = truncateWithEllipsis(
      `${pokemon.number} ${pokemon.name}`,
      DISCORD_BUTTON_LABEL_MAX,
    );
    const button = buildActionButton({
      customId: buildPokopiaDetailId({
        kind: "pokemon", ownerId, sort, order, page: safePage, itemKey: pokemon.number,
      }),
      label,
      style: ButtonStyle.Secondary,
    });
    const emoji = getPokemonEmoji(pokemon.number);
    if (emoji) button.setEmoji({ id: emoji.id, name: emoji.name });
    return button;
  });

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeV2TextContent("## Pokopia Pokedex", 250)),
    )
    .addActionRowComponents(...chunkButtons(itemButtons));

  const footerText = new TextDisplayBuilder().setContent(safeV2TextContent(footer, 250));

  const navRow = buildOptionalPrevNextRowWithIds(
    buildPokopiaListNavId({
      kind: "pokemon", ownerId, sort, order, page: safePage, direction: "prev",
    }),
    buildPokopiaListNavId({
      kind: "pokemon", ownerId, sort, order, page: safePage, direction: "next",
    }),
    safePage,
    totalPages,
  );

  return {
    components: paginateComponents(container, footerText, navRow),
    files,
  };
}

export function buildHabitatListPayload(
  ownerId: string,
  order: PokopiaSortOrder,
  page: number,
): IPokopiaPayload {
  const all = getSortedHabitats(order);
  const { pageItems, safePage, totalPages } = paginate(all, page);

  const files: AttachmentBuilder[] = [];
  const footer = buildPageFooterText(safePage, totalPages, `${all.length} habitats`);

  const itemButtons = pageItems.map((habitat) => {
    const label = truncateWithEllipsis(habitat.habitat, DISCORD_BUTTON_LABEL_MAX);
    const button = buildActionButton({
      customId: buildPokopiaDetailId({
        kind: "habitat", ownerId, sort: "name", order, page: safePage, itemKey: habitat.slug,
      }),
      label,
      style: ButtonStyle.Secondary,
    });
    const emoji = getHabitatEmoji(habitat.slug);
    if (emoji) button.setEmoji({ id: emoji.id, name: emoji.name });
    return button;
  });

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeV2TextContent("## Pokopia Habitats", 250)),
    )
    .addActionRowComponents(...chunkButtons(itemButtons));

  const footerText = new TextDisplayBuilder().setContent(safeV2TextContent(footer, 250));

  const navRow = buildOptionalPrevNextRowWithIds(
    buildPokopiaListNavId({
      kind: "habitat", ownerId, sort: "name", order, page: safePage, direction: "prev",
    }),
    buildPokopiaListNavId({
      kind: "habitat", ownerId, sort: "name", order, page: safePage, direction: "next",
    }),
    safePage,
    totalPages,
  );

  return {
    components: paginateComponents(container, footerText, navRow),
    files,
  };
}

function buildBackRow(
  ownerId: string,
  kind: "pokemon" | "habitat",
  sort: PokopiaSortField,
  order: PokopiaSortOrder,
  page: number,
) {
  return buildButtonRow(
    buildActionButton({
      customId: buildPokopiaBackId({ kind, ownerId, sort, order, page }),
      label: "Back to list",
      style: ButtonStyle.Secondary,
    }),
  );
}

export function buildPokemonDetailPayload(
  ownerId: string,
  sort: PokopiaSortField,
  order: PokopiaSortOrder,
  page: number,
  number: string,
  showBackButton = true,
): IPokopiaPayload | null {
  const pokemon = getPokemonByNumber(number);
  if (!pokemon) return null;

  const files: AttachmentBuilder[] = [attach(pokedexImagePath(pokemon.sprite), pokemon.sprite)];
  const container = new ContainerBuilder();

  const abilities = [pokemon.ability1, pokemon.ability2].filter(Boolean).join(", ");
  const favorites = pokemon.favorites.join(", ");
  const detailFields: [string, string | null][] = [
    ["Abilities", abilities],
    ["Home", pokemon.home],
    ["Litter Drop", formatLitterDrop(pokemon.litterDrop, pokemon.litterDropName)],
    ["Favorites", favorites],
  ];
  const detailText = [
    `## ${pokemon.number} ${pokemon.name}`,
    ...detailFields
      .filter(([, value]) => value)
      .map(([label, value]) => `**${label}:** ${value}`),
  ].join("\n");
  const headerSection = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeV2TextContent(detailText, 1800)),
  );
  headerSection.setThumbnailAccessory(
    new ThumbnailBuilder()
      .setURL(`attachment://${pokemon.sprite}`)
      .setDescription(pokemon.name),
  );
  container.addSectionComponents(headerSection);

  addHabitatSection(container, "Habitat 1", pokemon.habitat1Details);
  addHabitatSection(container, "Habitat 2", pokemon.habitat2Details);

  if (!showBackButton) {
    return { components: paginateComponents(container), files };
  }

  const backRow = buildBackRow(ownerId, "pokemon", sort, order, page);

  return { components: paginateComponents(container, backRow), files };
}

function formatHabitatDetails(details: string): string {
  return details
    .split("\n")
    .map((line) => line.trim().replace(/,$/, ""))
    .filter(Boolean)
    .join(", ")
    .replace(/:, /g, ": ");
}

function addHabitatSection(
  container: ContainerBuilder,
  label: string,
  details: string,
): void {
  if (!details) return;
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      safeV2TextContent(`**${label}**\n${formatHabitatDetails(details)}`, 500),
    ),
  );
}

export function buildHabitatDetailPayload(
  ownerId: string,
  order: PokopiaSortOrder,
  page: number,
  slug: string,
): IPokopiaPayload | null {
  const habitat: IPokopiaHabitat | undefined = getHabitatBySlug(slug);
  if (!habitat) return null;

  const files: AttachmentBuilder[] = [];
  const container = new ContainerBuilder();

  const itemsText = habitat.items.length ? habitat.items.join(", ") : "-";
  const pokemonText = habitat.pokemon.length
    ? habitat.pokemon.map((p) => formatPokemonRef(p)).join(", ")
    : "-";
  const detailText = [
    `## ${habitat.habitat}`,
    `**Required Items:** ${itemsText}`,
    `**Pokemon Found Here (${habitat.pokemon.length}):** ${pokemonText}`,
  ].join("\n");
  const headerSection = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeV2TextContent(detailText, 1800)),
  );
  if (habitat.image) {
    files.push(attach(habitatImagePath(habitat.image), habitat.image));
    headerSection.setThumbnailAccessory(
      new ThumbnailBuilder()
        .setURL(`attachment://${habitat.image}`)
        .setDescription(habitat.habitat),
    );
  }
  container.addSectionComponents(headerSection);

  const backRow = buildBackRow(ownerId, "habitat", "name", order, page);

  return { components: paginateComponents(container, backRow), files };
}
