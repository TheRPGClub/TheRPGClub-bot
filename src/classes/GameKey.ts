import { apiGet, apiPost, apiDelete } from "../services/RpgClubApiClient.js";

export interface IGameKey {
  keyId: number;
  gameTitle: string;
  platform: string;
  keyValue: string;
  donorUserId: string;
  claimedByUserId: string | null;
  claimedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

type GameKeyApiData = {
  key_id: number;
  game_title: string;
  platform: string;
  key_value: string;
  donor_user_id: string;
  claimed_by_user_id: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
};

type GameKeyResponse = { data: GameKeyApiData };
type GameKeyListResponse = {
  data: GameKeyApiData[];
  meta: { count: number; pages: number };
};

function mapGameKeyApi(d: GameKeyApiData): IGameKey {
  return {
    keyId: Number(d.key_id),
    gameTitle: d.game_title,
    platform: d.platform,
    keyValue: d.key_value,
    donorUserId: d.donor_user_id,
    claimedByUserId: d.claimed_by_user_id ?? null,
    claimedAt: d.claimed_at ? new Date(d.claimed_at) : null,
    createdAt: new Date(d.created_at),
    updatedAt: new Date(d.updated_at),
  };
}

export async function createGameKey(
  title: string,
  platform: string,
  keyValue: string,
  donorUserId: string,
): Promise<IGameKey> {
  const response = await apiPost<GameKeyResponse>("/api/v1/game_keys", {
    data: {
      game_title: title,
      platform,
      key_value: keyValue,
      donor_user_id: donorUserId,
    },
  });
  if (!response) throw new Error("Failed to create game key.");
  return mapGameKeyApi(response.data);
}

export async function countAvailableGameKeys(): Promise<number> {
  const response = await apiGet<GameKeyListResponse>("/api/v1/game_keys", {
    params: { per: 1 },
  });
  return response?.meta?.count ?? 0;
}

export async function listAvailableGameKeys(
  offset: number,
  limit: number,
): Promise<IGameKey[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const safeOffset = Math.max(offset, 0);
  const response = await apiGet<GameKeyListResponse>("/api/v1/game_keys", {
    params: { offset: safeOffset, limit: safeLimit },
  });
  if (!response) return [];
  return response.data.map(mapGameKeyApi);
}

export async function listKeysByDonor(userId: string): Promise<IGameKey[]> {
  const response = await apiGet<GameKeyListResponse>(
    `/api/v1/users/${userId}/game_keys`,
  );
  if (!response) return [];
  return response.data.map(mapGameKeyApi);
}

export async function claimGameKey(
  keyId: number,
  userId: string,
): Promise<boolean> {
  const response = await apiPost<GameKeyResponse>(
    `/api/v1/game_keys/${keyId}/claim`,
    { data: { claimed_by_user_id: userId } },
  );
  return response !== null;
}

export async function getGameKeyById(keyId: number): Promise<IGameKey | null> {
  const response = await apiGet<GameKeyResponse>(`/api/v1/game_keys/${keyId}`);
  if (!response) return null;
  return mapGameKeyApi(response.data);
}

export async function revokeGameKey(keyId: number): Promise<boolean> {
  const response = await apiDelete<{ deleted: boolean }>(
    `/api/v1/game_keys/${keyId}`,
  );
  return response?.deleted === true;
}
