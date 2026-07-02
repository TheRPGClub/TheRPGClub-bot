import {
  parseCustomIdSegments,
  validateCustomId,
} from "../../utilities/CustomIdUtils.js";
import {
  POKOPIA_BACK_PREFIX,
  POKOPIA_LIST_NAV_PREFIX,
  POKOPIA_SELECT_PREFIX,
} from "../../config/customIdPrefixes.js";
import type { PokopiaSortField, PokopiaSortOrder } from "./pokopia-data.service.js";

export type PokopiaKind = "pokemon" | "habitat";

interface IPokopiaListState {
  kind: PokopiaKind;
  ownerId: string;
  sort: PokopiaSortField;
  order: PokopiaSortOrder;
  page: number;
}

function encodeKind(kind: PokopiaKind): string {
  return kind === "pokemon" ? "p" : "h";
}

function decodeKind(code: string): PokopiaKind | null {
  if (code === "p") return "pokemon";
  if (code === "h") return "habitat";
  return null;
}

function encodeSort(sort: PokopiaSortField): string {
  return sort === "number" ? "n" : "a";
}

function decodeSort(code: string): PokopiaSortField | null {
  if (code === "n") return "number";
  if (code === "a") return "name";
  return null;
}

function encodeOrder(order: PokopiaSortOrder): string {
  return order === "desc" ? "d" : "u";
}

function decodeOrder(code: string): PokopiaSortOrder | null {
  if (code === "d") return "desc";
  if (code === "u") return "asc";
  return null;
}

export function buildPokopiaListNavId(
  state: IPokopiaListState & { direction: "prev" | "next" },
): string {
  return validateCustomId([
    POKOPIA_LIST_NAV_PREFIX,
    encodeKind(state.kind),
    state.ownerId,
    encodeSort(state.sort),
    encodeOrder(state.order),
    String(state.page),
    state.direction,
  ].join(":"));
}

export function parsePokopiaListNavId(customId: string): (IPokopiaListState & {
  direction: "prev" | "next";
}) | null {
  if (!customId.startsWith(`${POKOPIA_LIST_NAV_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(customId, 6);
  if (!segs) return null;
  const [kindCode, ownerId, sortCode, orderCode, pageRaw, direction] = segs;
  const kind = decodeKind(kindCode);
  const sort = decodeSort(sortCode);
  const order = decodeOrder(orderCode);
  const page = Number(pageRaw);
  if (!kind || !sort || !order || Number.isNaN(page)) return null;
  if (direction !== "prev" && direction !== "next") return null;
  return { kind, ownerId, sort, order, page, direction };
}

export function buildPokopiaSelectId(state: IPokopiaListState): string {
  return validateCustomId([
    POKOPIA_SELECT_PREFIX,
    encodeKind(state.kind),
    state.ownerId,
    encodeSort(state.sort),
    encodeOrder(state.order),
    String(state.page),
  ].join(":"));
}

export function parsePokopiaSelectId(customId: string): IPokopiaListState | null {
  if (!customId.startsWith(`${POKOPIA_SELECT_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(customId, 5);
  if (!segs) return null;
  const [kindCode, ownerId, sortCode, orderCode, pageRaw] = segs;
  const kind = decodeKind(kindCode);
  const sort = decodeSort(sortCode);
  const order = decodeOrder(orderCode);
  const page = Number(pageRaw);
  if (!kind || !sort || !order || Number.isNaN(page)) return null;
  return { kind, ownerId, sort, order, page };
}

export function buildPokopiaBackId(state: IPokopiaListState): string {
  return validateCustomId([
    POKOPIA_BACK_PREFIX,
    encodeKind(state.kind),
    state.ownerId,
    encodeSort(state.sort),
    encodeOrder(state.order),
    String(state.page),
  ].join(":"));
}

export function parsePokopiaBackId(customId: string): IPokopiaListState | null {
  if (!customId.startsWith(`${POKOPIA_BACK_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(customId, 5);
  if (!segs) return null;
  const [kindCode, ownerId, sortCode, orderCode, pageRaw] = segs;
  const kind = decodeKind(kindCode);
  const sort = decodeSort(sortCode);
  const order = decodeOrder(orderCode);
  const page = Number(pageRaw);
  if (!kind || !sort || !order || Number.isNaN(page)) return null;
  return { kind, ownerId, sort, order, page };
}
