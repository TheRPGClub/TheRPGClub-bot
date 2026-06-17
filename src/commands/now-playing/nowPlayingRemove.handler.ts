import {
  ButtonInteraction,
  MessageFlags,
  StringSelectMenuInteraction,
} from "discord.js";
import { Discord, ButtonComponent, SelectMenuComponent } from "discordx";
import Member from "../../classes/Member.js";
import {
  type AnyRepliable,
  extractErrorMessage,
  replyIfNotOwner,
  safeDeferReply,
  safeReply,
  safeUpdate,
} from "../../functions/InteractionUtils.js";
import {
  buildComponentsV2Flags,
  buildTextContainer,
} from "../../functions/ComponentsV2Utils.js";
import { getDisplayNowPlayingEntries } from "../../functions/NowPlayingUtils.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { assertCustomIdSegments } from "../../utilities/CustomIdUtils.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
import { NOW_PLAYING_GALLERY_MAX } from "./nowPlayingIds.js";
import {
  buildComponentPayload,
  buildNowPlayingAttachments,
  buildNowPlayingRemoveComponents,
  refreshNowPlayingListFromContext,
  returnToNowPlayingEditMenu,
  withPmNowPlayingList,
} from "./nowPlayingListRenderer.js";
import { setNowPlayingListContext } from "./nowPlayingContexts.js";

async function promptRemoveNowPlaying(
  interaction: AnyRepliable,
  mode: "reply" | "update" = "reply",
): Promise<void> {
  if (mode === "reply") {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });
  }
  const userId = interaction.user.id;
  const useDeferredEditPath = mode === "update" &&
    Boolean((interaction as any).__rpgDeferred ?? (interaction as any).deferred);
  const isEphemeral = mode === "update"
    ? ((interaction as any).message?.flags?.has(MessageFlags.Ephemeral) ?? false)
    : true;
  try {
    const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(userId));
    if (!entries.length) {
      const container = buildTextContainer("Your Now Playing list is empty.");
      const pmComponents = await withPmNowPlayingList(
        userId,
        interaction.guildId,
        [container],
      );
      if (mode === "update" && !useDeferredEditPath) {
        await safeUpdate(interaction, {
          components: pmComponents,
          flags: buildComponentsV2Flags(isEphemeral),
        });
      } else if (mode === "update") {
        await safeReply(interaction, {
          components: pmComponents,
          flags: buildComponentsV2Flags(true),
        });
      } else {
        await safeReply(interaction, {
          components: pmComponents,
          flags: buildComponentsV2Flags(true),
        });
      }
      return;
    }

    const includeImages = interaction.guildId != null;
    const { files, thumbnailsByGameId } = await buildNowPlayingAttachments(
      entries,
      NOW_PLAYING_GALLERY_MAX,
      includeImages,
    );
    const components = buildNowPlayingRemoveComponents(
      entries,
      userId,
      thumbnailsByGameId,
    );
    const pmComponents = await withPmNowPlayingList(
      userId,
      interaction.guildId,
      components,
    );
    if (mode === "update" && !useDeferredEditPath) {
      await safeUpdate(interaction, {
        ...buildComponentPayload(pmComponents as any, files),
        flags: buildComponentsV2Flags(isEphemeral),
      });
    } else if (mode === "update") {
      await safeReply(interaction, {
        ...buildComponentPayload(pmComponents as any, files),
        flags: buildComponentsV2Flags(true),
      });
    } else {
      await safeReply(interaction, {
        ...buildComponentPayload(pmComponents as any, files),
        flags: buildComponentsV2Flags(true),
      });
    }
  } catch (err: any) {
    const msg = extractErrorMessage(err);
    const container = buildTextContainer(`Could not remove from Now Playing: ${msg}`);
    const pmComponents = await withPmNowPlayingList(
      userId,
      interaction.guildId,
      [container],
    );
    if (mode === "update" && !useDeferredEditPath) {
      await safeUpdate(interaction, {
        components: pmComponents,
        flags: buildComponentsV2Flags(isEphemeral),
      });
    } else if (mode === "update") {
      await safeReply(interaction, {
        components: pmComponents,
        flags: buildComponentsV2Flags(true),
      });
    } else {
      await safeReply(interaction, {
        components: pmComponents,
        flags: buildComponentsV2Flags(true),
      });
    }
  }
}

@Discord()
export class NowPlayingRemoveHandlers {
  @ButtonComponent({ id: /^np-remove:[^:]+:\d+$/ })
  async handleRemoveNowPlayingButton(interaction: ButtonInteraction): Promise<void> {
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [ownerId, gameIdRaw] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This remove prompt isn't for you.")) return;

    const gameId = Number(gameIdRaw);
    if (!isPositiveInt(gameId)) {
      const container = buildTextContainer("Invalid selection.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    try {
      const removed = await Member.removeNowPlaying(ownerId, gameId);
      if (!removed) {
        const container = buildTextContainer("Failed to remove that game (it may have been removed already).");
        await safeReply(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(true),
        });
        return;
      }
      safeIgnore(refreshNowPlayingListFromContext(interaction, ownerId));

      const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId));
      if (!entries.length) {
        const container = buildTextContainer("Your Now Playing list is empty.");
        await safeUpdate(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(isEphemeral),
        });
        return;
      }
      const includeImages = interaction.guildId != null;
      const { files, thumbnailsByGameId } = await buildNowPlayingAttachments(
        entries,
        NOW_PLAYING_GALLERY_MAX,
        includeImages,
      );
      const components = buildNowPlayingRemoveComponents(
        entries,
        ownerId,
        thumbnailsByGameId,
      );
      const pmComponents = await withPmNowPlayingList(
        ownerId,
        interaction.guildId,
        components,
      );
      await safeUpdate(interaction, {
        ...buildComponentPayload(pmComponents as any, files),
        flags: buildComponentsV2Flags(isEphemeral),
      });
    } catch (err: any) {
      const msg = extractErrorMessage(err);
      const container = buildTextContainer(`Could not remove from Now Playing: ${msg}`);
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
    }
  }

  @SelectMenuComponent({ id: /^nowplaying-remove-select:\d+$/ })
  async handleNowPlayingRemoveSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This remove prompt isn't for you.")) return;
    const gameId = Number(interaction.values?.[0]);
    if (!isPositiveInt(gameId)) {
      const container = buildTextContainer("Invalid game selection.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    const loadingContainer = buildTextContainer("Updating your Now Playing remove list...");
    await safeUpdate(interaction, {
      components: [loadingContainer],
      flags: buildComponentsV2Flags(isEphemeral),
    });

    try {
      const removed = await Member.removeNowPlaying(ownerId, gameId);
      if (!removed) {
        const container = buildTextContainer("Failed to remove that game (it may have been removed already).");
        safeIgnore(safeReply(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(isEphemeral),
        }));
        return;
      }
      safeIgnore(refreshNowPlayingListFromContext(interaction, ownerId));
      const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId));
      if (!entries.length) {
        const container = buildTextContainer("Your Now Playing list is empty.");
        const pmComponents = await withPmNowPlayingList(
          ownerId,
          interaction.guildId,
          [container],
        );
        safeIgnore(safeReply(interaction, {
          components: pmComponents,
          flags: buildComponentsV2Flags(isEphemeral),
        }));
        return;
      }
      const includeImages = interaction.guildId != null;
      const { files, thumbnailsByGameId } = await buildNowPlayingAttachments(
        entries,
        NOW_PLAYING_GALLERY_MAX,
        includeImages,
      );
      const components = buildNowPlayingRemoveComponents(
        entries,
        ownerId,
        thumbnailsByGameId,
      );
      const pmComponents = await withPmNowPlayingList(
        ownerId,
        interaction.guildId,
        components,
      );
      safeIgnore(safeReply(interaction, {
        ...buildComponentPayload(pmComponents as any, files),
        flags: buildComponentsV2Flags(isEphemeral),
      }));
    } catch (err: any) {
      const msg = extractErrorMessage(err);
      const container = buildTextContainer(`Could not remove from Now Playing: ${msg}`);
      safeIgnore(safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(isEphemeral),
      }));
    }
  }

  @ButtonComponent({ id: /^nowplaying-edit-menu-remove:\d+$/ })
  async handleNowPlayingEditMenuRemove(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This edit menu isn't for you.")) return;
    await promptRemoveNowPlaying(interaction, "update");
  }

  @ButtonComponent({ id: /^nowplaying-list-remove:\d+$/ })
  async handleNowPlayingListRemove(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This remove prompt isn't for you.")) return;
    setNowPlayingListContext(ownerId, interaction.message);
    await promptRemoveNowPlaying(interaction, "update");
  }

  @ButtonComponent({ id: /^nowplaying-remove-done:\d+$/ })
  async handleNowPlayingRemoveDone(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This remove prompt isn't for you.")) return;
    await returnToNowPlayingEditMenu(interaction, ownerId);
  }
}
