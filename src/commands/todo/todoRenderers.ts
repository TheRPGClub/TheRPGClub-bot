import { TextDisplayBuilder } from "@discordjs/builders";
import { MediaGalleryBuilder, MediaGalleryItemBuilder } from "@discordjs/builders";
import type { ContainerBuilder } from "@discordjs/builders";
import { sanitizeUserInput } from "../../functions/InteractionUtils.js";
import { safeV2TextContent } from "../../functions/ComponentsV2Utils.js";
import { truncateWithEllipsis } from "../../utilities/ValidationUtils.js";
import { DISCORD_TEXT_INPUT_MAX } from "../../config/textLimits.js";
import { MAX_TODO_IMAGES_PER_VIEW } from "./todoTypes.js";

export function sanitizeTodoText(value: string, preserveNewlines: boolean): string {
  return sanitizeUserInput(value, { preserveNewlines, allowUnderscore: true });
}

export function sanitizeTodoRichText(value: string): string {
  return (value ?? "").replace(/\r\n/g, "\n");
}

export function extractImageUrlsFromHtml(text: string): string[] {
  const urls: string[] = [];
  const imageTagPattern = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  let match: RegExpExecArray | null = imageTagPattern.exec(text);
  while (match) {
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    const decoded = raw.replace(/&amp;/gi, "&").trim();
    try {
      const parsed = new URL(decoded);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        urls.push(parsed.toString());
      }
    } catch {
      // ignore invalid image URLs
    }
    match = imageTagPattern.exec(text);
  }
  return urls;
}

export function extractImageUrlsFromMarkdown(text: string): string[] {
  const urls: string[] = [];
  const markdownPattern = /!\[[^\]]*]\((https?:\/\/[^)\s]+(?:\s+"[^"]*")?)\)/gi;
  let match: RegExpExecArray | null = markdownPattern.exec(text);
  while (match) {
    const value = match[1] ?? "";
    const trimmed = value.split(" ")[0]?.trim() ?? "";
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        urls.push(parsed.toString());
      }
    } catch {
      // ignore invalid image URLs
    }
    match = markdownPattern.exec(text);
  }
  return urls;
}

export function extractTodoImageUrls(text: string): string[] {
  const unique = new Set<string>();
  [...extractImageUrlsFromHtml(text), ...extractImageUrlsFromMarkdown(text)]
    .forEach((url) => unique.add(url));
  return Array.from(unique);
}

export function stripInlineImagesForText(value: string): string {
  return value
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/!\[[^\]]*]\((https?:\/\/[^)\s]+(?:\s+"[^"]*")?)\)/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function renderTodoContent(rawValue: string, maxTextLength: number): {
  text: string;
  imageUrls: string[];
} {
  const imageUrls = extractTodoImageUrls(rawValue);
  const plainText = sanitizeTodoRichText(stripInlineImagesForText(rawValue))
    .slice(0, maxTextLength);
  return {
    text: plainText,
    imageUrls,
  };
}

export function clampTextDisplayContent(value: string): string {
  return truncateWithEllipsis(value, DISCORD_TEXT_INPUT_MAX);
}

export function trimToBudget(value: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 3)}...`;
}

export function addTextDisplayWithBudget(
  container: ContainerBuilder,
  budget: { remaining: number },
  content: string,
): void {
  if (budget.remaining <= 0) {
    return;
  }
  const normalized = clampTextDisplayContent(content);
  const clipped = trimToBudget(normalized, budget.remaining);
  if (!clipped.length) {
    return;
  }
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      safeV2TextContent(clipped, DISCORD_TEXT_INPUT_MAX),
    ),
  );
  budget.remaining -= clipped.length;
}

export function addIssueImagesToContainer(
  container: ContainerBuilder,
  imageUrls: string[],
  budget?: { remaining: number },
): void {
  const uniqueImages = Array.from(new Set(imageUrls)).slice(0, MAX_TODO_IMAGES_PER_VIEW);
  if (!uniqueImages.length) return;

  const galleryItems = uniqueImages.map((url, index) =>
    new MediaGalleryItemBuilder()
      .setURL(url)
      .setDescription(`Issue image ${index + 1}`),
  );
  if (budget) {
    addTextDisplayWithBudget(container, budget, "### Images");
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("### Images"),
    );
  }
  container.addMediaGalleryComponents(
    new MediaGalleryBuilder().addItems(galleryItems),
  );
}
