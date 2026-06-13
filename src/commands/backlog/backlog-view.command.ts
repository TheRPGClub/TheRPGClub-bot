import {
  ApplicationCommandOptionType,
  ButtonInteraction,
  CommandInteraction,
  ModalBuilder,
  ModalSubmitInteraction,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";
import {
  replyIfNotOwner,
  safeDeferReply,
  safeDeferUpdate,
  safeReply,
  safeUpdate,
  sanitizeUserInput,
} from "../../functions/InteractionUtils.js";
import {
  buildComponentsV2Flags,
  buildTextReply,
} from "../../functions/ComponentsV2Utils.js";
import { buildTextInputRow } from "../../functions/uiComponents.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
import { logError } from "../../utilities/LogUtils.js";
import {
  applyBacklogFiltersToSourceMessage,
  buildBacklogFilterModalId,
  buildBacklogFilterPanelButtons,
  buildBacklogFilterPanelContent,
  buildBacklogListResponse,
  closeBacklogFilterPanel,
  BACKLOG_FILTER_TITLE_INPUT_ID,
  parseBacklogFilterActionId,
  parseBacklogFilterModalId,
  parseBacklogFilterPanelActionId,
  parseBacklogFilterStateFromContent,
  parseBacklogFiltersFromListMessage,
  parseBacklogListNavId,
} from "./backlog-list.service.js";

@Discord()
@SlashGroup("backlog")
export class BacklogViewCommand {
  @Slash({ name: "list", description: "View your game backlog" })
  async list(
    @SlashOption({
      name: "title",
      description: "Filter by title",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    title: string | undefined,
    @SlashOption({
      name: "private",
      description: "Send reply privately (only visible to you). Defaults to true.",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    privateFlag: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isEphemeral = privateFlag ?? true;
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(isEphemeral) });

    const userId = interaction.user.id;
    const memberLabel = interaction.user.globalName ?? interaction.user.username;
    const titleFilter = title
      ? sanitizeUserInput(title, { preserveNewlines: false })
      : undefined;

    let response: Awaited<ReturnType<typeof buildBacklogListResponse>>;
    try {
      response = await buildBacklogListResponse({
        viewerUserId: userId,
        targetUserId: userId,
        memberLabel,
        title: titleFilter,
        page: 0,
        isEphemeral,
      });
    } catch (err) {
      logError("backlog list.build_response_failed", err);
      await safeReply(
        interaction,
        buildTextReply("Failed to load your backlog. Please try again.", isEphemeral),
      );
      return;
    }

    if (response.content) {
      await safeReply(interaction, buildTextReply(response.content, isEphemeral));
      return;
    }

    try {
      await safeReply(interaction, {
        components: response.components,
        flags: buildComponentsV2Flags(isEphemeral),
      });
    } catch (err) {
      logError("backlog list.safe_reply_failed", err);
      safeIgnore(
        safeReply(interaction, buildTextReply("Failed to display backlog. Please try again.", isEphemeral)),
      );
    }
  }

  @ButtonComponent({
    id: /^backlog-list-nav-v1:[^:]+:[^:]+:\d+:[ep]:(prev|next)$/,
  })
  async onBacklogListNav(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseBacklogListNavId(interaction.customId);
    if (!parsed) {
      safeIgnore(safeReply(interaction, buildTextReply("This backlog view control is invalid.", true)));
      return;
    }

    if (await replyIfNotOwner(interaction, parsed.viewerUserId, "This backlog view is not for you.")) return;

    await safeDeferUpdate(interaction);

    const nextPage = parsed.direction === "next"
      ? parsed.page + 1
      : Math.max(parsed.page - 1, 0);

    const currentFilters = parseBacklogFiltersFromListMessage(interaction.message);

    const memberLabel = interaction.user.globalName ?? interaction.user.username;
    const response = await buildBacklogListResponse({
      viewerUserId: parsed.viewerUserId,
      targetUserId: parsed.targetUserId,
      memberLabel,
      title: currentFilters.title,
      page: nextPage,
      isEphemeral: parsed.isEphemeral,
    });

    if (response.content) {
      safeIgnore(safeUpdate(interaction, { content: response.content, components: [] }));
      return;
    }

    try {
      await safeUpdate(interaction, {
        components: response.components,
        flags: buildComponentsV2Flags(parsed.isEphemeral),
      });
    } catch (err) {
      logError("backlog list nav.update_failed", err);
      throw err;
    }
  }

  @ButtonComponent({
    id: /^backlog-list-filter-v1:[^:]+:[^:]+:[ep]:open$/,
  })
  async onBacklogFilterOpen(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseBacklogFilterActionId(interaction.customId);
    if (!parsed) {
      safeIgnore(safeReply(interaction, buildTextReply("This filter control is invalid.", true)));
      return;
    }

    if (await replyIfNotOwner(interaction, parsed.viewerUserId, "This backlog view is not for you.")) return;

    const currentFilters = parseBacklogFiltersFromListMessage(interaction.message);
    const filterPanelReply = buildTextReply(
      buildBacklogFilterPanelContent(currentFilters.title),
      true,
    );

    safeIgnore(safeReply(interaction, {
      ...filterPanelReply,
      components: [
        ...filterPanelReply.components,
        ...buildBacklogFilterPanelButtons({
          viewerUserId: parsed.viewerUserId,
          targetUserId: parsed.targetUserId,
          sourceMessageId: interaction.message.id,
          isEphemeral: parsed.isEphemeral,
        }),
      ],
    }));
  }

  @ButtonComponent({
    id: /^backlog-filter-panel:[^:]+:[^:]+:[^:]+:[ep]:(text|apply|clear|cancel)$/,
  })
  async onBacklogFilterAction(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseBacklogFilterPanelActionId(interaction.customId);
    if (!parsed) {
      safeIgnore(safeReply(interaction, buildTextReply("This filter control is invalid.", true)));
      return;
    }

    if (await replyIfNotOwner(interaction, parsed.viewerUserId, "This filter control is not for you.")) return;

    if (parsed.action === "cancel") {
      await closeBacklogFilterPanel(interaction);
      return;
    }

    const currentState = parseBacklogFilterStateFromContent(interaction.message.content ?? "");

    if (parsed.action === "text") {
      const modal = new ModalBuilder()
        .setCustomId(buildBacklogFilterModalId({
          viewerUserId: parsed.viewerUserId,
          targetUserId: parsed.targetUserId,
          sourceMessageId: parsed.sourceMessageId,
          isEphemeral: parsed.isEphemeral,
        }))
        .setTitle("Backlog filter");

      modal.addComponents(
        buildTextInputRow({
          customId: BACKLOG_FILTER_TITLE_INPUT_ID,
          label: "Title contains",
          required: false,
          maxLength: 100,
          value: currentState.title ?? "",
        }),
      );
      safeIgnore(interaction.showModal(modal));
      return;
    }

    const nextTitle = parsed.action === "clear" ? undefined : currentState.title;

    if (parsed.action === "apply" || parsed.action === "clear") {
      await safeDeferUpdate(interaction);
      const applied = await applyBacklogFiltersToSourceMessage({
        interaction,
        sourceMessageId: parsed.sourceMessageId,
        viewerUserId: parsed.viewerUserId,
        targetUserId: parsed.targetUserId,
        isEphemeral: parsed.isEphemeral,
        title: nextTitle,
      });
      safeIgnore((interaction.message as any)?.delete?.() ?? Promise.resolve());
      if (!applied) {
        safeIgnore(
          safeReply(interaction, buildTextReply("Could not apply filter -- the backlog message was not found.", true)),
        );
      }
    }
  }

  @ModalComponent({
    id: /^blm1:[^:]+:[^:]+:[^:]+:[ep]$/,
  })
  async onBacklogFilterModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseBacklogFilterModalId(interaction.customId);
    if (!parsed) {
      safeIgnore(safeReply(interaction, buildTextReply("This filter modal is invalid.", true)));
      return;
    }

    if (await replyIfNotOwner(interaction, parsed.viewerUserId, "This filter modal is not for you.")) return;

    const rawTitle = interaction.fields.getTextInputValue(BACKLOG_FILTER_TITLE_INPUT_ID);
    const title = rawTitle
      ? sanitizeUserInput(rawTitle, { preserveNewlines: false }).trim() || undefined
      : undefined;

    const panelReply = buildTextReply(buildBacklogFilterPanelContent(title), true);
    await safeUpdate(interaction, {
      ...panelReply,
      components: [
        ...panelReply.components,
        ...buildBacklogFilterPanelButtons({
          viewerUserId: parsed.viewerUserId,
          targetUserId: parsed.targetUserId,
          sourceMessageId: parsed.sourceMessageId,
          isEphemeral: parsed.isEphemeral,
        }),
      ],
    });
  }
}
