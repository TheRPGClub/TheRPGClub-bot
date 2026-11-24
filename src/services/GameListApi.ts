import {
  apiGet,
  apiGetOrThrow,
  apiPostOrThrow,
} from "./RpgClubApiClient.js";

// The Game List endpoints the bot calls (spec api#442, ticket api#446), under
// /api/v1/game_lists. The shapes are the API's own (snake_case), as its swagger serves them.
// Every call names the member it acts for with acting_user_id: the API decides what they
// may read and change, applies the game_lists Feature Flag to them, and fills `viewer`.

export type GameListSort = "ranked" | "alphabetical" | "added";

/** A member as a Game List names them: its owner, or who the club took it over from. */
export interface IGameListMember {
  user_id: string;
  username: string;
  global_name: string | null;
}

/** A game on a Game List. `position` is its ranked place, whatever the list's sort. */
export interface IGameListEntry {
  game_id: number;
  position: number;
  note: string | null;
  added_at: string;
  game: {
    game_id: number;
    title: string;
    initial_release_date?: string | null;
    cover_url?: string | null;
  };
}

export interface IGameList {
  id: number;
  name: string;
  description: string | null;
  visibility: "members" | "private";
  sort: GameListSort;
  /** The club owns it (`owner` is null). */
  club: boolean;
  owner: IGameListMember | null;
  entry_count: number;
  /** What the acting member may do with it. */
  viewer: { can_edit: boolean; can_delete: boolean };
  /** A single list only: every game, in its sort's order. */
  entries?: IGameListEntry[];
  updated_at: string;
}

/** /api/v1/game_lists and friends, for the member the bot acts for. */
export interface IGameListApi {
  /** The member's own lists (all of them, Private included), most recently changed first. */
  ownLists(actingUserId: string): Promise<IGameList[]>;
  /** The lists the member may read whose name holds `query`, club lists first. */
  search(query: string, actingUserId: string): Promise<IGameList[]>;
  /** The club's lists. */
  clubLists(actingUserId: string): Promise<IGameList[]>;
  /** The lists holding the game that the member may read. */
  listsWithGame(gameId: number, actingUserId: string): Promise<IGameList[]>;
  /** The list with its entries, or null when there is none the member may read. */
  get(listId: number, actingUserId: string): Promise<IGameList | null>;
  /** Adds the game last. Throws the AxiosError on a refusal (409 already_in_list, ...). */
  addGame(listId: number, gameId: number, actingUserId: string): Promise<IGameListEntry>;
}

const LISTS_PATH = "/api/v1/game_lists";

/** Lists read per request: a member's or the club's lists, all in one page. */
export const GAME_LISTS_READ_PER = 100;

export function withQuery(path: string, query: Record<string, string | number>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) params.set(key, String(value));
  return `${path}?${params.toString()}`;
}

async function readLists(path: string, query: Record<string, string | number>) {
  const payload = await apiGetOrThrow<{ data: IGameList[] }>(
    withQuery(path, { ...query, page: 1, per: GAME_LISTS_READ_PER }),
  );
  return payload.data;
}

export const GAME_LIST_API: IGameListApi = {
  ownLists(actingUserId) {
    return readLists(`/api/v1/users/${encodeURIComponent(actingUserId)}/game_lists`, {
      acting_user_id: actingUserId,
    });
  },
  search(query, actingUserId) {
    const params: Record<string, string> = { acting_user_id: actingUserId };
    if (query.trim()) params.q = query.trim();
    return readLists(LISTS_PATH, params);
  },
  clubLists(actingUserId) {
    return readLists(LISTS_PATH, { acting_user_id: actingUserId, owner: "club" });
  },
  listsWithGame(gameId, actingUserId) {
    return readLists(`/api/v1/games/${gameId}/game_lists`, { acting_user_id: actingUserId });
  },
  async get(listId, actingUserId) {
    const payload = await apiGet<{ data: IGameList }>(
      withQuery(`${LISTS_PATH}/${listId}`, { acting_user_id: actingUserId }),
    );
    return payload?.data ?? null;
  },
  async addGame(listId, gameId, actingUserId) {
    const payload = await apiPostOrThrow<{ data: IGameListEntry }>(
      `${LISTS_PATH}/${listId}/entries/${gameId}`,
      { data: { acting_user_id: actingUserId } },
    );
    return payload.data;
  },
};
