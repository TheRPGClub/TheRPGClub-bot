import crypto from "node:crypto";
import {
  ActionRowBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import {
  canSafeReply,
  replyIfNotOwner,
  safeDeferUpdate,
  safeEditReply,
  safeReply,
  safeUpdate,
} from "../../functions/InteractionUtils.js";
import { isEphemeralInteractionMessage } from "../../functions/EphemeralMirror.js";
import {
  buildComponentsV2EditFlags,
  buildErrorReply,
  buildTextContainer,
  buildTextReply,
} from "../../functions/ComponentsV2Utils.js";
import { buildApiErrorMessage } from "../../utilities/ApiErrorUtils.js";
import { logError } from "../../utilities/LogUtils.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { truncateLabel } from "../../config/textLimits.js";
import { assertCustomIdSegments } from "../../utilities/CustomIdUtils.js";
import {
  buildActionButton,
  buildButtonRow,
  buildSelectRow,
} from "../../functions/uiComponents.js";
import {
  persistedSessionStore,
  persistSessionInBackground,
  removePersistedSession,
  type PersistedSessionLocation,
} from "../PersistedInteractionSessionStore.js";

export type IgdbSelectOption = { id: number; label: string; description?: string };

type Session = {
  ownerId: string;
  options: IgdbSelectOption[];
  onSelect: (interaction: StringSelectMenuInteraction, gameId: number) => Promise<void>;
  extraComponents?: ActionRowBuilder<any>[];
  emptyMessage?: string;
  // API row id of the restart-recovery copy; only set for resumable sessions.
  persistedRowId?: Promise<string | null>;
};

type IgdbSelectInteraction = StringSelectMenuInteraction | ButtonInteraction;

/**
 * A named IGDB selection flow whose context survives a bot restart. The session
 * persists the flow key and `toJson(context)`; after a restart the registry maps
 * the key back to `onSelect`, since a closure cannot be persisted.
 */
export type IgdbSelectFlow<T> = {
  key: string;
  toJson: (context: T) => unknown;
  fromJson: (raw: unknown) => T | null;
  onSelect: (
    interaction: StringSelectMenuInteraction,
    gameId: number,
    context: T,
  ) => Promise<void>;
};

type PersistedIgdbSessionState = {
  flow: string;
  options: IgdbSelectOption[];
  emptyMessage?: string;
  context: unknown;
};

const IGDB_FIRST_MATCH_PREFIX = "igdb-first";
const IGDB_SESSION_EXPIRED_MESSAGE =
  "This game selection has expired or was replaced by a newer one. " +
  "Please re-run the command (or click \"Link a game\" again) to start a fresh selection.";
// Leave room for prev/next navigation in the 25-option Discord limit.
const PAGE_SIZE = 22; // 22 options + prev/next (up to 24) stays under 25
const IGDB_SESSION_KEY = Symbol.for("igdbSelectSessions");
const IGDB_PERSISTED_KIND = "igdb-select";
const IGDB_SESSION_ID_PATTERN = /^igdb-(\d+)-([0-9a-f-]{36})$/;
const igdbSelectFlows = new Map<string, IgdbSelectFlow<any>>();

export function registerIgdbSelectFlow<T>(flow: IgdbSelectFlow<T>): IgdbSelectFlow<T> {
  igdbSelectFlows.set(flow.key, flow);
  return flow;
}

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
  // Unique per call so concurrent or sequential IGDB selections from the same user
  // do not clobber each other in the shared session store. The id never contains a
  // colon, which the custom-id parser relies on for exact segment counting.
  const sessionId = `igdb-${ownerId}-${crypto.randomUUID()}`;
  getSessionStore().set(sessionId, {
    ownerId,
    options: sortIgdbOptions(options),
    onSelect,
    extraComponents,
    emptyMessage,
  });
  return {
    sessionId,
    components: buildIgdbComponents(sessionId, 0),
  };
}

/**
 * Like createIgdbSession, but the session also survives a bot restart: the options
 * and `flow.toJson(context)` are persisted, and a pick after a restart runs
 * `flow.onSelect` with the restored context. The flow must be registered with
 * registerIgdbSelectFlow at module load so it exists before any interaction.
 */
export function createResumableIgdbSession<T>(params: {
  ownerId: string;
  options: IgdbSelectOption[];
  flow: IgdbSelectFlow<T>;
  context: T;
  location: PersistedSessionLocation;
  emptyMessage?: string;
}): { sessionId: string; components: ActionRowBuilder<any>[] } {
  const { flow, context } = params;
  const created = createIgdbSession(
    params.ownerId,
    params.options,
    (interaction, gameId) => flow.onSelect(interaction, gameId, context),
    undefined,
    params.emptyMessage,
  );
  const session = getSessionStore().get(created.sessionId);
  if (session) {
    const state: PersistedIgdbSessionState = {
      flow: flow.key,
      options: session.options,
      emptyMessage: params.emptyMessage,
      context: flow.toJson(context),
    };
    session.persistedRowId = persistSessionInBackground({
      kind: IGDB_PERSISTED_KIND,
      sessionId: created.sessionId,
      ownerId: params.ownerId,
      location: params.location,
      state,
    });
  }
  return created;
}

function sortIgdbOptions(options: IgdbSelectOption[]): IgdbSelectOption[] {
  return [...options].sort((a, b) => {
    const lenDiff = a.label.length - b.label.length;
    if (lenDiff !== 0) return lenDiff;
    return a.label.localeCompare(b.label);
  });
}

function parsePersistedOptions(raw: unknown): IgdbSelectOption[] | null {
  if (!Array.isArray(raw)) return null;
  const options: IgdbSelectOption[] = [];
  for (const item of raw) {
    const id = Number(item?.id);
    if (!isPositiveInt(id) || typeof item?.label !== "string") return null;
    const description = typeof item.description === "string" ? item.description : undefined;
    options.push({ id, label: item.label, description });
  }
  return options;
}

function toSessionFromPersisted(
  ownerId: string,
  rowId: string,
  raw: unknown,
): Session | null {
  const state = raw as Partial<PersistedIgdbSessionState> | null;
  const flow = typeof state?.flow === "string" ? igdbSelectFlows.get(state.flow) : undefined;
  const options = parsePersistedOptions(state?.options);
  if (!flow || !options) return null;
  const context = flow.fromJson(state?.context);
  if (context === null) return null;
  return {
    ownerId,
    options,
    onSelect: (interaction, gameId) => flow.onSelect(interaction, gameId, context),
    emptyMessage: typeof state?.emptyMessage === "string" ? state.emptyMessage : undefined,
    persistedRowId: Promise.resolve(rowId),
  };
}

/**
 * Returns the in-memory session, or rebuilds a resumable one from the API after a
 * bot restart. API errors propagate so the caller can show the request/response.
 */
async function resolveIgdbSession(
  sessionId: string,
  interaction: IgdbSelectInteraction,
): Promise<Session | undefined> {
  const cached = getSessionStore().get(sessionId);
  if (cached) return cached;

  const ownerId = IGDB_SESSION_ID_PATTERN.exec(sessionId)?.[1];
  if (!ownerId) return undefined;
  const record = await persistedSessionStore.load({
    kind: IGDB_PERSISTED_KIND,
    sessionId,
    ownerId,
    channelId: interaction.channelId,
  });
  if (!record) return undefined;
  const session = toSessionFromPersisted(ownerId, record.rowId, record.state);
  if (!session) return undefined;
  getSessionStore().set(sessionId, session);
  return session;
}

async function loadIgdbSessionOrReply(
  sessionId: string,
  interaction: IgdbSelectInteraction,
): Promise<Session | undefined> {
  let session: Session | undefined;
  try {
    session = await resolveIgdbSession(sessionId, interaction);
  } catch (err: unknown) {
    logError("IgdbSelectService.resolveIgdbSession", err);
    await safeReply(interaction, buildErrorReply(
      buildApiErrorMessage("Could not restore this game selection.", err),
      true,
    ));
    return undefined;
  }
  if (!session) {
    await safeReply(interaction, buildTextReply(IGDB_SESSION_EXPIRED_MESSAGE, true));
  }
  return session;
}

function finishIgdbSession(sessionId: string, session: Session): void {
  getSessionStore().delete(sessionId);
  void removePersistedSession(session.persistedRowId);
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
          label: truncateLabel(opt.label),
          value: String(opt.id),
          description: opt.description ? truncateLabel(opt.description) : undefined,
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
    buildSelectRow(select),
  ];

  if (hasOptions) {
    rows.push(buildButtonRow(
       
      buildActionButton({ customId: `${IGDB_FIRST_MATCH_PREFIX}:${sessionId}`, label: "Import First Match", style: ButtonStyle.Primary }),
    ));
  }

  rows.push(...(session.extraComponents ?? []));
  return rows;
}

export function getIgdbSession(sessionId: string): Session | undefined {
  return getSessionStore().get(sessionId);
}

export function deleteIgdbSession(sessionId: string): void {
  const session = getSessionStore().get(sessionId);
  if (session) finishIgdbSession(sessionId, session);
}

export async function handleIgdbSelectInteraction(
  interaction: StringSelectMenuInteraction,
): Promise<boolean> {
  const segs = assertCustomIdSegments(interaction, 2);
  if (!segs) return false;
  const [sessionId, pageRaw] = segs;
  const session = await loadIgdbSessionOrReply(sessionId, interaction);
  if (!session) return true;

  if (await replyIfNotOwner(interaction, session.ownerId, "This selection isn't for you.")) return true;

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
  } catch (err: unknown) {
    await reportIgdbSelectError(interaction, err);
  } finally {
    finishIgdbSession(sessionId, session);
  }
  return true;
}

export async function handleIgdbFirstMatchInteraction(
  interaction: ButtonInteraction,
): Promise<boolean> {
  const segs = assertCustomIdSegments(interaction, 1);
  if (!segs) return false;
  const [sessionId] = segs;
  const session = await loadIgdbSessionOrReply(sessionId, interaction);
  if (!session) return true;

  if (await replyIfNotOwner(interaction, session.ownerId, "This selection isn't for you.")) return true;

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
  } catch (err: unknown) {
    await reportIgdbSelectError(interaction, err);
  } finally {
    finishIgdbSession(sessionId, session);
  }
  return true;
}

const IGDB_SELECTION_FAILED_STATUS = "IGDB import failed. See the error below.";

async function reportIgdbSelectError(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  err: unknown,
): Promise<void> {
  logError("IgdbSelectService.onSelect", err);
  // Clear any "Importing..." status left by onSelect. A public prompt is left
  // alone so a shared message is never overwritten by one user's failure.
  if (isEphemeralInteractionMessage(interaction)) {
    await safeEditReply(interaction, {
      components: [buildTextContainer(IGDB_SELECTION_FAILED_STATUS)],
      flags: buildComponentsV2EditFlags(),
    }).catch((editErr: unknown) => logError("IgdbSelectService.statusEdit", editErr));
  }
  await safeReply(interaction, {
    ...buildErrorReply(buildApiErrorMessage("IGDB selection failed.", err), true),
    __forceFollowUp: true,
  });
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
