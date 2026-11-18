import { buildApiRefusalMessage } from "../utilities/ApiErrorUtils.js";
import {
  apiDelete,
  apiGet,
  apiGetOrThrow,
  apiPatchOrThrow,
  apiPostOrThrow,
} from "./RpgClubApiClient.js";

// The Club Codex endpoints the bot calls (spec api#397, ticket api#404), under
// /api/v1/codex. The shapes are the API's own (snake_case), as its swagger serves them.
// Every call names the member it acts for with acting_user_id: the API decides from that
// member's stored roles and Feature Flag, and fills each entry's `viewer` for them.

export type CodexPart = "history_event" | "lore_entry" | "fun_fact";

/** A member as an entry shows them: the author, or a member `body` mentions. */
export interface ICodexMember {
  user_id: string;
  /** The name they go by now (their last known one once they have left). */
  name: string;
  avatar_url: string;
}

/** One Club Codex entry, for every part. */
export interface ICodexEntry {
  id: number;
  part: CodexPart;
  title: string | null;
  rich_body: Record<string, unknown> | null;
  /** The Discord text, members mentioned as `<@discord_id>` tokens. */
  body: string | null;
  occurred_on: string | null;
  date_precision: "day" | "month" | "year" | null;
  kind: "founding" | "staff" | "platform" | "rules" | "milestone" | null;
  author: ICodexMember;
  /** Each known member `body` mentions, keyed by Discord id. */
  mentions: Record<string, ICodexMember>;
  images: { id: number; url: string; position: number }[];
  links: { id: number; part: CodexPart; title: string }[];
  /** What the acting member may do with it (all false when no member was named). */
  viewer: { can_edit: boolean; can_delete: boolean };
  created_at: string;
  updated_at: string;
}

/** /api/v1/codex/fun_facts, for the member the bot acts for. */
export interface IFunFactApi {
  /** One page of Fun Facts, newest first. */
  list(actingUserId: string, page: number, per: number): Promise<ICodexEntry[]>;
  /**
   * The Fun Fact, or null when there is no such Fun Fact. With no member named, it is read
   * as the bot itself (the Daily Fun Fact), and `viewer` is all false.
   */
  get(id: number, actingUserId?: string): Promise<ICodexEntry | null>;
  /** Adds a Fun Fact credited to the member. Throws the AxiosError on a refusal. */
  create(body: string, actingUserId: string): Promise<ICodexEntry>;
  /** Replaces a Fun Fact's text. Throws the AxiosError on a refusal. */
  edit(id: number, body: string, actingUserId: string): Promise<ICodexEntry>;
  /** Deletes a Fun Fact: false when it was already gone. Throws on a refusal. */
  remove(id: number, actingUserId: string): Promise<boolean>;
  /**
   * Draws the next Fun Fact in the queue for the member (/funfact), which marks it shown;
   * null when there are none. Throws the AxiosError on a refusal.
   */
  draw(actingUserId: string): Promise<ICodexEntry | null>;
}

const CODEX_PATH = "/api/v1/codex";
const FUN_FACTS_PATH = `${CODEX_PATH}/fun_facts`;

function withQuery(path: string, query: Record<string, string | number>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) params.set(key, String(value));
  return `${path}?${params.toString()}`;
}

export const FUN_FACT_API: IFunFactApi = {
  async list(actingUserId, page, per) {
    const payload = await apiGetOrThrow<{ data: ICodexEntry[] }>(
      withQuery(FUN_FACTS_PATH, { acting_user_id: actingUserId, page, per }),
    );
    return payload.data;
  },
  async get(id, actingUserId) {
    const path = `${FUN_FACTS_PATH}/${id}`;
    const payload = await apiGet<{ data: ICodexEntry }>(
      actingUserId === undefined ? path : withQuery(path, { acting_user_id: actingUserId }),
    );
    return payload?.data ?? null;
  },
  async create(body, actingUserId) {
    const payload = await apiPostOrThrow<{ data: ICodexEntry }>(
      FUN_FACTS_PATH,
      { data: { body, acting_user_id: actingUserId } },
    );
    return payload.data;
  },
  async edit(id, body, actingUserId) {
    const payload = await apiPatchOrThrow<{ data: ICodexEntry }>(
      `${FUN_FACTS_PATH}/${id}`,
      { data: { body, acting_user_id: actingUserId } },
    );
    return payload.data;
  },
  async remove(id, actingUserId) {
    const payload = await apiDelete<{ data: { id: number; deleted: boolean } }>(
      withQuery(`${FUN_FACTS_PATH}/${id}`, { acting_user_id: actingUserId }),
    );
    return payload !== null;
  },
  async draw(actingUserId) {
    // The draw answers `{ fun_fact }`, not the `{ data }` of the other Fun Fact endpoints.
    const payload = await apiPostOrThrow<{ fun_fact: ICodexEntry | null }>(
      `${FUN_FACTS_PATH}/draw`,
      { data: { acting_user_id: actingUserId } },
    );
    return payload.fun_fact ?? null;
  },
};

/**
 * A failed Club Codex call as the member reads it: the API's own `message` for a refusal
 * (403 `forbidden` or `feature_unavailable`, 422 `invalid_entry`), else the fallback, with
 * the request and the response.
 */
export function codexRefusalText(err: unknown, fallback: string): string {
  return buildApiRefusalMessage(err, fallback);
}
