import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  CommandInteraction,
  EmbedBuilder,
  Message,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  User,
} from "discord.js";
import {
  ContainerBuilder,
  TextDisplayBuilder,
  ModalBuilder as ComponentsModalBuilder,
  ActionRowBuilder as ComponentsActionRowBuilder,
  TextInputBuilder as ComponentsTextInputBuilder,
  LabelBuilder,
  RadioGroupBuilder,
} from "@discordjs/builders";
import { TextInputStyle as ApiTextInputStyle } from "discord-api-types/v10";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  SelectMenuComponent,
  Slash,
  SlashOption,
} from "discordx";
import Member, {
  type IGameJournalListEntry,
  type IJournalUserSummary,
} from "../classes/Member.js";
import {
  safeDeferReply,
  safeDeferUpdate,
  safeReply,
  safeUpdate,
} from "../functions/InteractionUtils.js";
import { renderUsernameWithEmoji } from "../services/UserEmojiService.js";
import { buildJournalView } from "../functions/journalView.js";
import { COMPONENTS_V2_FLAG } from "../config/flags.js";
import { buildUserHeaderContainer } from "../functions/uiComponents.js";
import {
  GJ_PUBLIC_CLOSE_PREFIX,
  JOURNAL_ADD_MODAL_ID,
  JOURNAL_TITLE_INPUT_ID,
  JOURNAL_BODY_INPUT_ID,
  JOURNAL_PRIVACY_INPUT_ID,
} from "../config/journalConstants.js";
import {
  trackNowPlayingJournalContext,
  refreshPublicJournalMessages,
} from "./now-playing.command.js";

const LIST_PAGE_SIZE = 15;
const ALL_PAGE_SIZE = 20;

const GJ_LIST_SELECT_PREFIX = "game-journal-list-select";
const GJ_LIST_PAGE_PREFIX = "game-journal-list-page";
const GJ_VIEW_PAGE_PREFIX = "game-journal-view-page";
const GJ_ALL_SELECT_PREFIX = "game-journal-all-select";
const GJ_ALL_PAGE_PREFIX = "game-journal-all-page";
const GJ_HEADER_ADD_PREFIX = "game-journal-header-add";
export { GJ_PUBLIC_CLOSE_PREFIX };

// customId: GJ_LIST_SELECT_PREFIX:{callerId}:{targetUserId}:{page}  value=gameId
// customId: GJ_LIST_PAGE_PREFIX:{callerId}:{targetUserId}:{page}
// customId: GJ_VIEW_PAGE_PREFIX:{callerId}:{targetUserId}:{gameId}:{page}
// customId: GJ_ALL_SELECT_PREFIX:{callerId}:{page}                  value=userId
// customId: GJ_ALL_PAGE_PREFIX:{callerId}:{page}
// customId: GJ_PUBLIC_CLOSE_PREFIX:{callerId}
// customId: GJ_HEADER_ADD_PREFIX:{ownerId}:{gameId}
// modal:    JOURNAL_ADD_MODAL_ID:{ownerId}:{gameId}:{page}

function gameLabel(n: number): string {
  return n === 1 ? "game" : "games";
}

function entryLabel(n: number): string {
  return n === 1 ? "entry" : "entries";
}

function buildListComponents(
  target: User,
  entries: IGameJournalListEntry[],
  isSelf: boolean,
  page: number,
  totalPages: number,
): ContainerBuilder[] {
  const ownerName = target.displayName ?? target.username;
  const userHeader = buildUserHeaderContainer(target.id, ownerName, "Game Journals");

  const start = page * LIST_PAGE_SIZE;
  const pageEntries = entries.slice(start, start + LIST_PAGE_SIZE);
  // const lines = [`## Game Journals`];
  const lines = [];
  lines.push(
    ...pageEntries.map((e) => {
      const count = isSelf ? e.totalEntries : e.publicEntries;
      return `**${e.title}** - ${count} ${entryLabel(count)}`;
    }),
  );
  const pageInfo = totalPages > 1 ? ` • Page ${page + 1}/${totalPages}` : "";
  lines.push(`-# ${entries.length} ${gameLabel(entries.length)}${pageInfo}`);

  const listContainer = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lines.join("\n")),
  );

  return [userHeader, listContainer];
}

function buildListSelectRow(
  entries: IGameJournalListEntry[],
  callerId: string,
  targetUserId: string,
  page: number,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const start = page * LIST_PAGE_SIZE;
  const pageEntries = entries.slice(start, start + LIST_PAGE_SIZE);

  const options = pageEntries.map((e) => ({
    label: e.title.slice(0, 100),
    value: String(e.gameId),
    description: `${e.publicEntries} public ${entryLabel(e.publicEntries)}`,
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${GJ_LIST_SELECT_PREFIX}:${callerId}:${targetUserId}:${page}`)
    .setPlaceholder("Select a game to read its journal")
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

function buildListPageRow(
  callerId: string,
  targetUserId: string,
  page: number,
  totalPages: number,
): ActionRowBuilder<ButtonBuilder> | null {
  if (totalPages <= 1) return null;

  const row = new ActionRowBuilder<ButtonBuilder>();
  if (page > 0) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${GJ_LIST_PAGE_PREFIX}:${callerId}:${targetUserId}:${page - 1}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  if (page < totalPages - 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${GJ_LIST_PAGE_PREFIX}:${callerId}:${targetUserId}:${page + 1}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return row.components.length > 0 ? row : null;
}

function buildJournalViewPayload(
  callerId: string,
  targetUserId: string,
  gameId: number,
  page: number,
  guildId?: string | null,
  isOwner?: boolean,
) {
  return buildJournalView({
    ownerId: targetUserId,
    viewerId: null,
    gameId,
    page,
    guildId,
    prevPageCustomId: (p) =>
      `${GJ_VIEW_PAGE_PREFIX}:${callerId}:${targetUserId}:${gameId}:${p}`,
    nextPageCustomId: (p) =>
      `${GJ_VIEW_PAGE_PREFIX}:${callerId}:${targetUserId}:${gameId}:${p}`,
    headerButtonCustomId: isOwner
      ? `${GJ_HEADER_ADD_PREFIX}:${targetUserId}:${gameId}`
      : undefined,
    includeNowPlayingMeta: true,
    includeCompletions: true,
  });
}

function buildAllEmbed(
  summaries: IJournalUserSummary[],
  page: number,
  totalPages: number,
): EmbedBuilder {
  const start = page * ALL_PAGE_SIZE;
  const pageSummaries = summaries.slice(start, start + ALL_PAGE_SIZE);
  const memberLabel = summaries.length === 1 ? "member" : "members";
  const lines = pageSummaries.map((s) => {
    return `${renderUsernameWithEmoji(s.userId, `<@${s.userId}>`)}`
      + ` - ${s.gameCount} ${gameLabel(s.gameCount)}`;
  });
  return new EmbedBuilder()
    .setTitle("Game Journal Users")
    .setDescription(lines.join("\n"))
    .setFooter({ text: `${summaries.length} ${memberLabel} • Page ${page + 1}/${totalPages}` });
}

function buildAllSelectRow(
  summaries: IJournalUserSummary[],
  callerId: string,
  page: number,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const start = page * ALL_PAGE_SIZE;
  const pageSummaries = summaries.slice(start, start + ALL_PAGE_SIZE);
  const options = pageSummaries.map((s) => ({
    label: (s.globalName ?? s.username ?? s.userId).slice(0, 100),
    value: s.userId,
    description: `${s.gameCount} ${gameLabel(s.gameCount)}`,
  }));
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${GJ_ALL_SELECT_PREFIX}:${callerId}:${page}`)
    .setPlaceholder("Select a member to view their journals")
    .addOptions(options);
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

function buildAllPageRow(
  callerId: string,
  page: number,
  totalPages: number,
): ActionRowBuilder<ButtonBuilder> | null {
  if (totalPages <= 1) return null;
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (page > 0) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${GJ_ALL_PAGE_PREFIX}:${callerId}:${page - 1}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  if (page < totalPages - 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${GJ_ALL_PAGE_PREFIX}:${callerId}:${page + 1}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return row.components.length > 0 ? row : null;
}

@Discord()
export class GameJournalCommand {
  @Slash({
    description: "View Game Journal lists for yourself, a member, or everyone",
    name: "game-journal",
  })
  async gameJournal(
    @SlashOption({
      description: "Show all members who use Game Journals",
      name: "all",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    all: boolean | undefined,
    @SlashOption({
      description: "Member whose journal list to view; defaults to you",
      name: "member",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    member: User | undefined,
    @SlashOption({
      description: "Return the result as an ephemeral (private) message",
      name: "private",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    isPrivate: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const ephemeral = isPrivate === true;
    const flags = ephemeral ? MessageFlags.Ephemeral : undefined;
    await safeDeferReply(interaction, { flags });

    if (all === true && member === undefined) {
      const summaries = await Member.getAllJournalUsers();
      if (!summaries.length) {
        await safeReply(interaction, {
          content: "No members are currently using Game Journals.",
          flags,
        });
        return;
      }
      const totalPages = Math.max(1, Math.ceil(summaries.length / ALL_PAGE_SIZE));
      const page = 0;
      const embed = buildAllEmbed(summaries, page, totalPages);
      const selectRow = buildAllSelectRow(summaries, interaction.user.id, page);
      const pageRow = buildAllPageRow(interaction.user.id, page, totalPages);
      const components = pageRow ? [selectRow, pageRow] : [selectRow];
      await safeReply(interaction, { embeds: [embed], components, flags });
      return;
    }

    const target = member ?? interaction.user;
    const isSelf = target.id === interaction.user.id;
    const entries = await Member.getGameJournalList(target.id);

    if (!entries.length) {
      const name = target.displayName ?? target.username;
      await safeReply(interaction, {
        content: `${name} has no game journals.`,
        flags,
      });
      return;
    }

    const totalPages = Math.max(1, Math.ceil(entries.length / LIST_PAGE_SIZE));
    const page = 0;
    const listComponents = buildListComponents(target, entries, isSelf, page, totalPages);
    const selectRow = buildListSelectRow(entries, interaction.user.id, target.id, page);
    const pageRow = buildListPageRow(interaction.user.id, target.id, page, totalPages);
    const cvFlags = (ephemeral ? MessageFlags.Ephemeral : 0) | COMPONENTS_V2_FLAG;

    const components = pageRow
      ? [...listComponents, selectRow, pageRow]
      : [...listComponents, selectRow];

    await safeReply(interaction, { embeds: [], components, flags: cvFlags });
  }

  @SelectMenuComponent({ id: new RegExp(`^${GJ_LIST_SELECT_PREFIX}:\\d+:\\d+:\\d+$`) })
  async handleListSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, callerId, targetUserId] = interaction.customId.split(":");
    if (interaction.user.id !== callerId) {
      await safeReply(interaction, {
        content: "This journal list isn't yours to navigate.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const gameId = Number(interaction.values[0]);
    if (!gameId) return;

    await safeDeferUpdate(interaction);

    const isOwner = callerId === targetUserId;
    const payload = await buildJournalViewPayload(
      callerId, targetUserId, gameId, 1, interaction.guildId, isOwner,
    );
    await safeUpdate(interaction, {
      embeds: [],
      components: payload.components,
      files: payload.files,
      flags: payload.flags,
      allowedMentions: payload.allowedMentions,
    });
    if (interaction.guildId && interaction.message) {
      await trackNowPlayingJournalContext(
        interaction.message as Message<boolean>, targetUserId, gameId,
      );
    }
  }

  @ButtonComponent({ id: new RegExp(`^${GJ_LIST_PAGE_PREFIX}:\\d+:\\d+:\\d+$`) })
  async handleListPage(interaction: ButtonInteraction): Promise<void> {
    const [, callerId, targetUserId, pageRaw] = interaction.customId.split(":");
    if (interaction.user.id !== callerId) {
      await safeReply(interaction, {
        content: "This journal list isn't yours to navigate.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const page = Number(pageRaw);
    if (Number.isNaN(page)) return;

    await safeDeferUpdate(interaction);

    const target = await interaction.client.users.fetch(targetUserId).catch(() => null);
    if (!target) return;

    const isSelf = targetUserId === callerId;
    const entries = await Member.getGameJournalList(targetUserId);
    const totalPages = Math.max(1, Math.ceil(entries.length / LIST_PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);

    const listComponents = buildListComponents(target, entries, isSelf, safePage, totalPages);
    const selectRow = buildListSelectRow(entries, callerId, targetUserId, safePage);
    const pageRow = buildListPageRow(callerId, targetUserId, safePage, totalPages);

    const components = pageRow
      ? [...listComponents, selectRow, pageRow]
      : [...listComponents, selectRow];
    await safeUpdate(interaction, { embeds: [], components, flags: COMPONENTS_V2_FLAG });
  }

  @SelectMenuComponent({ id: new RegExp(`^${GJ_ALL_SELECT_PREFIX}:\\d+:\\d+$`) })
  async handleAllSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, callerId] = interaction.customId.split(":");
    if (interaction.user.id !== callerId) {
      await safeReply(interaction, {
        content: "This member list isn't yours to navigate.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const targetUserId = interaction.values[0];
    if (!targetUserId) return;

    await safeDeferUpdate(interaction);

    const target = await interaction.client.users.fetch(targetUserId).catch(() => null);
    if (!target) return;

    const entries = await Member.getGameJournalList(targetUserId);
    if (!entries.length) {
      await safeUpdate(interaction, {
        content: `${target.displayName ?? target.username} has no game journals.`,
        embeds: [],
        components: [],
      });
      return;
    }

    const totalPages = Math.max(1, Math.ceil(entries.length / LIST_PAGE_SIZE));
    const page = 0;
    const listComponents = buildListComponents(target, entries, false, page, totalPages);
    const selectRow = buildListSelectRow(entries, callerId, targetUserId, page);
    const pageRow = buildListPageRow(callerId, targetUserId, page, totalPages);
    const components = pageRow
      ? [...listComponents, selectRow, pageRow]
      : [...listComponents, selectRow];
    await safeUpdate(interaction, { embeds: [], components, flags: COMPONENTS_V2_FLAG });
  }

  @ButtonComponent({ id: new RegExp(`^${GJ_ALL_PAGE_PREFIX}:\\d+:\\d+$`) })
  async handleAllPage(interaction: ButtonInteraction): Promise<void> {
    const [, callerId, pageRaw] = interaction.customId.split(":");
    if (interaction.user.id !== callerId) {
      await safeReply(interaction, {
        content: "This member list isn't yours to navigate.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const page = Number(pageRaw);
    if (Number.isNaN(page)) return;

    await safeDeferUpdate(interaction);

    const summaries = await Member.getAllJournalUsers();
    const totalPages = Math.max(1, Math.ceil(summaries.length / ALL_PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const embed = buildAllEmbed(summaries, safePage, totalPages);
    const selectRow = buildAllSelectRow(summaries, callerId, safePage);
    const pageRow = buildAllPageRow(callerId, safePage, totalPages);
    const components = pageRow ? [selectRow, pageRow] : [selectRow];
    await safeUpdate(interaction, { embeds: [embed], components });
  }

  @ButtonComponent({ id: new RegExp(`^${GJ_VIEW_PAGE_PREFIX}:\\d+:\\d+:\\d+:\\d+$`) })
  async handleViewPage(interaction: ButtonInteraction): Promise<void> {
    const [, callerId, targetUserId, gameIdRaw, pageRaw] = interaction.customId.split(":");
    if (interaction.user.id !== callerId) {
      await safeReply(interaction, {
        content: "This journal isn't yours to navigate.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const gameId = Number(gameIdRaw);
    const page = Number(pageRaw);
    if (Number.isNaN(gameId) || Number.isNaN(page)) return;

    await safeDeferUpdate(interaction);
    const isOwner = callerId === targetUserId;
    const payload = await buildJournalViewPayload(
      callerId, targetUserId, gameId, page, interaction.guildId, isOwner,
    );
    await safeUpdate(interaction, {
      components: payload.components,
      files: payload.files,
      flags: payload.flags,
      allowedMentions: payload.allowedMentions,
    });
    if (interaction.guildId && interaction.message) {
      await trackNowPlayingJournalContext(
        interaction.message as Message<boolean>, targetUserId, gameId,
      );
    }
  }

  @ButtonComponent({ id: /^game-journal-header-add:\d+:\d+$/ })
  async handleHeaderAdd(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, gameIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, {
        content: "Only the journal owner can add entries.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const modal = new ComponentsModalBuilder()
      .setCustomId(`${JOURNAL_ADD_MODAL_ID}:${ownerId}:${gameIdRaw}:1`)
      .setTitle("Add Journal Entry");
    modal.addActionRowComponents(
      new ComponentsActionRowBuilder<ComponentsTextInputBuilder>().addComponents(
        new ComponentsTextInputBuilder()
          .setCustomId(JOURNAL_TITLE_INPUT_ID)
          .setLabel("Title (optional)")
          .setStyle(ApiTextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(120),
      ),
      new ComponentsActionRowBuilder<ComponentsTextInputBuilder>().addComponents(
        new ComponentsTextInputBuilder()
          .setCustomId(JOURNAL_BODY_INPUT_ID)
          .setLabel("Entry")
          .setStyle(ApiTextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(2000),
      ),
    );
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel("Privacy")
        .setDescription("Choose who can view this entry")
        .setRadioGroupComponent(
          new RadioGroupBuilder()
            .setCustomId(JOURNAL_PRIVACY_INPUT_ID)
            .setRequired(true)
            .setOptions(
              { label: "Private", value: "private", description: "Only you can view it" },
              { label: "Public", value: "public", description: "Visible to other members" },
            ),
        ),
    );
    await interaction.showModal(modal);
  }

  @ButtonComponent({ id: new RegExp(`^${GJ_PUBLIC_CLOSE_PREFIX}:\\d+$`) })
  async handlePublicClose(interaction: ButtonInteraction): Promise<void> {
    const [, callerId] = interaction.customId.split(":");
    if (interaction.user.id !== callerId) {
      await safeReply(interaction, {
        content: "Only the person who opened this journal can close it.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferUpdate();
    await interaction.message.delete();
  }
}
