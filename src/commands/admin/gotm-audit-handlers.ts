// Handlers for gotm-audit button/select/modal interactions

import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import {
  safeDeferUpdate,
  safeReply,
  safeUpdate,
  stripModalInput,
} from "../../functions/InteractionUtils.js";
import { buildTextReply } from "../../functions/ComponentsV2Utils.js";
import type { IGameWithPlatforms } from "../../classes/Game.js";
import Game from "../../classes/Game.js";
import {
  getGotmAuditImportById,
  getGotmAuditItemById,
  updateGotmAuditItem,
  setGotmAuditImportStatus,
} from "../../classes/GotmAuditImport.js";
import { buildComponentsV2Flags } from "../../functions/NominationListComponents.js";
import { processNextGotmAuditItem, tryInsertGotmAuditRound } from "./gotm-audit.service.js";
import {
  GOTM_AUDIT_MANUAL_PREFIX,
  GOTM_AUDIT_MANUAL_INPUT_ID,
  GOTM_AUDIT_QUERY_PREFIX,
  GOTM_AUDIT_QUERY_INPUT_ID,
  GOTM_AUDIT_RESULT_LIMIT,
} from "./admin.types.js";
import {
  buildGotmAuditPromptContent,
  buildGotmAuditPromptContainer,
  buildGotmAuditPromptComponents,
} from "./gotm-audit-ui.service.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { parseCustomIdSegments } from "../../utilities/CustomIdUtils.js";

export async function handleGotmAuditSelect(
  interaction: StringSelectMenuInteraction): Promise<void> {
  const segs = parseCustomIdSegments(interaction.customId, 3);
  if (!segs) { console.error(`Unexpected customId: ${interaction.customId}`); return; }
  const [ownerId, importIdRaw, itemIdRaw] = segs;
  if (interaction.user.id !== ownerId) {
    await safeReply(interaction, buildTextReply("This audit prompt is not for you.", true));
    return;
  }

  const importId = Number(importIdRaw);
  const itemId = Number(itemIdRaw);
  if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
    await safeReply(interaction, buildTextReply("Invalid audit selection.", true));
    return;
  }

  const selectedRaw = interaction.values?.[0];
  const gameDbId = Number(selectedRaw);
  if (!isPositiveInt(gameDbId)) {
    await safeReply(interaction, buildTextReply("Invalid GameDB selection.", true));
    return;
  }

  await safeDeferUpdate(interaction);

  const session = await getGotmAuditImportById(importId);
  if (!session || session.userId !== ownerId) {
    await safeReply(interaction, {
      ...buildTextReply("This audit session no longer exists.", true),
      __forceFollowUp: true,
    });
    return;
  }

  if (session.status !== "ACTIVE") {
    await safeReply(interaction, {
      ...buildTextReply("This audit session is not active.", true),
      __forceFollowUp: true,
    });
    return;
  }

  const item = await getGotmAuditItemById(itemId);
  if (!item || item.importId !== session.importId || item.status !== "PENDING") {
    await safeReply(interaction, {
      ...buildTextReply("This audit item is no longer pending.", true),
      __forceFollowUp: true,
    });
    return;
  }

  const game = await Game.getGameById(gameDbId);
  if (!game) {
    await safeReply(interaction, {
      ...buildTextReply(`GameDB #${gameDbId} not found.`, true),
      __forceFollowUp: true,
    });
    return;
  }

  await updateGotmAuditItem(itemId, {
    status: "IMPORTED",
    gameDbGameId: gameDbId,
    errorText: null,
  });

  await safeReply(interaction, {
    ...buildTextReply(`Selected ${game.title} (GameDB #${gameDbId}).`, true),
    __forceFollowUp: true,
  });

  await tryInsertGotmAuditRound(interaction, session, item);
  await processNextGotmAuditItem(interaction, session);
}

export async function handleGotmAuditAction(interaction: ButtonInteraction): Promise<void> {
  const segs = parseCustomIdSegments(interaction.customId, 4);
  if (!segs) { console.error(`Unexpected customId: ${interaction.customId}`); return; }
  const [ownerId, importIdRaw, itemIdRaw, action] = segs;
  if (interaction.user.id !== ownerId) {
    await safeReply(interaction, buildTextReply("This audit prompt is not for you.", true));
    return;
  }

  const importId = Number(importIdRaw);
  const itemId = Number(itemIdRaw);
  if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
    await safeReply(interaction, buildTextReply("Invalid audit action.", true));
    return;
  }

  if (action === "manual") {
    const modal = new ModalBuilder()
       
      .setCustomId(`${GOTM_AUDIT_MANUAL_PREFIX}:${ownerId}:${importId}:${itemId}`)
      .setTitle("Manual GameDB Entry");
    const input = new TextInputBuilder()
       
      .setCustomId(GOTM_AUDIT_MANUAL_INPUT_ID)
      .setLabel("GameDB ID")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
    modal.addComponents(row);
    await interaction.showModal(modal);
    return;
  }

  if (action === "query") {
    const modal = new ModalBuilder()
       
      .setCustomId(`${GOTM_AUDIT_QUERY_PREFIX}:${ownerId}:${importId}:${itemId}`)
      .setTitle("Manual GameDB Search");
    const input = new TextInputBuilder()
       
      .setCustomId(GOTM_AUDIT_QUERY_INPUT_ID)
      .setLabel("Search query")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
    modal.addComponents(row);
    await interaction.showModal(modal);
    return;
  }

  if (action === "accept") {
    const session = await getGotmAuditImportById(importId);
    if (!session || session.userId !== ownerId) {
      await safeReply(interaction, buildTextReply("This audit session no longer exists.", true));
      return;
    }

    if (session.status !== "ACTIVE") {
      await safeReply(interaction, buildTextReply("This audit session is not active.", true));
      return;
    }

    const item = await getGotmAuditItemById(itemId);
    if (!item || item.importId !== session.importId || item.status !== "PENDING") {
      await safeReply(interaction, buildTextReply("This audit item is no longer pending.", true));
      return;
    }

    let results: IGameWithPlatforms[] = [];
    try {
      results = await Game.searchGames(item.gameTitle);
    } catch (err: any) {
      await safeReply(interaction, buildTextReply(
        `GameDB search failed: ${err?.message ?? "Unknown error"}`,
        true,
      ));
      return;
    }

    const first = results[0];
    if (!first) {
      await safeReply(interaction, buildTextReply("No GameDB matches found for this title.", true));
      return;
    }

    await safeDeferUpdate(interaction);

    await updateGotmAuditItem(itemId, {
      status: "IMPORTED",
      gameDbGameId: first.id,
      errorText: null,
    });

    await safeReply(interaction, {
      ...buildTextReply(`Selected ${first.title} (GameDB #${first.id}).`, true),
      __forceFollowUp: true,
    });

    await tryInsertGotmAuditRound(interaction, session, item);
    await processNextGotmAuditItem(interaction, session);
    return;
  }

  if (action === "skip") {
    const session = await getGotmAuditImportById(importId);
    if (!session || session.userId !== ownerId) {
      await safeReply(interaction, buildTextReply("This audit session no longer exists.", true));
      return;
    }

    if (session.status !== "ACTIVE") {
      await safeReply(interaction, buildTextReply("This audit session is not active.", true));
      return;
    }

    const item = await getGotmAuditItemById(itemId);
    if (!item || item.importId !== session.importId || item.status !== "PENDING") {
      await safeReply(interaction, buildTextReply("This audit item is no longer pending.", true));
      return;
    }

    await updateGotmAuditItem(itemId, { status: "SKIPPED" });
    await safeUpdate(interaction, {
      content: `Skipped "${item.gameTitle}".`,
      components: [],
    });
    await processNextGotmAuditItem(interaction, session);
    return;
  }

  if (action === "pause") {
    const session = await getGotmAuditImportById(importId);
    if (!session || session.userId !== ownerId) {
      await safeReply(interaction, buildTextReply("This audit session no longer exists.", true));
      return;
    }

    await setGotmAuditImportStatus(session.importId, "PAUSED");
    await safeUpdate(interaction, {
      content: `Paused GOTM audit #${session.importId}.`,
      components: [],
    });
  }
}

export async function handleGotmAuditManualModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const segs = parseCustomIdSegments(interaction.customId, 3);
  if (!segs) { console.error(`Unexpected customId: ${interaction.customId}`); return; }
  const [ownerId, importIdRaw, itemIdRaw] = segs;
  if (interaction.user.id !== ownerId) {
    await safeReply(interaction, buildTextReply("This audit prompt is not for you.", true));
    return;
  }

  const importId = Number(importIdRaw);
  const itemId = Number(itemIdRaw);
  if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
    await safeReply(interaction, buildTextReply("Invalid audit request.", true));
    return;
  }

  const raw = interaction.fields.getTextInputValue(GOTM_AUDIT_MANUAL_INPUT_ID);
  const cleaned = stripModalInput(raw);
  const gameDbId = Number(cleaned);
  if (!isPositiveInt(gameDbId)) {
    await safeReply(interaction, buildTextReply("Please provide a valid GameDB id.", true));
    return;
  }

  await safeDeferUpdate(interaction);

  const session = await getGotmAuditImportById(importId);
  if (!session || session.userId !== ownerId) {
    await safeReply(interaction, {
      ...buildTextReply("This audit session no longer exists.", true),
      __forceFollowUp: true,
    });
    return;
  }

  if (session.status !== "ACTIVE") {
    await safeReply(interaction, {
      ...buildTextReply("This audit session is not active.", true),
      __forceFollowUp: true,
    });
    return;
  }

  const item = await getGotmAuditItemById(itemId);
  if (!item || item.importId !== session.importId || item.status !== "PENDING") {
    await safeReply(interaction, {
      ...buildTextReply("This audit item is no longer pending.", true),
      __forceFollowUp: true,
    });
    return;
  }

  const game = await Game.getGameById(gameDbId);
  if (!game) {
    await safeReply(interaction, {
      ...buildTextReply(`GameDB #${gameDbId} not found.`, true),
      __forceFollowUp: true,
    });
    return;
  }

  await updateGotmAuditItem(itemId, {
    status: "IMPORTED",
    gameDbGameId: gameDbId,
    errorText: null,
  });

  await safeReply(interaction, {
    ...buildTextReply(`Selected ${game.title} (GameDB #${gameDbId}).`, true),
    __forceFollowUp: true,
  });

  await tryInsertGotmAuditRound(interaction, session, item);
  await processNextGotmAuditItem(interaction, session);
}

export async function handleGotmAuditQueryModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const segs = parseCustomIdSegments(interaction.customId, 3);
  if (!segs) { console.error(`Unexpected customId: ${interaction.customId}`); return; }
  const [ownerId, importIdRaw, itemIdRaw] = segs;
  if (interaction.user.id !== ownerId) {
    await safeReply(interaction, buildTextReply("This audit prompt is not for you.", true));
    return;
  }

  const importId = Number(importIdRaw);
  const itemId = Number(itemIdRaw);
  if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
    await safeReply(interaction, buildTextReply("Invalid audit request.", true));
    return;
  }

  const raw = interaction.fields.getTextInputValue(GOTM_AUDIT_QUERY_INPUT_ID);
  const query = stripModalInput(raw).trim();
  if (!query) {
    await safeReply(interaction, buildTextReply("Please provide a search query.", true));
    return;
  }

  await safeDeferUpdate(interaction);

  const session = await getGotmAuditImportById(importId);
  if (!session || session.userId !== ownerId) {
    await safeReply(interaction, {
      ...buildTextReply("This audit session no longer exists.", true),
      __forceFollowUp: true,
    });
    return;
  }

  if (session.status !== "ACTIVE") {
    await safeReply(interaction, {
      ...buildTextReply("This audit session is not active.", true),
      __forceFollowUp: true,
    });
    return;
  }

  const item = await getGotmAuditItemById(itemId);
  if (!item || item.importId !== session.importId || item.status !== "PENDING") {
    await safeReply(interaction, {
      ...buildTextReply("This audit item is no longer pending.", true),
      __forceFollowUp: true,
    });
    return;
  }

  let results: IGameWithPlatforms[] = [];
  try {
    results = await Game.searchGames(query);
  } catch (err: any) {
    await safeReply(interaction, {
      ...buildTextReply(`GameDB search failed: ${err?.message ?? "Unknown error"}`, true),
      __forceFollowUp: true,
    });
    return;
  }

  const options = results.slice(0, GOTM_AUDIT_RESULT_LIMIT).map((game) => {
    const year = game.initialReleaseDate instanceof Date
      ? game.initialReleaseDate.getFullYear()
      : game.initialReleaseDate
        ? new Date(game.initialReleaseDate).getFullYear()
        : null;
    const label = year ? `${game.title} (${year})` : game.title;
    return {
      id: game.id,
      label,
      description: `GameDB #${game.id}`,
    };
  });

  const baseContent = buildGotmAuditPromptContent(
    session,
    item,
    interaction.guildId ?? null,
    options.length > 0,
  );
  const content = `${baseContent}\n\nManual search: ${query}`;
  const container = buildGotmAuditPromptContainer(content);
  const components = buildGotmAuditPromptComponents(
    interaction.user.id,
    session.importId,
    item.itemId,
    options,
  );

  await safeReply(interaction, {
    components: [container, ...components],
    flags: buildComponentsV2Flags(true),
    __forceFollowUp: true,
  });
}
