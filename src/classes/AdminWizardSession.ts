import { apiGet, apiPost, apiPatch, apiDelete } from "../services/RpgClubApiClient.js";
import { isPositiveInt } from "../utilities/ValidationUtils.js";

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

type WizardSessionApiData = {
  session_id: string;
  command_key: string;
  owner_user_id: string;
  channel_id: string;
  guild_id: string | null;
  status: string;
  state_json: string;
  last_updated_at: string;
  created_at: string;
  updated_at: string;
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
    .filter(isPositiveInt);
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
    roundNumber !== null && isPositiveInt(roundNumber)
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
      isPositiveInt(Number(parsed?.gotmPickCount))
        ? Number(parsed?.gotmPickCount)
        : null,
    nrPickCount:
      isPositiveInt(Number(parsed?.nrPickCount))
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

function mapWizardSessionFromApi(data: WizardSessionApiData): IAdminWizardSession {
  return {
    sessionId: data.session_id,
    commandKey: data.command_key as AdminWizardCommand,
    ownerUserId: data.owner_user_id,
    channelId: data.channel_id,
    guildId: data.guild_id,
    status: fromDbStatus(data.status),
    state: parseNextRoundWizardState(data.state_json),
    createdAt: toDate(data.created_at),
    updatedAt: toDate(data.updated_at),
    lastUpdatedAt: toDate(data.last_updated_at),
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
  const result = await apiGet<{ data: WizardSessionApiData }>(
    `/api/v1/users/${ownerUserId}/wizard_sessions`,
    { params: { command_key: commandKey, channel_id: channelId } },
  );
  return result?.data ? mapWizardSessionFromApi(result.data) : null;
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

  const result = await apiPost<{ data: WizardSessionApiData }>(
    `/api/v1/users/${params.ownerUserId}/wizard_sessions`,
    {
      data: {
        command_key: params.commandKey,
        channel_id: params.channelId,
        guild_id: params.guildId ?? null,
        state_json: stateJson,
      },
    },
  );
  if (!result?.data) {
    throw new Error("Failed to save admin wizard session.");
  }
  return mapWizardSessionFromApi(result.data);
}

export async function closeActiveAdminWizardSession(params: {
  commandKey: AdminWizardCommand;
  ownerUserId: string;
  channelId: string;
  status: Exclude<AdminWizardSessionStatus, "active">;
}): Promise<boolean> {
  const active = await getActiveAdminWizardSession(
    params.commandKey,
    params.ownerUserId,
    params.channelId,
  );
  if (!active) return false;

  // Remove any prior historical row to avoid unique index collision when
  // promoting ACTIVE -> CANCELLED/COMPLETED.
  await apiDelete(`/api/v1/users/${params.ownerUserId}/wizard_sessions`, {
    params: { command_key: params.commandKey, channel_id: params.channelId },
  });

  const result = await apiPatch<{ data: WizardSessionApiData }>(
    `/api/v1/wizard_sessions/${active.sessionId}`,
    { data: { status: toDbStatus(params.status) } },
  );
  return Boolean(result?.data);
}
