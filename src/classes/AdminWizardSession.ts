import { oraQuery, oraMutate, oraWithConnection } from "../db/SqlManager.js";
import { getDialect } from "../db/dialect.js";
import { getSql } from "../db/SqlManager.js";
import { AdminWizardSessionSql } from "../db/sql/index.js";

const dialect = getDialect();

export const ADMIN_WIZARD_COMMANDS = ["nextround-setup"] as const;
export type AdminWizardCommand = (typeof ADMIN_WIZARD_COMMANDS)[number];

export const ADMIN_WIZARD_SESSION_STATUSES = ["active", "completed", "cancelled"] as const;
export type AdminWizardSessionStatus = (typeof ADMIN_WIZARD_SESSION_STATUSES)[number];

export const NEXT_ROUND_WIZARD_STEPS = [
  "start",
  "gotm-count",
  "gotm-select",
  "gotm-order",
  "nr-count",
  "nr-select",
  "nr-order",
  "date-choice",
  "date-input",
  "review",
  "commit",
] as const;
export type NextRoundWizardStep = (typeof NEXT_ROUND_WIZARD_STEPS)[number];

export interface INextRoundWizardState {
  step: NextRoundWizardStep;
  roundNumber: number | null;
  monthYear: string | null;
  selectedGotmNominationIds: number[];
  selectedNrGotmNominationIds: number[];
  selectedGotmOrder: number[];
  selectedNrGotmOrder: number[];
  gotmPickCount: number | null;
  nrPickCount: number | null;
  chosenVoteDateIso: string | null;
  testMode: boolean;
  stateLastUpdatedAt: Date;
}

export interface IAdminWizardSession {
  sessionId: string;
  commandKey: AdminWizardCommand;
  ownerUserId: string;
  channelId: string;
  guildId: string | null;
  status: AdminWizardSessionStatus;
  state: INextRoundWizardState;
  createdAt: Date;
  updatedAt: Date;
  lastUpdatedAt: Date;
}

type AdminWizardSessionRow = {
  SESSION_ID: string;
  COMMAND_KEY: string;
  OWNER_USER_ID: string;
  CHANNEL_ID: string;
  GUILD_ID: string | null;
  STATUS: string;
  STATE_JSON: string;
  LAST_UPDATED_AT: Date | string;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toDbStatus(status: AdminWizardSessionStatus): string {
  return status.toUpperCase();
}

function fromDbStatus(status: string): AdminWizardSessionStatus {
  const normalized = status.trim().toLowerCase();
  if (ADMIN_WIZARD_SESSION_STATUSES.includes(normalized as AdminWizardSessionStatus)) {
    return normalized as AdminWizardSessionStatus;
  }
  throw new Error(`Unknown admin wizard status: ${status}`);
}

function sanitizeNumberArray(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function parseNextRoundWizardState(raw: string): INextRoundWizardState {
  let parsed: any = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }

  const rawStep = String(parsed?.step ?? "start");
  const step = NEXT_ROUND_WIZARD_STEPS.includes(rawStep as NextRoundWizardStep)
    ? (rawStep as NextRoundWizardStep)
    : "start";

  const roundNumber = parsed?.roundNumber == null ? null : Number(parsed.roundNumber);
  const normalizedRoundNumber =
    roundNumber !== null && Number.isInteger(roundNumber) && roundNumber > 0
      ? roundNumber
      : null;

  const monthYear =
    typeof parsed?.monthYear === "string" && parsed.monthYear.trim()
      ? parsed.monthYear.trim()
      : null;

  const chosenVoteDateIso =
    typeof parsed?.chosenVoteDateIso === "string" && parsed.chosenVoteDateIso.trim()
      ? parsed.chosenVoteDateIso.trim()
      : null;

  const parsedUpdated = parsed?.stateLastUpdatedAt
    ? new Date(parsed.stateLastUpdatedAt)
    : new Date();
  const stateLastUpdatedAt =
    Number.isNaN(parsedUpdated.getTime()) ? new Date() : parsedUpdated;

  return {
    step,
    roundNumber: normalizedRoundNumber,
    monthYear,
    selectedGotmNominationIds: sanitizeNumberArray(parsed?.selectedGotmNominationIds),
    selectedNrGotmNominationIds: sanitizeNumberArray(parsed?.selectedNrGotmNominationIds),
    selectedGotmOrder: sanitizeNumberArray(parsed?.selectedGotmOrder),
    selectedNrGotmOrder: sanitizeNumberArray(parsed?.selectedNrGotmOrder),
    gotmPickCount:
      Number.isInteger(Number(parsed?.gotmPickCount)) &&
      Number(parsed?.gotmPickCount) > 0
        ? Number(parsed?.gotmPickCount)
        : null,
    nrPickCount:
      Number.isInteger(Number(parsed?.nrPickCount)) && Number(parsed?.nrPickCount) > 0
        ? Number(parsed?.nrPickCount)
        : null,
    chosenVoteDateIso,
    testMode: Boolean(parsed?.testMode),
    stateLastUpdatedAt,
  };
}

function serializeNextRoundWizardState(state: INextRoundWizardState): string {
  return JSON.stringify({
    ...state,
    stateLastUpdatedAt: state.stateLastUpdatedAt.toISOString(),
  });
}

function mapAdminWizardSessionRow(row: AdminWizardSessionRow): IAdminWizardSession {
  return {
    sessionId: row.SESSION_ID,
    commandKey: row.COMMAND_KEY as AdminWizardCommand,
    ownerUserId: row.OWNER_USER_ID,
    channelId: row.CHANNEL_ID,
    guildId: row.GUILD_ID,
    status: fromDbStatus(row.STATUS),
    state: parseNextRoundWizardState(row.STATE_JSON),
    createdAt: toDate(row.CREATED_AT),
    updatedAt: toDate(row.UPDATED_AT),
    lastUpdatedAt: toDate(row.LAST_UPDATED_AT),
  };
}

export function createDefaultNextRoundWizardState(
  testMode: boolean,
): INextRoundWizardState {
  return {
    step: "start",
    roundNumber: null,
    monthYear: null,
    selectedGotmNominationIds: [],
    selectedNrGotmNominationIds: [],
    selectedGotmOrder: [],
    selectedNrGotmOrder: [],
    gotmPickCount: null,
    nrPickCount: null,
    chosenVoteDateIso: null,
    testMode,
    stateLastUpdatedAt: new Date(),
  };
}

export async function getActiveAdminWizardSession(
  commandKey: AdminWizardCommand,
  ownerUserId: string,
  channelId: string,
): Promise<IAdminWizardSession | null> {
  const rows = await oraQuery(
    getSql(AdminWizardSessionSql.getActive, dialect),
    { commandKey, ownerUserId, channelId },
    mapAdminWizardSessionRow,
  );
  return rows[0] ?? null;
}

export async function saveAdminWizardSession(params: {
  commandKey: AdminWizardCommand;
  ownerUserId: string;
  channelId: string;
  guildId?: string | null;
  state: INextRoundWizardState;
}): Promise<IAdminWizardSession> {
  const normalizedState: INextRoundWizardState = {
    ...params.state,
    stateLastUpdatedAt: new Date(),
  };
  const stateJson = serializeNextRoundWizardState(normalizedState);
  const now = new Date();
  const uniqueSessionId = [
    "wiz",
    params.commandKey,
    params.ownerUserId,
    params.channelId,
    Date.now().toString(),
    Math.floor(Math.random() * 1_000_000).toString(),
  ].join("-");

  await oraMutate(
    getSql(AdminWizardSessionSql.saveSession, dialect),
    {
      commandKey: params.commandKey,
      ownerUserId: params.ownerUserId,
      channelId: params.channelId,
      guildId: params.guildId ?? null,
      stateJson,
      lastUpdatedAt: now,
      sessionId: uniqueSessionId,
    },
  );

  const saved = await getActiveAdminWizardSession(
    params.commandKey,
    params.ownerUserId,
    params.channelId,
  );
  if (!saved) {
    throw new Error("Failed to save admin wizard session.");
  }
  return saved;
}

export async function closeActiveAdminWizardSession(params: {
  commandKey: AdminWizardCommand;
  ownerUserId: string;
  channelId: string;
  status: Exclude<AdminWizardSessionStatus, "active">;
}): Promise<boolean> {
  return oraWithConnection(async (conn) => {
    // Remove any prior historical row to avoid unique index collision when
    // promoting ACTIVE -> CANCELLED/COMPLETED.
    await conn.execute(
      getSql(AdminWizardSessionSql.deleteHistorical, dialect),
      {
        commandKey: params.commandKey,
        ownerUserId: params.ownerUserId,
        channelId: params.channelId,
        status: toDbStatus(params.status),
      },
      { autoCommit: true },
    );

    const result = await conn.execute(
      getSql(AdminWizardSessionSql.updateStatus, dialect),
      {
        status: toDbStatus(params.status),
        lastUpdatedAt: new Date(),
        commandKey: params.commandKey,
        ownerUserId: params.ownerUserId,
        channelId: params.channelId,
      },
      { autoCommit: true },
    );
    return Number(result.rowsAffected ?? 0) > 0;
  });
}
