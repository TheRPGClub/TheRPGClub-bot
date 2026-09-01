import type { IGithubIssue, IGithubIssueComment } from "../../services/GithubIssuesService.js";
import { getTodoRepo } from "../../config/repos.js";
import type { TodoRepoCode } from "../../config/repos.js";
import { formatDiscordTimestamp } from "../../functions/DateFormatUtils.js";
import { truncateWithEllipsis } from "../../utilities/ValidationUtils.js";
import { renderTodoContent } from "./todoRenderers.js";
import { MAX_COMMENT_PREVIEW_LENGTH } from "./todoTypes.js";
import { buildMaskedLink } from "../../functions/ComponentsV2Utils.js";

export function buildIssueListTitle(repo: TodoRepoCode): string {
  const target = getTodoRepo(repo);
  return `${target.name} GitHub Issues`;
}

export function getGithubErrorMessage(error: any): string {
  const status = error?.response?.status as number | undefined;
  const message = error?.response?.data?.message as string | undefined;
  const errorMessage = error?.message as string | undefined;

  const outputParts: string[] = [];
  if (status) {
    outputParts.push(`Github status: ${status}`);
  }
  if (message) {
    outputParts.push(`Github error: ${message}`);
  } else if (errorMessage) {
    outputParts.push(`Github error: ${errorMessage}`);
  }

  if (outputParts.length) {
    return outputParts.join("\n");
  }
  return "GitHub request failed. Check the GitHub App configuration.";
}

export function formatIssueLink(issue: IGithubIssue): string {
  const labelText = issue.labels.length ? ` [${issue.labels.join(", ")}]` : "";
  const linkText = `#${issue.number}: ${issue.title}`;
  if (issue.htmlUrl) {
    return `${buildMaskedLink(linkText, issue.htmlUrl)}${labelText}`;
  }
  return `${linkText}${labelText}`;
}

export function formatIssueTitle(issue: IGithubIssue): string {
  const labelText = issue.labels.length ? ` [${issue.labels.join(", ")}]` : "";
  return `#${issue.number}: ${issue.title}${labelText}`;
}

export function formatIssueSelectLabel(issue: IGithubIssue): string {
  const labelText = issue.labels.length ? ` [${issue.labels.join(", ")}]` : "";
  const text = `#${issue.number} ${issue.title}${labelText}`;
  return truncateWithEllipsis(text, 100);
}

export function buildIssueCommentsDisplay(comments: IGithubIssueComment[]): {
  text: string;
  imageUrls: string[];
} {
  if (!comments.length) {
    return { text: "", imageUrls: [] };
  }

  const lines: string[] = ["**Comments:**"];
  const imageUrls: string[] = [];
  comments.forEach((comment) => {
    const author = comment.author ?? "Unknown";
    const createdAt = formatDiscordTimestamp(comment.createdAt);
    const rendered = renderTodoContent(comment.body, MAX_COMMENT_PREVIEW_LENGTH);
    imageUrls.push(...rendered.imageUrls);
    lines.push(`**${author}** ${createdAt}`);
    if (rendered.text) {
      lines.push(rendered.text);
    } else if (rendered.imageUrls.length) {
      lines.push("*Image-only comment.*");
    } else {
      lines.push("*No comment content.*");
    }
  });

  return {
    text: lines.join("\n"),
    imageUrls,
  };
}
