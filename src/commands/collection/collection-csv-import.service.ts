import axios from "axios";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Attachment,
} from "discord.js";
import ExcelJS from "exceljs";
import {
  COLLECTION_OWNERSHIP_TYPES,
  type CollectionOwnershipType,
} from "../../classes/UserGameCollection.js";
import { GAMEDB_CSV_PLATFORM_MAP } from "../../config/gamedbCsvPlatformMap.js";
import { sanitizeUserInput } from "../../functions/InteractionUtils.js";
import { resolveGameCompletionPlatformId } from "../game-completion/completion-autocomplete.utils.js";
import { buildImportReasonSummary } from "./collection-import-ui.utils.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";

export type CollectionCsvImportButtonAction = "skip" | "remap" | "game-id" | "pause";

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
  const parts = customId.split(":");
  if (parts.length !== 5) return null;
  if (parts[0] !== CSV_IMPORT_ACTION_PREFIX) return null;
  const importId = Number(parts[2]);
  const itemId = Number(parts[3]);
  if (!Number.isInteger(importId) || !Number.isInteger(itemId)) return null;
  if (!parts[1]) return null;
  const action = parts[4] === "s"
    ? "skip"
    : parts[4] === "r"
      ? "remap"
      : parts[4] === "i"
        ? "game-id"
      : parts[4] === "p"
        ? "pause"
        : null;
  if (!action) return null;
  return { ownerId: parts[1], importId, itemId, action };
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
  const parts = customId.split(":");
  if (parts.length !== 5) return null;
  if (parts[0] !== CSV_CHOOSE_PREFIX) return null;
  const importId = Number(parts[2]);
  const itemId = Number(parts[3]);
  const gameId = Number(parts[4]);
  if (!Number.isInteger(importId) || !Number.isInteger(itemId)) return null;
  if (!isPositiveInt(gameId)) return null;
  if (!parts[1]) return null;
  return { ownerId: parts[1], importId, itemId, gameId };
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
  const parts = customId.split(":");
  if (parts.length !== 4) return null;
  if (parts[0] !== CSV_REMAP_MODAL_PREFIX) return null;
  const importId = Number(parts[2]);
  const itemId = Number(parts[3]);
  if (!Number.isInteger(importId) || !Number.isInteger(itemId)) return null;
  if (!parts[1]) return null;
  return { ownerId: parts[1], importId, itemId };
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
  const parts = customId.split(":");
  if (parts.length !== 4) return null;
  if (parts[0] !== CSV_GAME_ID_MODAL_PREFIX) return null;
  const importId = Number(parts[2]);
  const itemId = Number(parts[3]);
  if (!Number.isInteger(importId) || !Number.isInteger(itemId)) return null;
  if (!parts[1]) return null;
  return { ownerId: parts[1], importId, itemId };
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
  return (
    `## CSV Import #${params.importId}\n` +
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
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
         
        buildCollectionCsvImportActionId({
          ownerId: params.ownerId,
          importId: params.importId,
          itemId: params.itemId,
          action: "remap",
        }),
      )
      .setLabel("Search a different title")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(
         
        buildCollectionCsvImportActionId({
          ownerId: params.ownerId,
          importId: params.importId,
          itemId: params.itemId,
          action: "game-id",
        }),
      )
      .setLabel("Enter GameDB or IGDB ID")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(
         
        buildCollectionCsvImportActionId({
          ownerId: params.ownerId,
          importId: params.importId,
          itemId: params.itemId,
          action: "skip",
        }),
      )
      .setLabel("Skip")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(
         
        buildCollectionCsvImportActionId({
          ownerId: params.ownerId,
          importId: params.importId,
          itemId: params.itemId,
          action: "pause",
        }),
      )
      .setLabel("Pause")
      .setStyle(ButtonStyle.Danger),
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

export type CollectionCsvParsedRow = {
  rowIndex: number;
  title: string;
  platformRaw: string | null;
  platformId: number | null;
  ownershipRaw: string | null;
  ownershipType: CollectionOwnershipType;
  noteRaw: string | null;
  note: string | null;
  sourceGameDbId: number | null;
  sourceIgdbId: number | null;
};

export type CsvValidationError = {
  rowIndex: number;
  column: string;
  message: string;
};

export const COLLECTION_CSV_TEMPLATE_VERSION = "1.0";
export const COLLECTION_CSV_TEMPLATE_FILENAME = "rpgclub_collection_import_template_v1.xlsx";
export const COLLECTION_CSV_EXAMPLE_NOTE = "EXAMPLE ROW - DELETE BEFORE IMPORT";

const HEADER_ALIASES: Record<string, string> = {
  title: "title",
  game: "title",
  game_title: "title",
  game_title_name: "title",
  game_name: "title",
  "game title": "title",
  platform: "platform",
  platform_name: "platform",
  platform_id: "platform",
  ownership: "ownership_type",
  ownership_type: "ownership_type",
  ownershiptype: "ownership_type",
  "ownership type": "ownership_type",
  note: "note",
  notes: "note",
  gamedb_id: "gamedb_id",
  gamedb: "gamedb_id",
  "gamedb id": "gamedb_id",
  igdb_id: "igdb_id",
  igdb: "igdb_id",
  "igdb id": "igdb_id",
};

const REQUIRED_HEADERS = ["title"];

export async function buildCollectionCsvTemplateAttachment(): Promise<AttachmentBuilder> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "RPGClubBotTs";
  workbook.created = new Date();

  const templateSheet = workbook.addWorksheet("Template");
  templateSheet.addRow([
    "title",
    "platform",
    "ownership_type",
    "note",
    "gamedb_id",
    "igdb_id",
  ]);
  templateSheet.addRow([
    "The Legend of Zelda: Breath of the Wild",
    "Switch",
    "Physical",
    COLLECTION_CSV_EXAMPLE_NOTE,
    "",
    "",
  ]);
  templateSheet.columns = [
    { width: 38 },
    { width: 18 },
    { width: 18 },
    { width: 40 },
    { width: 12 },
    { width: 12 },
  ];
  templateSheet.getRow(1).font = { bold: true };

  const guideSheet = workbook.addWorksheet("Guide");
  guideSheet.addRow(["Column", "Required", "Description", "Example"]);
  guideSheet.addRow([
    "title",
    "Yes",
    "Game title used for matching in GameDB.",
    "Chrono Trigger",
  ]);
  guideSheet.addRow([
    "platform",
    "No",
    "Platform name or id. Leave blank if unknown.",
    "Switch",
  ]);
  guideSheet.addRow([
    "ownership_type",
    "No",
    "Digital, Physical, Subscription, or Other. Defaults to Digital.",
    "Digital",
  ]);
  guideSheet.addRow([
    "note",
    "No",
    "Optional note, 500 characters max.",
    "Gifted copy from a friend",
  ]);
  guideSheet.addRow([
    "gamedb_id",
    "No",
    "GameDB id to skip title matching. Only one of gamedb_id or igdb_id.",
    "12345",
  ]);
  guideSheet.addRow([
    "igdb_id",
    "No",
    "IGDB numeric id to import new titles. Only one of gamedb_id or igdb_id.",
    "1020",
  ]);
  guideSheet.columns = [
    { width: 18 },
    { width: 10 },
    { width: 60 },
    { width: 24 },
  ];
  guideSheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return new AttachmentBuilder(Buffer.from(buffer), {
    name: COLLECTION_CSV_TEMPLATE_FILENAME,
  });
}

export async function fetchCsvAttachment(attachment: Attachment): Promise<string | null> {
  try {
    const response = await axios.get(attachment.url, { responseType: "arraybuffer" });
    return Buffer.from(response.data).toString("utf-8");
  } catch {
    return null;
  }
}

export async function parseCollectionCsvImportText(csvText: string): Promise<{
  rows: CollectionCsvParsedRow[];
  errors: CsvValidationError[];
}> {
  const normalizedText = csvText.replace(/^\uFEFF/, "");
  const { rows, errors: parseErrors } = parseCsvText(normalizedText);
  if (parseErrors.length) {
    return { rows: [], errors: parseErrors };
  }

  if (!rows.length) {
    return {
      rows: [],
      errors: [{
        rowIndex: 1,
        column: "file",
        message: "CSV file is empty.",
      }],
    };
  }

  const [headerRow, ...dataRows] = rows;
  const headerValues = headerRow?.values ?? [];
  const headerMap = buildHeaderMap(headerValues);
  const headerErrors = validateHeaders(headerMap);
  if (headerErrors.length) {
    return { rows: [], errors: headerErrors };
  }

  const results: CollectionCsvParsedRow[] = [];
  const validationErrors: CsvValidationError[] = [];

  for (const row of dataRows) {
    const rowIndex = row.rowIndex;
    const values = row.values;
    if (values.every((value) => !String(value ?? "").trim())) {
      continue;
    }

    const title = getColumnValue(values, headerMap, "title");
    const platformRaw = getColumnValue(values, headerMap, "platform");
    const ownershipRaw = getColumnValue(values, headerMap, "ownership_type");
    const noteRaw = getColumnValue(values, headerMap, "note");
    const gameDbRaw = getColumnValue(values, headerMap, "gamedb_id");
    const igdbRaw = getColumnValue(values, headerMap, "igdb_id");

    if (noteRaw && noteRaw.toUpperCase().includes("EXAMPLE ROW")) {
      continue;
    }

    const rowErrors: CsvValidationError[] = [];
    if (!title) {
      rowErrors.push({
        rowIndex,
        column: "title",
        message: "Title is required.",
      });
    }

    let gameDbId: number | null = null;
    if (gameDbRaw) {
      gameDbId = parsePositiveInteger(gameDbRaw);
      if (!gameDbId) {
        rowErrors.push({
          rowIndex,
          column: "gamedb_id",
          message: "GameDB id must be a positive number.",
        });
      }
    }

    let igdbId: number | null = null;
    if (igdbRaw) {
      igdbId = parsePositiveInteger(igdbRaw);
      if (!igdbId) {
        rowErrors.push({
          rowIndex,
          column: "igdb_id",
          message: "IGDB id must be a positive number.",
        });
      }
    }

    if (gameDbId && igdbId) {
      rowErrors.push({
        rowIndex,
        column: "gamedb_id",
        message: "Provide only one of gamedb_id or igdb_id.",
      });
    }

    const ownershipType = normalizeOwnershipType(ownershipRaw, rowIndex, rowErrors);

    const note = noteRaw ? sanitizeValue(noteRaw) : null;
    if (note && note.length > 500) {
      rowErrors.push({
        rowIndex,
        column: "note",
        message: "Note must be 500 characters or fewer.",
      });
    }

    let platformId: number | null = null;
    if (platformRaw) {
      platformId = await resolveCsvPlatformId(platformRaw);
      if (!platformId) {
        rowErrors.push({
          rowIndex,
          column: "platform",
          message: "Platform not recognized. Use a platform name or id.",
        });
      }
    }

    if (rowErrors.length) {
      validationErrors.push(...rowErrors);
      continue;
    }

    results.push({
      rowIndex,
      title,
      platformRaw: platformRaw || null,
      platformId,
      ownershipRaw: ownershipRaw || null,
      ownershipType,
      noteRaw: noteRaw || null,
      note: note ?? null,
      sourceGameDbId: gameDbId,
      sourceIgdbId: igdbId,
    });
  }

  return { rows: results, errors: validationErrors };
}

function parseCsvText(csvText: string): {
  rows: Array<{ rowIndex: number; values: string[] }>;
  errors: CsvValidationError[];
} {
  const rows: Array<{ rowIndex: number; values: string[] }> = [];
  const errors: CsvValidationError[] = [];

  let currentRow: string[] = [];
  let currentValue = "";
  let inQuotes = false;
  let rowIndex = 1;
  let columnIndex = 1;

  const pushValue = () => {
    currentRow.push(currentValue);
    currentValue = "";
    columnIndex += 1;
  };

  const pushRow = () => {
    rows.push({ rowIndex, values: currentRow });
    currentRow = [];
    rowIndex += 1;
    columnIndex = 1;
  };

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    const next = csvText[i + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        currentValue += "\"";
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      pushValue();
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      pushValue();
      pushRow();
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      continue;
    }

    currentValue += char;
  }

  if (inQuotes) {
    errors.push({
      rowIndex,
      column: `col${columnIndex}`,
      message: "Unterminated quoted field.",
    });
  }

  if (currentValue.length || currentRow.length) {
    pushValue();
    pushRow();
  }

  return { rows, errors };
}

function normalizeHeader(value: string): string {
  const cleaned = value
    .replace(/\uFEFF/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^\w]/g, "");
  return cleaned;
}

function buildHeaderMap(headerRow: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headerRow.forEach((value, index) => {
    const normalized = normalizeHeader(String(value ?? ""));
    const key = HEADER_ALIASES[normalized] ?? "";
    if (!key || map.has(key)) return;
    map.set(key, index);
  });
  return map;
}

function validateHeaders(headerMap: Map<string, number>): CsvValidationError[] {
  const errors: CsvValidationError[] = [];
  for (const required of REQUIRED_HEADERS) {
    if (!headerMap.has(required)) {
      errors.push({
        rowIndex: 1,
        column: required,
        message: `Missing required column "${required}".`,
      });
    }
  }
  return errors;
}

function getColumnValue(
  rowValues: string[],
  headerMap: Map<string, number>,
  column: string,
): string {
  const index = headerMap.get(column);
  if (index == null) return "";
  return sanitizeValue(rowValues[index] ?? "");
}

function sanitizeValue(value: string): string {
  return sanitizeUserInput(value, { preserveNewlines: false }).trim();
}

function parsePositiveInteger(value: string): number | null {
  const numeric = Number(value);
  if (!isPositiveInt(numeric)) return null;
  return numeric;
}

function normalizeOwnershipType(
  rawValue: string,
  rowIndex: number,
  errors: CsvValidationError[],
): CollectionOwnershipType {
  const cleaned = rawValue ? rawValue.trim() : "";
  if (!cleaned) {
    return "Digital";
  }
  const match = COLLECTION_OWNERSHIP_TYPES.find((item) =>
    item.toLowerCase() === cleaned.toLowerCase(),
  );
  if (!match) {
    errors.push({
      rowIndex,
      column: "ownership_type",
      message: "Ownership type must be Digital, Physical, Subscription, or Other.",
    });
    return "Digital";
  }
  return match;
}

function normalizePlatformKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveCsvPlatformId(rawValue: string): Promise<number | null> {
  const normalized = normalizePlatformKey(rawValue);
  if (!normalized) return null;

  const mapped = GAMEDB_CSV_PLATFORM_MAP[normalized] ?? [];
  const candidates = mapped.length ? mapped : [rawValue];

  for (const candidate of candidates) {
    const platformId = await resolveGameCompletionPlatformId(candidate);
    if (platformId) return platformId;
  }

  return null;
}
