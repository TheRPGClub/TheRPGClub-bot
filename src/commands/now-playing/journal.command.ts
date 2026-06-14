import {
  MessageFlags,
  ModalSubmitInteraction,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
} from "discord.js";
import {
  Discord,
  SelectMenuComponent,
  ButtonComponent,
  ModalComponent,
} from "discordx";
import {
  ModalBuilder as ComponentsModalBuilder,
  ActionRowBuilder as ComponentsActionRowBuilder,
  TextInputBuilder as ComponentsTextInputBuilder,
} from "@discordjs/builders";
import { TextInputStyle as ApiTextInputStyle } from "discord-api-types/v10";
import Member from "../../classes/Member.js";
import {
  safeDeferUpdate,
  safeReply,
  safeUpdate,
  sanitizeUserInput,
  replyIfNotOwner,
} from "../../functions/InteractionUtils.js";
import {
  buildActionButton,
  buildButtonRow,
  buildSelectRow,
} from "../../functions/uiComponents.js";
import {
  buildComponentsV2Flags,
  buildTextContainer,
  buildTextReply,
} from "../../functions/ComponentsV2Utils.js";
import { formatTableDate } from "../../functions/DateFormatUtils.js";
import { NOW_PLAYING_HELP_PREFIX } from "../now-playing-help.js";
import { truncateLabel } from "../../config/textLimits.js";
import { assertCustomIdSegments } from "../../utilities/CustomIdUtils.js";
import {
  NOW_PLAYING_EDIT_MENU_START_JOURNAL_SELECT_PREFIX,
  NOW_PLAYING_JOURNAL_ADD_PREFIX,
  NOW_PLAYING_JOURNAL_EDIT_PREFIX,
  NOW_PLAYING_JOURNAL_DELETE_PREFIX,
  NOW_PLAYING_JOURNAL_DELETE_SELECT_PREFIX,
  NOW_PLAYING_JOURNAL_DELETE_CONFIRM_PREFIX,
  NOW_PLAYING_JOURNAL_MODAL_ID,
  NOW_PLAYING_JOURNAL_EDIT_MODAL_ID,
  NOW_PLAYING_JOURNAL_TITLE_INPUT_ID,
  NOW_PLAYING_JOURNAL_BODY_INPUT_ID,
} from "./nowPlayingIds.js";
import {
  journalOwnerMenu,
  nowPlayingOwnerMenu,
  nowPlayingJournalContexts,
  refreshJournalMessages,
} from "./nowPlayingContexts.js";
import { getDisplayNowPlayingEntries } from "../../functions/NowPlayingUtils.js";
import {
  buildNowPlayingManageRow,
} from "./nowPlayingListRenderer.js";
import { buildJournalComponents } from "./nowPlayingRenderers.js";
import {
  deleteLatestJournalMessageInChannel,
  trackJournalReply,
} from "./nowPlayingMessageService.js";

@Discord()
export class NowPlayingJournalCommand {
  private async buildManageJournalButtonRow(
    ownerId: string,
    gameId: number,
    page: number,
  ): Promise<ActionRowBuilder<ButtonBuilder>> {
    const entries = await Member.getGameJournalEntries(ownerId, gameId, { limit: 1, offset: 0 });
    const hasEntries = entries.length > 0;
    return buildButtonRow(
      buildActionButton("add", `${NOW_PLAYING_JOURNAL_ADD_PREFIX}:${ownerId}:${gameId}:${page}`, "Add Entry"),
      buildActionButton("edit", `${NOW_PLAYING_JOURNAL_EDIT_PREFIX}:${ownerId}:${gameId}:${page}`, "Edit Entry")
        .setDisabled(!hasEntries),
      buildActionButton("delete", `${NOW_PLAYING_JOURNAL_DELETE_PREFIX}:${ownerId}:${gameId}:${page}`, "Delete Entry")
        .setDisabled(!hasEntries),
    );
  }

  @ButtonComponent({ id: /^nowplaying-journal-header:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalHeader(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId, gameIdRaw, pageRaw] = segs;
    if (interaction.user.id !== ownerId) {
      await safeDeferUpdate(interaction);
      return;
    }
    const gameId = Number(gameIdRaw);
    const page = Number(pageRaw);
    const row = await this.buildManageJournalButtonRow(ownerId, gameId, page);
    await journalOwnerMenu.show(interaction, ownerId, [row]);
  }

  @ButtonComponent({ id: /^nowplaying-journal-open:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalOpen(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId, gameIdRaw, pageRaw] = segs;
    const gameId = Number(gameIdRaw);
    const nowPlayingEntries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId));
    const selected = nowPlayingEntries.find((entry) => entry.gameId === Number(gameIdRaw));
    if (!selected?.journalEnabled) {
      await safeReply(interaction, buildTextReply("Journal is not enabled for this game.", true));
      return;
    }
    if (interaction.guildId && !selected.hasJournalEntry) {
      await safeReply(interaction, buildTextReply("This game's journal has no public entries to show in channel.", true));
      return;
    }
    const payload = await buildJournalComponents(
      ownerId,
      interaction.guildId ? "__public__" : interaction.user.id,
      gameId,
      Number(pageRaw),
      interaction.guildId,
      interaction.user.id === ownerId,
    );
    if (interaction.guildId) {
      await deleteLatestJournalMessageInChannel(interaction, ownerId, gameId);
    }
    const reply = await safeReply(interaction, {
      components: payload.components,
      files: payload.files,
      flags: buildComponentsV2Flags(
        interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false,
      ),
      allowedMentions: payload.allowedMentions,
      withResponse: true,
    } as any);
    await trackJournalReply(reply?.resource?.message ?? null, ownerId, gameId);
  }

  @SelectMenuComponent({ id: /^nowplaying-journal-view-select:\d+$/ })
  async handleNowPlayingJournalViewSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    const gameId = Number(interaction.values?.[0]);
    if (!gameId) return;
    const nowPlayingEntries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId));
    const selected = nowPlayingEntries.find((e) => e.gameId === gameId);
    if (!selected?.journalEnabled || !selected.hasJournalEntry) {
      await safeReply(interaction, buildTextReply("This game has no public journal entries.", true));
      return;
    }
    const payload = await buildJournalComponents(
      ownerId,
      interaction.guildId ? "__public__" : interaction.user.id,
      gameId,
      1,
      interaction.guildId,
      interaction.user.id === ownerId,
    );
    if (interaction.guildId) {
      await deleteLatestJournalMessageInChannel(interaction, ownerId, gameId);
    }
    const reply = await safeReply(interaction, {
      components: payload.components,
      files: payload.files,
      flags: buildComponentsV2Flags(
        interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false,
      ),
      allowedMentions: payload.allowedMentions,
      withResponse: true,
    } as any);
    await trackJournalReply(reply?.resource?.message ?? null, ownerId, gameId);
  }

  @ButtonComponent({ id: /^nowplaying-journal-page:\d+:\d+:(prev|next):\d+$/ })
  async handleNowPlayingJournalPage(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 4);
    if (!segs) return;
    const [ownerId, gameIdRaw, , pageRaw] = segs;
    const gameId = Number(gameIdRaw);
    const nowPlayingEntries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId));
    const selected = nowPlayingEntries.find((entry) => entry.gameId === Number(gameIdRaw));
    if (!selected?.journalEnabled) {
      await safeReply(interaction, buildTextReply("Journal is not enabled for this game.", true));
      return;
    }
    if (interaction.guildId && !selected.hasJournalEntry) {
      await safeReply(interaction, buildTextReply("This game's journal has no public entries to show in channel.", true));
      return;
    }
    const payload = await buildJournalComponents(
      ownerId,
      interaction.guildId ? "__public__" : interaction.user.id,
      gameId,
      Number(pageRaw),
      interaction.guildId,
      interaction.user.id === ownerId,
    );
    if (interaction.guildId) {
      await deleteLatestJournalMessageInChannel(interaction, ownerId, gameId);
    }
    const reply = await safeReply(interaction, {
      components: payload.components,
      files: payload.files,
      flags: buildComponentsV2Flags(
        interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false,
      ),
      allowedMentions: payload.allowedMentions,
      withResponse: true,
    } as any);
    await trackJournalReply(reply?.resource?.message ?? null, ownerId, gameId);
  }

  @ButtonComponent({ id: /^nowplaying-journal-add:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalAdd(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId, gameIdRaw, pageRaw] = segs;
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("Only the owner can add journal entries.", false));
      return;
    }
    const modal = new ComponentsModalBuilder()
      .setCustomId(`${NOW_PLAYING_JOURNAL_MODAL_ID}:${ownerId}:${gameIdRaw}:${pageRaw}`)
      .setTitle("Add Journal Entry");
    modal.addActionRowComponents(
      new ComponentsActionRowBuilder<ComponentsTextInputBuilder>().addComponents(
        new ComponentsTextInputBuilder()
          .setCustomId(NOW_PLAYING_JOURNAL_TITLE_INPUT_ID)
          .setLabel("Title (optional)")
          .setStyle(ApiTextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(120),
      ),
      new ComponentsActionRowBuilder<ComponentsTextInputBuilder>().addComponents(
        new ComponentsTextInputBuilder()
          .setCustomId(NOW_PLAYING_JOURNAL_BODY_INPUT_ID)
          .setLabel("Entry")
          .setStyle(ApiTextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(2000),
      ),
    );
    await interaction.showModal(modal);
    await journalOwnerMenu.dismiss(ownerId);
  }

  @ButtonComponent({ id: /^nowplaying-journal-edit:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalEdit(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId, gameIdRaw, pageRaw] = segs;
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("Only the owner can edit journal entries.", false));
      return;
    }
    const gameId = Number(gameIdRaw);
    const page = Number(pageRaw);
    const offset = Math.max(0, page - 1);
    const entries = await Member.getGameJournalEntries(ownerId, gameId, { limit: 1, offset });
    if (!entries.length) {
      await safeReply(interaction, buildTextReply("No journal entries available to edit.", false));
      return;
    }
    const entry = entries[0];
    const modal = new ComponentsModalBuilder()
      .setCustomId(`${NOW_PLAYING_JOURNAL_EDIT_MODAL_ID}:${ownerId}:${gameIdRaw}:${pageRaw}:${entry.entryId}`)
      .setTitle("Edit Journal Entry");
    modal.addActionRowComponents(
      new ComponentsActionRowBuilder<ComponentsTextInputBuilder>().addComponents(
        new ComponentsTextInputBuilder()
          .setCustomId(NOW_PLAYING_JOURNAL_TITLE_INPUT_ID)
          .setLabel("Title (optional)")
          .setStyle(ApiTextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(120)
          .setValue((entry.title ?? "").slice(0, 120)),
      ),
      new ComponentsActionRowBuilder<ComponentsTextInputBuilder>().addComponents(
        new ComponentsTextInputBuilder()
          .setCustomId(NOW_PLAYING_JOURNAL_BODY_INPUT_ID)
          .setLabel("Entry")
          .setStyle(ApiTextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(2000)
          .setValue(entry.body.slice(0, 2000)),
      ),
    );
    await interaction.showModal(modal);
  }

  @ButtonComponent({ id: /^nowplaying-journal-delete:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalDelete(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId, gameIdRaw, pageRaw] = segs;
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("Only the owner can delete journal entries.", false));
      return;
    }
    const gameId = Number(gameIdRaw);
    const page = Number(pageRaw);
    const offset = (Math.max(1, page) - 1) * 5;
    const entries = await Member.getGameJournalEntries(ownerId, gameId, { limit: 5, offset });
    if (!entries.length) {
      await safeReply(interaction, buildTextReply("No journal entries available to delete.", false));
      return;
    }
    const options = entries.map((entry) => ({
      label: truncateLabel((entry.title ?? `Entry #${entry.entryNumber}`)),
      value: String(entry.entryId),
      description: formatTableDate(entry.createdAt),
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_JOURNAL_DELETE_SELECT_PREFIX}:${ownerId}:${gameId}:${page}`)
      .setPlaceholder("Choose an entry to delete")
      .addOptions(options);
    const row = buildSelectRow(select);
    const container = buildTextContainer("## Delete Journal Entry\nSelect an entry to delete.");
    const helpRow = buildButtonRow(
      buildActionButton({ customId: `${NOW_PLAYING_HELP_PREFIX}:journal-delete:${ownerId}`, label: "?", style: ButtonStyle.Secondary }),
    );
    await safeUpdate(interaction, {
      components: [container, row, helpRow],
      flags: buildComponentsV2Flags(
        interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false,
      ),
    });
  }

  @SelectMenuComponent({ id: /^nowplaying-journal-delete-select:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalDeleteSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId, gameIdRaw, pageRaw] = segs;
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("Only the owner can delete journal entries.", false));
      return;
    }
    const entryId = Number(interaction.values[0]);
    const entry = await Member.getGameJournalEntryForUser(ownerId, entryId);
    if (!entry || entry.gameId !== Number(gameIdRaw)) {
      await safeReply(interaction, buildTextReply("That journal entry was not found.", false));
      return;
    }
    const entryTitle = entry.title?.trim() ? entry.title.trim() : `Entry #${entry.entryNumber}`;
    const container = buildTextContainer(`## Confirm Delete\nDelete **${entryTitle}** from ${formatTableDate(entry.createdAt)}?`);
    const row = buildButtonRow(
      buildActionButton(
        "delete",
        `${NOW_PLAYING_JOURNAL_DELETE_CONFIRM_PREFIX}:yes:${ownerId}:${gameIdRaw}:${pageRaw}:${entryId}`,
      ),
      buildActionButton(
        "cancel",
        `${NOW_PLAYING_JOURNAL_DELETE_CONFIRM_PREFIX}:no:${ownerId}:${gameIdRaw}:${pageRaw}:${entryId}`,
      ),
      buildActionButton({ customId: `${NOW_PLAYING_HELP_PREFIX}:journal-delete-confirm:${ownerId}`, label: "?", style: ButtonStyle.Secondary }),
    );
    await safeUpdate(interaction, {
      components: [container, row],
      flags: buildComponentsV2Flags(
        interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false,
      ),
    });
  }

  @ButtonComponent({ id: /^nowplaying-journal-delete-confirm:(yes|no):\d+:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalDeleteConfirm(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 5);
    if (!segs) return;
    const [action, ownerId, gameIdRaw, pageRaw, entryIdRaw] = segs;
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("Only the owner can delete journal entries.", false));
      return;
    }
    if (action === "yes") {
      const removed = await Member.deleteGameJournalEntry(ownerId, Number(entryIdRaw));
      if (!removed) {
        await safeReply(interaction, buildTextReply("That journal entry was not found.", false));
        return;
      }
    }
    const row = await this.buildManageJournalButtonRow(ownerId, Number(gameIdRaw), Number(pageRaw));
    await safeUpdate(interaction, {
      components: [row],
      flags: buildComponentsV2Flags(
        interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false,
      ),
    });
    if (action === "yes") {
      await refreshJournalMessages(
        interaction.client, ownerId, Number(gameIdRaw), interaction.message.id,
      );
    }
  }

  @ModalComponent({ id: /^nowplaying-journal-modal:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalModal(interaction: ModalSubmitInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId, gameIdRaw, pageRaw] = segs;
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("Only the owner can submit journal entries.", false));
      return;
    }
    const title = sanitizeUserInput(
      interaction.fields.getTextInputValue(NOW_PLAYING_JOURNAL_TITLE_INPUT_ID) ?? "",
      { preserveNewlines: true, maxLength: 120 },
    );
    const body = sanitizeUserInput(
      interaction.fields.getTextInputValue(NOW_PLAYING_JOURNAL_BODY_INPUT_ID),
      { preserveNewlines: true, maxLength: 2000 },
    );
    const gameId = Number(gameIdRaw);
    const hasExistingTracked = Array.from(nowPlayingJournalContexts.values())
      .some((ctx) => ctx.ownerUserId === ownerId && ctx.gameId === gameId);
    await Member.addGameJournalEntry({
      userId: ownerId,
      gameId,
      title: title || null,
      body,
    });
    const page = Number(pageRaw);
    const row = await this.buildManageJournalButtonRow(ownerId, gameId, page);
    if (!hasExistingTracked && interaction.guildId) {
      // First entry: post the journal message first so it appears before the manage buttons.
      // Skip journalOwnerMenu here to avoid its deletor pointing at the journal post.
      await deleteLatestJournalMessageInChannel(interaction, ownerId, gameId);
      const payload = await buildJournalComponents(
        ownerId,
        "__public__",
        gameId,
        page,
        interaction.guildId,
        true,
      );
      const reply = await safeReply(interaction, {
        components: payload.components as any[],
        files: payload.files,
        flags: buildComponentsV2Flags(false),
        allowedMentions: payload.allowedMentions,
        withResponse: true,
      } as any);
      await trackJournalReply(reply?.resource?.message ?? null, ownerId, gameId);
      await safeReply(interaction, {
        components: [row],
        flags: buildComponentsV2Flags(true),
        __forceFollowUp: true,
      });
    } else {
      await journalOwnerMenu.show(interaction, ownerId, [row]);
      await refreshJournalMessages(interaction.client, ownerId, gameId);
    }
  }

  @ModalComponent({ id: /^nowplaying-journal-edit-modal:\d+:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalEditModal(interaction: ModalSubmitInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 4);
    if (!segs) return;
    const [ownerId, gameIdRaw, pageRaw, entryIdRaw] = segs;
    const gameId = Number(gameIdRaw);
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("Only the owner can edit journal entries.", false));
      return;
    }

    const entryId = Number(entryIdRaw);
    const existing = await Member.getGameJournalEntryForUser(ownerId, entryId);
    if (!existing || existing.gameId !== gameId) {
      await safeReply(interaction, buildTextReply("That journal entry was not found.", false));
      return;
    }

    const title = sanitizeUserInput(
      interaction.fields.getTextInputValue(NOW_PLAYING_JOURNAL_TITLE_INPUT_ID) ?? "",
      { preserveNewlines: true, maxLength: 120 },
    );
    const body = sanitizeUserInput(
      interaction.fields.getTextInputValue(NOW_PLAYING_JOURNAL_BODY_INPUT_ID),
      { preserveNewlines: true, maxLength: 2000 },
    );
    await Member.updateGameJournalEntry({ userId: ownerId, entryId, title: title || null, body });
    const page = Number(pageRaw);
    const row = await this.buildManageJournalButtonRow(ownerId, gameId, page);
    await safeReply(interaction, {
      components: [row],
      flags: buildComponentsV2Flags(true),
    });
    await refreshJournalMessages(interaction.client, ownerId, gameId);
  }

  @ButtonComponent({ id: /^nowplaying-edit-menu-start-journal:\d+$/ })
  async handleNowPlayingEditMenuStartJournal(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This edit menu isn't for you.")) return;
    const entries = await Member.getNowPlaying(ownerId).then(getDisplayNowPlayingEntries);
    const gamesWithoutJournal = entries.filter((e) => !e.hasJournalEntry);
    if (!gamesWithoutJournal.length) {
      await safeUpdate(interaction, {
        components: [await buildNowPlayingManageRow(ownerId)],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    const options = gamesWithoutJournal.map((e) => ({
      label: truncateLabel(e.title),
      value: String(e.gameId),
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_EDIT_MENU_START_JOURNAL_SELECT_PREFIX}:${ownerId}`)
      .setPlaceholder("Select a game to start a journal")
      .addOptions(options);
    const selectRow = buildSelectRow(select);
    const container = buildTextContainer("## Start a Game Journal\nSelect a game to write your first entry.");
    await safeUpdate(interaction, {
      components: [container, selectRow],
      flags: buildComponentsV2Flags(true),
    });
  }

  @SelectMenuComponent({ id: /^nowplaying-edit-menu-start-journal-select:\d+$/ })
  async handleNowPlayingEditMenuStartJournalSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This edit menu isn't for you.")) return;
    const gameId = Number(interaction.values[0]);
    if (!gameId) return;
    const entries = await Member.getNowPlaying(ownerId).then(getDisplayNowPlayingEntries);
    const selected = entries.find((e) => e.gameId === gameId);
    if (!selected || selected.hasJournalEntry) {
      await safeUpdate(interaction, {
        components: [await buildNowPlayingManageRow(ownerId)],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    const modal = new ComponentsModalBuilder()
      .setCustomId(`${NOW_PLAYING_JOURNAL_MODAL_ID}:${ownerId}:${gameId}:1`)
      .setTitle("Add Journal Entry");
    modal.addActionRowComponents(
      new ComponentsActionRowBuilder<ComponentsTextInputBuilder>().addComponents(
        new ComponentsTextInputBuilder()
          .setCustomId(NOW_PLAYING_JOURNAL_TITLE_INPUT_ID)
          .setLabel("Title (optional)")
          .setStyle(ApiTextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(120),
      ),
      new ComponentsActionRowBuilder<ComponentsTextInputBuilder>().addComponents(
        new ComponentsTextInputBuilder()
          .setCustomId(NOW_PLAYING_JOURNAL_BODY_INPUT_ID)
          .setLabel("Entry")
          .setStyle(ApiTextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(2000),
      ),
    );
    await interaction.showModal(modal);
    await nowPlayingOwnerMenu.dismiss(ownerId);
  }
}
