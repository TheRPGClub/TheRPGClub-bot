import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  CommandInteraction,
  MessageFlags,
  ModalSubmitInteraction,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputStyle,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  SelectMenuComponent,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";
import {
  safeDeferReply,
  PRIVATE_OPTION_DESCRIPTION,
  replyIfNotOwner,
  safeReply,
  safeUpdate,
  sanitizeUserInput,
} from "../functions/InteractionUtils.js";
import { decodeBase64Url, encodeWithMaxLength } from "../functions/CustomIdUtils.js";
import {
  buildComponentsV2Flags,
  buildTextContainer,
  buildTextReply,
  buildTitledContainer,
  safeV2TextContent,
} from "../functions/ComponentsV2Utils.js";
import {
  ContainerBuilder,
} from "@discordjs/builders";
import { isAdmin } from "./admin/admin-auth.utils.js";
import type { IGame } from "../types/GameTypes.js";
import Game from "../classes/Game.js";
import GameSearchSynonym from "../classes/GameSearchSynonym.js";
import GameSearchSynonymDraft, {
  type ISynonymDraftPair,
} from "../classes/GameSearchSynonymDraft.js";
import { shouldRenderPrevNextButtons } from "../functions/PaginationUtils.js";
import {
  buildActionButton,
  buildButtonRow,
  buildTextInputRow,
  buildSelectRow,
} from "../functions/uiComponents.js";
import { parseSynonymQuickAddTerms } from "./gamedb-synonym.utils.js";
import { isPositiveInt, truncateWithEllipsis } from "../utilities/ValidationUtils.js";
import { SYNONYM_LIST_PAGE_SIZE } from "../config/pagination.js";
import { assertCustomIdSegments } from "../utilities/CustomIdUtils.js";
import { safeIgnore } from "../utilities/AsyncUtils.js";

const SYNONYM_ADD_MODAL_PREFIX = "gamedb-syn-add";
const SYNONYM_ADD_MORE_PREFIX = "gamedb-syn-more";
const SYNONYM_ADD_DONE_PREFIX = "gamedb-syn-done";
const SYNONYM_ADD_BULK_INPUT_ID = "gamedb-syn-bulk";
const SYNONYM_LIST_PAGE_PREFIX = "gamedb-syn-page";
const SYNONYM_EDIT_GROUP_SELECT_PREFIX = "gamedb-syn-edit-group";
const SYNONYM_EDIT_GROUP_MODAL_PREFIX = "gamedb-syn-edit-group-modal";
const SYNONYM_EDIT_GROUP_INPUT_ID = "gamedb-syn-edit-group-input";
const SYNONYM_DELETE_GROUP_SELECT_PREFIX = "gamedb-syn-delete-group";
const SYNONYM_ADD_FROM_LIST_PREFIX = "gamedb-syn-add-from-list";
const MAX_COMPONENT_CUSTOM_ID_LENGTH = 100;

function encodeSynonymQuery(query: string, maxLength: number): string {
  return encodeWithMaxLength(query.trim(), maxLength);
}

function decodeSynonymQuery(encoded: string): string {
  return decodeBase64Url(encoded);
}

function clampSynonymOptionText(value: string, maxLength = 100): string {
  return truncateWithEllipsis(value, maxLength);
}

function buildSynonymGroupEditModal(ownerId: string, groupId: number, terms: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`${SYNONYM_EDIT_GROUP_MODAL_PREFIX}:${ownerId}:${groupId}`)
    .setTitle("Edit Search Synonym Group")
    .addComponents(buildTextInputRow({
      customId: SYNONYM_EDIT_GROUP_INPUT_ID,
      label: "Synonym terms, one per line",
      style: TextInputStyle.Paragraph,
      maxLength: 2000,
      value: terms,
    }));
}

function buildSynonymListCustomId(
  ownerId: string,
  page: number,
  query: string,
  direction?: "next" | "prev",
): string {
  const base = `${SYNONYM_LIST_PAGE_PREFIX}:${ownerId}:${page}:`;
  const maxQueryLength = MAX_COMPONENT_CUSTOM_ID_LENGTH - base.length - (direction ? `:${direction}`.length : 0);
  const encodedQuery = encodeSynonymQuery(query, Math.max(maxQueryLength, 0));
  return direction
    ? `${base}${encodedQuery}:${direction}`
    : `${base}${encodedQuery}`;
}

function buildSynonymGroupSelectCustomId(
  prefix: string,
  ownerId: string,
  page: number,
  query: string,
): string {
  const base = `${prefix}:${ownerId}:${page}:`;
  const maxQueryLength = MAX_COMPONENT_CUSTOM_ID_LENGTH - base.length;
  const encodedQuery = encodeSynonymQuery(query, Math.max(maxQueryLength, 0));
  return `${base}${encodedQuery}`;
}
function parseSynonymPairs(
  rawInput: string,
  maxPairs: number,
): ISynonymDraftPair[] {
  const lines = rawInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const pairs: ISynonymDraftPair[] = [];
  const separators = ["<-->", "<->", "=>", "->", "|", ","];
  for (const line of lines) {
    let separator: string | null = null;
    for (const candidate of separators) {
      if (line.includes(candidate)) {
        separator = candidate;
        break;
      }
    }
    if (!separator) continue;
    const [left, right] = line.split(separator).map((part) => part.trim());
    if (!left || !right) continue;
    pairs.push({ term: left, match: right });
    if (pairs.length >= maxPairs) break;
  }
  return pairs;
}

function buildSynonymAddModal(draftId: number): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`${SYNONYM_ADD_MODAL_PREFIX}:${draftId}`)
    .setTitle("Add GameDB Search Synonyms")
    .addComponents(buildTextInputRow({
      customId: SYNONYM_ADD_BULK_INPUT_ID,
      label: "Synonym pairs, one per line",
      style: TextInputStyle.Paragraph,
      placeholder: "GTA <-> Grand Theft Auto\nKH <-> Kingdom Hearts\n1 <-> one",
      maxLength: 2000,
    }));
}

function buildSynonymContinueComponents(draftId: number): Array<ActionRowBuilder<ButtonBuilder>> {
  const addMore = buildActionButton({ customId: `${SYNONYM_ADD_MORE_PREFIX}:${draftId}`, label: "Add More", style: ButtonStyle.Primary });
  const done = buildActionButton({ customId: `${SYNONYM_ADD_DONE_PREFIX}:${draftId}`, label: "Done", style: ButtonStyle.Secondary });
  return [buildButtonRow(addMore, done)];
}
function parseGameIdList(raw: string): number[] {
  const matches = raw.split(/[^0-9]+/).filter(Boolean);
  const ids = matches.map((part) => Number(part)).filter(isPositiveInt);
  return Array.from(new Set(ids));
}

@Discord()
@SlashGroup({ description: "Game Database Commands", name: "gamedb" })
@SlashGroup("gamedb")
export class GameDbAdmin {
  private async buildSynonymListPayload(
    ownerId: string,
    query: string,
    page: number,
    isPublic: boolean,
  ): Promise<{
    components: Array<
      ContainerBuilder | ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>
    >;
    flags: number;
  }> {
    const totalCount = await GameSearchSynonym.countSynonymGroups(query || undefined);
    const totalPages = Math.max(1, Math.ceil(totalCount / SYNONYM_LIST_PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const offset = safePage * SYNONYM_LIST_PAGE_SIZE;

    const terms = await GameSearchSynonym.listSynonymGroups({
      query: query || undefined,
      limit: SYNONYM_LIST_PAGE_SIZE,
      offset,
    });

    const grouped = new Map<number, typeof terms>();
    terms.forEach((term) => {
      const list = grouped.get(term.groupId) ?? [];
      list.push(term);
      grouped.set(term.groupId, list);
    });

    const groupEntries = Array.from(grouped.entries());
    const groupLines = groupEntries.map(([, groupTerms], index) => {
      const termList = groupTerms.map((term) => `"${term.termText}"`);
      const arrowLine = termList.length > 1
        ? termList.join(" ➜ ")
        : termList.join("");
      return `${offset + index + 1}. ${arrowLine}`;
    });

    const titleLine = query
      ? `## Search Synonym Groups (Page ${safePage + 1}/${totalPages})\nQuery: ${query}`
      : `## Search Synonym Groups (Page ${safePage + 1}/${totalPages})`;
    const content = groupLines.length
      ? `${titleLine}\n\n${groupLines.join("\n")}`
      : `${titleLine}\n\nNo search synonyms found.`;

    const container = buildTextContainer(safeV2TextContent(content, 3500));

    const prevDisabled = safePage === 0;
    const nextDisabled = safePage >= totalPages - 1;
    const prevButton = buildActionButton({
      customId: buildSynonymListCustomId(ownerId, safePage, query, "prev"),
      label: "Previous Page",
      style: ButtonStyle.Secondary,
    }).setDisabled(prevDisabled);
    const nextButton = buildActionButton({
      customId: buildSynonymListCustomId(ownerId, safePage, query, "next"),
      label: "Next Page",
      style: ButtonStyle.Secondary,
    }).setDisabled(nextDisabled);
    const addGroupButton = buildActionButton({
      customId: buildSynonymGroupSelectCustomId(
        SYNONYM_ADD_FROM_LIST_PREFIX,
        ownerId,
        safePage,
        query,
      ),
      label: "Add New Group",
      style: ButtonStyle.Primary,
    });
    const buttonRowItems: ButtonBuilder[] = [addGroupButton];
    if (shouldRenderPrevNextButtons(prevDisabled, nextDisabled)) {
      buttonRowItems.push(prevButton, nextButton);
    }
    const buttonRow = buildButtonRow(...buttonRowItems);

    const components: Array<
      ContainerBuilder | ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>
    > = [container];

    if (groupEntries.length) {
      const select = new StringSelectMenuBuilder()
        .setCustomId(buildSynonymGroupSelectCustomId(
          SYNONYM_EDIT_GROUP_SELECT_PREFIX,
          ownerId,
          safePage,
          query,
        ))
        .setPlaceholder("Select a group to edit");
      const selectOptions = groupEntries.map(([groupId, groupTerms], index) => {
        const termList = groupTerms.map((term) => `"${term.termText}"`).join(" ↔ ");
        return {
          label: `Group ${offset + index + 1}`,
          value: String(groupId),
          description: clampSynonymOptionText(termList, 100),
        };
      });
      select.addOptions(selectOptions);
      components.push(buildSelectRow(select));

      const deleteSelect = new StringSelectMenuBuilder()
        .setCustomId(buildSynonymGroupSelectCustomId(
          SYNONYM_DELETE_GROUP_SELECT_PREFIX,
          ownerId,
          safePage,
          query,
        ))
        .setPlaceholder("Select a group to delete");
      deleteSelect.addOptions(selectOptions);
      components.push(buildSelectRow(deleteSelect));
    }
    components.push(buttonRow);

    return {
      components,
      flags: buildComponentsV2Flags(!isPublic),
    };
  }
  @Slash({ description: "Link alternate GameDB versions (Admin only)", name: "link-versions" })
  async linkVersions(
    @SlashOption({
      description: "Comma-separated GameDB ids to link together",
      name: "game_ids",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    gameIdsRaw: string,
    @SlashOption({
      description: PRIVATE_OPTION_DESCRIPTION,
      name: "private",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    privateFlag: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isPublic = !(privateFlag ?? false);
    await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });

    if (!(await isAdmin(interaction))) return;

    gameIdsRaw = sanitizeUserInput(gameIdsRaw, { preserveNewlines: false });
    const gameIds = parseGameIdList(gameIdsRaw);
    if (gameIds.length < 2) {
      await safeReply(interaction, buildTextReply(
        "Provide at least two valid GameDB ids to link.",
        true,
      ));
      return;
    }

    const games = (await Promise.all(gameIds.map((id) => Game.getGameById(id)))).filter(
      (g): g is IGame => g !== null,
    );
    const foundIds = new Set(games.map((game) => game.id));
    const missingIds = gameIds.filter((id) => !foundIds.has(id));
    if (missingIds.length) {
      await safeReply(interaction, buildTextReply(
        `Missing GameDB id(s): ${missingIds.join(", ")}.`,
        true,
      ));
      return;
    }

    await Game.linkAlternateVersions(gameIds);
    const lines = games
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((game) => `• **${game.title}** (GameDB #${game.id})`);
    const container = buildTitledContainer("Linked Alternate Versions", lines.join("\n"));
    await safeReply(interaction, {
      components: [container],
      flags: buildComponentsV2Flags(!isPublic),
    });
  }

  @Slash({
    description: "Quick add one GameDB search synonym group (Admin only)",
    name: "synonym-add",
  })
  async synonymAdd(
    @SlashOption({
      description: "Base term for the group",
      name: "base_term",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    baseTerm: string,
    @SlashOption({
      description: "Required synonym for the base term",
      name: "synonym",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    synonym: string,
    @SlashOption({
      description: "Optional additional synonyms (comma, pipe, semicolon, or newline separated)",
      name: "additional_synonyms",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    additionalSynonyms: string | undefined,
    @SlashOption({
      description: PRIVATE_OPTION_DESCRIPTION,
      name: "private",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    privateFlag: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isPublic = !(privateFlag ?? false);
    await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });
    if (!(await isAdmin(interaction))) return;

    const cleanedBaseTerm = sanitizeUserInput(baseTerm, { preserveNewlines: false });
    const cleanedSynonym = sanitizeUserInput(synonym, { preserveNewlines: false });
    const cleanedAdditionalSynonyms = additionalSynonyms
      ? sanitizeUserInput(additionalSynonyms, { preserveNewlines: true })
      : undefined;

    const terms = parseSynonymQuickAddTerms(
      cleanedBaseTerm,
      cleanedSynonym,
      cleanedAdditionalSynonyms,
    );
    if (terms.length < 2) {
      await safeReply(interaction, buildTextReply("Invalid input. Provide a base term and synonym with letters or numbers. " +
          "Additional synonyms can be separated by comma, pipe, semicolon, or newline.", !(isPublic)));
      return;
    }

    try {
      const result = await GameSearchSynonym.createGroupTerms(terms, interaction.user.id);
      const termList = result.terms.map((term) => `"${term.termText}"`).join(" | ");
      let content = `Saved synonym group #${result.groupId} with ${result.terms.length} terms:\n${termList}`;
      content = truncateWithEllipsis(content, 1900);
      await safeReply(interaction, buildTextReply(content, !(isPublic)));
    } catch (err: any) {
      await safeReply(interaction, buildTextReply(`Failed to save synonym group. ${err?.message ?? "Unknown error."}`, !(isPublic)));
    }
  }

  @Slash({
    description: "List GameDB search synonyms (Admin only)",
    name: "synonym-list",
  })
  async synonymList(
    @SlashOption({
      description: "Optional query to filter terms",
      name: "query",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    query: string | undefined,
    @SlashOption({
      description: PRIVATE_OPTION_DESCRIPTION,
      name: "private",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    privateFlag: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isPublic = !(privateFlag ?? false);
    await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });
    if (!(await isAdmin(interaction))) return;

    const cleanedQuery = query ? sanitizeUserInput(query, { preserveNewlines: false }) : "";
    const payload = await this.buildSynonymListPayload(
      interaction.user.id,
      cleanedQuery,
      0,
      isPublic,
    );
    await safeReply(interaction, payload);
  }

  @ModalComponent({ id: /^gamedb-syn-add:\d+$/ })
  async synonymAddModal(interaction: ModalSubmitInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const draftId = Number(segs[0]);
    if (!isPositiveInt(draftId)) {
      await safeReply(interaction, buildTextReply("This synonym draft is no longer valid.", true));
      return;
    }

    const draft = await GameSearchSynonymDraft.getDraft(draftId);
    if (!draft || draft.userId !== interaction.user.id) {
      await safeReply(interaction, buildTextReply("This synonym draft is no longer available.", true));
      return;
    }

    const rawInput = interaction.fields.getTextInputValue(SYNONYM_ADD_BULK_INPUT_ID);
    const cleanedInput = sanitizeUserInput(rawInput, { preserveNewlines: true });
    const pairs = parseSynonymPairs(cleanedInput, 50);
    if (!pairs.length) {
      await safeReply(interaction, buildTextReply("No valid pairs found. Use one pair per line with a separator like \"<->\" or \"->\".", true));
      return;
    }

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const addedLines: string[] = [];
    const errors: string[] = [];
    for (const pair of pairs) {
      const termText = sanitizeUserInput(pair.term, { preserveNewlines: false });
      const matchText = sanitizeUserInput(pair.match, { preserveNewlines: false });
      if (!termText || !matchText) continue;
      try {
        const result = await GameSearchSynonym.addSynonymPair(
          termText,
          matchText,
          interaction.user.id,
        );
        const list = result.terms.map((item) => `"${item.termText}"`).join(" | ");
        addedLines.push(`Group ${result.groupId}: ${list}`);
      } catch (err: any) {
        errors.push(err?.message ?? `Failed to add ${termText}`);
      }
    }

    await GameSearchSynonymDraft.appendPairs(draftId, pairs);

    const summaryLines = [
      `Added ${addedLines.length} synonym pair${addedLines.length === 1 ? "" : "s"}.`,
      ...addedLines,
      ...(errors.length ? ["", "Errors:", ...errors] : []),
      "",
      "Use Add More to continue, or Done to finish.",
    ];
    const content = truncateWithEllipsis(summaryLines.join("\n"), 1900);

    const synonymSummaryReply = buildTextReply(content, true);
    await safeReply(interaction, {
      ...synonymSummaryReply,
      components: [
        ...synonymSummaryReply.components,
        ...buildSynonymContinueComponents(draftId),
      ],
    });
  }

  @ButtonComponent({ id: /^gamedb-syn-more:\d+$/ })
  async synonymAddMore(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const draftId = Number(segs[0]);
    if (!isPositiveInt(draftId)) {
      await safeReply(interaction, buildTextReply("This synonym draft is no longer valid.", true));
      return;
    }

    const draft = await GameSearchSynonymDraft.getDraft(draftId);
    if (!draft || draft.userId !== interaction.user.id) {
      await safeReply(interaction, buildTextReply("This synonym draft is no longer available.", true));
      return;
    }

    safeIgnore(interaction.showModal(buildSynonymAddModal(draftId)));
  }

  @ButtonComponent({ id: /^gamedb-syn-done:\d+$/ })
  async synonymAddDone(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const draftId = Number(segs[0]);
    if (!isPositiveInt(draftId)) {
      await safeReply(interaction, buildTextReply("This synonym draft is no longer valid.", true));
      return;
    }

    const draft = await GameSearchSynonymDraft.getDraft(draftId);
    if (!draft || draft.userId !== interaction.user.id) {
      await safeReply(interaction, buildTextReply("This synonym draft is no longer available.", true));
      return;
    }

    await GameSearchSynonymDraft.deleteDraft(draftId);
    await safeUpdate(interaction, buildTextReply("Synonym entry complete.", true));
  }

  @SelectMenuComponent({ id: /^gamedb-syn-edit-group:\d+:\d+:[A-Za-z0-9_-]*$/ })
  async synonymGroupEditSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId)) return;

    const groupId = Number(interaction.values[0]);
    if (!isPositiveInt(groupId)) {
      await safeReply(interaction, buildTextReply("Invalid synonym group selected.", true));
      return;
    }

    const terms = await GameSearchSynonym.listGroupTerms(groupId);
    if (!terms.length) {
      await safeReply(interaction, buildTextReply("Synonym group not found.", true));
      return;
    }

    let termLines = terms.map((term) => term.termText).join("\n");
    if (termLines.length > 2000) {
      termLines = termLines.slice(0, 2000);
    }

    await interaction
      .showModal(buildSynonymGroupEditModal(ownerId, groupId, termLines))
      .catch(async () => {
        await safeReply(interaction, buildTextReply("Unable to open the edit modal. Please try again.", true));
      });
  }

  @SelectMenuComponent({ id: /^gamedb-syn-delete-group:\d+:\d+:[A-Za-z0-9_-]*$/ })
  async synonymGroupDeleteSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId, pageRaw, encodedQuery] = segs;
    const page = Number(pageRaw);
    if (await replyIfNotOwner(interaction, ownerId)) return;

    const groupId = Number(interaction.values[0]);
    if (!isPositiveInt(groupId)) {
      await safeReply(interaction, buildTextReply("Invalid synonym group selected.", true));
      return;
    }

    const deleted = await GameSearchSynonym.deleteGroup(groupId);
    if (!deleted) {
      await safeReply(interaction, buildTextReply("Synonym group not found.", true));
      return;
    }

    const query = sanitizeUserInput(decodeSynonymQuery(encodedQuery), { preserveNewlines: false });
    const isPublic = !(interaction.message?.flags?.has(MessageFlags.Ephemeral));
    const payload = await this.buildSynonymListPayload(
      ownerId,
      query,
      Number.isFinite(page) ? page : 0,
      isPublic,
    );
    await safeUpdate(interaction, payload);
  }

  @ButtonComponent({ id: /^gamedb-syn-add-from-list:\d+:\d+:[A-Za-z0-9_-]*$/ })
  async synonymAddFromList(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId)) return;

    const draft = await GameSearchSynonymDraft.createDraft(interaction.user.id);
    await interaction
      .showModal(buildSynonymAddModal(draft.draftId))
      .catch(async () => {
        await safeReply(interaction, buildTextReply("Unable to open the synonym modal. Please try again.", true));
      });
  }

  @ModalComponent({ id: /^gamedb-syn-edit-group-modal:\d+:\d+$/ })
  async synonymGroupEditModal(
    interaction: ModalSubmitInteraction,
  ): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [ownerId, groupIdRaw] = segs;
    const groupId = Number(groupIdRaw);
    if (await replyIfNotOwner(interaction, ownerId, "This edit request isn't for you.")) return;
    if (!isPositiveInt(groupId)) {
      await safeReply(interaction, buildTextReply("Invalid synonym group selected.", true));
      return;
    }

    const rawInput = interaction.fields.getTextInputValue(SYNONYM_EDIT_GROUP_INPUT_ID);
    const cleanedInput = sanitizeUserInput(rawInput, { preserveNewlines: true });
    const terms: string[] = [];
    const seen = new Set<string>();
    for (const line of cleanedInput.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const norm = GameSearchSynonym.normalizeTerm(trimmed);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      terms.push(trimmed);
    }

    if (terms.length < 2) {
      await safeReply(interaction, buildTextReply("Synonym groups must include at least two terms.", true));
      return;
    }

    try {
      const result = await GameSearchSynonym.updateGroupTerms(
        groupId,
        terms,
        interaction.user.id,
      );
      const termList = result.terms.map((term) => `"${term.termText}"`).join(" | ");
      let content = `Updated synonym group with ${result.terms.length} terms:\n${termList}`;
      content = truncateWithEllipsis(content, 1900);
      await safeReply(interaction, buildTextReply(content, true));
    } catch (err: any) {
      await safeReply(interaction, buildTextReply(err?.message ?? "Failed to update synonym group.", true));
    }
  }

  @ButtonComponent({ id: /^gamedb-syn-page:\d+:\d+:[A-Za-z0-9_-]*:(next|prev)$/ })
  async synonymListPage(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 4);
    if (!segs) return;
    const [ownerId, pageRaw, encodedQuery, direction] = segs;
    const page = Number(pageRaw);

    if (await replyIfNotOwner(interaction, ownerId)) return;

    const query = sanitizeUserInput(decodeSynonymQuery(encodedQuery), { preserveNewlines: false });
    const delta = direction === "next" ? 1 : -1;
    const isPublic = !(interaction.message?.flags?.has(MessageFlags.Ephemeral));
    const payload = await this.buildSynonymListPayload(
      ownerId,
      query,
      Number.isFinite(page) ? page + delta : 0,
      isPublic,
    );

    await safeUpdate(interaction, payload);
  }
}
