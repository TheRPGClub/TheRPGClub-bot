import type { ActionRowBuilder, ButtonBuilder } from "discord.js";
import {
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import { ContainerBuilder, TextDisplayBuilder } from "@discordjs/builders";
import type { IGithubIssue, IGithubIssueComment } from "../../services/GithubIssuesService.js";
import { getTodoRepo, TODO_REPO_CODES } from "../../config/repos.js";
import { buildTextReply, safeV2TextContent } from "../../functions/ComponentsV2Utils.js";
import {
  buildActionButton,
  buildButtonRow,
  buildSelectRow,
} from "../../functions/uiComponents.js";
import { AnyRepliable, safeReply } from "../../functions/InteractionUtils.js";
import { formatDiscordTimestamp } from "../../functions/DateFormatUtils.js";
import { DISCORD_TEXT_INPUT_MAX } from "../../config/textLimits.js";
import {
  TODO_REVIEW_SUGGESTIONS_BUTTON_ID,
  type TodoListPayload,
} from "./todoTypes.js";
import {
  buildTodoFilterButtonId,
  buildTodoCreateButtonId,
  buildTodoCloseButtonId,
  buildTodoOpenSelectId,
  buildTodoRepoSelectId,
  buildTodoListCustomId,
  buildTodoCommentButtonId,
  buildTodoEditViewButtonId,
  buildTodoCloseViewId,
  buildTodoReopenViewId,
  buildTodoListBackId,
} from "./todoCustomIds.js";
import {
  buildIssueListTitle,
  formatIssueLink,
  formatIssueSelectLabel,
  formatIssueTitle,
  buildIssueCommentsDisplay,
} from "./todoFormatters.js";
import {
  renderTodoContent,
  addTextDisplayWithBudget,
  addIssueImagesToContainer,
} from "./todoRenderers.js";

export function buildTodoTextReply(
  content: string,
  isEphemeral: boolean,
  extraComponents: Array<ContainerBuilder | ActionRowBuilder<any>> = [],
): {
  components: Array<ContainerBuilder | ActionRowBuilder<any>>;
  flags: number;
} {
  const textReply = buildTextReply(content, isEphemeral);
  if (extraComponents.length === 0) {
    return textReply;
  }

  return {
    ...textReply,
    components: [...textReply.components, ...extraComponents],
  };
}

export async function replyTodoExpired(interaction: AnyRepliable): Promise<void> {
  await safeReply(
    interaction,
    buildTodoTextReply("This /todo view expired. Run /todo again to refresh it.", true),
  );
}

export function buildIssueListComponents(
  issues: IGithubIssue[],
  totalIssues: number,
  payload: TodoListPayload,
  payloadToken: string,
  suggestionCount: number,
): { components: Array<ContainerBuilder | ActionRowBuilder<any>> } {
  const totalPages = Math.max(1, Math.ceil(totalIssues / payload.perPage));
  const labelSummary = payload.excludeBlocked
    ? "Label: Not Blocked"
    : payload.labels.length
      ? `Label: ${payload.labels.join(", ")}`
      : "Label: Any";
  const summaryParts = [
    `-# Repo: ${getTodoRepo(payload.repo).label}`,
    `State: ${payload.state}`,
    labelSummary,
    payload.query ? `Query: ${payload.query}` : "Query: Any",
    `Sort: # ${payload.direction}`,
    `Page: ${payload.page} of ${totalPages}`,
  ];
  if (suggestionCount > 0) {
    summaryParts.push(`${suggestionCount} suggestions awaiting review`);
  }

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        safeV2TextContent(
          `## ${buildIssueListTitle(payload.repo)}`,
          DISCORD_TEXT_INPUT_MAX,
        ),
      ),
    );

  if (issues.length) {
    issues.forEach((issue) => {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          safeV2TextContent(formatIssueLink(issue), DISCORD_TEXT_INPUT_MAX),
        ),
      );
    });
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("No issues found for this filter."),
    );
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      safeV2TextContent(
        `${summaryParts.join(" | ")} | Total: ${totalIssues}`,
        DISCORD_TEXT_INPUT_MAX,
      ),
    ),
  );

  const filterButton = buildActionButton({
    customId: buildTodoFilterButtonId(payloadToken, payload.page),
    label: "Filter",
    style: ButtonStyle.Secondary,
  });

  const createButton = buildActionButton({
    customId: buildTodoCreateButtonId(payloadToken, payload.page),
    label: "Create Issue",
    style: ButtonStyle.Success,
  });

  const closeButton = buildActionButton({
    customId: buildTodoCloseButtonId(payloadToken, payload.page),
    label: "Close Issue",
    style: ButtonStyle.Danger,
  });

  const actionRowButtons: ButtonBuilder[] = [createButton, closeButton, filterButton];
  if (suggestionCount > 0) {
    actionRowButtons.push(
      buildActionButton({
        customId: TODO_REVIEW_SUGGESTIONS_BUTTON_ID,
        label: "Review Suggestions",
        style: ButtonStyle.Primary,
      }),
    );
  }
  const actionRow = buildButtonRow(...actionRowButtons);

  const components: Array<ContainerBuilder | ActionRowBuilder<any>> = [container];

  if (issues.length) {
    const openSelect = new StringSelectMenuBuilder()
      .setCustomId(buildTodoOpenSelectId(payloadToken, payload.page))
      .setPlaceholder("View an issue...")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        issues.map((issue) => ({
          label: formatIssueSelectLabel(issue),
          value: String(issue.number),
        })),
      );
    components.push(buildSelectRow(openSelect));
  }

  const repoSelect = new StringSelectMenuBuilder()
    .setCustomId(buildTodoRepoSelectId(payloadToken, payload.page))
    .setPlaceholder("Repository...")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      TODO_REPO_CODES.map((code) => {
        const repo = getTodoRepo(code);
        return {
          label: repo.label,
          value: code,
          description: `${repo.owner}/${repo.name}`,
          default: code === payload.repo,
        };
      }),
    );
  components.push(buildSelectRow(repoSelect));
  components.push(actionRow);
  if (totalPages > 1) {
    const prevDisabled = payload.page <= 1;
    const nextDisabled = payload.page >= totalPages;
    const pagingRow = buildButtonRow(
      buildActionButton({
        customId: buildTodoListCustomId(payloadToken, payload.page - 1),
        label: "Prev Page",
        style: ButtonStyle.Secondary,
      }).setDisabled(prevDisabled),
      buildActionButton({
        customId: buildTodoListCustomId(payloadToken, payload.page + 1),
        label: "Next Page",
        style: ButtonStyle.Secondary,
      }).setDisabled(nextDisabled),
    );
    components.push(pagingRow);
  }

  return { components };
}

export function buildIssueViewComponents(
  issue: IGithubIssue,
  comments: IGithubIssueComment[],
  payload: TodoListPayload,
  payloadToken: string,
): { components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>> } {
  const container = new ContainerBuilder();
  const textBudget = { remaining: DISCORD_TEXT_INPUT_MAX };
  const repoTarget = getTodoRepo(payload.repo);
  const repoLabel = `${repoTarget.owner}/${repoTarget.name}`;
  addTextDisplayWithBudget(container, textBudget, `-# ${repoLabel}`);
  const titleText = issue.htmlUrl
    ? `## [${formatIssueTitle(issue)}](${issue.htmlUrl})`
    : `## ${formatIssueTitle(issue)}`;
  addTextDisplayWithBudget(container, textBudget, titleText);

  const issueBody = issue.body ?? "";
  const renderedBody = renderTodoContent(issueBody, DISCORD_TEXT_INPUT_MAX);
  if (renderedBody.text) {
    addTextDisplayWithBudget(container, textBudget, renderedBody.text);
  } else {
    addTextDisplayWithBudget(container, textBudget, "*No description provided.*");
  }

  const commentsDisplay = buildIssueCommentsDisplay(comments);
  if (commentsDisplay.text) {
    addTextDisplayWithBudget(container, textBudget, commentsDisplay.text);
  }
  addIssueImagesToContainer(
    container,
    [...renderedBody.imageUrls, ...commentsDisplay.imageUrls],
    textBudget,
  );

  const assignee = issue.assignee ?? "Unassigned";
  const footerLine = [
    `-# **Repo:** ${repoLabel}`,
    `**State:** ${issue.state}`,
    `**Author:** ${issue.author ?? "Unknown"}`,
    `**Assignee:** ${assignee}`,
    `**Created:** ${formatDiscordTimestamp(issue.createdAt)}`,
    `**Updated:** ${formatDiscordTimestamp(issue.updatedAt)}`,
  ].join(" | ");
  addTextDisplayWithBudget(container, textBudget, footerLine);

  const isOpen = issue.state === "open";
  const stateButton = isOpen
    ? buildActionButton({
        customId: buildTodoCloseViewId(payloadToken, payload.page, issue.number),
        label: "Close Issue",
        style: ButtonStyle.Danger,
      })
    : buildActionButton({
        customId: buildTodoReopenViewId(payloadToken, payload.page, issue.number),
        label: "Reopen Issue",
        style: ButtonStyle.Success,
      });

  const actionRow = buildButtonRow(
    buildActionButton({
      customId: buildTodoCommentButtonId(payloadToken, payload.page, issue.number),
      label: "Add Comment",
      style: ButtonStyle.Primary,
    }),
    buildActionButton({
      customId: buildTodoEditViewButtonId(payloadToken, payload.page, issue.number),
      label: "Edit",
      style: ButtonStyle.Secondary,
    }),
    stateButton,
  );

  const backRow = buildButtonRow(
    buildActionButton({
      customId: buildTodoListBackId(payloadToken, payload.page),
      label: "Back",
      style: ButtonStyle.Secondary,
    }),
  );

  return { components: [container, actionRow, backRow] };
}
