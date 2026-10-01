import {
  ButtonStyle,
  ModalBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type CommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import {
  getModalField,
  safeDeferReply,
  safeReply,
  withErrorReply,
} from "../../functions/InteractionUtils.js";
import { buildTextReply } from "../../functions/ComponentsV2Utils.js";
import Gotm, {
  insertGotmRoundInDatabase,
  updateGotmGameFieldInDatabase,
  type IGotmEntry,
} from "../../classes/Gotm.js";
import NrGotm, {
  insertNrGotmRoundInDatabase,
  updateNrGotmGameFieldInDatabase,
  type INrGotmEntry,
} from "../../classes/NrGotm.js";
import Game from "../../classes/Game.js";
import { getThreadsByGameId } from "../../classes/Thread.js";
import {
  buildGotmEntryEmbed,
  buildNrGotmEntryEmbed,
} from "../../functions/GotmEntryEmbeds.js";
import {
  buildActionButton,
  buildButtonRow,
  buildTextInputLabel,
} from "../../functions/uiComponents.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
import {
  logUnexpectedCustomId,
  parseCustomIdSegments,
} from "../../utilities/CustomIdUtils.js";
import { commandMention } from "../../services/CommandMentionService.js";
import { DISCORD_TEXT_INPUT_MAX } from "../../config/textLimits.js";
import {
  ADMIN_ROUND_ADD_MODAL_PREFIX,
  ADMIN_ROUND_ADD_PREFIX,
  ADMIN_ROUND_EDIT_MODAL_PREFIX,
  ADMIN_ROUND_EDIT_PREFIX,
} from "../../config/customIdPrefixes.js";

export type RoundKind = "gotm" | "nr-gotm";

const MAX_ROUND_GAMES = 5;
const MONTH_YEAR_MAX_LENGTH = 100;
const ADD_MONTH_YEAR_INPUT_ID = "month-year";
const ADD_GAMES_INPUT_ID = "gamedb-ids";
const EDIT_GAMEDB_INPUT_ID = "gamedb-id";
const EDIT_REDDIT_INPUT_ID = "reddit-url";
const CLEAR_VALUE_PATTERN = /^(none|null)$/i;

type RoundGame = {
  id?: number | null;
  title: string;
  threadId: string | null;
  redditUrl: string | null;
  gamedbGameId: number;
};

type RoundEntry = {
  round: number;
  monthYear: string;
  gameOfTheMonth: RoundGame[];
};

type RoundEditableField = "gamedbGameId" | "redditUrl";
type RoundEmbed = Awaited<ReturnType<typeof buildGotmEntryEmbed>>;

type RoundKindConfig = {
  label: string;
  all: () => RoundEntry[];
  getByRound: (round: number) => RoundEntry[];
  createRound: (round: number, monthYear: string, games: RoundGame[]) => Promise<RoundEntry>;
  updateField: (
    entry: RoundEntry,
    gameIndex: number,
    field: RoundEditableField,
    value: string | number | null,
  ) => Promise<RoundEntry | null>;
  buildEmbed: (
    entry: RoundEntry,
    guildId: string | undefined,
    client: Client,
  ) => Promise<RoundEmbed>;
};

const ROUND_KINDS: Record<RoundKind, RoundKindConfig> = {
  gotm: {
    label: "GOTM",
    all: () => Gotm.all(),
    getByRound: (round) => Gotm.getByRound(round),
    createRound: async (round, monthYear, games) => {
      await insertGotmRoundInDatabase(round, monthYear, games);
      return Gotm.addRound(round, monthYear, games);
    },
    updateField: async (entry, gameIndex, field, value) => {
      await updateGotmGameFieldInDatabase(entry.round, gameIndex, field, value);
      return field === "gamedbGameId"
        ? Gotm.updateGamedbIdByRound(entry.round, value as number, gameIndex)
        : Gotm.updateRedditUrlByRound(entry.round, value as string | null, gameIndex);
    },
    buildEmbed: (entry, guildId, client) =>
      buildGotmEntryEmbed(entry as IGotmEntry, guildId, client),
  },
  "nr-gotm": {
    label: "NR-GOTM",
    all: () => NrGotm.all(),
    getByRound: (round) => NrGotm.getByRound(round),
    createRound: async (round, monthYear, games) => {
      const insertedIds = await insertNrGotmRoundInDatabase(round, monthYear, games);
      const gamesWithIds = games.map((g, idx) => ({ ...g, id: insertedIds[idx] ?? null }));
      return NrGotm.addRound(round, monthYear, gamesWithIds);
    },
    updateField: async (entry, gameIndex, field, value) => {
      await updateNrGotmGameFieldInDatabase({
        rowId: entry.gameOfTheMonth[gameIndex]?.id ?? null,
        round: entry.round,
        gameIndex,
        field,
        value,
      });
      return field === "gamedbGameId"
        ? NrGotm.updateGamedbIdByRound(entry.round, value as number, gameIndex)
        : NrGotm.updateRedditUrlByRound(entry.round, value as string | null, gameIndex);
    },
    buildEmbed: (entry, guildId, client) =>
      buildNrGotmEntryEmbed(entry as INrGotmEntry, guildId, client),
  },
};

function isRoundKind(value: string | undefined): value is RoundKind {
  return value === "gotm" || value === "nr-gotm";
}

/** Parses `<prefix>:<kind>:<round>[:<gameIndex>]` custom ids. */
export function parseRoundCustomId(
  customId: string,
  withGameIndex: boolean,
): { kind: RoundKind; round: number; gameIndex: number } | null {
  const segs = parseCustomIdSegments(customId, withGameIndex ? 3 : 2);
  if (!segs) {
    logUnexpectedCustomId(customId);
    return null;
  }
  const [kind, roundRaw, indexRaw] = segs;
  const round = Number(roundRaw);
  const gameIndex = withGameIndex ? Number(indexRaw) : 0;
  if (!isRoundKind(kind) || !isPositiveInt(round)) return null;
  if (!Number.isInteger(gameIndex) || gameIndex < 0) return null;
  return { kind, round, gameIndex };
}

async function replyWithEntry(
  interaction: CommandInteraction | ModalSubmitInteraction,
  config: RoundKindConfig,
  entry: RoundEntry,
  message: string,
  extraComponents: ReturnType<typeof buildButtonRow>[] = [],
): Promise<void> {
  const assets = await config.buildEmbed(
    entry,
    interaction.guildId ?? undefined,
    interaction.client,
  );
  const reply = buildTextReply(message, false);
  await safeReply(interaction, {
    ...reply,
    components: [...reply.components, assets.container, ...extraComponents],
    files: assets.files?.length ? assets.files : undefined,
  });
}

/** Resolves a GameDB id typed by an admin, replying with the reason when it is unusable. */
async function resolveGameDbId(
  interaction: ModalSubmitInteraction,
  raw: string,
  failurePrefix: string,
): Promise<{ id: number; title: string } | null> {
  const id = Number(raw.trim());
  if (!isPositiveInt(id)) {
    await safeReply(
      interaction,
      buildTextReply(`${failurePrefix}: "${raw}" is not a valid GameDB id.`, false),
    );
    return null;
  }
  const game = await Game.getGameById(id);
  if (!game) {
    await safeReply(interaction, buildTextReply(
      `${failurePrefix}: GameDB id ${id} was not found. ` +
        `Use ${commandMention("gamedb add")} first if needed.`,
      false,
    ));
    return null;
  }
  return { id, title: game.title };
}

export async function handleAddRound(
  interaction: CommandInteraction,
  kind: RoundKind,
): Promise<void> {
  const config = ROUND_KINDS[kind];
  const entries = await withErrorReply(
    interaction,
    async () => config.all(),
    `Error loading existing ${config.label} data`,
    false,
  );
  if (entries === undefined) return;

  const nextRound = entries.length > 0 ? Math.max(...entries.map((e) => e.round)) + 1 : 1;
  const reply = buildTextReply(
    `Ready to create ${config.label} round ${nextRound}. ` +
      "Open the form to enter its month and games.",
    false,
  );
  await safeReply(interaction, {
    ...reply,
    components: [
      ...reply.components,
      buildButtonRow(buildActionButton({
        customId: `${ADMIN_ROUND_ADD_PREFIX}:${kind}:${nextRound}`,
        label: `Create ${config.label} round`,
        style: ButtonStyle.Primary,
      })),
    ],
  });
}

export async function handleAddRoundButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = parseRoundCustomId(interaction.customId, false);
  if (!parsed) {
    await safeReply(interaction, buildTextReply("Invalid round button.", true));
    return;
  }
  const { kind, round } = parsed;
  const config = ROUND_KINDS[kind];
  if (config.getByRound(round).length) {
    await safeReply(interaction, buildTextReply(
      `${config.label} round ${round} already exists. ` +
        `Use ${commandMention(`admin edit-${kind}`)} to change it.`,
      true,
    ));
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`${ADMIN_ROUND_ADD_MODAL_PREFIX}:${kind}:${round}`)
    .setTitle(`Create ${config.label} round ${round}`)
    .addLabelComponents(
      buildTextInputLabel({
        customId: ADD_MONTH_YEAR_INPUT_ID,
        label: "Month/year label",
        placeholder: "March 2024",
        maxLength: MONTH_YEAR_MAX_LENGTH,
      }),
      buildTextInputLabel({
        customId: ADD_GAMES_INPUT_ID,
        label: `GameDB ids, one per line (1 to ${MAX_ROUND_GAMES})`,
        style: TextInputStyle.Paragraph,
        placeholder: "1234\n5678",
      }),
    );
  safeIgnore(interaction.showModal(modal));
}

export async function handleAddRoundModal(interaction: ModalSubmitInteraction): Promise<void> {
  const parsed = parseRoundCustomId(interaction.customId, false);
  await safeDeferReply(interaction);
  if (!parsed) {
    await safeReply(interaction, buildTextReply("Invalid round form.", false));
    return;
  }
  const { kind, round } = parsed;
  const config = ROUND_KINDS[kind];
  const failurePrefix = `${config.label} round ${round} was not created`;

  if (config.getByRound(round).length) {
    await safeReply(interaction, buildTextReply(
      `${failurePrefix}: it already exists.`,
      false,
    ));
    return;
  }

  const monthYear = getModalField(interaction, ADD_MONTH_YEAR_INPUT_ID).trim();
  if (!monthYear) {
    await safeReply(interaction, buildTextReply(
      `${failurePrefix}: the month/year label cannot be empty.`,
      false,
    ));
    return;
  }

  const rawIds = getModalField(interaction, ADD_GAMES_INPUT_ID)
    .split(/[\s,]+/)
    .filter(Boolean);
  if (rawIds.length < 1 || rawIds.length > MAX_ROUND_GAMES) {
    await safeReply(interaction, buildTextReply(
      `${failurePrefix}: enter between 1 and ${MAX_ROUND_GAMES} GameDB ids ` +
        `(got ${rawIds.length}).`,
      false,
    ));
    return;
  }

  const games: RoundGame[] = [];
  for (const rawId of rawIds) {
    const game = await resolveGameDbId(interaction, rawId, failurePrefix);
    if (!game) return;
    const threadId = (await getThreadsByGameId(game.id))[0] ?? null;
    games.push({ title: game.title, threadId, redditUrl: null, gamedbGameId: game.id });
  }

  await withErrorReply(interaction, async () => {
    const entry = await config.createRound(round, monthYear, games);
    await replyWithEntry(interaction, config, entry, `Created ${config.label} round ${round}.`);
  }, `Failed to create ${config.label} round ${round}`, false);
}

export async function handleEditRound(
  interaction: CommandInteraction,
  kind: RoundKind,
  round: number,
): Promise<void> {
  const config = ROUND_KINDS[kind];
  const roundNumber = Number(round);
  if (!isPositiveInt(roundNumber)) {
    await safeReply(interaction, buildTextReply(`Invalid ${config.label} round number.`, false));
    return;
  }

  const entries = await withErrorReply(
    interaction,
    async () => config.getByRound(roundNumber),
    `Error loading ${config.label} data`,
    false,
  );
  if (entries === undefined) return;
  const entry = entries[0];
  if (!entry) {
    await safeReply(interaction, buildTextReply(
      `No ${config.label} entry found for round ${roundNumber}.`,
      false,
    ));
    return;
  }

  const buttons = entry.gameOfTheMonth.slice(0, MAX_ROUND_GAMES).map((_game, index) =>
    buildActionButton({
      customId: `${ADMIN_ROUND_EDIT_PREFIX}:${kind}:${roundNumber}:${index}`,
      label: `Edit game #${index + 1}`,
      style: ButtonStyle.Primary,
    }));
  await replyWithEntry(
    interaction,
    config,
    entry,
    `Editing ${config.label} round ${roundNumber}. Pick the game to change.`,
    buttons.length ? [buildButtonRow(...buttons)] : [],
  );
}

export async function handleEditRoundButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = parseRoundCustomId(interaction.customId, true);
  if (!parsed) {
    await safeReply(interaction, buildTextReply("Invalid round button.", true));
    return;
  }
  const { kind, round, gameIndex } = parsed;
  const config = ROUND_KINDS[kind];
  const game = config.getByRound(round)[0]?.gameOfTheMonth[gameIndex];
  if (!game) {
    await safeReply(interaction, buildTextReply(
      `${config.label} round ${round} no longer has a game #${gameIndex + 1}.`,
      true,
    ));
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`${ADMIN_ROUND_EDIT_MODAL_PREFIX}:${kind}:${round}:${gameIndex}`)
    .setTitle(`Edit ${config.label} round ${round}, game #${gameIndex + 1}`)
    .addLabelComponents(
      buildTextInputLabel({
        customId: EDIT_GAMEDB_INPUT_ID,
        label: "GameDB id",
        value: String(game.gamedbGameId),
      }),
      buildTextInputLabel({
        customId: EDIT_REDDIT_INPUT_ID,
        label: "Reddit URL (leave blank to clear)",
        required: false,
        // Any cap below the stored length would make Discord reject the prefilled form.
        maxLength: DISCORD_TEXT_INPUT_MAX,
        value: game.redditUrl ?? undefined,
      }),
    );
  safeIgnore(interaction.showModal(modal));
}

export async function handleEditRoundModal(interaction: ModalSubmitInteraction): Promise<void> {
  const parsed = parseRoundCustomId(interaction.customId, true);
  await safeDeferReply(interaction);
  if (!parsed) {
    await safeReply(interaction, buildTextReply("Invalid round form.", false));
    return;
  }
  const { kind, round, gameIndex } = parsed;
  const config = ROUND_KINDS[kind];
  const failurePrefix = `${config.label} round ${round} was not updated`;
  const entry = config.getByRound(round)[0];
  const current = entry?.gameOfTheMonth[gameIndex];
  if (!entry || !current) {
    await safeReply(interaction, buildTextReply(
      `${failurePrefix}: game #${gameIndex + 1} no longer exists.`,
      false,
    ));
    return;
  }

  const changes: Array<{ field: RoundEditableField; value: string | number | null }> = [];
  const gamedbRaw = getModalField(interaction, EDIT_GAMEDB_INPUT_ID).trim();
  if (gamedbRaw !== String(current.gamedbGameId)) {
    const game = await resolveGameDbId(interaction, gamedbRaw, failurePrefix);
    if (!game) return;
    if (game.id !== current.gamedbGameId) {
      changes.push({ field: "gamedbGameId", value: game.id });
    }
  }

  const redditRaw = getModalField(interaction, EDIT_REDDIT_INPUT_ID).trim();
  const redditUrl = !redditRaw || CLEAR_VALUE_PATTERN.test(redditRaw) ? null : redditRaw;
  if (redditUrl !== (current.redditUrl ?? null)) {
    changes.push({ field: "redditUrl", value: redditUrl });
  }

  if (!changes.length) {
    await safeReply(interaction, buildTextReply(
      `No changes made to ${config.label} round ${round}.`,
      false,
    ));
    return;
  }

  await withErrorReply(interaction, async () => {
    let updated: RoundEntry | null = entry;
    for (const change of changes) {
      updated = await config.updateField(entry, gameIndex, change.field, change.value);
    }
    await replyWithEntry(
      interaction,
      config,
      updated ?? entry,
      `${config.label} round ${round} updated successfully.`,
    );
  }, `Failed to update ${config.label} round ${round}`, false);
}
