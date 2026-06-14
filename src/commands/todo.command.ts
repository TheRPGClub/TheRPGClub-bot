import type { ButtonInteraction, CommandInteraction } from "discord.js";
import {
  ApplicationCommandOptionType,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputStyle,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  SelectMenuComponent,
  Slash,
  SlashChoice,
  SlashOption,
} from "discordx";
import type { ContainerBuilder } from "@discordjs/builders";
import type { ActionRowBuilder } from "discord.js";
import {
  safeDeferReply,
  PRIVATE_OPTION_DESCRIPTION,
  safeDeferUpdate,
  safeReply,
  safeUpdate,
} from "../functions/InteractionUtils.js";
import { countSuggestions } from "../classes/Suggestion.js";
import {
  addComment,
  closeIssue,
  reopenIssue,
  createIssue,
  getIssue,
  listAllIssues,
  listIssueComments,
  setIssueLabels,
  updateIssue,
  type IGithubIssue,
  type IGithubIssueComment,
} from "../services/GithubIssuesService.js";
import {
  DEFAULT_TODO_REPO_CODE,
  isTodoRepoCode,
} from "../config/repos.js";
import {
  buildComponentsV2Flags,
} from "../functions/ComponentsV2Utils.js";
import {
  buildSelectRow,
  buildActionButton,
  buildButtonRow,
  buildTextInputRow,
} from "../functions/uiComponents.js";
import { DISCORD_TEXT_INPUT_MAX } from "../config/textLimits.js";
import { TODO_DEFAULT_PAGE_SIZE, TODO_MAX_PAGE_SIZE } from "../config/pagination.js";
import {
  TODO_LABELS,
  LIST_STATES,
  LIST_SORTS,
  LIST_DIRECTIONS,
  TODO_CREATE_TYPE_LABELS,
  TODO_CREATE_BUTTON_PREFIX,
  TODO_CREATE_MODAL_PREFIX,
  TODO_CLOSE_BUTTON_PREFIX,
  TODO_CLOSE_SELECT_PREFIX,
  TODO_CLOSE_CANCEL_PREFIX,
  TODO_COMMENT_BUTTON_PREFIX,
  TODO_COMMENT_MODAL_PREFIX,
  TODO_COMMENT_INPUT_ID,
  TODO_EDIT_VIEW_BUTTON_PREFIX,
  TODO_EDIT_VIEW_MODAL_PREFIX,
  TODO_EDIT_TITLE_BUTTON_PREFIX,
  TODO_EDIT_TITLE_MODAL_PREFIX,
  TODO_EDIT_TITLE_INPUT_ID,
  TODO_EDIT_DESC_BUTTON_PREFIX,
  TODO_EDIT_DESC_MODAL_PREFIX,
  TODO_EDIT_DESC_INPUT_ID,
  TODO_CLOSE_VIEW_PREFIX,
  TODO_REOPEN_VIEW_PREFIX,
  TODO_LABEL_EDIT_BUTTON_PREFIX,
  TODO_LABEL_EDIT_SELECT_PREFIX,
  TODO_FILTER_BUTTON_PREFIX,
  TODO_FILTER_MODAL_PREFIX,
  TODO_FILTER_STATE_ID,
  TODO_FILTER_LABEL_ID,
  TODO_FILTER_QUERY_ID,
  TODO_FILTER_SORT_ID,
  TODO_OPEN_SELECT_PREFIX,
  TODO_REPO_SELECT_PREFIX,
  TODO_FILTER_LABEL_ALL,
  TODO_FILTER_LABEL_NOT_BLOCKED,
  TODO_CREATE_TITLE_ID,
  TODO_CREATE_BODY_ID,
  TODO_CREATE_TYPE_ID,
  TODO_PAYLOAD_TOKEN_MAX_LENGTH,
  type TodoLabel,
  type ListState,
  type ListSort,
  type ListDirection,
  type TodoListPayload,
} from "./todo/todoTypes.js";
import {
  clampNumber,
  getRepoTarget,
  buildTodoPayloadToken,
  parseTodoPayloadToken,
} from "./todo/todoPayload.js";
import {
  parseTodoListCustomId,
  parseTodoListBackId,
  parseTodoCreateButtonId,
  parseTodoCreateModalId,
  parseTodoCloseId,
  parseTodoCloseSelectId,
  parseTodoViewId,
  parseTodoIssueActionId,
  parseTodoIssueModalId,
  parseTodoCloseViewId,
  parseTodoReopenViewId,
  parseTodoLabelEditId,
  parseTodoLabelEditSelectId,
  parseTodoSelectId,
  parseTodoFilterButtonId,
  parseTodoFilterModalId,
  buildTodoCreateModalId,
  buildTodoCloseSelectId,
  buildTodoCloseCancelId,
  buildTodoLabelEditSelectId,
  buildTodoFilterModalId,
  buildTodoEditViewModalId,
  buildTodoCommentModalId,
  buildTodoEditTitleModalId,
  buildTodoEditDescModalId,
} from "./todo/todoCustomIds.js";
import {
  normalizeStateFilters,
  toIssueState,
  matchesIssueLabels,
  matchesIssueQuery,
  isBlockedIssue,
  normalizeQuery,
  parseTodoLabels,
  parseTodoCreateTypeLabels,
  sortIssuesByNumber,
} from "./todo/todoFilters.js";
import { getGithubErrorMessage } from "./todo/todoFormatters.js";
import {
  buildTodoTextReply,
  replyTodoExpired,
  buildIssueListComponents,
  buildIssueViewComponents,
} from "./todo/todoComponents.js";
import {
  requireModeratorOrAdminOrOwner,
  requireOwner,
} from "./todo/todoPermissions.js";
import { sanitizeTodoRichText } from "./todo/todoRenderers.js";

async function getSuggestionReviewCount(): Promise<number> {
  try {
    return await countSuggestions();
  } catch {
    return 0;
  }
}

@Discord()
export class TodoCommand {
  @Slash({ description: "List GitHub issues", name: "todo" })
  async list(
    @SlashOption({
      description: "Search text in any issue field",
      name: "query",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    queryRaw: string | undefined,
    @SlashChoice(...LIST_STATES)
    @SlashOption({
      description: "Issue state",
      name: "state",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    state: ListState | undefined,
    @SlashOption({
      description: "Filter by labels (comma-separated)",
      name: "labels",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    labelsRaw: string | undefined,
    @SlashChoice(...LIST_SORTS)
    @SlashOption({
      description: "Sort order",
      name: "sort",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    sort: ListSort | undefined,
    @SlashChoice(...LIST_DIRECTIONS)
    @SlashOption({
      description: "Sort direction",
      name: "direction",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    direction: ListDirection | undefined,
    @SlashOption({
      description: "Page number",
      name: "page",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    page: number | undefined,
    @SlashOption({
      description: "Results per page",
      name: "per_page",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    perPage: number | undefined,
    @SlashOption({
      description: PRIVATE_OPTION_DESCRIPTION,
      name: "private",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    privateFlag: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isPublic = !(privateFlag ?? false);
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(!isPublic) });

    const resolvedPerPage = clampNumber(perPage ?? TODO_DEFAULT_PAGE_SIZE, 1, TODO_MAX_PAGE_SIZE);
    const parsedLabels = parseTodoLabels(labelsRaw);
    const query = normalizeQuery(queryRaw);
    if (parsedLabels.invalid.length) {
      await safeReply(
        interaction,
        buildTodoTextReply(
          "Unknown labels: " +
            parsedLabels.invalid.join(", ") +
            `. Valid labels: ${TODO_LABELS.join(", ")}.`,
          true,
        ),
      );
      return;
    }

    const initialStateFilters = normalizeStateFilters(
      state === "all" ? ["open", "closed"] : [state ?? "open"],
    );
    const effectiveState = toIssueState(initialStateFilters);

    const resolvedDirection = direction ?? "desc";
    let issues: IGithubIssue[];
    try {
      issues = await listAllIssues({
        state: effectiveState,
        sort: sort ?? "updated",
        direction: resolvedDirection,
      }, getRepoTarget(DEFAULT_TODO_REPO_CODE));
    } catch (err: any) {
      await safeReply(interaction, buildTodoTextReply(getGithubErrorMessage(err), true));
      return;
    }

    if (parsedLabels.labels.length) {
      issues = issues.filter((issue) => matchesIssueLabels(issue, parsedLabels.labels));
    }
    if (query) {
      issues = issues.filter((issue) => matchesIssueQuery(issue, query));
    }
    issues = sortIssuesByNumber(issues, resolvedDirection);

    const totalIssues = issues.length;
    const totalPages = Math.max(1, Math.ceil(totalIssues / resolvedPerPage));
    const resolvedPage = clampNumber(page ?? 1, 1, totalPages);
    const startIndex = (resolvedPage - 1) * resolvedPerPage;
    const pageIssues = issues.slice(startIndex, startIndex + resolvedPerPage);

    const payload: TodoListPayload = {
      page: resolvedPage,
      perPage: resolvedPerPage,
      state: effectiveState,
      stateFilters: initialStateFilters,
      labels: parsedLabels.labels,
      excludeBlocked: parsedLabels.labels.length === 0,
      query,
      sort: sort ?? "updated",
      direction: resolvedDirection,
      isPublic,
      repo: DEFAULT_TODO_REPO_CODE,
    };
    const suggestionCount = await getSuggestionReviewCount();
    const payloadToken = buildTodoPayloadToken(payload, TODO_PAYLOAD_TOKEN_MAX_LENGTH);
    const listPayload = buildIssueListComponents(
      pageIssues,
      totalIssues,
      payload,
      payloadToken,
      suggestionCount,
    );

    await safeReply(interaction, {
      components: listPayload.components,
      flags: buildComponentsV2Flags(!isPublic),
      allowedMentions: { parse: [] },
    });

  }

  private async buildTodoListPayload(
    payloadToken: string,
    page: number,
  ): Promise<{
    components: Array<ContainerBuilder | ActionRowBuilder<any>>;
    payload: TodoListPayload;
    pageIssues: IGithubIssue[];
  } | null> {
    const basePayload = parseTodoPayloadToken(payloadToken);
    if (!basePayload) return null;

    const payload: TodoListPayload = {
      ...basePayload,
      page,
    };
    const safePerPage = clampNumber(payload.perPage, 1, TODO_MAX_PAGE_SIZE);
    if (safePerPage !== payload.perPage) {
      payload.perPage = safePerPage;
      payload.perPage = safePerPage;
    }

    let issues: IGithubIssue[];
    try {
      issues = await listAllIssues({
        state: payload.state,
        sort: payload.sort,
        direction: payload.direction,
      }, getRepoTarget(payload.repo));
    } catch {
      return null;
    }

    if (payload.excludeBlocked) {
      issues = issues.filter((issue) => !isBlockedIssue(issue));
    }
    if (payload.labels.length) {
      issues = issues.filter((issue) => matchesIssueLabels(issue, payload.labels));
    }
    if (payload.query) {
      issues = issues.filter((issue) => matchesIssueQuery(issue, payload.query as string));
    }
    issues = sortIssuesByNumber(issues, payload.direction);

    const totalIssues = issues.length;
    const totalPages = Math.max(1, Math.ceil(totalIssues / payload.perPage));
    const safePage = clampNumber(payload.page, 1, totalPages);
    const startIndex = (safePage - 1) * payload.perPage;
    const pageIssues = issues.slice(startIndex, startIndex + payload.perPage);

    const suggestionCount = await getSuggestionReviewCount();
    const updatedPayload: TodoListPayload = { ...payload, page: safePage };
    const nextToken = buildTodoPayloadToken(updatedPayload, TODO_PAYLOAD_TOKEN_MAX_LENGTH);
    const listPayload = buildIssueListComponents(
      pageIssues,
      totalIssues,
      updatedPayload,
      nextToken,
      suggestionCount,
    );

    return {
      components: listPayload.components,
      payload: updatedPayload,
      pageIssues,
    };
  }

  private async renderTodoListPage(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    payloadToken: string,
    page: number,
  ): Promise<void> {
    const listPayload = await this.buildTodoListPayload(payloadToken, page);
    if (!listPayload) {
      if (parseTodoPayloadToken(payloadToken)) {
        await safeReply(
          interaction,
          buildTodoTextReply(
            "Could not load issues for this repository. The bot's GitHub App may not " +
              "have access to it.",
            true,
          ),
        );
      } else {
        await replyTodoExpired(interaction);
      }
      return;
    }

    await safeUpdate(interaction, {
      components: listPayload.components,
      flags: buildComponentsV2Flags(!listPayload.payload.isPublic),
    });
  }

  @ButtonComponent({ id: /^todo-list-page:[^:]+:\d+$/ })
  async listPage(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoListCustomId(interaction.customId);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }
    await this.renderTodoListPage(interaction, parsed.payloadToken, parsed.page);
  }

  @ButtonComponent({ id: /^todo-list-back:[^:]+:\d+$/ })
  async listBack(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoListBackId(interaction.customId);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }
    await this.renderTodoListPage(interaction, parsed.payloadToken, parsed.page);
  }

  @ButtonComponent({ id: /^todo-create-button:[^:]+:\d+$/ })
  async createFromList(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoCreateButtonId(interaction.customId, TODO_CREATE_BUTTON_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const ok = await requireModeratorOrAdminOrOwner(interaction);
    if (!ok) return;

    const modal = new ModalBuilder()
      .setCustomId(
        buildTodoCreateModalId(
          parsed.payloadToken,
          parsed.page,
          interaction.channelId,
          interaction.message?.id ?? "",
        ),
      )
      .setTitle("Create GitHub Issue");

    modal.addComponents(
      buildTextInputRow({ customId: TODO_CREATE_TITLE_ID, label: "Title", maxLength: 256 }),
      buildTextInputRow({
        customId: TODO_CREATE_BODY_ID,
        label: "Description",
        style: TextInputStyle.Paragraph,
        maxLength: DISCORD_TEXT_INPUT_MAX,
      }),
    );
    modal.addLabelComponents((label) =>
      label
        .setLabel("Issue Type(s)")
        .setDescription("Select one or more issue types")
        .setStringSelectMenuComponent((builder) =>
          builder
            .setCustomId(TODO_CREATE_TYPE_ID)
            .setPlaceholder("Select type(s)")
            .setMinValues(1)
            .setMaxValues(TODO_CREATE_TYPE_LABELS.length)
            .addOptions(
              TODO_CREATE_TYPE_LABELS.map((typeLabel) => ({
                label: typeLabel,
                value: typeLabel,
              })),
            )),
    );

    await interaction.showModal(modal);
  }

  @ButtonComponent({ id: /^todo-close-button:[^:]+:\d+$/ })
  async closeFromList(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoCloseId(interaction.customId, TODO_CLOSE_BUTTON_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    const listPayload = await this.buildTodoListPayload(parsed.payloadToken, parsed.page);
    if (!listPayload) {
      await replyTodoExpired(interaction);
      return;
    }
    if (listPayload.pageIssues.length === 0) {
      await safeReply(
        interaction,
        buildTodoTextReply("No issues to close on this page.", true),
      );
      return;
    }

    const channelId = interaction.channelId;
    const messageId = interaction.message?.id ?? "";
    const select = new StringSelectMenuBuilder()
      .setCustomId(buildTodoCloseSelectId(parsed.payloadToken, parsed.page, channelId, messageId))
      .setPlaceholder("Select an issue to close")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        listPayload.pageIssues.map((issue) => ({
          label: issue.title.slice(0, 100),
          value: String(issue.number),
        })),
      );
    const selectRow = buildSelectRow(select);

    const cancelRow = buildButtonRow(
      buildActionButton({
        customId: buildTodoCloseCancelId(parsed.payloadToken, parsed.page),
        label: "Cancel",
        style: ButtonStyle.Secondary,
      }),
    );

    await safeReply(
      interaction,
      buildTodoTextReply("Choose an issue to close.", true, [selectRow, cancelRow]),
    );
  }

  @SelectMenuComponent({ id: /^todo-repo-select:[^:]+:\d+$/ })
  async repoSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseTodoSelectId(interaction.customId, TODO_REPO_SELECT_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      await replyTodoExpired(interaction);
      return;
    }

    const selected = interaction.values[0];
    basePayload.repo = isTodoRepoCode(selected) ? selected : DEFAULT_TODO_REPO_CODE;

    const nextToken = buildTodoPayloadToken(basePayload, TODO_PAYLOAD_TOKEN_MAX_LENGTH);
    await this.renderTodoListPage(interaction, nextToken, 1);
  }

  @SelectMenuComponent({ id: /^todo-open-select:[^:]+:\d+$/ })
  async openSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseTodoSelectId(interaction.customId, TODO_OPEN_SELECT_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      await replyTodoExpired(interaction);
      return;
    }

    const issueNumber = Number(interaction.values[0]);
    if (!issueNumber) {
      await replyTodoExpired(interaction);
      return;
    }

    const repo = getRepoTarget(basePayload.repo);
    let issue: IGithubIssue | null;
    let comments: IGithubIssueComment[] = [];
    try {
      issue = await getIssue(issueNumber, repo);
      if (issue) {
        comments = await listIssueComments(issueNumber, repo);
      }
    } catch (err: any) {
      await safeUpdate(
        interaction,
        buildTodoTextReply(getGithubErrorMessage(err), true),
      );
      return;
    }

    if (!issue) {
      await safeUpdate(
        interaction,
        buildTodoTextReply(`Issue #${issueNumber} was not found.`, true),
      );
      return;
    }

    const payload: TodoListPayload = { ...basePayload, page: parsed.page };
    const viewPayload = buildIssueViewComponents(
      issue,
      comments,
      payload,
      parsed.payloadToken,
    );

    await safeUpdate(interaction, {
      components: viewPayload.components,
      flags: buildComponentsV2Flags(!payload.isPublic),
    });
  }

  @SelectMenuComponent({ id: /^todo-close-select:[^:]+:\d+:\d+:\d+$/ })
  async closeSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseTodoCloseSelectId(interaction.customId, TODO_CLOSE_SELECT_PREFIX);
    if (!parsed) {
      await safeUpdate(
        interaction,
        buildTodoTextReply("This close menu expired.", true),
      );
      return;
    }

    await safeDeferUpdate(interaction);

    const ok = await requireOwner(interaction);
    if (!ok) return;

    const issueNumber = Number(interaction.values[0]);
    if (!issueNumber) {
      await safeUpdate(
        interaction,
        buildTodoTextReply("Invalid issue selection.", true),
      );
      return;
    }

    const closeRepo = getRepoTarget(
      parseTodoPayloadToken(parsed.payloadToken)?.repo ?? DEFAULT_TODO_REPO_CODE,
    );
    let closed: IGithubIssue | null;
    try {
      closed = await closeIssue(issueNumber, closeRepo);
    } catch (err: any) {
      await safeUpdate(
        interaction,
        buildTodoTextReply(getGithubErrorMessage(err), true),
      );
      return;
    }

    if (!closed) {
      await safeUpdate(
        interaction,
        buildTodoTextReply(`Issue #${issueNumber} was not found.`, true),
      );
      return;
    }

    const listPayload = await this.buildTodoListPayload(parsed.payloadToken, parsed.page);
    if (!listPayload) {
      return;
    }

    const channel = interaction.client.channels.cache.get(parsed.channelId);
    if (!channel || !("messages" in channel)) {
      return;
    }

    try {
      const message = await (channel as any).messages.fetch(parsed.messageId);
      await message.edit({
        components: listPayload.components,
      });
    } catch {
      // ignore refresh failures
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }

  @SelectMenuComponent({ id: /^todo-label-edit-select:[^:]+:\d+:\d+:\d+:\d+$/ })
  async labelEditSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseTodoLabelEditSelectId(
      interaction.customId,
      TODO_LABEL_EDIT_SELECT_PREFIX,
    );
    if (!parsed) {
      await safeReply(interaction, buildTodoTextReply("This label editor expired.", true));
      return;
    }

    const ok = await requireModeratorOrAdminOrOwner(interaction);
    if (!ok) return;

    await safeDeferUpdate(interaction);

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      await replyTodoExpired(interaction);
      return;
    }
    const repo = getRepoTarget(basePayload.repo);

    const selectedLabels = interaction.values
      .map((value) => TODO_LABELS.find((label) => label === value))
      .filter((label): label is TodoLabel => Boolean(label));

    let updated: IGithubIssue | null;
    try {
      updated = await setIssueLabels(parsed.issueNumber, selectedLabels, repo);
    } catch (err: any) {
      await safeUpdate(
        interaction,
        buildTodoTextReply(getGithubErrorMessage(err), true),
      );
      return;
    }

    if (!updated) {
      await safeUpdate(
        interaction,
        buildTodoTextReply(`Issue #${parsed.issueNumber} was not found.`, true),
      );
      return;
    }

    let issue: IGithubIssue | null;
    let comments: IGithubIssueComment[] = [];
    try {
      issue = await getIssue(parsed.issueNumber, repo);
      if (issue) {
        comments = await listIssueComments(parsed.issueNumber, repo);
      }
    } catch {
      issue = null;
    }

    if (issue) {
      const payload: TodoListPayload = { ...basePayload, page: parsed.page };

      const viewPayload = buildIssueViewComponents(
        issue,
        comments,
        payload,
        parsed.payloadToken,
      );

      const channel = interaction.client.channels.cache.get(parsed.channelId);
      if (channel && "messages" in channel) {
        try {
          const message = await (channel as any).messages.fetch(parsed.messageId);
          await message.edit({
            components: viewPayload.components,
          });
        } catch {
          // ignore refresh failures
        }
      }
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }

  @ButtonComponent({ id: /^todo-close-cancel:[^:]+:\d+$/ })
  async closeCancel(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoCloseId(interaction.customId, TODO_CLOSE_CANCEL_PREFIX);
    if (!parsed) {
      await safeUpdate(
        interaction,
        buildTodoTextReply("This close menu expired.", true),
      );
      return;
    }

    await safeUpdate(interaction, buildTodoTextReply("Close issue cancelled.", true));
  }

  @ModalComponent({ id: /^todo-create-modal:[^:]+:\d+:\d+:\d+$/ })
  async submitCreateModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseTodoCreateModalId(interaction.customId, TODO_CREATE_MODAL_PREFIX);
    if (!parsed) {
      await safeReply(interaction, buildTodoTextReply("This create form expired.", true));
      return;
    }

    const ok = await requireModeratorOrAdminOrOwner(interaction);
    if (!ok) return;

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const rawTitle = interaction.fields.getTextInputValue(TODO_CREATE_TITLE_ID);
    const rawBody = interaction.fields.getTextInputValue(TODO_CREATE_BODY_ID);
    const selectedTypes = parseTodoCreateTypeLabels(
      interaction.fields.getStringSelectValues(TODO_CREATE_TYPE_ID),
    );
    const trimmedTitle = sanitizeTodoRichText(rawTitle).trim();
    if (!trimmedTitle) {
      await safeReply(interaction, buildTodoTextReply("Title cannot be empty.", true));
      return;
    }

    const trimmedBody = rawBody
      ? sanitizeTodoRichText(rawBody)
      : "";
    if (!trimmedBody.trim()) {
      await safeReply(
        interaction,
        buildTodoTextReply("Description cannot be empty.", true),
      );
      return;
    }

    if (selectedTypes.length === 0) {
      await safeReply(
        interaction,
        buildTodoTextReply("Select at least one issue type.", true),
      );
      return;
    }

    const baseBody = trimmedBody;
    const isOwner = interaction.guild?.ownerId === interaction.user.id;
    const prefixedBody = isOwner ? baseBody : `${interaction.user.username}: ${baseBody}`;
    const finalBody = prefixedBody.length ? prefixedBody.slice(0, DISCORD_TEXT_INPUT_MAX) : null;

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      await replyTodoExpired(interaction);
      return;
    }
    const repo = getRepoTarget(basePayload.repo);

    let created: IGithubIssue;
    try {
      created = await createIssue({
        title: trimmedTitle,
        body: finalBody,
        labels: selectedTypes,
      }, repo);
    } catch (err: any) {
      await safeReply(interaction, buildTodoTextReply(getGithubErrorMessage(err), true));
      return;
    }

    const payload: TodoListPayload = { ...basePayload, page: parsed.page };
    const viewPayload = buildIssueViewComponents(
      created,
      [],
      payload,
      parsed.payloadToken,
    );

    const channel = interaction.client.channels.cache.get(parsed.channelId);
    if (channel && "messages" in channel) {
      try {
        const message = await (channel as any).messages.fetch(parsed.messageId);
        await message.edit({
          components: viewPayload.components,
        });
      } catch {
        // ignore refresh failures
      }
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }

  @ModalComponent({ id: /^todo-comment-modal:[^:]+:\d+:\d+:\d+:\d+$/ })
  async submitCommentModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseTodoIssueModalId(interaction.customId, TODO_COMMENT_MODAL_PREFIX);
    if (!parsed) {
      await safeReply(interaction, buildTodoTextReply("This comment form expired.", true));
      return;
    }

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const rawComment = interaction.fields.getTextInputValue(TODO_COMMENT_INPUT_ID);
    const finalCommentBody = sanitizeTodoRichText(rawComment);
    if (!finalCommentBody.trim()) {
      await safeReply(interaction, buildTodoTextReply("Comment cannot be empty.", true));
      return;
    }

    const prefixedComment = `${interaction.user.username}: ${finalCommentBody}`.slice(
      0,
      DISCORD_TEXT_INPUT_MAX,
    );

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }
    const repo = getRepoTarget(basePayload.repo);

    try {
      await addComment(parsed.issueNumber, prefixedComment, repo);
    } catch (err: any) {
      await safeReply(interaction, buildTodoTextReply(getGithubErrorMessage(err), true));
      return;
    }

    let issue: IGithubIssue | null;
    let comments: IGithubIssueComment[] = [];
    try {
      issue = await getIssue(parsed.issueNumber, repo);
      if (issue) {
        comments = await listIssueComments(parsed.issueNumber, repo);
      }
    } catch {
      issue = null;
    }

    if (!issue) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }

    const payload: TodoListPayload = { ...basePayload, page: parsed.page };

    const viewPayload = buildIssueViewComponents(
      issue,
      comments,
      payload,
      parsed.payloadToken,
    );

    const channel = interaction.client.channels.cache.get(parsed.channelId);
    if (!channel || !("messages" in channel)) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }

    try {
      const message = await (channel as any).messages.fetch(parsed.messageId);
      await message.edit({
        components: viewPayload.components,
      });
    } catch {
      // ignore refresh failures
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }

  @ModalComponent({ id: /^todo-edit-view-modal:[^:]+:\d+:\d+:\d+:\d+$/ })
  async submitEditViewModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseTodoIssueModalId(interaction.customId, TODO_EDIT_VIEW_MODAL_PREFIX);
    if (!parsed) {
      await safeReply(interaction, buildTodoTextReply("This edit prompt expired.", true));
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const rawTitle = interaction.fields.getTextInputValue(TODO_CREATE_TITLE_ID);
    const rawBody = interaction.fields.getTextInputValue(TODO_CREATE_BODY_ID);
    const selectedTypes = parseTodoCreateTypeLabels(
      interaction.fields.getStringSelectValues(TODO_CREATE_TYPE_ID),
    );
    const trimmedTitle = sanitizeTodoRichText(rawTitle).trim();
    if (!trimmedTitle) {
      await safeReply(interaction, buildTodoTextReply("Title cannot be empty.", true));
      return;
    }

    const trimmedBody = sanitizeTodoRichText(rawBody);
    if (!trimmedBody.trim()) {
      await safeReply(
        interaction,
        buildTodoTextReply("Description cannot be empty.", true),
      );
      return;
    }

    if (selectedTypes.length === 0) {
      await safeReply(
        interaction,
        buildTodoTextReply("Select at least one issue type.", true),
      );
      return;
    }

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      await replyTodoExpired(interaction);
      return;
    }
    const repo = getRepoTarget(basePayload.repo);

    try {
      await updateIssue(parsed.issueNumber, {
        title: trimmedTitle,
        body: trimmedBody.slice(0, DISCORD_TEXT_INPUT_MAX),
      }, repo);
      await setIssueLabels(parsed.issueNumber, selectedTypes, repo);
    } catch (err: any) {
      await safeReply(interaction, buildTodoTextReply(getGithubErrorMessage(err), true));
      return;
    }

    let issue: IGithubIssue | null;
    let comments: IGithubIssueComment[] = [];
    try {
      issue = await getIssue(parsed.issueNumber, repo);
      if (issue) {
        comments = await listIssueComments(parsed.issueNumber, repo);
      }
    } catch {
      issue = null;
    }

    if (!issue) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }

    const payload: TodoListPayload = { ...basePayload, page: parsed.page };

    const viewPayload = buildIssueViewComponents(
      issue,
      comments,
      payload,
      parsed.payloadToken,
    );

    const channel = interaction.client.channels.cache.get(parsed.channelId);
    if (channel && "messages" in channel) {
      try {
        const message = await (channel as any).messages.fetch(parsed.messageId);
        await message.edit({
          components: viewPayload.components,
        });
      } catch {
        // ignore refresh failures
      }
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }

  @ModalComponent({ id: /^todo-edit-title-modal:[^:]+:\d+:\d+:\d+:\d+$/ })
  async submitEditTitleModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseTodoIssueModalId(interaction.customId, TODO_EDIT_TITLE_MODAL_PREFIX);
    if (!parsed) {
      await safeReply(interaction, buildTodoTextReply("This edit prompt expired.", true));
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const rawTitle = interaction.fields.getTextInputValue(TODO_EDIT_TITLE_INPUT_ID);
    const trimmedTitle = sanitizeTodoRichText(rawTitle).trim();
    if (!trimmedTitle) {
      await safeReply(interaction, buildTodoTextReply("Title cannot be empty.", true));
      return;
    }

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      await replyTodoExpired(interaction);
      return;
    }
    const repo = getRepoTarget(basePayload.repo);

    try {
      await updateIssue(parsed.issueNumber, {
        title: trimmedTitle,
      }, repo);
    } catch (err: any) {
      await safeReply(interaction, buildTodoTextReply(getGithubErrorMessage(err), true));
      return;
    }

    let issue: IGithubIssue | null;
    let comments: IGithubIssueComment[] = [];
    try {
      issue = await getIssue(parsed.issueNumber, repo);
      if (issue) {
        comments = await listIssueComments(parsed.issueNumber, repo);
      }
    } catch {
      issue = null;
    }

    if (!issue) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }

    const payload: TodoListPayload = { ...basePayload, page: parsed.page };

    const viewPayload = buildIssueViewComponents(
      issue,
      comments,
      payload,
      parsed.payloadToken,
    );

    const channel = interaction.client.channels.cache.get(parsed.channelId);
    if (channel && "messages" in channel) {
      try {
        const message = await (channel as any).messages.fetch(parsed.messageId);
        await message.edit({
          components: viewPayload.components,
        });
      } catch {
        // ignore refresh failures
      }
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }

  @ModalComponent({ id: /^todo-edit-desc-modal:[^:]+:\d+:\d+:\d+:\d+$/ })
  async submitEditDescriptionModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseTodoIssueModalId(interaction.customId, TODO_EDIT_DESC_MODAL_PREFIX);
    if (!parsed) {
      await safeReply(interaction, buildTodoTextReply("This edit prompt expired.", true));
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const rawBody = interaction.fields.getTextInputValue(TODO_EDIT_DESC_INPUT_ID);
    const trimmedBody = sanitizeTodoRichText(rawBody);
    if (!trimmedBody.trim()) {
      await safeReply(
        interaction,
        buildTodoTextReply("Description cannot be empty.", true),
      );
      return;
    }

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      await replyTodoExpired(interaction);
      return;
    }
    const repo = getRepoTarget(basePayload.repo);

    try {
      await updateIssue(parsed.issueNumber, {
        body: trimmedBody.slice(0, DISCORD_TEXT_INPUT_MAX),
      }, repo);
    } catch (err: any) {
      await safeReply(interaction, buildTodoTextReply(getGithubErrorMessage(err), true));
      return;
    }

    let issue: IGithubIssue | null;
    let comments: IGithubIssueComment[] = [];
    try {
      issue = await getIssue(parsed.issueNumber, repo);
      if (issue) {
        comments = await listIssueComments(parsed.issueNumber, repo);
      }
    } catch {
      issue = null;
    }

    if (!issue) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }
    const payload: TodoListPayload = { ...basePayload, page: parsed.page };

    const viewPayload = buildIssueViewComponents(
      issue,
      comments,
      payload,
      parsed.payloadToken,
    );

    const channel = interaction.client.channels.cache.get(parsed.channelId);
    if (channel && "messages" in channel) {
      try {
        const message = await (channel as any).messages.fetch(parsed.messageId);
        await message.edit({
          components: viewPayload.components,
        });
      } catch {
        // ignore refresh failures
      }
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }

  @ModalComponent({ id: /^todo-filter-modal:[^:]+:\d+:\d+:\d+$/ })
  async submitFilterModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseTodoFilterModalId(interaction.customId, TODO_FILTER_MODAL_PREFIX);
    if (!parsed) {
      await safeReply(interaction, buildTodoTextReply("This filter prompt expired.", true));
      return;
    }

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      await replyTodoExpired(interaction);
      return;
    }

    const stateValue = interaction.fields.getStringSelectValues(TODO_FILTER_STATE_ID)[0];
    const labelValue = interaction.fields.getStringSelectValues(TODO_FILTER_LABEL_ID)[0];
    const sortValue = interaction.fields.getStringSelectValues(TODO_FILTER_SORT_ID)[0];
    const rawQuery = interaction.fields.getTextInputValue(TODO_FILTER_QUERY_ID);

    const stateFilters = normalizeStateFilters(
      stateValue === "all" ? ["open", "closed"] : [stateValue as ListState],
    );
    basePayload.stateFilters = stateFilters;
    basePayload.state = toIssueState(stateFilters);

    if (labelValue === TODO_FILTER_LABEL_NOT_BLOCKED) {
      basePayload.labels = [];
      basePayload.excludeBlocked = true;
    } else if (labelValue && labelValue !== TODO_FILTER_LABEL_ALL
      && TODO_LABELS.includes(labelValue as TodoLabel)) {
      basePayload.labels = [labelValue as TodoLabel];
      basePayload.excludeBlocked = false;
    } else {
      basePayload.labels = [];
      basePayload.excludeBlocked = false;
    }

    basePayload.query = normalizeQuery(rawQuery);
    basePayload.direction = sortValue === "asc" ? "asc" : "desc";

    const nextToken = buildTodoPayloadToken(basePayload, TODO_PAYLOAD_TOKEN_MAX_LENGTH);
    const listPayload = await this.buildTodoListPayload(nextToken, 1);
    if (!listPayload) {
      await replyTodoExpired(interaction);
      return;
    }

    const channel = interaction.client.channels.cache.get(parsed.channelId);
    if (channel && "messages" in channel) {
      try {
        const message = await (channel as any).messages.fetch(parsed.messageId);
        await message.edit({
          components: listPayload.components,
        });
      } catch {
        // ignore refresh failures
      }
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }

  @ButtonComponent({ id: /^todo-view:[^:]+:\d+:\d+$/ })
  async viewFromList(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoViewId(interaction.customId);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      await replyTodoExpired(interaction);
      return;
    }
    const repo = getRepoTarget(basePayload.repo);

    let issue: IGithubIssue | null;
    let comments: IGithubIssueComment[] = [];
    try {
      issue = await getIssue(parsed.issueNumber, repo);
      if (issue) {
        comments = await listIssueComments(parsed.issueNumber, repo);
      }
    } catch (err: any) {
      await safeUpdate(
        interaction,
        buildTodoTextReply(getGithubErrorMessage(err), true),
      );
      return;
    }

    if (!issue) {
      await safeUpdate(
        interaction,
        buildTodoTextReply(`Issue #${parsed.issueNumber} was not found.`, true),
      );
      return;
    }

    const payload: TodoListPayload = { ...basePayload, page: parsed.page };
    const viewPayload = buildIssueViewComponents(
      issue,
      comments,
      payload,
      parsed.payloadToken,
    );

    await safeUpdate(interaction, {
      components: viewPayload.components,
      flags: buildComponentsV2Flags(!payload.isPublic),
    });
  }

  @ButtonComponent({ id: /^todo-close-view:[^:]+:\d+:\d+$/ })
  async closeFromView(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoCloseViewId(interaction.customId, TODO_CLOSE_VIEW_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    await safeDeferUpdate(interaction);

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      await replyTodoExpired(interaction);
      return;
    }
    const repo = getRepoTarget(basePayload.repo);

    let closed: IGithubIssue | null;
    try {
      closed = await closeIssue(parsed.issueNumber, repo);
    } catch (err: any) {
      await safeUpdate(
        interaction,
        buildTodoTextReply(getGithubErrorMessage(err), true),
      );
      return;
    }

    if (!closed) {
      await safeUpdate(
        interaction,
        buildTodoTextReply(`Issue #${parsed.issueNumber} was not found.`, true),
      );
      return;
    }

    let comments: IGithubIssueComment[] = [];
    try {
      comments = await listIssueComments(parsed.issueNumber, repo);
    } catch {
      comments = [];
    }

    const payload: TodoListPayload = { ...basePayload, page: parsed.page };
    const viewPayload = buildIssueViewComponents(
      closed,
      comments,
      payload,
      parsed.payloadToken,
    );

    try {
      await interaction.message.edit({
        components: viewPayload.components,
      });
    } catch {
      await replyTodoExpired(interaction);
      return;
    }
  }

  @ButtonComponent({ id: /^todo-reopen-view:[^:]+:\d+:\d+$/ })
  async reopenFromView(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoReopenViewId(interaction.customId, TODO_REOPEN_VIEW_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    await safeDeferUpdate(interaction);

    const reopenRepo = getRepoTarget(
      parseTodoPayloadToken(parsed.payloadToken)?.repo ?? DEFAULT_TODO_REPO_CODE,
    );
    let reopened: IGithubIssue | null;
    try {
      reopened = await reopenIssue(parsed.issueNumber, reopenRepo);
    } catch (err: any) {
      await safeUpdate(
        interaction,
        buildTodoTextReply(getGithubErrorMessage(err), true),
      );
      return;
    }

    if (!reopened) {
      await safeUpdate(
        interaction,
        buildTodoTextReply(`Issue #${parsed.issueNumber} was not found.`, true),
      );
      return;
    }

    const listPayload = await this.buildTodoListPayload(parsed.payloadToken, parsed.page);
    if (!listPayload) {
      await replyTodoExpired(interaction);
      return;
    }

    try {
      await interaction.message.edit({
        components: listPayload.components,
      });
    } catch {
      await replyTodoExpired(interaction);
      return;
    }
  }

  @ButtonComponent({ id: /^todo-label-edit-button:[^:]+:\d+:\d+$/ })
  async editLabelsFromView(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoLabelEditId(interaction.customId, TODO_LABEL_EDIT_BUTTON_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const ok = await requireModeratorOrAdminOrOwner(interaction);
    if (!ok) return;

    const labelRepo = getRepoTarget(
      parseTodoPayloadToken(parsed.payloadToken)?.repo ?? DEFAULT_TODO_REPO_CODE,
    );
    let issue: IGithubIssue | null;
    try {
      issue = await getIssue(parsed.issueNumber, labelRepo);
    } catch (err: any) {
      await safeReply(interaction, buildTodoTextReply(getGithubErrorMessage(err), true));
      return;
    }

    if (!issue) {
      await safeReply(
        interaction,
        buildTodoTextReply(`Issue #${parsed.issueNumber} was not found.`, true),
      );
      return;
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId(
        buildTodoLabelEditSelectId(
          parsed.payloadToken,
          parsed.page,
          parsed.issueNumber,
          interaction.channelId,
          interaction.message?.id ?? "",
        ),
      )
      .setPlaceholder("Select Label(s)...")
      .setMinValues(0)
      .setMaxValues(TODO_LABELS.length)
      .addOptions(
        TODO_LABELS.map((label) => ({
          label,
          value: label,
          default: issue.labels.includes(label),
        })),
      );

    await safeReply(
      interaction,
      buildTodoTextReply("Select labels to apply to this issue.", true, [
        buildSelectRow(select),
      ]),
    );
  }

  @ButtonComponent({ id: /^todo-filter-button:[^:]+:\d+$/ })
  async filterFromList(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoFilterButtonId(interaction.customId, TODO_FILTER_BUTTON_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      await replyTodoExpired(interaction);
      return;
    }

    const currentLabelValue: string = basePayload.excludeBlocked
      ? TODO_FILTER_LABEL_NOT_BLOCKED
      : basePayload.labels[0] ?? TODO_FILTER_LABEL_ALL;

    const modal = new ModalBuilder()
      .setCustomId(
        buildTodoFilterModalId(
          parsed.payloadToken,
          parsed.page,
          interaction.channelId,
          interaction.message?.id ?? "",
        ),
      )
      .setTitle("Filter Issues");

    modal.addLabelComponents((label) =>
      label
        .setLabel("Issue State")
        .setStringSelectMenuComponent((builder) =>
          builder
            .setCustomId(TODO_FILTER_STATE_ID)
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions([
              { label: "Open", value: "open", default: basePayload.state === "open" },
              { label: "Closed", value: "closed", default: basePayload.state === "closed" },
              { label: "All", value: "all", default: basePayload.state === "all" },
            ])));

    modal.addLabelComponents((label) =>
      label
        .setLabel("Label")
        .setStringSelectMenuComponent((builder) =>
          builder
            .setCustomId(TODO_FILTER_LABEL_ID)
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions([
              {
                label: "All",
                value: TODO_FILTER_LABEL_ALL,
                default: currentLabelValue === TODO_FILTER_LABEL_ALL,
              },
              {
                label: "Not Blocked",
                value: TODO_FILTER_LABEL_NOT_BLOCKED,
                default: currentLabelValue === TODO_FILTER_LABEL_NOT_BLOCKED,
              },
              ...TODO_LABELS.map((todoLabel) => ({
                label: todoLabel,
                value: todoLabel,
                default: currentLabelValue === todoLabel,
              })),
            ])));

    modal.addLabelComponents((label) =>
      label
        .setLabel("Search Query")
        .setTextInputComponent((builder) => {
          builder
            .setCustomId(TODO_FILTER_QUERY_ID)
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(200);
          if (basePayload.query) builder.setValue(basePayload.query);
          return builder;
        }));

    modal.addLabelComponents((label) =>
      label
        .setLabel("Sort by Issue Number")
        .setStringSelectMenuComponent((builder) =>
          builder
            .setCustomId(TODO_FILTER_SORT_ID)
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions([
              {
                label: "Descending (newest first)",
                value: "desc",
                default: basePayload.direction !== "asc",
              },
              {
                label: "Ascending (oldest first)",
                value: "asc",
                default: basePayload.direction === "asc",
              },
            ])));

    await interaction.showModal(modal);
  }

  @ButtonComponent({ id: /^todo-edit-view-button:[^:]+:\d+:\d+$/ })
  async editFromView(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoIssueActionId(interaction.customId, TODO_EDIT_VIEW_BUTTON_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    const editRepo = getRepoTarget(
      parseTodoPayloadToken(parsed.payloadToken)?.repo ?? DEFAULT_TODO_REPO_CODE,
    );
    let issue: IGithubIssue | null;
    try {
      issue = await getIssue(parsed.issueNumber, editRepo);
    } catch {
      issue = null;
    }

    if (!issue) {
      await safeReply(
        interaction,
        buildTodoTextReply(`Issue #${parsed.issueNumber} was not found.`, true),
      );
      return;
    }
    const issueLabelSet = new Set(issue.labels.map((label) => label.toLowerCase()));

    const modal = new ModalBuilder()
      .setCustomId(
        buildTodoEditViewModalId(
          parsed.payloadToken,
          parsed.page,
          parsed.issueNumber,
          interaction.channelId,
          interaction.message?.id ?? "",
        ),
      )
      .setTitle("Edit GitHub Issue");

    modal.addComponents(
      buildTextInputRow({
        customId: TODO_CREATE_TITLE_ID,
        label: "Title",
        maxLength: 256,
        value: issue.title,
      }),
      buildTextInputRow({
        customId: TODO_CREATE_BODY_ID,
        label: "Description",
        style: TextInputStyle.Paragraph,
        maxLength: DISCORD_TEXT_INPUT_MAX,
        value: issue.body?.slice(0, DISCORD_TEXT_INPUT_MAX) || undefined,
      }),
    );
    modal.addLabelComponents((label) =>
      label
        .setLabel("Issue Type(s)")
        .setDescription("Select one or more issue types")
        .setStringSelectMenuComponent((builder) =>
          builder
            .setCustomId(TODO_CREATE_TYPE_ID)
            .setPlaceholder("Select type(s)")
            .setMinValues(1)
            .setMaxValues(TODO_CREATE_TYPE_LABELS.length)
            .addOptions(
              TODO_CREATE_TYPE_LABELS.map((typeLabel) => ({
                label: typeLabel,
                value: typeLabel,
                default: issueLabelSet.has(typeLabel.toLowerCase()),
              })),
            )),
    );

    await interaction.showModal(modal);
  }

  @ButtonComponent({ id: /^todo-comment-button:[^:]+:\d+:\d+$/ })
  async addCommentFromView(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoIssueActionId(interaction.customId, TODO_COMMENT_BUTTON_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(
        buildTodoCommentModalId(
          parsed.payloadToken,
          parsed.page,
          parsed.issueNumber,
          interaction.channelId,
          interaction.message?.id ?? "",
        ),
      )
      .setTitle("Add Comment");

    modal.addComponents(buildTextInputRow({
      customId: TODO_COMMENT_INPUT_ID,
      label: "Comment",
      style: TextInputStyle.Paragraph,
      maxLength: DISCORD_TEXT_INPUT_MAX,
    }));

    await interaction.showModal(modal);
  }

  @ButtonComponent({ id: /^todo-edit-title-button:[^:]+:\d+:\d+$/ })
  async editTitleFromView(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoIssueActionId(interaction.customId, TODO_EDIT_TITLE_BUTTON_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    const titleRepo = getRepoTarget(
      parseTodoPayloadToken(parsed.payloadToken)?.repo ?? DEFAULT_TODO_REPO_CODE,
    );
    let issue: IGithubIssue | null;
    try {
      issue = await getIssue(parsed.issueNumber, titleRepo);
    } catch {
      issue = null;
    }

    if (!issue) {
      await safeReply(
        interaction,
        buildTodoTextReply(`Issue #${parsed.issueNumber} was not found.`, true),
      );
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(
        buildTodoEditTitleModalId(
          parsed.payloadToken,
          parsed.page,
          parsed.issueNumber,
          interaction.channelId,
          interaction.message?.id ?? "",
        ),
      )
      .setTitle("Edit Title");

    modal.addComponents(buildTextInputRow({
      customId: TODO_EDIT_TITLE_INPUT_ID,
      label: "Title",
      maxLength: 256,
      value: issue.title,
    }));

    await interaction.showModal(modal);
  }

  @ButtonComponent({ id: /^todo-edit-desc-button:[^:]+:\d+:\d+$/ })
  async editDescriptionFromView(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoIssueActionId(interaction.customId, TODO_EDIT_DESC_BUTTON_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    const descRepo = getRepoTarget(
      parseTodoPayloadToken(parsed.payloadToken)?.repo ?? DEFAULT_TODO_REPO_CODE,
    );
    let issue: IGithubIssue | null;
    try {
      issue = await getIssue(parsed.issueNumber, descRepo);
    } catch {
      issue = null;
    }

    if (!issue) {
      await safeReply(
        interaction,
        buildTodoTextReply(`Issue #${parsed.issueNumber} was not found.`, true),
      );
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(
        buildTodoEditDescModalId(
          parsed.payloadToken,
          parsed.page,
          parsed.issueNumber,
          interaction.channelId,
          interaction.message?.id ?? "",
        ),
      )
      .setTitle("Edit Description");

    modal.addComponents(buildTextInputRow({
      customId: TODO_EDIT_DESC_INPUT_ID,
      label: "Description",
      style: TextInputStyle.Paragraph,
      maxLength: DISCORD_TEXT_INPUT_MAX,
      value: issue.body?.slice(0, DISCORD_TEXT_INPUT_MAX) || undefined,
    }));

    await interaction.showModal(modal);
  }

}
