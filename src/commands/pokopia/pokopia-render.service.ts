import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import { SeparatorSpacingSize } from "discord-api-types/v10";
import { resolveAssetPath } from "../../functions/AssetPath.js";
import { safeV2TextContent } from "../../functions/ComponentsV2Utils.js";
import {
  buildActionButton,
  buildButtonRow,
  buildSelectRow,
} from "../../functions/uiComponents.js";
import {
  buildOptionalPrevNextRowWithIds,
  buildPageFooterText,
} from "../../functions/PaginationUtils.js";
import { POKOPIA_LIST_PAGE_SIZE } from "../../config/pagination.js";
import {
  getHabitatBySlug,
  getPokemonByNumber,
  getSortedHabitats,
  getSortedPokemon,
  pokedexNumberKey,
  type IPokopiaHabitat,
  type PokopiaSortField,
  type PokopiaSortOrder,
} from "./pokopia-data.service.js";
import {
  buildPokopiaBackId,
  buildPokopiaListNavId,
  buildPokopiaSelectId,
} from "./pokopia-customid.utils.js";

type PokopiaComponent =
  | ContainerBuilder
  | ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>;

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
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      safeV2TextContent(`## Pokopia Pokedex\n${footer}`, 250),
    ),
  );

  pageItems.forEach((pokemon) => {
    files.push(attach(pokedexImagePath(pokemon.sprite), pokemon.sprite));
    const section = new SectionBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        safeV2TextContent(`**${pokemon.number} ${pokemon.name}**\n${pokemon.ability1 || "-"}`, 500),
      ),
    );
    section.setThumbnailAccessory(
      new ThumbnailBuilder().setURL(`attachment://${pokemon.sprite}`),
    );
    container.addSectionComponents(section);
  });

  const selectOptions = pageItems.map((pokemon) => ({
    label: `${pokemon.number} ${pokemon.name}`.substring(0, 100),
    value: pokedexNumberKey(pokemon.number),
  }));
  const selectRow = buildSelectRow(
    new StringSelectMenuBuilder()
      .setCustomId(buildPokopiaSelectId({ kind: "pokemon", ownerId, sort, order, page: safePage }))
      .setPlaceholder("View a Pokemon's details...")
      .addOptions(selectOptions),
  );

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

  return { components: paginateComponents(container, selectRow, navRow), files };
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
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      safeV2TextContent(`## Pokopia Habitats\n${footer}`, 250),
    ),
  );

  pageItems.forEach((habitat) => {
    const section = new SectionBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        safeV2TextContent(`**${habitat.habitat}**\n${habitat.pokemon.length} Pokemon`, 500),
      ),
    );
    if (habitat.image) {
      files.push(attach(habitatImagePath(habitat.image), habitat.image));
      section.setThumbnailAccessory(
        new ThumbnailBuilder().setURL(`attachment://${habitat.image}`),
      );
    }
    container.addSectionComponents(section);
  });

  const selectOptions = pageItems.map((habitat) => ({
    label: habitat.habitat.substring(0, 100),
    value: habitat.slug,
  }));
  const selectId = buildPokopiaSelectId({
    kind: "habitat", ownerId, sort: "name", order, page: safePage,
  });
  const selectRow = buildSelectRow(
    new StringSelectMenuBuilder()
      .setCustomId(selectId)
      .setPlaceholder("View a habitat's details...")
      .addOptions(selectOptions),
  );

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

  return { components: paginateComponents(container, selectRow, navRow), files };
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
): IPokopiaPayload | null {
  const pokemon = getPokemonByNumber(number);
  if (!pokemon) return null;

  const files: AttachmentBuilder[] = [attach(pokedexImagePath(pokemon.sprite), pokemon.sprite)];
  const container = new ContainerBuilder();
  container.addMediaGalleryComponents(
    new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder()
        .setURL(`attachment://${pokemon.sprite}`)
        .setDescription(pokemon.name),
    ),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
  );

  const abilities = [pokemon.ability1, pokemon.ability2].filter(Boolean).join(", ");
  const favorites = pokemon.favorites.join(", ");
  const detailFields: [string, string | null][] = [
    ["Abilities", abilities],
    ["Home", pokemon.home],
    ["Litter Drop", pokemon.litterDrop],
    ["Favorites", favorites],
  ];
  const detailText = [
    `## ${pokemon.number} ${pokemon.name}`,
    ...detailFields
      .filter(([, value]) => value)
      .map(([label, value]) => `**${label}:** ${value}`),
  ].join("\n");
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeV2TextContent(detailText, 1800)),
  );

  addHabitatSection(container, files, "Habitat 1", pokemon.habitat1Details, pokemon.habitat1Image);
  addHabitatSection(container, files, "Habitat 2", pokemon.habitat2Details, pokemon.habitat2Image);

  const backRow = buildBackRow(ownerId, "pokemon", sort, order, page);

  return { components: paginateComponents(container, backRow), files };
}

function addHabitatSection(
  container: ContainerBuilder,
  files: AttachmentBuilder[],
  label: string,
  details: string,
  image: string,
): void {
  if (!details) return;
  const section = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      safeV2TextContent(`**${label}**\n${details.replace(/\n/g, ", ")}`, 500),
    ),
  );
  if (image) {
    files.push(attach(habitatImagePath(image), image));
    section.setThumbnailAccessory(new ThumbnailBuilder().setURL(`attachment://${image}`));
  }
  container.addSectionComponents(section);
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
  if (habitat.image) {
    files.push(attach(habitatImagePath(habitat.image), habitat.image));
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(`attachment://${habitat.image}`)
          .setDescription(habitat.habitat),
      ),
    );
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
    );
  }

  const itemsText = habitat.items.length ? habitat.items.join(", ") : "-";
  const pokemonText = habitat.pokemon.length
    ? habitat.pokemon.map((p) => `${p.number} ${p.name}`).join(", ")
    : "-";
  const detailText = [
    `## ${habitat.habitat}`,
    `**Required Items:** ${itemsText}`,
    `**Pokemon Found Here (${habitat.pokemon.length}):** ${pokemonText}`,
  ].join("\n");
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeV2TextContent(detailText, 1800)),
  );

  const backRow = buildBackRow(ownerId, "habitat", "name", order, page);

  return { components: paginateComponents(container, backRow), files };
}
