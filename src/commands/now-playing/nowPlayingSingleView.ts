import type { Message, User } from "discord.js";
import Member from "../../classes/Member.js";
import { safeReply, type AnyRepliable } from "../../functions/InteractionUtils.js";
import { buildUserHeaderContainer } from "../../functions/uiComponents.js";
import { buildComponentsV2Flags } from "../../functions/ComponentsV2Utils.js";
import { renderUsernameWithEmoji } from "../../services/UserEmojiService.js";
import { getDisplayNowPlayingEntries } from "../../functions/NowPlayingUtils.js";
import { NOW_PLAYING_LIST_EDIT_PREFIX } from "./nowPlayingIds.js";
import { trackNowPlayingListContext } from "./nowPlayingContexts.js";
import {
  buildNowPlayingListPayload,
  buildNowPlayingMessageContainer,
} from "./nowPlayingListRenderer.js";

/** Replies to a deferred interaction with one member's Now Playing list. */
export async function showNowPlayingSingle(
  interaction: AnyRepliable,
  target: User,
  ephemeral: boolean,
): Promise<void> {
  const isOwnList = target.id === interaction.user.id;
  const entries = await Member.getNowPlaying(target.id);
  if (!entries.length) {
    if (isOwnList) {
      const ownerName = target.displayName ?? target.username ?? target.id;
      const header = buildUserHeaderContainer(
        target.id,
        ownerName,
        "Now Playing",
        `${NOW_PLAYING_LIST_EDIT_PREFIX}:${target.id}`,
      );
      const container = buildNowPlayingMessageContainer(
        "Your Now Playing List",
        [
          "Welcome. Your list is empty, so nothing shows yet.",
          "Use the user button in the header to manage sort order, platform, "
            + "completions, and removals.",
        ].join("\n"),
      );
      const reply = await safeReply(interaction, {
        components: [header, container],
        flags: buildComponentsV2Flags(ephemeral),
        withResponse: !ephemeral,
      });
      if (!ephemeral) {
        const message = reply?.resource?.message ?? null;
        if (message) {
          trackNowPlayingListContext(message as Message<boolean>, {
            view: "single",
            ownerUserId: target.id,
          });
        }
      }
      return;
    }

    const targetName = renderUsernameWithEmoji(
      target.id,
      target.displayName ?? target.username ?? target.id,
    );
    const container = buildNowPlayingMessageContainer(
      "Now Playing",
      `No Now Playing entries found for ${targetName}.`,
    );
    const reply = await safeReply(interaction, {
      components: [container],
      flags: buildComponentsV2Flags(ephemeral),
      withResponse: !ephemeral,
    });
    if (!ephemeral) {
      const message = reply?.resource?.message ?? null;
      if (message) {
        trackNowPlayingListContext(message as Message<boolean>, {
          view: "single",
          ownerUserId: target.id,
        });
      }
    }
    return;
  }

  const sortedEntries = getDisplayNowPlayingEntries(entries);
  const payload = await buildNowPlayingListPayload(
    target,
    sortedEntries,
    interaction.guildId,
    isOwnList,
    true,
  );
  const reply = await safeReply(interaction, {
    components: payload.components,
    files: payload.files,
    flags: buildComponentsV2Flags(ephemeral),
    withResponse: !ephemeral,
  });
  if (!ephemeral) {
    const message = reply?.resource?.message ?? null;
    if (message) {
      trackNowPlayingListContext(message as Message<boolean>, {
        view: "single",
        ownerUserId: target.id,
      });
    }
  }
}
