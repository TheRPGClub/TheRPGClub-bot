import type { CommandInteraction, Attachment } from "discord.js";
import { ContainerBuilder, TextDisplayBuilder } from "@discordjs/builders";
import type { CompletionatorAction } from "./completion.types.js";
import { ephemeralFlag, safeDeferReply, safeReply } from "../../functions/InteractionUtils.js";
import { fetchCsv, parseCompletionatorCsv } from "./completionator-parser.service.js";
import {
  createImportSession,
  insertImportItems,
  getActiveImportForUser,
  setImportStatus,
  countImportItems,
} from "../../classes/CompletionatorImport.js";
import { CompletionatorThreadService } from "./completionator-thread.service.js";
import { CompletionatorWorkflowService } from "./completionator-workflow.service.js";
import { BOT_DEV_CHANNEL_ID } from "../../config/channels.js";
import { buildComponentsV2Flags } from "../../functions/ComponentsV2Utils.js";

export async function handleCompletionatorImport(
  interaction: CommandInteraction,
  action: CompletionatorAction,
  file: Attachment | undefined,
): Promise<void> {
  const ephemeral = interaction.channel?.id !== BOT_DEV_CHANNEL_ID;
  await safeDeferReply(interaction, {
    flags: ephemeralFlag(ephemeral),
  });
  const userId = interaction.user.id;
  const guild = interaction.guild;

  if (!guild) {
    await safeReply(interaction, {
      content: "This command can only be used inside a server.",
      flags: buildComponentsV2Flags(ephemeral),
    });
    return;
  }

  if (action === "start") {
    if (!file?.url) {
      await safeReply(interaction, {
        content: [
          "Please attach the Completionator CSV file.",
          "To export it from Completionator:",
          "1. Open your Completionator profile",
          "2. Hover over 'Playthroughs' from the top menu and choose 'My Completions'",
          "3. In the upper-right, click 'Export' and then 'Export to CSV'",
          "4. Upload the CSV with `/game-completion import-completionator action:start file:<csv>`.",
        ].join("\n"),
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    const csvText = await fetchCsv(file.url);
    if (!csvText) {
      await safeReply(interaction, {
        content: "Failed to download the CSV file.",
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    const parsed = parseCompletionatorCsv(csvText);
    if (!parsed.length) {
      await safeReply(interaction, {
        content: "No rows found in the CSV file.",
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    const session = await createImportSession({
      userId,
      totalCount: parsed.length,
      sourceFilename: file.name ?? null,
    });
    await insertImportItems(session.importId, parsed);

    const threadService = new CompletionatorThreadService();
    const context = await threadService.getOrCreateCompletionatorThread(interaction, session);
    if (!context) return;
    const threadMention: string = `<#${context.threadId}>`;

    await safeReply(interaction, {
      content:
        `Import session #${session.importId} created with ${parsed.length} rows. ` +
        `Starting review in ${threadMention}.`,
      flags: buildComponentsV2Flags(ephemeral),
    });

    const workflowService = new CompletionatorWorkflowService();
    await workflowService.processNextCompletionatorItem(interaction, session, {
      ephemeral,
      context,
    });
    return;
  }

  if (action === "status") {
    const session = await getActiveImportForUser(userId);
    if (!session) {
      await safeReply(interaction, {
        content: "No active import session found.",
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    const stats = await countImportItems(session.importId);
    const statusContainer = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Completionator Import #${session.importId}\n` +
        `Status: ${session.status}\n\n` +
        `**Pending:** ${stats.pending} | **Imported:** ${stats.imported} | ` +
        `**Updated:** ${stats.updated} | **Skipped:** ${stats.skipped} | ` +
        `**Errors:** ${stats.error}`,
      ),
    );

    await safeReply(interaction, {
      components: [statusContainer],
      flags: buildComponentsV2Flags(ephemeral),
    });
    return;
  }

  const session = await getActiveImportForUser(userId);
  if (!session) {
    await safeReply(interaction, {
      content: "No active import session found.",
      flags: buildComponentsV2Flags(ephemeral),
    });
    return;
  }

  if (action === "pause") {
    await setImportStatus(session.importId, "PAUSED");
    const threadService = new CompletionatorThreadService();
    await threadService.cleanupCompletionatorThread(session.userId, session.importId);
    await safeReply(interaction, {
      content:
        `Import #${session.importId} paused. ` +
        "Resume with `/game-completion import-completionator action:resume`.",
      flags: buildComponentsV2Flags(ephemeral),
    });
    return;
  }

  if (action === "cancel") {
    await setImportStatus(session.importId, "CANCELED");
    await safeReply(interaction, {
      content: `Import #${session.importId} canceled.`,
      flags: buildComponentsV2Flags(ephemeral),
    });
    return;
  }

  await setImportStatus(session.importId, "ACTIVE");
  const threadService = new CompletionatorThreadService();
  const context = await threadService.getOrCreateCompletionatorThread(interaction, session);
  if (!context) return;
  await safeReply(interaction, {
    content:
      `Import #${session.importId} resumed. ` +
      `Continue in <#${context.threadId}>.`,
    flags: buildComponentsV2Flags(ephemeral),
  });

  const workflowService = new CompletionatorWorkflowService();
  await workflowService.processNextCompletionatorItem(interaction, session, {
    ephemeral,
    context,
  });
}
