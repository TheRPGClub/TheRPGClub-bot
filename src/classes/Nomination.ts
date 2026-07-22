import { isPositiveInt } from "../utilities/ValidationUtils.js";
import { apiGet, apiPost, apiDelete } from "../services/RpgClubApiClient.js";

export type NominationKind = "gotm" | "nr-gotm";

export const NOMINATION_KINDS: readonly NominationKind[] = ["gotm", "nr-gotm"];

export interface INominationEntry {
  id: number;
  roundNumber: number;
  userId: string;
  gameTitle: string;
  gamedbGameId: number;
  nominatedAt: Date;
  reason: string | null;
}

export function nominationApiPrefix(kind: NominationKind): string {
  return kind === "gotm" ? "gotm_entries" : "nr_gotm_entries";
}

export function parseNominationKind(value: string): NominationKind | null {
  if (value === "gotm" || value === "nr-gotm") {
    return value;
  }
  return null;
}

export function nominationKindLabel(kind: NominationKind): string {
  return kind === "gotm" ? "GOTM" : "NR-GOTM";
}

type NominationApiData = {
  nomination_id: number;
  round_number: number;
  user_id: string;
  gamedb_game_id: number | null;
  reason: string | null;
  nominated_at: string;
  game: { title?: string } | null;
};

type NominationListApiResponse = { data: NominationApiData[] };
type NominationSingleApiResponse = { data: NominationApiData };

function mapApiData(d: NominationApiData): INominationEntry {
  const gamedbGameId = Number(d.gamedb_game_id);
  const gameTitle = d.game?.title ?? `(missing GameDB title for id ${gamedbGameId})`;
  return {
    id: Number(d.nomination_id),
    roundNumber: Number(d.round_number),
    userId: String(d.user_id),
    gameTitle,
    gamedbGameId,
    nominatedAt: new Date(d.nominated_at),
    reason: d.reason ?? null,
  };
}

export async function getNominationForUser(
  kind: NominationKind,
  roundNumber: number,
  userId: string,
): Promise<INominationEntry | null> {
  const response = await apiGet<NominationSingleApiResponse>(
    `/api/v1/${nominationApiPrefix(kind)}/${roundNumber}/nominations/${userId}`,
  );
  return response ? mapApiData(response.data) : null;
}

export async function upsertNomination(
  kind: NominationKind,
  roundNumber: number,
  userId: string,
  gamedbGameId: number,
  reason: string | null,
): Promise<INominationEntry> {
  if (!isPositiveInt(gamedbGameId)) {
    throw new Error("A valid GameDB game id is required to save a nomination.");
  }

  const response = await apiPost<NominationSingleApiResponse>(
    `/api/v1/${nominationApiPrefix(kind)}/${roundNumber}/nominations`,
    { data: { user_id: userId, gamedb_game_id: gamedbGameId, reason } },
  );
  if (!response) {
    throw new Error("Nomination upsert failed to return a row.");
  }
  return mapApiData(response.data);
}

export async function deleteNominationForUser(
  kind: NominationKind,
  roundNumber: number,
  userId: string,
): Promise<boolean> {
  const response = await apiDelete<{ deleted: boolean }>(
    `/api/v1/${nominationApiPrefix(kind)}/${roundNumber}/nominations/${userId}`,
  );
  return response?.deleted === true;
}

export async function listNominationsForRound(
  kind: NominationKind,
  roundNumber: number,
): Promise<INominationEntry[]> {
  const response = await apiGet<NominationListApiResponse>(
    `/api/v1/${nominationApiPrefix(kind)}/${roundNumber}/nominations`,
    { params: { per: 500 } },
  );
  return (response?.data ?? []).map(mapApiData);
}
