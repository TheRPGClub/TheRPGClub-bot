import {
  ActionRowBuilder,
  type APIMessageTopLevelComponent,
  ButtonBuilder,
  ButtonStyle,
  escapeMarkdown,
  MessageFlags,
} from "discord.js";
import { CODEX_AUTOCOMPLETE_READ } from "../config/codex.js";
import {
  DISCORD_AUTOCOMPLETE_CHOICES_MAX,
  truncateLabel,
} from "../config/textLimits.js";
import {
  buildCodexFunFactId,
  parseCodexEntryOption,
} from "../functions/CodexCustomIds.js";
import { plainCodexText } from "../functions/CodexText.js";
import { buildTextContainer } from "../functions/ComponentsV2Utils.js";
import { logError } from "../utilities/LogUtils.js";
import {
  codexRefusalText,
  FUN_FACT_API,
  type ICodexEntry,
  type IFunFactApi,
} from "./CodexApi.js";

// /codex fun-fact add, edit and delete (spec api#397, bot#1561). Members write Fun Facts
// from Discord; the bot acts for them, so the API's rules decide who may add, edit and
// delete, and its refusals are shown privately as it words them.

/** A private Club Codex reply. Mentions show as names and never ping. */
export interface ICodexView {
  components: APIMessageTopLevelComponent[];
  flags: number;
  allowedMentions: { parse: [] };
}

/** What to show: a view, or an error (the API's refusal with its request and response). */
export type CodexReplyResult = { view: ICodexView } | { error: string };

export interface ICodexFunFactDeps {
  api?: IFunFactApi;
}

const PICK_FROM_LIST = "Pick a Fun Fact from the list.";

/** A private Club Codex reply of text, with an optional row of buttons. */
export function codexView(content: string, buttons: ButtonBuilder[] = []): ICodexView {
  const components: APIMessageTopLevelComponent[] = [buildTextContainer(content).toJSON()];
  if (buttons.length) {
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons).toJSON());
  }
  return { components, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

/** The Fun Fact as a quote, so its mention tokens show as names. */
function quoted(entry: ICodexEntry): string {
  return (entry.body ?? "").split("\n").map((line) => `> ${line}`).join("\n");
}

/** /codex fun-fact add: publishes the member's Fun Fact, mention tokens as typed. */
export async function addFunFactReply(
  input: { text: string; actingUserId: string },
  deps: ICodexFunFactDeps = {},
): Promise<CodexReplyResult> {
  const api = deps.api ?? FUN_FACT_API;
  try {
    const entry = await api.create(input.text, input.actingUserId);
    return { view: codexView(["## Fun Fact added", quoted(entry)].join("\n")) };
  } catch (err: unknown) {
    return { error: codexRefusalText(err, "Could not add your Fun Fact.") };
  }
}

/** Which Fun Facts an autocomplete offers: those the member may edit, or delete. */
export type FunFactPick = "edit" | "delete";

/**
 * Autocomplete for `fact:`: the member's own Fun Facts, or every one for a Moderator and
 * above, as the API's `viewer` flags say, narrowed to what they typed. The value is the
 * Fun Fact's ID. Nothing on a failed read: an autocomplete can't show an error.
 */
export async function funFactChoices(
  input: { actingUserId: string; query: string; action: FunFactPick },
  deps: ICodexFunFactDeps = {},
): Promise<{ name: string; value: string }[]> {
  const api = deps.api ?? FUN_FACT_API;
  const query = input.query.trim().toLowerCase();
  try {
    const facts = await api.list(input.actingUserId, 1, CODEX_AUTOCOMPLETE_READ);
    return facts
      .filter((f) => (input.action === "edit" ? f.viewer.can_edit : f.viewer.can_delete))
      .map((f) => ({
        name: plainCodexText(f.body, f.mentions).replace(/\s+/g, " ").trim(),
        value: String(f.id),
      }))
      .filter((c) => !query || c.name.toLowerCase().includes(query))
      .slice(0, DISCORD_AUTOCOMPLETE_CHOICES_MAX)
      .map((c) => ({ name: truncateLabel(c.name), value: c.value }));
  } catch (err: unknown) {
    logError("CodexFunFacts.funFactChoices", err);
    return [];
  }
}

/** /codex fun-fact edit: replaces the picked Fun Fact's text. */
export async function editFunFactReply(
  input: { factRaw: string; text: string; actingUserId: string },
  deps: ICodexFunFactDeps = {},
): Promise<CodexReplyResult> {
  const factId = parseCodexEntryOption(input.factRaw);
  if (factId === null) return { view: codexView(PICK_FROM_LIST) };
  const api = deps.api ?? FUN_FACT_API;
  try {
    const entry = await api.edit(factId, input.text, input.actingUserId);
    return { view: codexView(["## Fun Fact edited", quoted(entry)].join("\n")) };
  } catch (err: unknown) {
    return { error: codexRefusalText(err, "Could not edit that Fun Fact.") };
  }
}

function deleteButton(action: "delete" | "keep", factId: number): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildCodexFunFactId(action, factId))
    .setLabel(action === "delete" ? "Delete" : "Keep it")
    .setStyle(action === "delete" ? ButtonStyle.Danger : ButtonStyle.Secondary);
}

/**
 * /codex fun-fact delete: shows the picked Fun Fact and asks before deleting it. A Fun Fact
 * the member may not delete is refused here, before they confirm anything.
 */
export async function deleteFunFactQuestion(
  input: { factRaw: string | undefined; actingUserId: string },
  deps: ICodexFunFactDeps = {},
): Promise<CodexReplyResult> {
  const factId = parseCodexEntryOption(input.factRaw);
  if (factId === null) return { view: codexView(PICK_FROM_LIST) };
  const api = deps.api ?? FUN_FACT_API;
  let entry: ICodexEntry | null;
  try {
    entry = await api.get(factId, input.actingUserId);
  } catch (err: unknown) {
    return { error: codexRefusalText(err, "Could not read that Fun Fact.") };
  }
  if (!entry) {
    return { view: codexView(`There is no Fun Fact ${factId}. It may have been deleted.`) };
  }
  if (!entry.viewer.can_delete) {
    return { view: codexView("Only its author or a Moderator can delete this.") };
  }
  return {
    view: codexView(
      [
        "## Delete this Fun Fact?",
        quoted(entry),
        `-# By ${escapeMarkdown(entry.author.name)}. This can't be undone.`,
      ].join("\n"),
      [deleteButton("delete", factId), deleteButton("keep", factId)],
    ),
  };
}

/** The question's Delete button: deletes the Fun Fact, as the member who clicked. */
export async function deleteFunFactReply(
  input: { factId: number; actingUserId: string },
  deps: ICodexFunFactDeps = {},
): Promise<CodexReplyResult> {
  const api = deps.api ?? FUN_FACT_API;
  try {
    const deleted = await api.remove(input.factId, input.actingUserId);
    return {
      view: codexView(deleted ? "## Fun Fact deleted" : "That Fun Fact was already deleted."),
    };
  } catch (err: unknown) {
    return { error: codexRefusalText(err, "Could not delete that Fun Fact.") };
  }
}

/** The question's Keep it button. */
export function keepFunFactView(): ICodexView {
  return codexView("Kept. Nothing was deleted.");
}
