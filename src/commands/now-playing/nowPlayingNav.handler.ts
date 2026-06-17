import {
  ButtonInteraction,
  type Message,
  MessageFlags,
  StringSelectMenuInteraction,
} from "discord.js";
import { Discord, ButtonComponent, SelectMenuComponent } from "discordx";
import Member from "../../classes/Member.js";
import {
  replyIfNotOwner,
  safeReply,
  safeUpdate,
  safeUserFetch,
} from "../../functions/InteractionUtils.js";
import { buildUserHeaderContainer } from "../../functions/uiComponents.js";
import {
  buildComponentsV2Flags,
  buildTextContainer,
} from "../../functions/ComponentsV2Utils.js";
import { getDisplayNowPlayingEntries } from "../../functions/NowPlayingUtils.js";
import { renderUsernameWithEmoji } from "../../services/UserEmojiService.js";
import { assertCustomIdSegments } from "../../utilities/CustomIdUtils.js";
import { NOW_PLAYING_LIST_EDIT_PREFIX } from "./nowPlayingIds.js";
import {
  nowPlayingOwnerMenu,
  setNowPlayingListContext,
  trackNowPlayingListContext,
} from "./nowPlayingContexts.js";
import {
  buildNowPlayingListPayload,
  buildNowPlayingManageRow,
  buildNowPlayingMessageContainer,
  returnToNowPlayingEditMenu,
} from "./nowPlayingListRenderer.js";
import { NOW_PLAYING_HELP_TEXTS } from "../now-playing-help.js";

@Discord()
export class NowPlayingNavHandlers {
  @ButtonComponent({ id: /^nowplaying-list-edit:\d+$/ })
  async handleNowPlayingListEdit(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "Only the owner of this Now Playing list can use Edit.")) return;

    setNowPlayingListContext(ownerId, interaction.message);
    await nowPlayingOwnerMenu.show(
      interaction,
      ownerId,
      [await buildNowPlayingManageRow(ownerId)],
    );
  }

  @ButtonComponent({ id: /^nowplaying-help:[a-z-]+:\d+$/ })
  async handleNowPlayingHelp(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [screenType, ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This help button isn't for you.")) return;
    const helpText = NOW_PLAYING_HELP_TEXTS[screenType]
      ?? "No help available for this screen.";
    const container = buildTextContainer(helpText);
    await safeReply(interaction, {
      components: [container],
      flags: buildComponentsV2Flags(true),
    });
  }

  @ButtonComponent({ id: /^nowplaying-list-cancel:\d+$/ })
  async handleNowPlayingListCancel(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This prompt isn't for you.")) return;
    await returnToNowPlayingEditMenu(interaction, ownerId);
  }

  @SelectMenuComponent({ id: /^nowplaying-all-select(?::v1)?$/ })
  async handleNowPlayingAllSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const selectedUserId = interaction.values?.[0];
    if (!selectedUserId) return;
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;

    const loadingContainer = buildTextContainer("## Now Loading\nGenerating cover layout and loading the selected member list...");
    await safeUpdate(interaction, {
      components: [loadingContainer],
      flags: buildComponentsV2Flags(isEphemeral),
    });

    const entries = await Member.getNowPlaying(selectedUserId);
    const target =
      (await safeUserFetch(interaction.client, selectedUserId)) ??
      interaction.user;

    if (!entries.length) {
      const ownerName = target.displayName ?? target.username ?? target.id;
      const header = buildUserHeaderContainer(
        selectedUserId,
        ownerName,
        "Now Playing",
        `${NOW_PLAYING_LIST_EDIT_PREFIX}:${selectedUserId}`,
      );
      const container = buildNowPlayingMessageContainer(
        "Now Playing - Everyone",
        `No Now Playing entries found for ${renderUsernameWithEmoji(selectedUserId, ownerName)}.`,
      );
      const updated = await safeReply(interaction, {
        components: [header, container],
      });
      trackNowPlayingListContext(updated as Message<boolean>, {
        view: "everyone-selected",
        selectedUserId,
      });
      return;
    }

    const sortedEntries = getDisplayNowPlayingEntries(entries);
    const payload = await buildNowPlayingListPayload(
      target,
      sortedEntries,
      interaction.guildId,
      false,
      true,
    );
    const updated = await safeReply(interaction, {
      components: payload.components,
      files: payload.files,
    });
    trackNowPlayingListContext(updated as Message<boolean>, {
      view: "everyone-selected",
      selectedUserId,
    });
  }
}
