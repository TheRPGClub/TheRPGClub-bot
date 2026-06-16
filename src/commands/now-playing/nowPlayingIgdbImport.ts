import { type StringSelectMenuInteraction } from "discord.js";
import {
  safeDeferUpdate,
  safeReply,
  safeUpdate,
  type AnyRepliable,
} from "../../functions/InteractionUtils.js";
import { igdbService } from "../../services/IGDB/IgdbService.js";
import {
  createIgdbSession,
  type IgdbSelectOption,
} from "../../services/IGDB/IgdbSelectService.js";
import {
  buildComponentsV2Flags,
  buildTextContainer,
} from "../../functions/ComponentsV2Utils.js";
import { truncateDescription } from "../../config/textLimits.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
import { importGameFromIgdb } from "../../functions/GameIgdbSync.js";

interface INowPlayingIgdbSession {
  userId: string;
  query: string;
  note: string | null;
}

type PromptNowPlayingAddPlatformSelection = (
  interaction: StringSelectMenuInteraction,
  sourceSessionId: string,
  userId: string,
  gameId: number,
  note: string | null,
  mode: "reply" | "update",
) => Promise<void>;

export async function startNowPlayingIgdbImport(
  interaction: StringSelectMenuInteraction,
  session: INowPlayingIgdbSession,
  promptAddPlatform: PromptNowPlayingAddPlatformSelection,
): Promise<void> {
  await startNowPlayingIgdbImportFromInteraction(interaction, session, "update", promptAddPlatform);
}

export async function startNowPlayingIgdbImportFromInteraction(
  interaction: AnyRepliable,
  session: INowPlayingIgdbSession,
  mode: "reply" | "update",
  promptAddPlatform: PromptNowPlayingAddPlatformSelection,
): Promise<void> {
  if (mode === "update" && "deferUpdate" in interaction) {
    await safeDeferUpdate(interaction);
  }

  try {
    const searchRes = await igdbService.searchGames(session.query);
    if (!searchRes.results.length) {
      const container = buildTextContainer(`No IGDB results found for "${session.query}".`);
      if (mode === "update" && "update" in interaction) {
        await safeUpdate(interaction, { components: [container] });
      } else {
        await safeReply(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(true),
        });
      }
      return;
    }

    const opts: IgdbSelectOption[] = searchRes.results.map((game) => {
      const year = game.first_release_date
        ? new Date(game.first_release_date * 1000).getFullYear()
        : "TBD";
      return {
        id: game.id,
        label: `${game.name} (${year})`,
        description: truncateDescription((game.summary || "No summary")),
      };
    });

    const { components } = createIgdbSession(session.userId, opts, async (sel, igdbId) => {
      try {
        await safeDeferUpdate(sel);
        const imported = await importGameFromIgdb(igdbId);
        const sourceSessionId = `np-igdb-add-${session.userId}`;
        await promptAddPlatform(
          sel,
          sourceSessionId,
          session.userId,
          imported.gameId,
          session.note,
          "reply",
        );
      } catch (err: any) {
        const msg = err?.message ?? "Failed to import from IGDB.";
        const container = buildTextContainer(msg);
        safeIgnore(safeReply(sel, {
          components: [container],
          flags: buildComponentsV2Flags(true),
        }));
      }
    });

    const container = buildTextContainer("Select an IGDB result to import and add to Now Playing:")
      .addActionRowComponents(components.map((row) => row.toJSON()));
    if (mode === "update" && "update" in interaction) {
      await safeUpdate(interaction, { components: [container] });
    } else {
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
    }
  } catch (err: any) {
    const msg = err?.message ?? "Failed to search IGDB.";
    const container = buildTextContainer(msg);
    if (mode === "update" && "update" in interaction) {
      await safeUpdate(interaction, { components: [container] });
    } else {
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
    }
  }
}
