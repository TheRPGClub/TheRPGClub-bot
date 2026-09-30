import {
  ApplicationCommandOptionType,
  ButtonInteraction,
  ButtonStyle,
  CommandInteraction,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  Slash,
  SlashChoice,
  SlashGroup,
  SlashOption,
} from "discordx";
import UserGameBacklog from "../../classes/UserGameBacklog.js";
import UserGameCollection from "../../classes/UserGameCollection.js";
import {
  autocompleteGameCompletionPlatformStandardFirst,
  resolveGameCompletionPlatformId,
} from "../game-completion/completion-autocomplete.utils.js";
import {
  buildComponentsV2EditFlags,
  buildComponentsV2Flags,
  buildContentContainer,
  buildTextContainer,
  buildTextReply,
} from "../../functions/ComponentsV2Utils.js";
import {
  replyIfNotOwner,
  safeDeferReply,
  safeDeferUpdate,
  safeEditReply,
  safeReply,
} from "../../functions/InteractionUtils.js";
import { buildActionButton, buildButtonRow } from "../../functions/uiComponents.js";
import { buildApiErrorMessage } from "../../utilities/ApiErrorUtils.js";
import { logError } from "../../utilities/LogUtils.js";
import { startPlayingEntry } from "../now-playing/nowPlayingStart.service.js";
import { takeOffBacklogIfAlreadyPlaying } from "./backlog-list.service.js";
import {
  buildBacklogPickContent,
  buildBacklogPickDismissId,
  buildBacklogPickEmptyMessage,
  buildBacklogPickRerollId,
  buildBacklogPickStartId,
  describeBacklogPickFilters,
  newBacklogPickSeed,
  parseBacklogPickRerollId,
  parseBacklogPickStartId,
  pickFromBacklog,
  type BacklogPickSource,
  type IBacklogPickState,
} from "./backlog-pick.service.js";

const MAX_HOURS_LIMIT = 1000;
const NOT_YOURS = "This pick is not for you.";

type PickPayload = { components: unknown[] };

async function buildPickPayload(state: IBacklogPickState): Promise<PickPayload> {
  let result: Awaited<ReturnType<typeof pickFromBacklog>>;
  try {
    result = await pickFromBacklog(state);
  } catch (err) {
    logError("backlog pick.build_failed", err);
    const message = buildApiErrorMessage("Failed to pick a game", err);
    return { components: [buildTextContainer(message)] };
  }
  if (!result) {
    return { components: [buildTextContainer(buildBacklogPickEmptyMessage(state))] };
  }

  const filterSummary = await describeBacklogPickFilters(state);
  const container = buildContentContainer(
    buildBacklogPickContent(result, filterSummary),
    result.coverUrl,
  );
  const buttons = buildButtonRow(
    buildActionButton({
      customId: buildBacklogPickRerollId({ ...state, position: result.position + 1 }),
      label: "Reroll",
      style: ButtonStyle.Primary,
    }),
    buildActionButton({
      customId: buildBacklogPickStartId(
        state.ownerId,
        result.candidate.kind,
        result.candidate.entryId,
      ),
      label: "Start playing",
      style: ButtonStyle.Success,
    }),
    buildActionButton({
      customId: buildBacklogPickDismissId(state.ownerId),
      label: "Not now",
      style: ButtonStyle.Secondary,
    }),
  );
  return { components: [container, buttons] };
}

@Discord()
@SlashGroup("backlog")
export class BacklogPickCommand {
  @Slash({ name: "pick", description: "Suggest a game from your backlog to play next" })
  async pick(
    @SlashOption({
      name: "platform",
      description: "Only suggest games on this platform",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: autocompleteGameCompletionPlatformStandardFirst,
    })
    platformRaw: string | undefined,
    @SlashOption({
      name: "max_hours",
      description: "Longest HowLongToBeat main story time to allow",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 1,
      maxValue: MAX_HOURS_LIMIT,
    })
    maxHours: number | undefined,
    @SlashChoice(
      { name: "Backlog", value: "backlog" },
      { name: "Collection", value: "collection" },
      { name: "Both", value: "both" },
    )
    @SlashOption({
      name: "source",
      description: "Where to pick from. Defaults to your backlog.",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    source: BacklogPickSource | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });

    const platformId = platformRaw !== undefined
      ? await resolveGameCompletionPlatformId(platformRaw)
      : null;
    if (platformRaw !== undefined && !platformId) {
      await safeReply(interaction, buildTextReply("Invalid platform selection.", true));
      return;
    }

    const payload = await buildPickPayload({
      ownerId: interaction.user.id,
      source: source ?? "backlog",
      platformId: platformId ?? 0,
      maxHours: maxHours ?? 0,
      seed: newBacklogPickSeed(),
      position: 0,
    });
    await safeReply(interaction, {
      components: payload.components,
      flags: buildComponentsV2Flags(true),
    });
  }

  @ButtonComponent({ id: /^backlog-pick-reroll-v1:\d+:[bca]:\d+:\d+:[0-9a-z]+:\d+$/ })
  async onPickReroll(interaction: ButtonInteraction): Promise<void> {
    const state = parseBacklogPickRerollId(interaction.customId);
    if (!state) {
      await safeReply(interaction, buildTextReply("This pick control is invalid.", true));
      return;
    }
    if (await replyIfNotOwner(interaction, state.ownerId, NOT_YOURS)) return;
    await safeDeferUpdate(interaction);

    const payload = await buildPickPayload(state);
    await safeEditReply(interaction, {
      components: payload.components,
      flags: buildComponentsV2EditFlags(),
    });
  }

  @ButtonComponent({ id: /^backlog-pick-start-v1:\d+:[bc]:\d+$/ })
  async onPickStart(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseBacklogPickStartId(interaction.customId);
    if (!parsed) {
      await safeReply(interaction, buildTextReply("This pick control is invalid.", true));
      return;
    }
    if (await replyIfNotOwner(interaction, parsed.ownerId, NOT_YOURS)) return;
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });

    if (parsed.kind === "b") {
      const entry = await UserGameBacklog.getEntryForUser(parsed.entryId, parsed.ownerId);
      if (!entry) {
        await safeReply(interaction, buildTextReply("That backlog entry no longer exists.", true));
        return;
      }
      if (await takeOffBacklogIfAlreadyPlaying(interaction, entry)) return;
      await startPlayingEntry(interaction, entry);
      return;
    }

    const entry = await UserGameCollection.getEntryForUser(parsed.entryId, parsed.ownerId);
    if (!entry) {
      await safeReply(
        interaction,
        buildTextReply("That collection entry no longer exists.", true),
      );
      return;
    }
    await startPlayingEntry(interaction, entry);
  }

  @ButtonComponent({ id: /^backlog-pick-dismiss-v1:\d+$/ })
  async onPickDismiss(interaction: ButtonInteraction): Promise<void> {
    const ownerId = interaction.customId.split(":")[1] ?? "";
    if (await replyIfNotOwner(interaction, ownerId, NOT_YOURS)) return;
    await safeDeferUpdate(interaction);
    await safeEditReply(interaction, {
      components: [buildTextContainer(
        "No problem. Run `/backlog pick` again whenever you want a suggestion.",
      )],
      flags: buildComponentsV2EditFlags(),
    });
  }
}
