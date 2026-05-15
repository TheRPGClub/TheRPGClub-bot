import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  User,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  SelectMenuComponent,
  Slash,
  SlashOption,
} from "discordx";
import {
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import { SeparatorSpacingSize } from "discord-api-types/v10";
import Member, {
  type IGameJournalListEntry,
  type IJournalUserSummary,
} from "../classes/Member.js";
import Game from "../classes/Game.js";
import {
  safeDeferReply,
  safeDeferUpdate,
  safeReply,
  safeUpdate,
} from "../functions/InteractionUtils.js";
import { formatTableDate } from "../commands/profile.command.js";
import { COMPONENTS_V2_FLAG } from "../config/flags.js";

const LIST_PAGE_SIZE = 15;
const ALL_PAGE_SIZE = 20;
const JOURNAL_PAGE_SIZE = 5;

const GJ_LIST_SELECT_PREFIX = "game-journal-list-select";
const GJ_LIST_PAGE_PREFIX = "game-journal-list-page";
const GJ_VIEW_PAGE_PREFIX = "game-journal-view-page";
const GJ_ALL_SELECT_PREFIX = "game-journal-all-select";
const GJ_ALL_PAGE_PREFIX = "game-journal-all-page";

// customId: GJ_LIST_SELECT_PREFIX:{callerId}:{targetUserId}:{page}  value=gameId
// customId: GJ_LIST_PAGE_PREFIX:{callerId}:{targetUserId}:{page}
// customId: GJ_VIEW_PAGE_PREFIX:{callerId}:{targetUserId}:{gameId}:{page}
// customId: GJ_ALL_SELECT_PREFIX:{callerId}:{page}                  value=userId
// customId: GJ_ALL_PAGE_PREFIX:{callerId}:{page}

function trimContent(text: string): string {
  return text.length <= 4000 ? text : `${text.slice(0, 3997)}...`;
}

function gameLabel(n: number): string {
  return n === 1 ? "game" : "games";
}

function entryLabel(n: number): string {
  return n === 1 ? "entry" : "entries";
}

function buildListEmbed(
  target: User,
  entries: IGameJournalListEntry[],
  isSelf: boolean,
  page: number,
  totalPages: number,
): EmbedBuilder {
  const name = target.displayName ?? target.username;
  const start = page * LIST_PAGE_SIZE;
  const pageEntries = entries.slice(start, start + LIST_PAGE_SIZE);

  const lines = pageEntries.map((e) => {
    const count = isSelf ? e.totalEntries : e.publicEntries;
    return `**${e.title}** — ${count} ${entryLabel(count)}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`${name}'s Game Journals`)
    .setThumbnail(target.displayAvatarURL())
    .setDescription(lines.join("\n"))
    .setFooter({
      text: `${entries.length} ${gameLabel(entries.length)} • Page ${page + 1}/${totalPages}`,
    });

  return embed;
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

async function buildJournalViewPayload(
  callerId: string,
  targetUserId: string,
  gameId: number,
  page: number,
): Promise<{
  components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>>;
  files: AttachmentBuilder[];
  flags: number;
}> {
  const game = await Game.getGameById(gameId);
  const ownerProfile = await Member.getByUserId(targetUserId);
  const ownerLabel = ownerProfile?.globalName ?? ownerProfile?.username ?? targetUserId;

  const total = await Member.countGameJournalEntries(targetUserId, gameId, "__public__");
  const totalPages = Math.max(1, Math.ceil(total / JOURNAL_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const offset = (safePage - 1) * JOURNAL_PAGE_SIZE;

  const entries = await Member.getGameJournalEntries(targetUserId, gameId, {
    viewerUserId: null,
    limit: JOURNAL_PAGE_SIZE,
    offset,
  });

  const files: AttachmentBuilder[] = [];
  const container = new ContainerBuilder();

  let coverUrl: string | null = null;
  if (game?.imageData) {
    const filename = `game_journal_${gameId}.png`;
    files.push(new AttachmentBuilder(game.imageData, { name: filename }));
    coverUrl = `attachment://${filename}`;
  }

  const gameTitle = game?.title ?? `Game #${gameId}`;
  const pageInfo = totalPages > 1 ? `, page ${safePage} of ${totalPages}` : "";
  const footer = `-# ${total} public ${entryLabel(total)}${pageInfo}`;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${ownerLabel}'s Game Journal\n## ${gameTitle}`,
    ),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
  );

  const entryLines: string[] = [];
  if (!entries.length) {
    entryLines.push("No public journal entries for this game.");
  } else {
    for (const entry of entries) {
      const titleLine = entry.title ? `### ${entry.title}` : "### Untitled Entry";
      const date = formatTableDate(entry.createdAt);
      entryLines.push(`${titleLine}\n-# ${date}\n${trimContent(entry.body)}`);
    }
  }
  entryLines.push(footer);

  const entriesSection = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(entryLines.join("\n\n")),
  );
  if (coverUrl) {
    entriesSection.setThumbnailAccessory(new ThumbnailBuilder().setURL(coverUrl));
  }
  container.addSectionComponents(entriesSection);

  const pageRow = new ActionRowBuilder<ButtonBuilder>();
  if (safePage > 1) {
    pageRow.addComponents(
      new ButtonBuilder()
        .setCustomId(
          `${GJ_VIEW_PAGE_PREFIX}:${callerId}:${targetUserId}:${gameId}:${safePage - 1}`,
        )
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  if (safePage < totalPages) {
    pageRow.addComponents(
      new ButtonBuilder()
        .setCustomId(
          `${GJ_VIEW_PAGE_PREFIX}:${callerId}:${targetUserId}:${gameId}:${safePage + 1}`,
        )
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary),
    );
  }

  const components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>> = [container];
  if (pageRow.components.length > 0) {
    components.push(pageRow);
  }

  return { components, files, flags: COMPONENTS_V2_FLAG };
}

function buildAllEmbed(
  summaries: IJournalUserSummary[],
  page: number,
  totalPages: number,
): EmbedBuilder {
  const start = page * ALL_PAGE_SIZE;
  const pageSummaries = summaries.slice(start, start + ALL_PAGE_SIZE);
  const memberLabel = summaries.length === 1 ? "member" : "members";
  const lines = pageSummaries.map(
    (s) => `<@${s.userId}> — ${s.gameCount} ${gameLabel(s.gameCount)}`,
  );
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
    const embed = buildListEmbed(target, entries, isSelf, page, totalPages);
    const selectRow = buildListSelectRow(entries, interaction.user.id, target.id, page);
    const pageRow = buildListPageRow(interaction.user.id, target.id, page, totalPages);

    const components = pageRow
      ? [selectRow, pageRow]
      : [selectRow];

    await safeReply(interaction, { embeds: [embed], components, flags });
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

    const payload = await buildJournalViewPayload(callerId, targetUserId, gameId, 1);
    await safeUpdate(interaction, {
      embeds: [],
      components: payload.components,
      files: payload.files,
      flags: payload.flags,
    });
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

    const embed = buildListEmbed(target, entries, isSelf, safePage, totalPages);
    const selectRow = buildListSelectRow(entries, callerId, targetUserId, safePage);
    const pageRow = buildListPageRow(callerId, targetUserId, safePage, totalPages);

    const components = pageRow ? [selectRow, pageRow] : [selectRow];
    await safeUpdate(interaction, { embeds: [embed], components });
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
    const embed = buildListEmbed(target, entries, false, page, totalPages);
    const selectRow = buildListSelectRow(entries, callerId, targetUserId, page);
    const pageRow = buildListPageRow(callerId, targetUserId, page, totalPages);
    const components = pageRow ? [selectRow, pageRow] : [selectRow];
    await safeUpdate(interaction, { embeds: [embed], components });
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
    const payload = await buildJournalViewPayload(callerId, targetUserId, gameId, page);
    await safeUpdate(interaction, {
      components: payload.components,
      files: payload.files,
      flags: payload.flags,
    });
  }
}
