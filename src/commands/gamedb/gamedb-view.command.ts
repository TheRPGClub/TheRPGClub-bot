// import {
//   ApplicationCommandOptionType,
//   ButtonInteraction,
//   CommandInteraction,
//   ModalBuilder,
//   TextInputStyle,
// } from "discord.js";
// import {
//   ButtonComponent,
//   Discord,
//   Slash,
//   SlashChoice,
//   SlashGroup,
//   SlashOption,
// } from "discordx";
// import {
//   safeDeferReply,
//   safeDeferUpdate,
//   safeReply,
//   safeUpdate,
//   sanitizeUserInput,
// } from "../../functions/InteractionUtils.js";
// import { getHltbCacheByGameId, upsertHltbCache } from "../../classes/HltbCache.js";
// import Game, { type GameSource } from "../../classes/Game.js";
// import { searchHltb } from "../../scripts/SearchHltb.js";
// import { buildTextReply } from "../../functions/ComponentsV2Utils.js";
// import {
//   autocompleteGameDbViewTitle,
//   buildComponentsV2Flags,
//   getSearchRowsFromComponents,
//   isHltbImportEligible,
// } from "./gamedb-utils.js";
// import {
//   buildGameProfile,
//   buildGameProfileActionRow,
//   refreshGameProfileMessage,
//   showGameProfile,
// } from "./gamedb-profile.service.js";
// import { runSearchFlow } from "./gamedb-search.command.js";
// import { startCompletionWizard } from "./gamedb-completion.command.js";
// import { showNowPlayingThreadModal } from "./gamedb-thread.command.js";
// import { isPositiveInt } from "../../utilities/ValidationUtils.js";
// import { assertCustomIdSegments } from "../../utilities/CustomIdUtils.js";
// import { buildTextInputRow } from "../../functions/uiComponents.js";
// import { safeIgnore } from "../../utilities/AsyncUtils.js";

// @Discord()
// @SlashGroup("gamedb")
// export class GameDbViewCommand {
//   @Slash({ description: "View details of a game", name: "view" })
//   async view(
//     @SlashOption({
//       description: "Search query (falls back to search flow if no ID provided)",
//       name: "title",
//       required: true,
//       type: ApplicationCommandOptionType.String,
//       autocomplete: autocompleteGameDbViewTitle,
//     })
//     query: string,
//     @SlashChoice({ name: "oracle", value: "oracle" }, { name: "api", value: "api" })
//     @SlashOption({
//       description: "Data source for the game lookup (default: oracle)",
//       name: "source",
//       required: false,
//       type: ApplicationCommandOptionType.String,
//     })
//     sourceChoice: string | undefined,
//     interaction: CommandInteraction,
//   ): Promise<void> {
//     await safeDeferReply(interaction, { flags: buildComponentsV2Flags(false) });

//     const source: GameSource = sourceChoice === "api" ? "API" : "oracleSQL";
//     const searchTerm = sanitizeUserInput(query, { preserveNewlines: false });

//     if (source === "API") {
//       const gameId = /^\d+$/.test(searchTerm) ? Number(searchTerm) : NaN;
//       if (!isPositiveInt(gameId)) {
//         await safeReply(interaction, buildTextReply("API source requires a numeric game ID.", false));
//         return;
//       }
//       await showGameProfile(interaction, gameId, undefined, "API");
//       return;
//     }

//     if (/^\d+$/.test(searchTerm)) {
//       const gameId = Number(searchTerm);
//       if (isPositiveInt(gameId)) {
//         const game = await Game.getGameById(gameId, source);
//         if (game) {
//           await showGameProfile(interaction, gameId, undefined, source);
//           return;
//         }
//       }
//     }
//     await runSearchFlow(interaction, searchTerm);
//   }

//   @ButtonComponent({
//     id: /^gamedb-action:(nowplaying|completion|thread|video|hltb-import):\d+$/,
//   })
//   async handleGameDbAction(interaction: ButtonInteraction): Promise<void> {
//     const segs = assertCustomIdSegments(interaction, 2);
//     if (!segs) return;
//     const [action, gameIdRaw] = segs;
//     const gameId = Number(gameIdRaw);
//     if (!isPositiveInt(gameId)) {
//       await safeReply(interaction, buildTextReply("Invalid GameDB id.", true));
//       return;
//     }

//     const game = await Game.getGameById(gameId);
//     if (!game) {
//       await safeReply(interaction, {
//         ...buildTextReply(`No game found with ID ${gameId}.`, true),
//         __forceFollowUp: true,
//       });
//       return;
//     }

//     if (action === "video") {
//       const videoUrl = game.featuredVideoUrl;
//       if (!videoUrl) {
//         await safeReply(interaction, buildTextReply(
//           "No featured video is available for this game.", true,
//         ));
//         return;
//       }
//       let updatedMessage = false;
//       const profile = await buildGameProfile(gameId, interaction);
//       if (profile) {
//         const actionRows = buildGameProfileActionRow(
//           gameId,
//           profile.hasThread,
//           profile.featuredVideoUrl,
//           profile.isReleased,
//           true,
//         );
//         const existingComponents = interaction.message?.components ?? [];
//         const searchRows = getSearchRowsFromComponents(existingComponents);
//         try {
//           await safeUpdate(interaction, {
//             files: profile.files,
//             components: [...profile.components, ...actionRows, ...searchRows],
//             flags: buildComponentsV2Flags(false),
//           });
//           updatedMessage = true;
//         } catch {
//           // fall through to deferUpdate
//         }
//       }
//       if (!updatedMessage) {
//         await safeDeferUpdate(interaction);
//       }
//       // Exception: v1 plain-text reply used intentionally so Discord auto-embeds
//       // the YouTube URL, enabling inline video preview. Components V2 suppresses embeds.
//       // eslint-disable-next-line local/no-plain-text-v1-reply
//       await safeReply(interaction, {
//         content: `Warning: videos may contain spoilers. ${videoUrl}`,
//         __forceFollowUp: true,
//       });
//       return;
//     }

//     if (action === "nowplaying") {
//       const modal = new ModalBuilder()
//         // eslint-disable-next-line local/custom-id-has-matching-handler
//         .setCustomId(`gamedb-nowplaying-modal:${gameId}`)
//         .setTitle("Add to Now Playing")
//         .addComponents(
//           buildTextInputRow({
//             customId: "gamedb-nowplaying-note",
//             label: "Note (optional)",
//             style: TextInputStyle.Paragraph,
//             required: false,
//             maxLength: 500,
//           }),
//         );
//       safeIgnore(interaction.showModal(modal));
//       return;
//     }

//     if (action === "hltb-import") {
//       await safeDeferUpdate(interaction);
//       const hltbCache = await getHltbCacheByGameId(gameId);
//       if (isHltbImportEligible(game, Boolean(hltbCache))) {
//         const scraped = await searchHltb(game.title);
//         if (scraped) {
//           await upsertHltbCache(gameId, {
//             name: scraped.name,
//             url: scraped.url,
//             imageUrl: scraped.imageUrl ?? null,
//             main: scraped.main,
//             mainSides: scraped.mainSides,
//             completionist: scraped.completionist,
//             singlePlayer: scraped.singlePlayer,
//             coOp: scraped.coOp,
//             vs: scraped.vs,
//             sourceQuery: game.title,
//           });
//         }
//       }
//       await refreshGameProfileMessage(interaction, gameId);
//       return;
//     }

//     if (action === "completion") {
//       await startCompletionWizard(interaction, gameId, game.title);
//       return;
//     }

//     if (action === "thread") {
//       await showNowPlayingThreadModal(interaction, gameId, game.title);
//       return;
//     }
//   }
// }
