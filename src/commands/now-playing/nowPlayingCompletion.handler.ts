// import {
//   AttachmentBuilder,
//   ButtonInteraction,
//   ButtonStyle,
//   ComponentType,
//   type CommandInteraction,
//   type Message,
//   ModalBuilder,
//   ModalSubmitInteraction,
//   StringSelectMenuBuilder,
//   StringSelectMenuInteraction,
//   TextInputStyle,
// } from "discord.js";
// import {
//   ButtonComponent,
//   Discord,
//   ModalComponent,
//   SelectMenuComponent,
// } from "discordx";
// import {
//   ButtonBuilder as V2ButtonBuilder,
//   ContainerBuilder,
//   MediaGalleryBuilder,
//   MediaGalleryItemBuilder,
//   SectionBuilder,
//   SeparatorBuilder,
//   TextDisplayBuilder,
// } from "@discordjs/builders";
// import { SeparatorSpacingSize } from "discord-api-types/v10";
// import Member, { type IMemberNowPlayingEntry } from "../../classes/Member.js";
// import {
//   getModalField,
//   isInteractionSettled,
//   replyIfNotOwner,
//   safeDeferReply,
//   safeDeferUpdate,
//   safeReply,
//   safeUpdate,
// } from "../../functions/InteractionUtils.js";
// import Game, { type IGame } from "../../classes/Game.js";
// import {
//   buildActionButton,
//   buildButtonRow,
//   buildSelectRow,
//   buildTextInputRow,
// } from "../../functions/uiComponents.js";
// import {
//   announceCompletion,
//   notifyUnknownCompletionPlatform,
// } from "../../functions/CompletionHelpers.js";
// import {
//   buildComponentsV2Flags,
//   buildTextContainer,
//   safeV2TextContent,
// } from "../../functions/ComponentsV2Utils.js";
// import {
//   COMPLETION_TYPES,
//   type CompletionType,
//   parseCompletionDateInput,
// } from "../profile.command.js";
// import {
//   formatDiscordTimestamp,
//   formatPlaytimeHours,
//   formatTableDate,
// } from "../../functions/DateFormatUtils.js";
// import { STANDARD_PLATFORM_IDS } from "../../config/standardPlatforms.js";
// import {
//   isPositiveInt,
//   isValidPlaytimeHours,
// } from "../../utilities/ValidationUtils.js";
// import { assertCustomIdSegments } from "../../utilities/CustomIdUtils.js";
// import { safeIgnore } from "../../utilities/AsyncUtils.js";
// import { truncateLabel } from "../../config/textLimits.js";
// import {
//   MAX_NOW_PLAYING_NOTE_LEN,
//   NOW_PLAYING_COMPLETE_ANNOUNCE_SELECT_PREFIX,
//   NOW_PLAYING_COMPLETE_DATE_INPUT_ID,
//   NOW_PLAYING_COMPLETE_DETAILS_PREFIX,
//   NOW_PLAYING_COMPLETE_HOURS_INPUT_ID,
//   NOW_PLAYING_COMPLETE_MODAL_ID,
//   NOW_PLAYING_COMPLETE_NOTE_INPUT_ID,
//   NOW_PLAYING_COMPLETE_NOTE_SELECT_PREFIX,
//   NOW_PLAYING_COMPLETE_PICK_PREFIX,
//   NOW_PLAYING_COMPLETE_PLATFORM_SELECT_PREFIX,
//   NOW_PLAYING_COMPLETE_REMOVE_SELECT_PREFIX,
//   NOW_PLAYING_COMPLETE_TYPE_SELECT_PREFIX,
//   NOW_PLAYING_GALLERY_MAX,
// } from "./nowPlayingIds.js";
// import {
//   type NowPlayingCompletionPlatformSession,
//   type NowPlayingCompletionWizardSession,
// } from "./nowPlayingTypes.js";
// import {
//   createNowPlayingCompletionWizardSession,
//   nowPlayingCompletionPlatformSessions,
//   nowPlayingCompletionWizardSessions,
//   setNowPlayingListContext,
// } from "./nowPlayingContexts.js";
// import {
//   formatEntryTitleWithPlatform,
//   getDisplayNowPlayingEntries,
// } from "../../functions/NowPlayingUtils.js";
// import {
//   buildComponentPayload,
//   buildNowPlayingAttachments,
//   refreshNowPlayingListFromContext,
//   returnToNowPlayingEditMenu,
//   trimTextDisplayContent,
//   withPmNowPlayingList,
// } from "./nowPlayingListRenderer.js";
// import { NOW_PLAYING_HELP_PREFIX } from "../now-playing-help.js";

// async function confirmDuplicateCompletion(
//   interaction: CommandInteraction | ModalSubmitInteraction | ButtonInteraction,
//   gameTitle: string,
//   existing: Awaited<ReturnType<typeof Member.getRecentCompletionForGame>>,
// ): Promise<boolean> {
//   if (!existing) return true;

//   const promptId = `np-comp-dup:${interaction.user.id}`;
//   const yesId = `${promptId}:yes`;
//   const noId = `${promptId}:no`;
//   const dateText = existing.completedAt
//     ? formatDiscordTimestamp(existing.completedAt)
//     : "No date";
//   const playtimeText = formatPlaytimeHours(existing.finalPlaytimeHours);
//   const detailParts = [existing.completionType, dateText, playtimeText].filter(Boolean);
//   const noteLine = existing.note ? `\n> ${existing.note}` : "";

//   const container = buildTextContainer(
//     `We found a completion for **${gameTitle}** within the last week:\n` +
//     `• ${detailParts.join(" - ")} (Completion #${existing.completionId})${noteLine}\n\n` +
//     "Add another completion anyway?",
//   );
//   const row = buildButtonRow(
//     buildActionButton({ customId: yesId, label: "Add Another", style: ButtonStyle.Danger }),
//     buildActionButton("cancel", noId),
//   );

//   const payload = {
//     components: [container, row],
//     flags: buildComponentsV2Flags(true),
//   };

//   let message: Message | null = null;
//   try {
//     if (isInteractionSettled(interaction)) {
//       const reply = await safeReply(interaction, { ...payload, __forceFollowUp: true } as any);
//       message = reply as Message;
//     } else {
//       const reply = await safeReply(interaction, { ...payload, withResponse: true } as any);
//       message = reply.resource?.message ?? null;
//     }
//   } catch {
//     try {
//       const reply = await safeReply(interaction, { ...payload, __forceFollowUp: true } as any);
//       message = reply as Message;
//     } catch {
//       return false;
//     }
//   }

//   if (!message || typeof message.awaitMessageComponent !== "function") {
//     return false;
//   }

//   try {
//     const selection = await message.awaitMessageComponent({
//       componentType: ComponentType.Button,
//       filter: (i) =>
//         i.user.id === interaction.user.id && i.customId.startsWith(promptId),
//       time: 120_000,
//     });
//     const confirmed = selection.customId.endsWith(":yes");
//     const resultContainer = buildTextContainer(confirmed ? "Adding another completion." : "Cancelled.");
//     await safeUpdate(selection, {
//       components: [resultContainer],
//       flags: buildComponentsV2Flags(true),
//     });
//     return confirmed;
//   } catch {
//     return false;
//   }
// }

// function parseNowPlayingCompletionDate(value: string): Date | null {
//   const trimmed = value.trim();
//   if (!trimmed) {
//     return null;
//   }
//   const normalized = trimmed.toLowerCase();
//   if (normalized === "today") {
//     return new Date();
//   }
//   if (normalized === "unknown" || normalized === "skip") {
//     return null;
//   }
//   const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
//   if (match) {
//     const month = Number(match[1]);
//     const day = Number(match[2]);
//     const year = Number(match[3]);
//     const parsed = new Date(year, month - 1, day);
//     if (
//       parsed.getFullYear() !== year ||
//       parsed.getMonth() !== month - 1 ||
//       parsed.getDate() !== day
//     ) {
//       throw new Error(
//         "Could not parse completion date. Use MM/DD/YYYY, YYYY-MM-DD, 'today', or leave blank.",
//       );
//     }
//     return parsed;
//   }
//   try {
//     return parseCompletionDateInput(trimmed);
//   } catch {
//     throw new Error(
//       "Could not parse completion date. Use MM/DD/YYYY, YYYY-MM-DD, 'today', or leave blank.",
//     );
//   }
// }

// function buildNowPlayingCompletionConfigContainer(
//   entry: IMemberNowPlayingEntry,
//   sessionId: string,
//   session: NowPlayingCompletionWizardSession,
//   thumbnailUrl: string | null,
// ): ContainerBuilder {
//   void thumbnailUrl;
//   const container = new ContainerBuilder();
//   container.addTextDisplayComponents(
//     new TextDisplayBuilder().setContent("## Add Completion"),
//   );
//   const headerLines = [`### ${formatEntryTitleWithPlatform(entry)}`];
//   if (entry.note) {
//     headerLines.push(`Current Note: ${entry.note}`);
//   }
//   container.addTextDisplayComponents(
//     new TextDisplayBuilder().setContent(
//       safeV2TextContent(trimTextDisplayContent(headerLines.join("\n")), 3500),
//     ),
//   );

//   const typeSelect = new StringSelectMenuBuilder()
//     .setCustomId(`${NOW_PLAYING_COMPLETE_TYPE_SELECT_PREFIX}:${sessionId}`)
//     .setPlaceholder("Completion type")
//     .addOptions(
//       COMPLETION_TYPES.map((type) => ({
//         label: type,
//         value: type,
//         default: type === session.completionType,
//       })),
//     );
//   const removeSelect = new StringSelectMenuBuilder()
//     .setCustomId(`${NOW_PLAYING_COMPLETE_REMOVE_SELECT_PREFIX}:${sessionId}`)
//     .setPlaceholder("Remove from Now Playing?")
//     .addOptions(
//       {
//         label: "Yes",
//         value: "yes",
//         default: session.removeFromNowPlaying,
//       },
//       {
//         label: "No",
//         value: "no",
//         default: !session.removeFromNowPlaying,
//       },
//     );
//   const announceSelect = new StringSelectMenuBuilder()
//     .setCustomId(`${NOW_PLAYING_COMPLETE_ANNOUNCE_SELECT_PREFIX}:${sessionId}`)
//     .setPlaceholder("Announce completion?")
//     .addOptions(
//       {
//         label: "Yes",
//         value: "yes",
//         default: session.announce,
//       },
//       {
//         label: "No",
//         value: "no",
//         default: !session.announce,
//       },
//     );
//   const noteSelect = new StringSelectMenuBuilder()
//     .setCustomId(`${NOW_PLAYING_COMPLETE_NOTE_SELECT_PREFIX}:${sessionId}`)
//     .setPlaceholder("Add a Completion Note")
//     .addOptions(
//       {
//         label: "Yes",
//         value: "yes",
//         default: session.addCompletionNote,
//       },
//       {
//         label: "No",
//         value: "no",
//         default: !session.addCompletionNote,
//       },
//     );
//   const detailsButton = buildActionButton({
//     customId: `${NOW_PLAYING_COMPLETE_DETAILS_PREFIX}:${sessionId}`,
//     label: "Continue",
//     style: ButtonStyle.Primary,
//   });
//   const cancelButton = buildActionButton("cancel", `nowplaying-list-cancel:${session.userId}`);

//   const typeRow = buildSelectRow(typeSelect);
//   const removeRow = buildSelectRow(removeSelect);
//   const announceRow = buildSelectRow(announceSelect);
//   const noteRow = buildSelectRow(noteSelect);
//   const helpButton = buildActionButton({
//     customId: `${NOW_PLAYING_HELP_PREFIX}:completion-config:${session.userId}`,
//     label: "?",
//     style: ButtonStyle.Secondary,
//   });
//   const buttonRow = buildButtonRow(
//     detailsButton,
//     cancelButton,
//     helpButton,
//   );

//   container.addTextDisplayComponents(
//     new TextDisplayBuilder().setContent("Completion Type"),
//   );
//   container.addActionRowComponents(typeRow.toJSON());
//   container.addTextDisplayComponents(
//     new TextDisplayBuilder().setContent("Remove from Now Playing"),
//   );
//   container.addActionRowComponents(removeRow.toJSON());
//   container.addTextDisplayComponents(
//     new TextDisplayBuilder().setContent("Announce Completion"),
//   );
//   container.addActionRowComponents(announceRow.toJSON());
//   container.addTextDisplayComponents(
//     new TextDisplayBuilder().setContent("Add a Completion Note"),
//   );
//   container.addActionRowComponents(noteRow.toJSON());
//   container.addActionRowComponents(buttonRow.toJSON());
//   return container;
// }

// async function renderNowPlayingCompletionConfig(
//   interaction: ButtonInteraction | StringSelectMenuInteraction,
//   sessionId: string,
//   session: NowPlayingCompletionWizardSession,
// ): Promise<void> {
//   const entries = await Member.getNowPlaying(session.userId);
//   const entry = entries.find((item) => item.gameId === session.gameId);
//   if (!entry) {
//     const container = buildTextContainer("That game is no longer in your Now Playing list.");
//     await safeUpdate(interaction, { components: [container] });
//     return;
//   }

//   let thumbnailUrl: string | null = null;
//   const files: AttachmentBuilder[] = [];
//   const includeImages = interaction.guildId != null;
//   const game = await Game.getGameById(entry.gameId);
//   if (includeImages && game?.imageData) {
//     const filename = `now_playing_completion_${entry.gameId}.png`;
//     files.push(new AttachmentBuilder(game.imageData, { name: filename }));
//     thumbnailUrl = `attachment://${filename}`;
//   }

//   const container = buildNowPlayingCompletionConfigContainer(
//     entry,
//     sessionId,
//     session,
//     thumbnailUrl,
//   );
//   const pmComponents = await withPmNowPlayingList(
//     session.userId,
//     interaction.guildId,
//     [container],
//   );
//   if (files.length) {
//     await safeUpdate(interaction, { components: pmComponents, files });
//   } else {
//     await safeUpdate(interaction, { components: pmComponents });
//   }
// }

// function buildNowPlayingCompletionComponents(
//   entries: IMemberNowPlayingEntry[],
//   ownerId: string,
//   sessionId: string,
//   thumbnailsByGameId: Map<number, string>,
// ): Array<ContainerBuilder | ReturnType<typeof buildButtonRow>> {
//   const container = new ContainerBuilder();
//   container.addTextDisplayComponents(
//     new TextDisplayBuilder().setContent(
//       "## Add Completion\nClick Add Completion to log a game.",
//     ),
//   );

//   const galleryItems: MediaGalleryItemBuilder[] = [];
//   for (const entry of entries) {
//     if (galleryItems.length >= NOW_PLAYING_GALLERY_MAX) {
//       break;
//     }
//     if (!entry.gameId) {
//       continue;
//     }
//     const imageUrl = thumbnailsByGameId.get(entry.gameId);
//     if (!imageUrl) {
//       continue;
//     }
//     const item = new MediaGalleryItemBuilder()
//       .setURL(imageUrl)
//       .setDescription(formatEntryTitleWithPlatform(entry));
//     galleryItems.push(item);
//   }

//   if (galleryItems.length) {
//     container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(galleryItems));
//     container.addSeparatorComponents(
//       new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
//     );
//   }

//   entries.forEach((entry, index) => {
//     if (index === 0) {
//       container.addSeparatorComponents(
//         new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
//       );
//     }
//     const lines = [`### ${formatEntryTitleWithPlatform(entry)}`, entry.note ?? ""];
//     if (entry.addedAt) {
//       const addedLabel = `Added ${formatTableDate(entry.addedAt)}`;
//       if (entry.noteUpdatedAt) {
//         const updatedLabel = `last updated ${formatTableDate(entry.noteUpdatedAt)}`;
//         if (formatTableDate(entry.addedAt) === formatTableDate(entry.noteUpdatedAt)) {
//           lines.push(`-# *${addedLabel}.*`);
//         } else {
//           lines.push(`-# *${addedLabel}, ${updatedLabel}.*`);
//         }
//       } else {
//         lines.push(`-# *${addedLabel}.*`);
//       }
//     }
//     const section = new SectionBuilder().addTextDisplayComponents(
//       new TextDisplayBuilder().setContent(
//         safeV2TextContent(trimTextDisplayContent(lines.join("\n")), 3500),
//       ),
//     );
//     section.setButtonAccessory(
//       new V2ButtonBuilder()
//         .setCustomId(`${NOW_PLAYING_COMPLETE_PICK_PREFIX}:${sessionId}:${entry.gameId}`)
//         .setLabel("Add Completion")
//         .setStyle(ButtonStyle.Primary),
//     );
//     container.addSectionComponents(section);
//   });

//   const doneRow = buildButtonRow(
//     buildActionButton("confirm", `nowplaying-complete-done:${ownerId}`, "Done"),
//     buildActionButton({
//       customId: `${NOW_PLAYING_HELP_PREFIX}:completion-pick:${ownerId}`,
//       label: "?",
//       style: ButtonStyle.Secondary,
//     }),
//   );
//   return [container, doneRow];
// }

// async function promptNowPlayingCompletionPlatformSelection(
//   interaction: ModalSubmitInteraction,
//   sessionId: string,
//   session: NowPlayingCompletionWizardSession,
//   game: IGame,
//   completedAt: Date | null,
//   finalPlaytimeHours: number | null,
//   note: string | null,
// ): Promise<void> {
//   const platforms = await Game.getPlatformsForGameWithStandard(game.id, STANDARD_PLATFORM_IDS);
//   if (!platforms.length) {
//     const container = buildTextContainer("No platform data is available for this game.");
//     await safeReply(interaction, {
//       components: [container],
//       flags: buildComponentsV2Flags(true),
//     });
//     return;
//   }

//   const platformOptions = platforms.map((platform) => ({
//     id: platform.id,
//     name: platform.name,
//   }));
//   const platformSessionId = `np-comp-platform-${session.userId}`;
//   nowPlayingCompletionPlatformSessions.set(platformSessionId, {
//     sessionId,
//     userId: session.userId,
//     gameId: game.id,
//     completionType: session.completionType,
//     completedAt,
//     finalPlaytimeHours,
//     note,
//     removeFromNowPlaying: session.removeFromNowPlaying,
//     announce: session.announce,
//     returnToList: session.returnToList,
//     platforms: platformOptions,
//   });

//   const baseOptions = platformOptions.map((platform) => ({
//     label: truncateLabel(platform.name),
//     value: String(platform.id),
//   }));
//   const options = [
//     ...baseOptions.slice(0, 24),
//     { label: "Other", value: "other" },
//   ];
//   const select = new StringSelectMenuBuilder()
//     .setCustomId(`${NOW_PLAYING_COMPLETE_PLATFORM_SELECT_PREFIX}:${platformSessionId}`)
//     .setPlaceholder("Select the platform")
//     .addOptions(options);
//   const content = platformOptions.length > 24
//     ? `Select the platform for **${game.title}** (showing first 24).`
//     : `Select the platform for **${game.title}**.`;
//   const container = buildTextContainer(content);
//   await safeReply(interaction, {
//     components: await withPmNowPlayingList(
//       session.userId,
//       interaction.guildId,
//       [
//         container,
//         buildSelectRow(select),
//       ],
//     ),
//     flags: buildComponentsV2Flags(true),
//   });
// }

// async function finalizeNowPlayingCompletion(
//   interaction: StringSelectMenuInteraction | ModalSubmitInteraction,
//   sessionId: string,
//   session: NowPlayingCompletionPlatformSession,
//   game: IGame,
//   platformId: number | null,
// ): Promise<void> {
//   try {
//     await Member.addCompletion({
//       userId: session.userId,
//       gameId: game.id,
//       completionType: session.completionType,
//       platformId,
//       completedAt: session.completedAt,
//       finalPlaytimeHours: session.finalPlaytimeHours,
//       note: session.note,
//     });
//   } catch (err: any) {
//     const msg = err?.message ?? "Failed to save completion.";
//     const container = buildTextContainer(`Could not save completion: ${msg}`);
//     await safeReply(interaction, {
//       components: [container],
//       flags: buildComponentsV2Flags(true),
//     });
//     return;
//   }

//   if (session.removeFromNowPlaying) {
//     safeIgnore(Member.removeNowPlaying(session.userId, game.id));
//   }

//   if (session.announce) {
//     await announceCompletion(
//       interaction,
//       session.userId,
//       game,
//       session.completionType,
//       session.completedAt,
//       session.finalPlaytimeHours,
//     );
//   }

//   if (session.removeFromNowPlaying) {
//     safeIgnore(refreshNowPlayingListFromContext(interaction, session.userId));
//   }

//   if (session.returnToList) {
//     const entries = getDisplayNowPlayingEntries(
//       await Member.getNowPlaying(session.userId),
//     );
//     if (!entries.length) {
//       const container = buildTextContainer("Your Now Playing list is empty.");
//       await safeReply(interaction, {
//         components: [container],
//         flags: buildComponentsV2Flags(true),
//       });
//     } else {
//       const includeImages = interaction.guildId != null;
//       const { files, thumbnailsByGameId } = await buildNowPlayingAttachments(
//         entries,
//         NOW_PLAYING_GALLERY_MAX,
//         includeImages,
//       );
//       const components = buildNowPlayingCompletionComponents(
//         entries,
//         session.userId,
//         sessionId,
//         thumbnailsByGameId,
//       );
//       await safeReply(interaction, {
//         ...buildComponentPayload(components, files),
//         flags: buildComponentsV2Flags(true),
//       });
//     }
//     return;
//   }

//   const detailLines = [
//     "## Completion Added",
//     `**Game:** ${game.title}`,
//     `**Type:** ${session.completionType}`,
//     `**Date:** ${formatTableDate(session.completedAt)}`,
//   ];
//   const playtimeText = formatPlaytimeHours(session.finalPlaytimeHours);
//   if (playtimeText) {
//     detailLines.push(`**Hours:** ${playtimeText}`);
//   }
//   if (session.note) {
//     detailLines.push(`**Note:** ${session.note}`);
//   }
//   detailLines.push(
//     `**Removed from Now Playing:** ${session.removeFromNowPlaying ? "Yes" : "No"}`,
//     `**Announced:** ${session.announce ? "Yes" : "No"}`,
//   );
//   const content = trimTextDisplayContent(detailLines.join("\n"));
//   const container = buildTextContainer(content);
//   await safeReply(interaction, {
//     components: [container],
//     flags: buildComponentsV2Flags(true),
//   });
//   nowPlayingCompletionWizardSessions.delete(sessionId);
// }

// export async function promptNowPlayingCompletionPick(
//   interaction: ButtonInteraction,
//   ownerId: string,
//   sessionId: string,
// ): Promise<void> {
//   const current = await Member.getNowPlaying(ownerId);
//   if (!current.length) {
//     const container = buildTextContainer("Your Now Playing list is empty.");
//     const pmComponents = await withPmNowPlayingList(
//       ownerId, interaction.guildId, [container],
//     );
//     await safeUpdate(interaction, { components: pmComponents });
//     return;
//   }

//   if (current.length === 1) {
//     const session = nowPlayingCompletionWizardSessions.get(sessionId);
//     const entry = current[0];
//     if (!session || !entry?.gameId) {
//       const container = buildTextContainer("Unable to start completion flow.");
//       await safeUpdate(interaction, { components: [container] });
//       return;
//     }
//     session.gameId = entry.gameId;
//     await renderNowPlayingCompletionConfig(interaction, sessionId, session);
//     return;
//   }

//   const entries = getDisplayNowPlayingEntries(current);
//   const includeImages = interaction.guildId != null;
//   const { files, thumbnailsByGameId } = await buildNowPlayingAttachments(
//     entries,
//     NOW_PLAYING_GALLERY_MAX,
//     includeImages,
//   );
//   const components = buildNowPlayingCompletionComponents(
//     entries,
//     ownerId,
//     sessionId,
//     thumbnailsByGameId,
//   );
//   const pmComponents = await withPmNowPlayingList(ownerId, interaction.guildId, components);
//   await safeUpdate(interaction, buildComponentPayload(pmComponents as any, files));
// }

// @Discord()
// export class NowPlayingCompletionHandlers {
//   @ButtonComponent({ id: /^nowplaying-edit-menu-complete:\d+$/ })
//   async handleNowPlayingEditMenuComplete(interaction: ButtonInteraction): Promise<void> {
//     const segs = assertCustomIdSegments(interaction, 1);
//     if (!segs) return;
//     const [ownerId] = segs;
//     if (await replyIfNotOwner(interaction, ownerId, "This edit menu isn't for you.")) return;
//     const sessionId = createNowPlayingCompletionWizardSession(ownerId, true);
//     await promptNowPlayingCompletionPick(interaction, ownerId, sessionId);
//   }

//   @ButtonComponent({ id: /^nowplaying-list-complete:\d+$/ })
//   async handleNowPlayingListComplete(interaction: ButtonInteraction): Promise<void> {
//     const segs = assertCustomIdSegments(interaction, 1);
//     if (!segs) return;
//     const [ownerId] = segs;
//     if (await replyIfNotOwner(interaction, ownerId, "This completion prompt isn't for you.")) return;
//     setNowPlayingListContext(ownerId, interaction.message);
//     const sessionId = createNowPlayingCompletionWizardSession(ownerId, true);
//     await promptNowPlayingCompletionPick(interaction, ownerId, sessionId);
//   }

//   @ButtonComponent({ id: /^nowplaying-complete-done:\d+$/ })
//   async handleNowPlayingCompleteDone(interaction: ButtonInteraction): Promise<void> {
//     const segs = assertCustomIdSegments(interaction, 1);
//     if (!segs) return;
//     const [ownerId] = segs;
//     if (await replyIfNotOwner(interaction, ownerId, "This completion prompt isn't for you.")) return;
//     await returnToNowPlayingEditMenu(interaction, ownerId);
//   }

//   @ModalComponent({ id: /^nowplaying-complete-modal:[^:]+$/ })
//   async handleNowPlayingCompletionModal(
//     interaction: ModalSubmitInteraction,
//   ): Promise<void> {
//     await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });
//     const segs = assertCustomIdSegments(interaction, 1);
//     if (!segs) return;
//     const [sessionId] = segs;
//     const session = nowPlayingCompletionWizardSessions.get(sessionId);
//     if (!session) {
//       const container = buildTextContainer("This completion prompt has expired.");
//       await safeReply(interaction, {
//         components: [container],
//         flags: buildComponentsV2Flags(true),
//       });
//       return;
//     }

//     if (await replyIfNotOwner(interaction, session.userId, "This completion prompt isn't for you.")) return;

//     if (!session.gameId) {
//       const container = buildTextContainer("Select a game first before submitting details.");
//       await safeReply(interaction, {
//         components: [container],
//         flags: buildComponentsV2Flags(true),
//       });
//       return;
//     }

//     const completionDateInput = getModalField(interaction, NOW_PLAYING_COMPLETE_DATE_INPUT_ID);
//     const finalPlaytimeRaw = getModalField(interaction, NOW_PLAYING_COMPLETE_HOURS_INPUT_ID);
//     const noteInput = session.addCompletionNote
//       ? getModalField(interaction, NOW_PLAYING_COMPLETE_NOTE_INPUT_ID)
//       : "";

//     let completedAt: Date | null = null;
//     try {
//       completedAt = parseNowPlayingCompletionDate(completionDateInput);
//     } catch (err: any) {
//       const container = buildTextContainer(err?.message ?? "Invalid completion date.");
//       await safeReply(interaction, {
//         components: [container],
//         flags: buildComponentsV2Flags(true),
//       });
//       return;
//     }

//     const finalPlaytimeHours = finalPlaytimeRaw
//       ? Number(finalPlaytimeRaw)
//       : null;
//     if (finalPlaytimeHours !== null && !isValidPlaytimeHours(finalPlaytimeHours)) {
//       const container = buildTextContainer(
//         "Final playtime must be a non-negative number of hours.",
//       );
//       await safeReply(interaction, {
//         components: [container],
//         flags: buildComponentsV2Flags(true),
//       });
//       return;
//     }

//     const note = noteInput ? noteInput : null;

//     const game = await Game.getGameById(session.gameId);
//     if (!game) {
//       const container = buildTextContainer("That game could not be found.");
//       await safeReply(interaction, {
//         components: [container],
//         flags: buildComponentsV2Flags(true),
//       });
//       return;
//     }

//     const referenceDate = completedAt ?? new Date();
//     const recentCompletion = await Member.getRecentCompletionForGame(
//       session.userId,
//       session.gameId,
//       referenceDate,
//     );
//     if (recentCompletion) {
//       const confirmed = await confirmDuplicateCompletion(
//         interaction,
//         game.title,
//         recentCompletion,
//       );
//       if (!confirmed) {
//         return;
//       }
//     }

//     const nowPlayingEntries = await Member.getNowPlaying(session.userId);
//     const selectedEntry = nowPlayingEntries.find((item) => item.gameId === session.gameId);
//     const existingPlatformId = selectedEntry?.platformId ?? null;
//     if (existingPlatformId) {
//       await finalizeNowPlayingCompletion(
//         interaction,
//         sessionId,
//         {
//           sessionId,
//           userId: session.userId,
//           gameId: game.id,
//           completionType: session.completionType,
//           completedAt,
//           finalPlaytimeHours,
//           note,
//           removeFromNowPlaying: session.removeFromNowPlaying,
//           announce: session.announce,
//           returnToList: session.returnToList,
//           platforms: [],
//         },
//         game,
//         existingPlatformId,
//       );
//       return;
//     }

//     await promptNowPlayingCompletionPlatformSelection(
//       interaction,
//       sessionId,
//       session,
//       game,
//       completedAt,
//       finalPlaytimeHours,
//       note,
//     );
//     return;
//   }

//   @SelectMenuComponent({ id: /^np-complete-platform:[^:]+$/ })
//   async handleNowPlayingCompletionPlatformSelect(
//     interaction: StringSelectMenuInteraction,
//   ): Promise<void> {
//     const segs = assertCustomIdSegments(interaction, 1);
//     if (!segs) return;
//     const [platformSessionId] = segs;
//     const session = nowPlayingCompletionPlatformSessions.get(platformSessionId);
//     if (!session) {
//       const container = buildTextContainer("This completion prompt has expired.");
//       await safeReply(interaction, {
//         components: [container],
//         flags: buildComponentsV2Flags(true),
//       });
//       return;
//     }

//     if (await replyIfNotOwner(interaction, session.userId, "This completion prompt isn't for you.")) return;

//     const selected = interaction.values?.[0];
//     const isOther = selected === "other";
//     let platformId: number | null = null;
//     if (!isOther) {
//       const parsedId = Number(selected);
//       if (Number.isInteger(parsedId)) {
//         platformId = parsedId;
//       }
//     }
//     const valid = isOther || (
//       platformId !== null &&
//       session.platforms.some((platform) => platform.id === platformId)
//     );
//     if (!valid) {
//       const container = buildTextContainer("Invalid platform selection.");
//       await safeReply(interaction, {
//         components: [container],
//         flags: buildComponentsV2Flags(true),
//       });
//       return;
//     }

//     await safeDeferUpdate(interaction);
//     nowPlayingCompletionPlatformSessions.delete(platformSessionId);

//     const game = await Game.getGameById(session.gameId);
//     if (!game) {
//       const container = buildTextContainer("That game could not be found.");
//       await safeReply(interaction, {
//         components: [container],
//         flags: buildComponentsV2Flags(true),
//       });
//       return;
//     }

//     if (isOther) {
//       await notifyUnknownCompletionPlatform(interaction, game.title, game.id);
//     }

//     await finalizeNowPlayingCompletion(
//       interaction,
//       session.sessionId,
//       session,
//       game,
//       platformId,
//     );
//   }

//   @ButtonComponent({ id: /^np-complete-pick:[^:]+:\d+$/ })
//   async handleNowPlayingCompletionPick(interaction: ButtonInteraction): Promise<void> {
//     const segs = assertCustomIdSegments(interaction, 2);
//     if (!segs) return;
//     const [sessionId, gameIdRaw] = segs;
//     const session = nowPlayingCompletionWizardSessions.get(sessionId);
//     if (!session) {
//       const container = buildTextContainer("This completion prompt has expired.");
//       await safeReply(interaction, {
//         components: [container],
//         flags: buildComponentsV2Flags(true),
//       });
//       return;
//     }

//     if (await replyIfNotOwner(interaction, session.userId, "This completion prompt isn't for you.")) return;

//     const gameId = Number(gameIdRaw);
//     if (!isPositiveInt(gameId)) {
//       const container = buildTextContainer("Invalid selection.");
//       await safeReply(interaction, {
//         components: [container],
//         flags: buildComponentsV2Flags(true),
//       });
//       return;
//     }

//     session.gameId = gameId;
//     await renderNowPlayingCompletionConfig(interaction, sessionId, session);
//   }

//   @SelectMenuComponent({ id: /^np-complete-type:[^:]+$/ })
//   async handleNowPlayingCompletionTypeSelect(
//     interaction: StringSelectMenuInteraction,
//   ): Promise<void> {
//     const segs = assertCustomIdSegments(interaction, 1);
//     if (!segs) return;
//     const [sessionId] = segs;
//     const session = nowPlayingCompletionWizardSessions.get(sessionId);
//     if (!session) {
//       const container = buildTextContainer("This completion prompt has expired.");
//       await safeReply(interaction, {
//         components: [container],
//         flags: buildComponentsV2Flags(true),
//       });
//       return;
//     }

//     if (await replyIfNotOwner(interaction, session.userId, "This completion prompt isn't for you.")) return;

//     const value = interaction.values?.[0];
//     if (!value || !COMPLETION_TYPES.includes(value as CompletionType)) {
//       const container = buildTextContainer("Invalid completion type.");
//       await safeReply(interaction, {
//         components: [container],
//         flags: buildComponentsV2Flags(true),
//       });
//       return;
//     }

//     session.completionType = value as CompletionType;
//     await renderNowPlayingCompletionConfig(interaction, sessionId, session);
//   }

//   @SelectMenuComponent({ id: /^np-complete-remove:[^:]+$/ })
//   async handleNowPlayingCompletionRemoveSelect(
//     interaction: StringSelectMenuInteraction,
//   ): Promise<void> {
//     const segs = assertCustomIdSegments(interaction, 1);
//     if (!segs) return;
//     const [sessionId] = segs;
//     const session = nowPlayingCompletionWizardSessions.get(sessionId);
//     if (!session) {
//       const container = buildTextContainer("This completion prompt has expired.");
//       await safeReply(interaction, {
//         components: [container],
//         flags: buildComponentsV2Flags(true),
//       });
//       return;
//     }

//     if (await replyIfNotOwner(interaction, session.userId, "This completion prompt isn't for you.")) return;

//     const value = interaction.values?.[0];
//     if (value !== "yes" && value !== "no") {
//       const container = buildTextContainer("Invalid selection.");
//       await safeReply(interaction, {
//         components: [container],
//         flags: buildComponentsV2Flags(true),
//       });
//       return;
//     }

//     session.removeFromNowPlaying = value === "yes";
//     await renderNowPlayingCompletionConfig(interaction, sessionId, session);
//   }

//   @SelectMenuComponent({ id: /^np-complete-announce:[^:]+$/ })
//   async handleNowPlayingCompletionAnnounceSelect(
//     interaction: StringSelectMenuInteraction,
//   ): Promise<void> {
//     const segs = assertCustomIdSegments(interaction, 1);
//     if (!segs) return;
//     const [sessionId] = segs;
//     const session = nowPlayingCompletionWizardSessions.get(sessionId);
//     if (!session) {
//       const container = buildTextContainer("This completion prompt has expired.");
//       await safeReply(interaction, {
//         components: [container],
//         flags: buildComponentsV2Flags(true),
//       });
//       return;
//     }

//     if (await replyIfNotOwner(interaction, session.userId, "This completion prompt isn't for you.")) return;

//     const value = interaction.values?.[0];
//     if (value !== "yes" && value !== "no") {
//       const container = buildTextContainer("Invalid selection.");
//       await safeReply(interaction, {
//         components: [container],
//         flags: buildComponentsV2Flags(true),
//       });
//       return;
//     }

//     session.announce = value === "yes";
//     await renderNowPlayingCompletionConfig(interaction, sessionId, session);
//   }

//   @SelectMenuComponent({ id: /^np-complete-note:[^:]+$/ })
//   async handleNowPlayingCompletionNoteSelect(
//     interaction: StringSelectMenuInteraction,
//   ): Promise<void> {
//     const segs = assertCustomIdSegments(interaction, 1);
//     if (!segs) return;
//     const [sessionId] = segs;
//     const session = nowPlayingCompletionWizardSessions.get(sessionId);
//     if (!session) {
//       const container = buildTextContainer("This completion prompt has expired.");
//       await safeReply(interaction, {
//         components: [container],
//         flags: buildComponentsV2Flags(true),
//       });
//       return;
//     }

//     if (await replyIfNotOwner(interaction, session.userId, "This completion prompt isn't for you.")) return;

//     const value = interaction.values?.[0];
//     if (value !== "yes" && value !== "no") {
//       const container = buildTextContainer("Invalid selection.");
//       await safeReply(interaction, {
//         components: [container],
//         flags: buildComponentsV2Flags(true),
//       });
//       return;
//     }

//     session.addCompletionNote = value === "yes";
//     await renderNowPlayingCompletionConfig(interaction, sessionId, session);
//   }

//   @ButtonComponent({ id: /^np-complete-details:[^:]+$/ })
//   async handleNowPlayingCompletionDetails(interaction: ButtonInteraction): Promise<void> {
//     const segs = assertCustomIdSegments(interaction, 1);
//     if (!segs) return;
//     const [sessionId] = segs;
//     const session = nowPlayingCompletionWizardSessions.get(sessionId);
//     if (!session) {
//       const container = buildTextContainer("This completion prompt has expired.");
//       await safeReply(interaction, {
//         components: [container],
//         flags: buildComponentsV2Flags(true),
//       });
//       return;
//     }

//     if (await replyIfNotOwner(interaction, session.userId, "This completion prompt isn't for you.")) return;

//     if (!session.gameId) {
//       const container = buildTextContainer("Select a game first.");
//       await safeReply(interaction, {
//         components: [container],
//         flags: buildComponentsV2Flags(true),
//       });
//       return;
//     }

//     const entries = await Member.getNowPlaying(session.userId);
//     const currentEntry = entries.find((entry) => entry.gameId === session.gameId);
//     const noteValue = currentEntry?.note ?? "";

//     const modal = new ModalBuilder()
//       .setCustomId(`${NOW_PLAYING_COMPLETE_MODAL_ID}:${sessionId}`)
//       .setTitle("Add Completion Details");
//     const modalRows = [
//       buildTextInputRow({
//         customId: NOW_PLAYING_COMPLETE_DATE_INPUT_ID,
//         label: "Completion date (blank unknown)",
//         required: false,
//         placeholder: "today or 03/10/2025",
//       }),
//       buildTextInputRow({
//         customId: NOW_PLAYING_COMPLETE_HOURS_INPUT_ID,
//         label: "Final playtime hours (optional)",
//         required: false,
//       }),
//     ];
//     if (session.addCompletionNote) {
//       modalRows.push(buildTextInputRow({
//         customId: NOW_PLAYING_COMPLETE_NOTE_INPUT_ID,
//         label: "Note (optional)",
//         style: TextInputStyle.Paragraph,
//         required: false,
//         maxLength: MAX_NOW_PLAYING_NOTE_LEN,
//         value: noteValue ? noteValue.slice(0, MAX_NOW_PLAYING_NOTE_LEN) : undefined,
//       }));
//     }
//     modal.addComponents(...modalRows);
//     safeIgnore(interaction.showModal(modal));
//   }
// }
