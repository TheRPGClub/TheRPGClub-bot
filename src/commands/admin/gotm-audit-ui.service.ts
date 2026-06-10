import {
  ActionRowBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import {
  buildActionButton,
  buildButtonRow,
  buildSelectRow,
} from "../../functions/uiComponents.js";
import { ContainerBuilder } from "@discordjs/builders";
import { type IGotmAuditImport, type IGotmAuditItem } from "../../classes/GotmAuditImport.js";
import {
  GOTM_AUDIT_SELECT_PREFIX,
  GOTM_AUDIT_ACTION_PREFIX,
  GOTM_AUDIT_RESULT_LIMIT,
} from "./admin.types.js";
import { buildTextContainer } from "../../functions/ComponentsV2Utils.js";
import { DISCORD_SELECT_LABEL_MAX } from "../../config/textLimits.js";

export function buildGotmAuditPromptContent(
  session: IGotmAuditImport,
  item: IGotmAuditItem,
  guildId: string | null,
  hasResults: boolean,
): string {
  const kindLabel = item.kind === "nr-gotm" ? "NR-GOTM" : "GOTM";
  const threadLink = item.threadId && guildId
    ? `https://discord.com/channels/${guildId}/${item.threadId}`
    : null;
  const threadText = threadLink
    ? `[Thread Link](${threadLink})`
    : item.threadId
      ? item.threadId
      : "None";
  const redditText = item.redditUrl ?? "None";
  const base =
    `## ${kindLabel} Audit #${session.importId} - Item ${item.rowIndex}/${session.totalCount}\n` +
    `**Round:** ${item.roundNumber}\n` +
    `**Month/Year:** ${item.monthYear}\n` +
    `**Game Index:** ${item.gameIndex + 1}\n` +
    `**Title:** ${item.gameTitle}\n` +
    `**Thread:** ${threadText}\n` +
    `**Reddit:** ${redditText}`;

  if (hasResults) {
    return `${base}\n\nSelect a GameDB match or choose Manual GameDB ID.`;
  }

  return `${base}\n\nNo GameDB matches found. Use Manual GameDB Search or Skip.`;
}

export function buildGotmAuditPromptContainer(content: string): ContainerBuilder {
  return buildTextContainer(content);
}

export function buildGotmAuditPromptComponents(
  ownerId: string,
  importId: number,
  itemId: number,
  options: Array<{ id: number; label: string; description?: string }>,
): ActionRowBuilder<any>[] {
  const rows: ActionRowBuilder<any>[] = [];

  if (options.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${GOTM_AUDIT_SELECT_PREFIX}:${ownerId}:${importId}:${itemId}`)
      .setPlaceholder("Select a GameDB match")
      .addOptions(
        options.slice(0, GOTM_AUDIT_RESULT_LIMIT).map((opt, idx) => ({
          label: opt.label.slice(0, DISCORD_SELECT_LABEL_MAX),
          value: String(opt.id),
          description: opt.description?.slice(0, DISCORD_SELECT_LABEL_MAX),
          default: idx === 0,
        })),
      );
    rows.push(buildSelectRow(select));
  }

  const manualBtn = buildActionButton({
    customId: `${GOTM_AUDIT_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:manual`,
    label: "Manual GameDB ID",
    style: ButtonStyle.Primary,
  });
  const queryBtn = buildActionButton({
    customId: `${GOTM_AUDIT_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:query`,
    label: "Manual GameDB Search",
    style: ButtonStyle.Primary,
  });
  const acceptBtn = buildActionButton({
    customId: `${GOTM_AUDIT_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:accept`,
    label: "Accept First Option",
    style: ButtonStyle.Success,
  }).setDisabled(!options.length);
  const actionRow = buildButtonRow(manualBtn, queryBtn, acceptBtn);
  const skipBtn = buildActionButton({
    customId: `${GOTM_AUDIT_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:skip`,
    label: "Skip",
    style: ButtonStyle.Secondary,
  });
  const pauseBtn = buildActionButton({
    customId: `${GOTM_AUDIT_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:pause`,
    label: "Pause",
    style: ButtonStyle.Secondary,
  });
  const controlRow = buildButtonRow(skipBtn, pauseBtn);

  rows.push(actionRow, controlRow);
  return rows;
}
