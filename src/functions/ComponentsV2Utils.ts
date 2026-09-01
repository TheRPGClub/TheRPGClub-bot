import { MessageFlags, MessageFlagsBitField } from "discord.js";
import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import { COMPONENTS_V2_FLAG } from "../config/flags.js";
import { DEV_ROLE_ID } from "../config/roles.js";
import { truncateWithEllipsis } from "../utilities/ValidationUtils.js";

export type EmbedField = { name: string; value: string };

export function safeV2TextContent(value: string, maxLength: number): string {
  const normalized = value.split("\0").join("").trim();
  if (normalized.length <= maxLength) return normalized;
  return truncateWithEllipsis(normalized, maxLength);
}

export function buildComponentsV2Flags(isEphemeral: boolean): number {
  return (isEphemeral ? MessageFlags.Ephemeral : 0) | COMPONENTS_V2_FLAG;
}

export function buildComponentsV2EditFlags(): number {
  return COMPONENTS_V2_FLAG;
}

export function buildTextContainer(content: string): ContainerBuilder {
  return new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeV2TextContent(content, 3500)),
  );
}

export function buildContentContainer(
  content: string,
  thumbnailUrl?: string | null,
): ContainerBuilder {
  const text = new TextDisplayBuilder().setContent(safeV2TextContent(content, 3500));
  const container = new ContainerBuilder();
  if (thumbnailUrl) {
    const section = new SectionBuilder().addTextDisplayComponents(text);
    section.setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl));
    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(text);
  }
  return container;
}

export function buildTextReply(
  content: string,
  isEphemeral: boolean,
): { components: ContainerBuilder[]; flags: number } {
  return {
    components: [buildTextContainer(content)],
    flags: buildComponentsV2Flags(isEphemeral),
  };
}

/**
 * Same shape as buildTextReply, but permits the dev role mention that
 * formatApiError appends to every request/response failure block.
 */
export function buildErrorReply(
  content: string,
  isEphemeral: boolean,
): {
  components: ContainerBuilder[];
  flags: number;
  allowedMentions: { roles: string[] };
} {
  return {
    ...buildTextReply(content, isEphemeral),
    allowedMentions: { roles: [DEV_ROLE_ID] },
  };
}

export function buildTextSend(
  content: string,
): { components: ContainerBuilder[]; flags: number } {
  return {
    components: [buildTextContainer(content)],
    flags: buildComponentsV2EditFlags(),
  };
}

export function buildContainerSend(
  container: ContainerBuilder,
): { components: ContainerBuilder[]; flags: number } {
  return {
    components: [container],
    flags: buildComponentsV2EditFlags(),
  };
}

/**
 * Link text is often user- or website-controlled, and a bare `]` there closes
 * the bracket early so the rest of the string can render a link whose visible
 * text and real target disagree. Escaping keeps the text inert; parentheses in
 * the URL are percent-encoded so they cannot terminate the target early.
 */
export function escapeMaskedLinkText(text: string): string {
  return text.replace(/([\\[\]()])/g, "\\$1");
}

export function unescapeMaskedLinkText(text: string): string {
  return text.replace(/\\([\\[\]()])/g, "$1");
}

export function buildMaskedLink(text: string, url: string): string {
  const safeUrl = url.split("(").join("%28").split(")").join("%29");
  return `[${escapeMaskedLinkText(text)}](${safeUrl})`;
}

export function buildAccentContainer(
  content: string,
  color?: number,
): ContainerBuilder {
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeV2TextContent(content, 3500)),
  );
  if (color !== undefined) container.setAccentColor(color);
  return container;
}

export function buildTitledContainer(
  title: string,
  body: string,
  options?: { color?: number; footer?: string; detail?: string },
): ContainerBuilder {
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      safeV2TextContent(`# ${title}\n${body}`, 3500),
    ),
  );
  // A metadata line (source, jump link) gets its own text display so quoted
  // user content cannot swallow it into a code block and body truncation
  // cannot cut it in half.
  if (options?.detail) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeV2TextContent(options.detail, 500)),
    );
  }
  if (options?.footer) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        safeV2TextContent(`-# ${options.footer}`, 1000),
      ),
    );
  }
  if (options?.color !== undefined) container.setAccentColor(options.color);
  return container;
}

export function buildFieldsText(fields: EmbedField[]): string {
  return fields.map((f) => `**${f.name}**\n${f.value}`).join("\n\n");
}

export function hasComponentsV2Flag(flags: unknown): boolean {
  try {
    const bitfield = new MessageFlagsBitField(flags as any).bitfield;
    const asBigInt = typeof bitfield === "bigint" ? bitfield : BigInt(bitfield);
    return (asBigInt & BigInt(COMPONENTS_V2_FLAG)) === BigInt(COMPONENTS_V2_FLAG);
  } catch {
    return false;
  }
}
