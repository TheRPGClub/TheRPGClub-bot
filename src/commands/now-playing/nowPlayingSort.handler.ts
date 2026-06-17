import {
  ButtonInteraction,
  MessageFlags,
  StringSelectMenuInteraction,
} from "discord.js";
import { Discord, ButtonComponent, SelectMenuComponent } from "discordx";
import Member from "../../classes/Member.js";
import {
  replyIfNotOwner,
  safeDeferUpdate,
  safeReply,
  safeUpdate,
} from "../../functions/InteractionUtils.js";
import {
  buildComponentsV2Flags,
  buildTextContainer,
} from "../../functions/ComponentsV2Utils.js";
import {
  buildNowPlayingSortStateToken,
  encodeNowPlayingSortState,
  getDisplayNowPlayingEntries,
  parseNowPlayingSortStateToken,
} from "../../functions/NowPlayingUtils.js";
import { assertCustomIdSegments } from "../../utilities/CustomIdUtils.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
import {
  buildNowPlayingSortComponents,
  refreshNowPlayingListFromContext,
  returnToNowPlayingEditMenu,
  withPmNowPlayingList,
} from "./nowPlayingListRenderer.js";
import { setNowPlayingListContext } from "./nowPlayingContexts.js";

async function promptSortNowPlayingButtons(
  interaction: ButtonInteraction,
  ownerId: string,
): Promise<void> {
  const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
  const entries = getDisplayNowPlayingEntries(
    await Member.getNowPlaying(ownerId),
  ).slice(0, 10);
  if (!entries.length) {
    const container = buildTextContainer("Your Now Playing list is empty.");
    const pmComponents = await withPmNowPlayingList(
      ownerId, interaction.guildId, [container],
    );
    await safeUpdate(interaction, {
      components: pmComponents,
      flags: buildComponentsV2Flags(isEphemeral),
    });
    return;
  }
  const stateToken = buildNowPlayingSortStateToken(entries.length);
  const components = buildNowPlayingSortComponents(entries, ownerId, stateToken);
  const pmComponents = await withPmNowPlayingList(
    ownerId,
    interaction.guildId,
    components,
  );
  await safeUpdate(interaction, {
    components: pmComponents,
    flags: buildComponentsV2Flags(isEphemeral),
  });
}

@Discord()
export class NowPlayingSortHandlers {
  @SelectMenuComponent({ id: /^nowplaying-sort-slot:\d+:\d+:[a-z0-9_]+$/ })
  async handleNowPlayingSortSlot(interaction: StringSelectMenuInteraction): Promise<void> {
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId, slotRaw, stateToken] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This sort prompt isn't for you.")) return;

    const slotIndex = Number(slotRaw);
    if (!Number.isInteger(slotIndex) || slotIndex < 0) {
      const container = buildTextContainer("Invalid selection.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    try {
      const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId)).slice(0, 10);
      const parsed = parseNowPlayingSortStateToken(stateToken, entries.length);
      const selectedValue = interaction.values[0] ?? "";
      const selectedIndex = Number(selectedValue);
      if (
        !parsed ||
        !Number.isInteger(selectedIndex) ||
        selectedIndex < 0 ||
        selectedIndex >= entries.length ||
        slotIndex >= entries.length
      ) {
        const container = buildTextContainer("This sort form has expired. Open Sort again.");
        await safeUpdate(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(isEphemeral),
        });
        return;
      }

      for (let i = 0; i < parsed.length; i += 1) {
        if (i !== slotIndex && parsed[i] === selectedIndex) {
          parsed[i] = -1;
        }
      }
      parsed[slotIndex] = selectedIndex;
      const components = buildNowPlayingSortComponents(
        entries,
        ownerId,
        encodeNowPlayingSortState(parsed),
      );
      const pmComponents = await withPmNowPlayingList(
        ownerId, interaction.guildId, components,
      );
      await safeUpdate(interaction, {
        components: pmComponents,
        flags: buildComponentsV2Flags(isEphemeral),
      });
    } catch {
      const container = buildTextContainer("Could not update the sort form right now.");
      safeIgnore(safeUpdate(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(isEphemeral),
      }));
    }
  }

  @ButtonComponent({ id: /^nowplaying-sort-save:\d+:[a-z0-9_]+$/ })
  async handleNowPlayingSortSave(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [ownerId, stateToken] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This sort prompt isn't for you.")) return;
    await safeDeferUpdate(interaction);
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const responseFlags = buildComponentsV2Flags(isEphemeral);

    const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId)).slice(0, 10);
    const parsed = parseNowPlayingSortStateToken(stateToken, entries.length);
    if (!parsed) {
      const container = buildTextContainer("This sort form has expired. Open Sort again.");
      const pmComponents = await withPmNowPlayingList(
        ownerId, interaction.guildId, [container],
      );
      await safeReply(interaction, { components: pmComponents, flags: responseFlags });
      return;
    }
    if (parsed.some((value) => value < 0)) {
      const components = buildNowPlayingSortComponents(
        entries,
        ownerId,
        stateToken,
        "Assign a title to every visible position before saving.",
      );
      const pmComponents = await withPmNowPlayingList(
        ownerId, interaction.guildId, components,
      );
      await safeReply(interaction, { components: pmComponents, flags: responseFlags });
      return;
    }
    if (new Set(parsed).size !== parsed.length) {
      const components = buildNowPlayingSortComponents(
        entries,
        ownerId,
        stateToken,
        "Each title can only be used once. Remove duplicate assignments and try again.",
      );
      const pmComponents = await withPmNowPlayingList(
        ownerId, interaction.guildId, components,
      );
      await safeReply(interaction, { components: pmComponents, flags: responseFlags });
      return;
    }

    const loadingContainer = buildTextContainer("## Now Loading\nSaving sort order and generating cover layout...");
    await safeUpdate(interaction, { components: [loadingContainer], flags: responseFlags });

    const orderedIds = parsed.map((index) => entries[index].gameId);
    const updated = await Member.updateNowPlayingSort(ownerId, orderedIds);
    if (!updated) {
      const container = buildTextContainer("Could not update the sort order.");
      const pmComponents = await withPmNowPlayingList(
        ownerId, interaction.guildId, [container],
      );
      await safeReply(interaction, { components: pmComponents, flags: responseFlags });
      return;
    }

    safeIgnore(refreshNowPlayingListFromContext(interaction, ownerId));
    await returnToNowPlayingEditMenu(interaction, ownerId);
  }

  @ButtonComponent({ id: /^nowplaying-sort-reset:\d+$/ })
  async handleNowPlayingSortReset(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This sort prompt isn't for you.")) return;
    await safeDeferUpdate(interaction);
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const responseFlags = buildComponentsV2Flags(isEphemeral);
    const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId)).slice(0, 10);
    const stateToken = buildNowPlayingSortStateToken(entries.length);
    const components = buildNowPlayingSortComponents(entries, ownerId, stateToken);
    const pmComponents = await withPmNowPlayingList(ownerId, interaction.guildId, components);
    await safeReply(interaction, { components: pmComponents, flags: responseFlags });
  }

  @ButtonComponent({ id: /^nowplaying-edit-menu-sort:\d+$/ })
  async handleNowPlayingEditMenuSort(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This edit menu isn't for you.")) return;
    await promptSortNowPlayingButtons(interaction, ownerId);
  }

  @ButtonComponent({ id: /^nowplaying-list-sort:\d+$/ })
  async handleNowPlayingListSort(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This sort prompt isn't for you.")) return;
    setNowPlayingListContext(ownerId, interaction.message);
    await promptSortNowPlayingButtons(interaction, ownerId);
  }
}
