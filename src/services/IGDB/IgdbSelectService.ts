import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import {
  canSafeReply,
  safeDeferUpdate,
  safeReply,
  safeUpdate,
} from "../../functions/InteractionUtils.js";
import { buildTextReply } from "../../functions/ComponentsV2Utils.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { DISCORD_SELECT_LABEL_MAX } from "../../config/textLimits.js";
import { parseCustomIdSegments } from "../../utilities/CustomIdUtils.js";

export type IgdbSelectOption = { id: number; label: string; description?: string };

type Session = {
  ownerId: string;
  options: IgdbSelectOption[];
  onSelect: (interaction: StringSelectMenuInteraction, gameId: number) => Promise<void>;
  extraComponents?: ActionRowBuilder<any>[];
  emptyMessage?: string;
};

const IGDB_FIRST_MATCH_PREFIX = "igdb-first";
// Leave room for prev/next navigation in the 25-option Discord limit.
const PAGE_SIZE = 22; // 22 options + prev/next (up to 24) stays under 25
const IGDB_SESSION_KEY = Symbol.for("igdbSelectSessions");

function getSessionStore(): Map<string, Session> {
  const g = globalThis as any;
  if (!g[IGDB_SESSION_KEY]) {
    g[IGDB_SESSION_KEY] = new Map<string, Session>();
  }
  return g[IGDB_SESSION_KEY] as Map<string, Session>;
}

function chunkOptions(options: IgdbSelectOption[], page: number): {
  pageOptions: IgdbSelectOption[];
  totalPages: number;
} {
  const totalPages = Math.max(1, Math.ceil(options.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = safePage * PAGE_SIZE;
  const pageOptions = options.slice(start, start + PAGE_SIZE);
  return { pageOptions, totalPages };
}

export function createIgdbSession(
  ownerId: string,
  options: IgdbSelectOption[],
  onSelect: Session["onSelect"],
  extraComponents?: ActionRowBuilder<any>[],
  emptyMessage?: string,
): {
  sessionId: string;
  components: ActionRowBuilder<any>[];
} {
  const sessionId = `igdb-${ownerId}`;
  const sorted = [...options].sort((a, b) => {
    const lenDiff = a.label.length - b.label.length;
    if (lenDiff !== 0) return lenDiff;
    return a.label.localeCompare(b.label);
  });
  getSessionStore().set(sessionId, {
    ownerId,
    options: sorted,
    onSelect,
    extraComponents,
    emptyMessage,
  });
  return {
    sessionId,
    components: buildIgdbComponents(sessionId, 0),
  };
}

export function buildIgdbComponents(
  sessionId: string,
  page: number,
): ActionRowBuilder<any>[] {
  const session = getSessionStore().get(sessionId);
  if (!session) return [];
  const { pageOptions, totalPages } = chunkOptions(session.options, page);
  const hasOptions = pageOptions.length > 0;

  const select = new StringSelectMenuBuilder()
    // eslint-disable-next-line local/custom-id-has-matching-handler
    .setCustomId(`igdb-select:${sessionId}:${page}`)
    .setPlaceholder("Select a game from IGDB")
    .addOptions(
      hasOptions
        ? pageOptions.map((opt, index) => ({
          label: opt.label.slice(0, DISCORD_SELECT_LABEL_MAX),
          value: String(opt.id),
          description: opt.description?.slice(0, DISCORD_SELECT_LABEL_MAX),
          default: page === 0 && index === 0,
        }))
        : [{
          label: "No IGDB matches found",
          value: "__igdb_none",
          description: "Search a different title",
        }],
    );

  if (hasOptions && totalPages > 1) {
    if (page > 0) {
      select.addOptions({
        label: "Previous page",
        value: "__igdb_prev",
        description: "Show previous results",
      });
    }
    if (page < totalPages - 1) {
      select.addOptions({
        label: "Next page",
        value: "__igdb_next",
        description: "Show more results",
      });
    }
  }

  const rows: ActionRowBuilder<any>[] = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
  ];

  if (hasOptions) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        // eslint-disable-next-line local/custom-id-has-matching-handler
        .setCustomId(`${IGDB_FIRST_MATCH_PREFIX}:${sessionId}`)
        .setLabel("Import First Match")
        .setStyle(ButtonStyle.Primary),
    ));
  }

  rows.push(...(session.extraComponents ?? []));
  return rows;
}

export function getIgdbSession(sessionId: string): Session | undefined {
  return getSessionStore().get(sessionId);
}

export function deleteIgdbSession(sessionId: string): void {
  getSessionStore().delete(sessionId);
}

export async function handleIgdbSelectInteraction(
  interaction: StringSelectMenuInteraction,
): Promise<boolean> {
  const segs = parseCustomIdSegments(interaction.customId, 2);
  if (!segs) { console.error(`Unexpected customId: ${interaction.customId}`); return false; }
  const [sessionId, pageRaw] = segs;
  const session = getSessionStore().get(sessionId);
  if (!session) {
    await safeReply(interaction, buildTextReply("This selection session has expired.", true));
    return true;
  }

  if (interaction.user.id !== session.ownerId) {
    await safeReply(interaction, buildTextReply("This selection isn't for you.", true));
    return true;
  }

  const page = Number(pageRaw) || 0;
  const value = interaction.values?.[0];
  if (!value) return true;

  if (value === "__igdb_none") {
    const message = session.emptyMessage ??
      "No IGDB matches found. Try Search a different title.";
    await safeReply(interaction, buildTextReply(message, true));
    return true;
  }

  if (value === "__igdb_prev" || value === "__igdb_next") {
    const result = resolveIgdbSelection(sessionId, page, value);
    if (result && result.kind === "page") {
      try {
        await safeUpdate(interaction, { components: result.components });
      } catch {
        // ensure the interaction is acknowledged to avoid "Interaction failed"
        await safeDeferUpdate(interaction);
      }
    }
    return true;
  }

  const selected = resolveIgdbSelection(sessionId, page, value);
  if (!selected || selected.kind !== "select") {
    await safeReply(interaction, buildTextReply("Invalid selection.", true));
    return true;
  }

  try {
    if (canSafeReply(interaction)) {
      await safeDeferUpdate(interaction);
    }
    await session.onSelect(interaction, selected.gameId);
  } finally {
    getSessionStore().delete(sessionId);
  }
  return true;
}

export async function handleIgdbFirstMatchInteraction(
  interaction: ButtonInteraction,
): Promise<boolean> {
  const segs = parseCustomIdSegments(interaction.customId, 1);
  if (!segs) { console.error(`Unexpected customId: ${interaction.customId}`); return false; }
  const [sessionId] = segs;
  const session = getSessionStore().get(sessionId);
  if (!session) {
    await safeReply(interaction, buildTextReply("This selection session has expired.", true));
    return true;
  }

  if (interaction.user.id !== session.ownerId) {
    await safeReply(interaction, buildTextReply("This selection isn't for you.", true));
    return true;
  }

  const firstOption = session.options[0];
  if (!firstOption) {
    const message = session.emptyMessage ??
      "No IGDB matches found. Try Search a different title.";
    await safeReply(interaction, buildTextReply(message, true));
    return true;
  }

  try {
    if (canSafeReply(interaction)) {
      await safeDeferUpdate(interaction);
    }
    await session.onSelect(interaction as unknown as StringSelectMenuInteraction, firstOption.id);
  } finally {
    getSessionStore().delete(sessionId);
  }
  return true;
}

function resolveIgdbSelection(
  sessionId: string,
  page: number,
  value: string,
): {
  kind: "page";
  page: number;
  components: ActionRowBuilder<StringSelectMenuBuilder>[];
} | { kind: "select"; gameId: number } | null {
  const session = getSessionStore().get(sessionId);
  if (!session) return null;

  if (value === "__igdb_prev") {
    const newPage = Math.max(page - 1, 0);
    return {
      kind: "page",
      page: newPage,
      components: buildIgdbComponents(sessionId, newPage),
    };
  }

  if (value === "__igdb_next") {
    const { totalPages } = chunkOptions(session.options, page);
    const newPage = Math.min(page + 1, totalPages - 1);
    return {
      kind: "page",
      page: newPage,
      components: buildIgdbComponents(sessionId, newPage),
    };
  }

  const gameId = Number(value);
  if (!isPositiveInt(gameId)) return null;
  return { kind: "select", gameId };
}
