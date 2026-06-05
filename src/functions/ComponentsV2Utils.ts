import { MessageFlags } from "discord.js";
import { ContainerBuilder, TextDisplayBuilder } from "@discordjs/builders";
import { COMPONENTS_V2_FLAG } from "../config/flags.js";

export function safeV2TextContent(value: string, maxLength: number): string {
  const normalized = value.split("\0").join("").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
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

export function buildTextReply(
  content: string,
  isEphemeral: boolean,
): { components: ContainerBuilder[]; flags: number } {
  return {
    components: [buildTextContainer(content)],
    flags: buildComponentsV2Flags(isEphemeral),
  };
}
