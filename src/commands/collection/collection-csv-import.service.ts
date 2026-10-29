import axios from "axios";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Attachment,
} from "discord.js";
import { buildActionButton, buildButtonRow } from "../../functions/uiComponents.js";
import writeXlsxFile, { type Row } from "write-excel-file/node";
import type { ICsvImportIgdbCandidate } from "../../classes/CollectionCsvImport.js";
import { buildImportReasonSummary } from "./collection-import-ui.utils.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { parseCustomIdSegments } from "../../utilities/CustomIdUtils.js";
import { truncateLabel } from "../../config/textLimits.js";
import type { IgdbSelectOption } from "../../services/IGDB/IgdbSelectService.js";

export type CollectionCsvImportButtonAction = "skip" | "remap" | "game-id" | "pause";

/** The API rejects a larger file, so say so before downloading and uploading it. */
export const COLLECTION_CSV_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Each advance call auto-applies up to 25 rows, so a very large file needs many calls
 * before the first row that needs a person. Past this many calls the review stops and
 * asks the member to resume.
 */
export const CSV_IMPORT_MAX_ADVANCE_CALLS = 40;

const CSV_IMPORT_ERROR_MESSAGES: Record<string, string> = {
  import_not_active: "This CSV import is no longer active.",
  item_not_pending: "This import row is no longer pending.",
  game_not_found: "Could not find that game in GameDB.",
  igdb_game_not_found: "Could not find that game on IGDB.",
  game_id_or_igdb_id_required: "Enter a GameDB or IGDB ID.",
  invalid_igdb_id: "That is not a valid IGDB ID.",
  igdb_not_configured: "IGDB lookups are not set up on the server yet.",
  igdb_request_failed: "IGDB could not be reached. Try again in a few minutes.",
  title_required: "Enter a title to search for.",
};

/** How many validation problems one reply lists before it summarises the rest. */
const CSV_VALIDATION_LINES_SHOWN = 12;

export type CsvValidationProblem = { rowIndex: number; column: string; message: string };

/** The `error` code the API puts in a failed response body, if there is one. */
export function getCsvImportErrorCode(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  const code = (error.response?.data as { error?: unknown } | undefined)?.error;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}

/**
 * A short reason for an API failure the member can act on during review, or null for
 * anything unexpected. Starting an import has its own handling, because that request
 * carries the whole file.
 */
export function describeCsvImportError(error: unknown): string | null {
  const code = getCsvImportErrorCode(error);
  if (code && Object.hasOwn(CSV_IMPORT_ERROR_MESSAGES, code)) {
    return CSV_IMPORT_ERROR_MESSAGES[code] ?? null;
  }
  return null;
}

/**
 * The per line and column problems of a 422 `invalid_csv`, or null for any other error.
 * `row_index` is the physical line, with 1 being the header.
 */
export function readCsvValidationProblems(error: unknown): CsvValidationProblem[] | null {
  if (getCsvImportErrorCode(error) !== "invalid_csv") return null;
  const raw = (error as { response?: { data?: { errors?: unknown } } }).response?.data?.errors;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): CsvValidationProblem[] => {
    const value = entry as Partial<{ row_index: unknown; column: unknown; message: unknown }>;
    if (typeof value?.message !== "string") return [];
    return [{
      rowIndex: Number(value.row_index ?? 0),
      column: typeof value.column === "string" ? value.column : "file",
      message: value.message,
    }];
  });
}

export function buildCsvValidationLines(problems: CsvValidationProblem[]): string[] {
  const lines = problems
    .slice(0, CSV_VALIDATION_LINES_SHOWN)
    .map((problem) => `- Line ${problem.rowIndex}, ${problem.column}: ${problem.message}`);
  if (problems.length > CSV_VALIDATION_LINES_SHOWN) {
    lines.push(`- ...and ${problems.length - CSV_VALIDATION_LINES_SHOWN} more`);
  }
  return lines;
}

export function buildCsvIgdbSelectOptions(
  candidates: ICsvImportIgdbCandidate[],
): IgdbSelectOption[] {
  return candidates.slice(0, 50).map((candidate) => {
    const year = candidate.firstReleaseDate
      ? candidate.firstReleaseDate.getUTCFullYear()
      : "TBD";
    const summary = (candidate.summary ?? "No summary").replace(/\s+/g, " ").trim();
    return {
      id: candidate.igdbId,
      label: truncateLabel(`${candidate.name} (${year})`),
      description: truncateLabel(summary),
    };
  });
}

export const CSV_IMPORT_ACTION_PREFIX = "collection-csv-import-v1";
export const CSV_CHOOSE_PREFIX = "collection-csv-choose-v1";
export const CSV_REMAP_MODAL_PREFIX = "collection-csv-remap-v1";
export const CSV_REMAP_INPUT_ID = "collection-csv-remap-title";
export const CSV_GAME_ID_MODAL_PREFIX = "collection-csv-game-id-v1";
export const CSV_GAME_ID_INPUT_ID = "collection-csv-game-id";

export const CSV_IMPORT_REASON_LABELS: Record<string, string> = {
  DUPLICATE: "duplicate",
  MANUAL_SKIP: "manual-skip",
  ADD_FAILED: "add-failed",
  PLATFORM_UNRESOLVED: "platform-unresolved",
  NO_CANDIDATE: "no-candidate",
  INVALID_REMAP: "invalid-remap",
  INVALID_ROW: "invalid-row",
  CSV_GAMEDB_ID: "csv-gamedb-id",
  CSV_IGDB_ID: "csv-igdb-id",
};

export function buildCollectionCsvImportActionId(params: {
  ownerId: string;
  importId: number;
  itemId: number;
  action: CollectionCsvImportButtonAction;
}): string {
  const actionCode = params.action === "skip"
    ? "s"
    : params.action === "remap"
      ? "r"
      : params.action === "game-id"
        ? "i"
      : "p";
  return [
    CSV_IMPORT_ACTION_PREFIX,
    params.ownerId,
    String(params.importId),
    String(params.itemId),
    actionCode,
  ].join(":");
}

export function parseCollectionCsvImportActionId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
  action: CollectionCsvImportButtonAction;
} | null {
  if (!customId.startsWith(`${CSV_IMPORT_ACTION_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(customId, 4);
  if (!segs) return null;
  const [ownerId, importIdStr, itemIdStr, actionCode] = segs;
  const importId = Number(importIdStr);
  const itemId = Number(itemIdStr);
  if (!Number.isInteger(importId) || !Number.isInteger(itemId)) return null;
  if (!ownerId) return null;
  const action = actionCode === "s"
    ? "skip"
    : actionCode === "r"
      ? "remap"
      : actionCode === "i"
        ? "game-id"
      : actionCode === "p"
        ? "pause"
        : null;
  if (!action) return null;
  return { ownerId, importId, itemId, action };
}

export function buildCollectionCsvChooseId(params: {
  ownerId: string;
  importId: number;
  itemId: number;
  gameId: number;
}): string {
  return [
    CSV_CHOOSE_PREFIX,
    params.ownerId,
    String(params.importId),
    String(params.itemId),
    String(params.gameId),
  ].join(":");
}

export function parseCollectionCsvChooseId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
  gameId: number;
} | null {
  if (!customId.startsWith(`${CSV_CHOOSE_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(customId, 4);
  if (!segs) return null;
  const [ownerId, importIdStr, itemIdStr, gameIdStr] = segs;
  const importId = Number(importIdStr);
  const itemId = Number(itemIdStr);
  const gameId = Number(gameIdStr);
  if (!Number.isInteger(importId) || !Number.isInteger(itemId)) return null;
  if (!isPositiveInt(gameId)) return null;
  if (!ownerId) return null;
  return { ownerId, importId, itemId, gameId };
}

export function buildCollectionCsvRemapModalId(params: {
  ownerId: string;
  importId: number;
  itemId: number;
}): string {
  return [
    CSV_REMAP_MODAL_PREFIX,
    params.ownerId,
    String(params.importId),
    String(params.itemId),
  ].join(":");
}

export function parseCollectionCsvRemapModalId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
} | null {
  if (!customId.startsWith(`${CSV_REMAP_MODAL_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(customId, 3);
  if (!segs) return null;
  const [ownerId, importIdStr, itemIdStr] = segs;
  const importId = Number(importIdStr);
  const itemId = Number(itemIdStr);
  if (!Number.isInteger(importId) || !Number.isInteger(itemId)) return null;
  if (!ownerId) return null;
  return { ownerId, importId, itemId };
}

export function buildCollectionCsvGameIdModalId(params: {
  ownerId: string;
  importId: number;
  itemId: number;
}): string {
  return [
    CSV_GAME_ID_MODAL_PREFIX,
    params.ownerId,
    String(params.importId),
    String(params.itemId),
  ].join(":");
}

export function parseCollectionCsvGameIdModalId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
} | null {
  if (!customId.startsWith(`${CSV_GAME_ID_MODAL_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(customId, 3);
  if (!segs) return null;
  const [ownerId, importIdStr, itemIdStr] = segs;
  const importId = Number(importIdStr);
  const itemId = Number(itemIdStr);
  if (!Number.isInteger(importId) || !Number.isInteger(itemId)) return null;
  if (!ownerId) return null;
  return { ownerId, importId, itemId };
}

export function buildCsvImportItemMessage(params: {
  importId: number;
  rowIndex: number;
  totalCount: number;
  title: string;
  platformLabel: string;
  ownershipType: string;
  note: string | null;
  sourceGameDbId: number | null;
  sourceIgdbId: number | null;
  testMode: boolean;
}): string {
  const details = [
    `Platform: ${params.platformLabel}`,
    `Ownership: ${params.ownershipType}`,
  ];
  if (params.sourceGameDbId) {
    details.push(`CSV GameDB ID: ${params.sourceGameDbId}`);
  }
  if (params.sourceIgdbId) {
    details.push(`CSV IGDB ID: ${params.sourceIgdbId}`);
  }

  const noteText = params.note ? `\nNote: ${params.note}` : "";
  const testModeBanner = params.testMode
    ? "**TEST MODE** - nothing will be persisted\n"
    : "";
  return (
    `${testModeBanner}## CSV Import #${params.importId}\n` +
    `Row ${params.rowIndex}/${params.totalCount}\n` +
    `Title: **${params.title}**\n` +
    `${details.join(" | ")}${noteText}`
  );
}

export function buildCsvImportItemButtons(params: {
  ownerId: string;
  importId: number;
  itemId: number;
}): ActionRowBuilder<ButtonBuilder> {
  const base = { ownerId: params.ownerId, importId: params.importId, itemId: params.itemId };
  return buildButtonRow(
    buildActionButton({
      customId: buildCollectionCsvImportActionId({ ...base, action: "remap" }),
      label: "Search a different title",
      style: ButtonStyle.Primary,
    }),
    buildActionButton({
      customId: buildCollectionCsvImportActionId({ ...base, action: "game-id" }),
      label: "Enter GameDB or IGDB ID",
      style: ButtonStyle.Secondary,
    }),
    buildActionButton({
      customId: buildCollectionCsvImportActionId({ ...base, action: "skip" }),
      label: "Skip",
      style: ButtonStyle.Secondary,
    }),
    buildActionButton({
      customId: buildCollectionCsvImportActionId({ ...base, action: "pause" }),
      label: "Pause",
      style: ButtonStyle.Danger,
    }),
  );
}

export function logCsvImportEvent(
  message: string,
  meta: Record<string, string | number>,
): void {
  const entries = Object.entries(meta).map(([key, value]) => `${key}=${value}`);
  console.info(`[CsvImport] ${message} ${entries.join(" ")}`.trim());
}

export function buildCsvImportReasonSummary(reasonCounts: Record<string, number>): string[] {
  return buildImportReasonSummary(reasonCounts, CSV_IMPORT_REASON_LABELS);
}

export const COLLECTION_CSV_TEMPLATE_FILENAME = "rpgclub_collection_import_template_v1.xlsx";
export const COLLECTION_CSV_EXAMPLE_NOTE = "EXAMPLE ROW - DELETE BEFORE IMPORT";

const TEMPLATE_COLUMN_HEADERS = [
  "title",
  "platform",
  "ownership_type",
  "note",
  "gamedb_id",
  "igdb_id",
];

const GUIDE_COLUMN_HEADERS = ["Column", "Required", "Description", "Example"];

const GUIDE_ROWS = [
  ["title", "Yes", "Game title used for matching in GameDB.", "Chrono Trigger"],
  ["platform", "No", "Platform name or id. Leave blank if unknown.", "Switch"],
  [
    "ownership_type",
    "No",
    "Digital, Physical, Subscription, or Other. Defaults to Digital.",
    "Digital",
  ],
  ["note", "No", "Optional note, 500 characters max.", "Gifted copy from a friend"],
  [
    "gamedb_id",
    "No",
    "GameDB id to skip title matching. Only one of gamedb_id or igdb_id.",
    "12345",
  ],
  [
    "igdb_id",
    "No",
    "IGDB numeric id to import new titles. Only one of gamedb_id or igdb_id.",
    "1020",
  ],
];

function buildHeaderRow(labels: string[]): Row {
  return labels.map((value) => ({ value, type: String, fontWeight: "bold" }));
}

function buildTextRow(values: string[]): Row {
  return values.map((value) => ({ value: value || undefined, type: String }));
}

export async function buildCollectionCsvTemplateAttachment(): Promise<AttachmentBuilder> {
  const templateSheet = {
    sheet: "Template",
    data: [
      buildHeaderRow(TEMPLATE_COLUMN_HEADERS),
      buildTextRow([
        "The Legend of Zelda: Breath of the Wild",
        "Switch",
        "Physical",
        COLLECTION_CSV_EXAMPLE_NOTE,
        "",
        "",
      ]),
    ],
    columns: [
      { width: 38 },
      { width: 18 },
      { width: 18 },
      { width: 40 },
      { width: 12 },
      { width: 12 },
    ],
  };

  const guideSheet = {
    sheet: "Guide",
    data: [buildHeaderRow(GUIDE_COLUMN_HEADERS), ...GUIDE_ROWS.map(buildTextRow)],
    columns: [{ width: 18 }, { width: 10 }, { width: 60 }, { width: 24 }],
  };

  const buffer = await writeXlsxFile([templateSheet, guideSheet]).toBuffer();
  return new AttachmentBuilder(buffer, {
    name: COLLECTION_CSV_TEMPLATE_FILENAME,
  });
}

export async function fetchCsvAttachment(attachment: Attachment): Promise<string | null> {
  try {
    const response = await axios.get(attachment.url, { responseType: "arraybuffer" });
    return Buffer.from(response.data).toString("utf-8").replace(/^﻿/, "");
  } catch {
    return null;
  }
}
