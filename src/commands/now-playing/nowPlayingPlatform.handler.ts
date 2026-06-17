import {
  ButtonInteraction,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import { Discord, ButtonComponent, SelectMenuComponent } from "discordx";
import Member, { type IMemberNowPlayingEntry } from "../../classes/Member.js";
import Game from "../../classes/Game.js";
import GamePlatformRegionService from "../../classes/GamePlatformRegionService.js";
import {
  type AnyRepliable,
  replyIfNotOwner,
  safeDeferReply,
  safeDeferUpdate,
  safeReply,
  safeUpdate,
} from "../../functions/InteractionUtils.js";
import { buildSelectRow } from "../../functions/uiComponents.js";
import {
  buildComponentsV2Flags,
  buildTextContainer,
  buildTextReply,
} from "../../functions/ComponentsV2Utils.js";
import {
  buildNowPlayingPlatformStateFromCurrent,
  encodeNowPlayingPlatformState,
  getDisplayNowPlayingEntries,
  parseNowPlayingPlatformStateToken,
} from "../../functions/NowPlayingUtils.js";
import { STANDARD_PLATFORM_IDS } from "../../config/standardPlatforms.js";
import { DISCORD_SELECT_OPTIONS_MAX, truncateLabel } from "../../config/textLimits.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { assertCustomIdSegments } from "../../utilities/CustomIdUtils.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
import {
  buildNowPlayingEditPlatformComponents,
  refreshNowPlayingListFromContext,
  returnToNowPlayingEditMenu,
  withPmNowPlayingList,
} from "./nowPlayingListRenderer.js";
import { setNowPlayingListContext } from "./nowPlayingContexts.js";

async function getNowPlayingEditPlatformOptions(
  entries: IMemberNowPlayingEntry[],
): Promise<Array<Array<{ label: string; value: string; platformId: number }>>> {
  const limitedEntries = entries.slice(0, 10);
  const optionsPerEntry = await Promise.all(
    limitedEntries.map(async (entry) => {
      const platforms = await GamePlatformRegionService.getPlatformsForGameWithStandard(
        entry.gameId,
        STANDARD_PLATFORM_IDS,
      );
      const uniqueById = new Map<number, { id: number; name: string }>();
      platforms.forEach((platform) => {
        if (!uniqueById.has(platform.id)) {
          uniqueById.set(platform.id, platform);
        }
      });
      const deduped = Array.from(uniqueById.values()).slice(0, DISCORD_SELECT_OPTIONS_MAX);
      if (!deduped.length && entry.platformId) {
        deduped.push({
          id: entry.platformId,
          name: entry.platformName ?? "Current Platform",
        });
      }
      return deduped.map((platform, optionIndex) => ({
        label: truncateLabel(platform.name),
        value: String(optionIndex),
        platformId: platform.id,
      }));
    }),
  );
  return optionsPerEntry;
}

async function promptEditNowPlayingPlatform(
  interaction: AnyRepliable,
  mode: "reply" | "update" = "reply",
): Promise<void> {
  if (mode === "reply") {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
  }

  const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(interaction.user.id));
  if (!entries.length) {
    const container = buildTextContainer("Your Now Playing list is empty.");
    const pmComponents = await withPmNowPlayingList(
      interaction.user.id,
      interaction.guildId,
      [container],
    );
    if (mode === "update" && "update" in interaction) {
      await safeUpdate(interaction, {
        components: pmComponents, flags: buildComponentsV2Flags(true) });
    } else {
      await safeReply(interaction, {
        components: pmComponents,
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  const platformOptions = await getNowPlayingEditPlatformOptions(entries);
  const stateToken = buildNowPlayingPlatformStateFromCurrent(entries, platformOptions);
  const components = buildNowPlayingEditPlatformComponents(
    entries,
    interaction.user.id,
    platformOptions,
    stateToken,
  );
  const pmComponents = await withPmNowPlayingList(
    interaction.user.id,
    interaction.guildId,
    components,
  );

  if (mode === "update" && "update" in interaction) {
    await safeUpdate(interaction, {
      components: pmComponents,
      flags: buildComponentsV2Flags(true),
    });
    return;
  }
  await safeReply(interaction, {
    components: pmComponents,
    flags: buildComponentsV2Flags(true),
  });
}

async function promptNowPlayingEditPlatformSelection(
  interaction: AnyRepliable,
  ownerId: string,
  gameId: number,
  mode: "reply" | "update" = "reply",
): Promise<void> {
  const game = await Game.getGameById(gameId);
  if (!game) {
    const container = buildTextContainer("That game could not be found.");
    if (mode === "update" && "update" in interaction) {
      await safeUpdate(interaction, {
        components: [container], flags: buildComponentsV2Flags(true) });
    } else {
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
    }
    return;
  }

  const platforms = await GamePlatformRegionService
    .getPlatformsForGameWithStandard(gameId, STANDARD_PLATFORM_IDS);
  if (!platforms.length) {
    const container = buildTextContainer("No platform data is available for this game.");
    if (mode === "update" && "update" in interaction) {
      await safeUpdate(interaction, {
        components: [container], flags: buildComponentsV2Flags(true) });
    } else {
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
    }
    return;
  }

  const options = platforms.slice(0, DISCORD_SELECT_OPTIONS_MAX).map((platform) => ({
    label: truncateLabel(platform.name),
    value: String(platform.id),
  }));
  const select = new StringSelectMenuBuilder()
    .setCustomId(`nowplaying-edit-platform-select:${ownerId}:${gameId}`)
    .setPlaceholder("Select the platform")
    .addOptions(options);
  const content = platforms.length > options.length
    ? `Select the platform for **${game.title}** (showing first ${options.length}).`
    : `Select the platform for **${game.title}**.`;
  const container = buildTextContainer(content);
  const payload = {
    components: [
      container,
      buildSelectRow(select),
    ],
    flags: buildComponentsV2Flags(true),
  };
  const pmComponents = await withPmNowPlayingList(
    ownerId,
    interaction.guildId,
    payload.components,
  );
  if (mode === "update" && "update" in interaction) {
    await safeUpdate(interaction, { ...payload, components: pmComponents });
  } else {
    await safeReply(interaction, { ...payload, components: pmComponents });
  }
}

@Discord()
export class NowPlayingPlatformHandlers {
  @SelectMenuComponent({ id: /^nowplaying-edit-platform-select:\d+:\d+$/ })
  async handleNowPlayingEditPlatformSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [ownerId, gameIdRaw] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This platform prompt isn't for you.")) return;

    const gameId = Number(gameIdRaw);
    const platformId = Number(interaction.values?.[0]);
    if (!isPositiveInt(gameId) || !isPositiveInt(platformId)) {
      await safeReply(interaction, buildTextReply("Invalid platform selection.", true));
      return;
    }

    const updated = await Member.updateNowPlayingPlatform(ownerId, gameId, platformId);
    if (!updated) {
      await safeReply(interaction, buildTextReply("Could not update that platform.", true));
      return;
    }

    safeIgnore(refreshNowPlayingListFromContext(interaction, ownerId));
    await returnToNowPlayingEditMenu(interaction, ownerId);
  }

  @SelectMenuComponent({ id: /^nowplaying-edit-platform-slot:\d+:\d+:[a-z0-9_]+$/ })
  async handleEditPlatformSlot(interaction: StringSelectMenuInteraction): Promise<void> {
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId, slotRaw, stateToken] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This platform prompt isn't for you.")) return;

    const slotIndex = Number(slotRaw);
    const selectedOptionIndex = Number(interaction.values?.[0]);
    if (
      !Number.isInteger(slotIndex) ||
      slotIndex < 0 ||
      !Number.isInteger(selectedOptionIndex) ||
      selectedOptionIndex < 0
    ) {
      await safeReply(interaction, buildTextReply("Invalid selection.", true));
      return;
    }

    const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId)).slice(0, 10);
    const platformOptions = await getNowPlayingEditPlatformOptions(entries);
    const parsed = parseNowPlayingPlatformStateToken(stateToken, entries.length);
    if (!parsed || slotIndex >= entries.length || selectedOptionIndex > 24) {
      await safeReply(interaction, buildTextReply("This platform form has expired. Open Edit Platform again.", true));
      return;
    }
    if (selectedOptionIndex >= (platformOptions[slotIndex]?.length ?? 0)) {
      await safeReply(interaction, buildTextReply("Invalid platform selection for that game.", true));
      return;
    }

    parsed[slotIndex] = selectedOptionIndex;
    const components = buildNowPlayingEditPlatformComponents(
      entries,
      ownerId,
      platformOptions,
      encodeNowPlayingPlatformState(parsed),
    );
    const pmComponents = await withPmNowPlayingList(ownerId, interaction.guildId, components);
    await safeUpdate(interaction, {
      components: pmComponents,
      flags: buildComponentsV2Flags(isEphemeral),
    });
  }

  @ButtonComponent({ id: /^nowplaying-edit-menu-platform:\d+$/ })
  async handleNowPlayingEditMenuPlatform(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This edit menu isn't for you.")) return;
    await promptEditNowPlayingPlatform(interaction, "update");
  }

  @ButtonComponent({ id: /^nowplaying-list-edit-platform:\d+$/ })
  async handleNowPlayingListEditPlatform(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This platform prompt isn't for you.")) return;
    setNowPlayingListContext(ownerId, interaction.message);
    await promptEditNowPlayingPlatform(interaction, "update");
  }

  @ButtonComponent({ id: /^np-edit-platform:\d+:\d+$/ })
  async handleNowPlayingEditPlatformPick(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [ownerId, gameIdRaw] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This platform prompt isn't for you.")) return;
    const gameId = Number(gameIdRaw);
    if (!isPositiveInt(gameId)) {
      await safeReply(interaction, buildTextReply("Invalid selection.", true));
      return;
    }
    await promptNowPlayingEditPlatformSelection(interaction, ownerId, gameId, "update");
  }

  @ButtonComponent({ id: /^nowplaying-edit-platform-save:\d+:[a-z0-9_]+$/ })
  async handleNowPlayingEditPlatformSave(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [ownerId, stateToken] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This platform prompt isn't for you.")) return;

    await safeDeferUpdate(interaction);
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const responseFlags = buildComponentsV2Flags(isEphemeral);
    const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId)).slice(0, 10);
    const platformOptions = await getNowPlayingEditPlatformOptions(entries);
    const parsed = parseNowPlayingPlatformStateToken(stateToken, entries.length);
    if (!parsed) {
      await safeReply(
        interaction,
        buildTextReply("This platform form has expired. Open Edit Platform again.", isEphemeral),
      );
      return;
    }
    if (parsed.some((value) => value < 0)) {
      const components = buildNowPlayingEditPlatformComponents(
        entries,
        ownerId,
        platformOptions,
        stateToken,
        "Assign a platform for every visible game before saving.",
      );
      const pmComponents = await withPmNowPlayingList(
        ownerId, interaction.guildId, components,
      );
      await safeReply(interaction, { components: pmComponents, flags: responseFlags });
      return;
    }

    for (let slotIndex = 0; slotIndex < entries.length; slotIndex += 1) {
      const selectedOptionIndex = parsed[slotIndex];
      const option = platformOptions[slotIndex]?.[selectedOptionIndex];
      const gameId = entries[slotIndex]?.gameId;
      if (!option || !gameId) {
        await safeReply(
          interaction,
          buildTextReply(
            "One or more selected platforms are invalid. Please review and try again.",
            isEphemeral,
          ),
        );
        return;
      }
      const updated = await Member.updateNowPlayingPlatform(ownerId, gameId, option.platformId);
      if (!updated) {
        await safeReply(
          interaction,
          buildTextReply(
            `Could not update platform for ${entries[slotIndex].title}.`,
            isEphemeral,
          ),
        );
        return;
      }
    }
    safeIgnore(refreshNowPlayingListFromContext(interaction, ownerId));
    await returnToNowPlayingEditMenu(interaction, ownerId);
  }

  @ButtonComponent({ id: /^nowplaying-edit-platform-reset:\d+$/ })
  async handleNowPlayingEditPlatformReset(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This platform prompt isn't for you.")) return;
    await safeDeferUpdate(interaction);
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const responseFlags = buildComponentsV2Flags(isEphemeral);
    const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId)).slice(0, 10);
    const platformOptions = await getNowPlayingEditPlatformOptions(entries);
    const stateTokenReset = buildNowPlayingPlatformStateFromCurrent(entries, platformOptions);
    const components = buildNowPlayingEditPlatformComponents(
      entries,
      ownerId,
      platformOptions,
      stateTokenReset,
    );
    const pmComponents = await withPmNowPlayingList(ownerId, interaction.guildId, components);
    await safeReply(interaction, { components: pmComponents, flags: responseFlags });
  }
}
