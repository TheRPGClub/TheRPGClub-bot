// Discord web helpers for the Playwright conductor runner (`run.ts`).
//
// Every selector is a role, visible text, or a Discord CDN path, never Discord's generated
// CSS classes, which change between builds. Text read from the page is data: it only
// locates controls the step's own action names, and it never decides what to type or click.

import type { Locator, Page } from "playwright-core";

import { CONDUCTOR_BOT_NAME, PREVIEW_BOT_NAME } from "../../src/config/previewMode.ts";
import { PREVIEW_BOT_USER_ID } from "../../src/config/users.ts";
import type {
  DriveAction,
  IModalField,
  ISlashAction,
} from "../../src/conductor/DriveActions.ts";

export const TIMING = {
  /** How long a control or popup may take to appear before the step is handed off. */
  controlMs: 10_000,
  /** How long to wait for the preview bot's reply before pressing Check. */
  replyMs: 30_000,
  /** The pause after an in-place update, which adds no new message to wait for. */
  settleMs: 3_000,
  /** How long the conductor may take to judge a step after Check. */
  verdictMs: 60_000,
  /** How long a signed-in channel may take to show its messages before a reload. */
  channelLoadMs: 30_000,
  /** How many times a channel that never shows its messages is reloaded. */
  channelReloads: 3,
  /** How long to wait for the tester to finish a handed-off step. */
  handOffMs: 15 * 60_000,
  pollMs: 1_000,
  /** Per-key delay, so Discord's command editor keeps up. */
  typeDelayMs: 40,
  /** The pause after scrolling the message panel, so Discord renders what came into view. */
  scrollSettleMs: 500,
} as const;

/** How many screens the runner scrolls up looking for a conductor message. */
const SCROLL_SCREENS = 10;

/** A step header the conductor posts: `PR #<pr>, step <n> of <m>: <label>`. */
export interface IStepHeader {
  number: number;
  total: number;
  label: string;
}

/** A step the runner could not finish, with why; the tester takes it over. */
export class HandOff extends Error {}

const STEP_HEADER = /PR #(\d+), step (\d+) of (\d+): ([^\n]+)/;
/**
 * Any of a run's step messages: one still open (`step N of M:`) or one the conductor
 * rewrote once it was checked (`step N:`, see `buildStepResultText`).
 */
const RUN_STEP_MESSAGE = /PR #(\d+), step \d+(?: of \d+)?: /;
/** Buttons a step message shows once a check found anything but a pass. */
const PENDING_BUTTONS = /^(?:Check again|Looks right)$/;
/** The conductor's verdict line on a step message, as `ConductorReport.ts` labels it. */
const VERDICT_LINE = /^(?:FAIL|NEEDS EYES): .+$/m;
/** Controls only conductor messages carry; their messages are never acted on. */
const CONDUCTOR_BUTTONS = /^(?:Check|Check again|Abort run|Post report|Approve PR)$/;
/** Discord's placeholder for a deferred reply: `<app> is thinking...`. */
const THINKING = /\bis thinking(?:\.\.\.|\u2026)/;

/** True when `text` is Discord's placeholder for a reply the bot has not sent yet. */
export function isThinkingPlaceholder(text: string): boolean {
  return THINKING.test(text);
}

/** The channel's message list; visible once Discord has loaded the channel. */
export function messageList(page: Page): Locator {
  return page.getByRole("list", { name: /^Messages in / });
}

/**
 * The login page's passkey button. Clicking it only opens the browser's own passkey
 * prompt; the tester picks the passkey there, and nothing is ever typed into the page.
 */
export function passkeyButton(page: Page): Locator {
  return page.getByRole("button", { name: /passkey/i }).first();
}

export function messages(page: Page): Locator {
  return messageList(page).getByRole("listitem");
}

/**
 * Scrolls the panel holding the messages one screen up, or to the bottom. Discord renders
 * only a window of messages, so a tall reply can push a conductor message out of the DOM.
 * Returns false when the panel did not move.
 */
async function scrollPanel(page: Page, direction: "up" | "bottom"): Promise<boolean> {
  const moved = await messageList(page).evaluate((list, to) => {
    let panel = list.parentElement;
    while (panel) {
      const overflow = getComputedStyle(panel).overflowY;
      const scrolls = overflow === "auto" || overflow === "scroll";
      if (scrolls && panel.scrollHeight > panel.clientHeight) break;
      panel = panel.parentElement;
    }
    if (!panel) return false;
    const before = panel.scrollTop;
    panel.scrollTop = to === "up" ? before - panel.clientHeight * 0.8 : panel.scrollHeight;
    return panel.scrollTop !== before;
  }, direction);
  if (moved) await page.waitForTimeout(TIMING.scrollSettleMs);
  return moved;
}

/**
 * Puts the panel back at the bottom, where the conductor posts its next header and report.
 * Call it after using a message `findStepMessage` scrolled up to.
 */
export async function scrollToBottom(page: Page): Promise<void> {
  await scrollPanel(page, "bottom");
}

/**
 * Scrolls the panel to the bottom, then up a screen at a time until `found` holds or
 * the panel stops moving. Reads of the newest messages scroll back down themselves.
 * Only the runner's own actions scroll: the polls that wait on the tester or the
 * conductor read what is rendered and leave the panel where the tester put it.
 */
async function scrollUpUntil(page: Page, found: () => Promise<boolean>): Promise<boolean> {
  await scrollPanel(page, "bottom");
  for (let screen = 0; screen < SCROLL_SCREENS; screen += 1) {
    if (await found()) return true;
    if (!await scrollPanel(page, "up")) break;
  }
  return found();
}


function chatBox(page: Page): Locator {
  return page.getByRole("textbox", { name: /^Message #/ });
}

/** The newest step header the conductor posted for this PR, or null. */
export async function currentStep(page: Page, pr: number): Promise<IStepHeader | null> {
  const texts = await messages(page).allInnerTexts();
  for (const text of texts.reverse()) {
    const match = STEP_HEADER.exec(text);
    if (match && Number(match[1]) === pr) {
      return { number: Number(match[2]), total: Number(match[3]), label: match[4].trim() };
    }
  }
  return null;
}

/**
 * The conductor's `Report for PR #<pr> posted: <url>` line for the current run. Only a
 * report newer than the PR's newest step message counts, open or checked, so an earlier
 * run's report still in the channel never ends this one, even in the moment between a
 * step being checked and the next one being posted.
 */
export async function reportUrl(page: Page, pr: number): Promise<string | null> {
  const posted = new RegExp(`Report for PR #${pr} posted: (\\S+)`);
  const texts = await messages(page).allInnerTexts();
  for (const text of texts.reverse()) {
    const match = posted.exec(text);
    if (match) return match[1];
    if (Number(RUN_STEP_MESSAGE.exec(text)?.[1]) === pr) return null;
  }
  return null;
}

/** The message holding the step header for this PR's step `n`. */
function stepMessage(page: Page, pr: number, n: number): Locator {
  const header = new RegExp(`PR #${pr}, step ${n} of \\d+:`);
  return messages(page).filter({ hasText: header }).last();
}

/**
 * The step message for this PR's step `n`, scrolling the panel up to it when a tall
 * reply pushed it out of the rendered window, or null when it is not in the channel.
 */
export async function findStepMessage(page: Page, pr: number, n: number): Promise<Locator | null> {
  const message = stepMessage(page, pr, n);
  return await scrollUpUntil(page, async () => await message.count() > 0) ? message : null;
}

/**
 * The verdict a step message is waiting on the tester for, or null while it still
 * offers a plain Check. Such a step is the tester's: driving it again would repeat it.
 */
export async function pendingVerdict(page: Page, pr: number, n: number): Promise<string | null> {
  const message = await findStepMessage(page, pr, n);
  if (!message) return null;
  const pending = await message.getByRole("button", { name: PENDING_BUTTONS }).count() > 0;
  const text = pending ? await message.innerText() : "";
  await scrollToBottom(page);
  if (!pending) return null;
  return VERDICT_LINE.exec(text)?.[0] ?? "awaiting the tester's judgment";
}

async function isConductorMessage(item: Locator): Promise<boolean> {
  if (STEP_HEADER.test(await item.innerText())) return true;
  return await item.getByRole("button", { name: CONDUCTOR_BUTTONS }).count() > 0;
}

/**
 * The newest message, conductor messages excluded, that holds the control `find`
 * returns. Only the last few messages are searched: the step acts on the reply it just
 * got, never on an old message further up.
 */
async function newestWith(page: Page, find: (item: Locator) => Locator): Promise<Locator> {
  await scrollPanel(page, "bottom");
  const items = messages(page);
  const count = await items.count();
  for (let index = count - 1; index >= Math.max(0, count - 15); index -= 1) {
    const item = items.nth(index);
    if (await isConductorMessage(item)) continue;
    const control = find(item);
    // The control sits below any heading that repeats its text, so the last match is it.
    if (await control.count() > 0) return control.last();
  }
  throw new HandOff("the control is not on any recent preview bot message");
}

/**
 * The option whose first line of visible text is one of `values`, or null. An exact match
 * wins; failing that, one that differs only in case, since Discord labels a boolean
 * option's choices `True` and `False` while a step types `all:true`.
 */
async function findOption(options: Locator, values: string[]): Promise<Locator | null> {
  const count = await options.count();
  const lowered = values.map((value) => value.toLowerCase());
  let caseless: Locator | null = null;
  for (let index = 0; index < count; index += 1) {
    const text = (await options.nth(index).innerText()).split("\n")[0]?.trim() ?? "";
    if (values.includes(text)) return options.nth(index);
    if (!caseless && lowered.includes(text.toLowerCase())) caseless = options.nth(index);
  }
  return caseless;
}

async function pickOption(options: Locator, value: string): Promise<void> {
  const option = await findOption(options, [value]);
  if (!option) throw new HandOff(`no option reads "${value}"`);
  await option.click();
}

async function waitVisible(locator: Locator, what: string): Promise<void> {
  try {
    await locator.first().waitFor({ state: "visible", timeout: TIMING.controlMs });
  } catch {
    throw new HandOff(`${what} did not appear`);
  }
}

async function fillModal(page: Page, fields: IModalField[]): Promise<void> {
  const dialog = page.getByRole("dialog");
  await waitVisible(dialog, "the modal");
  for (const field of fields) {
    if (field.kind === "enter") {
      const box = dialog.getByRole("textbox", { name: field.field, exact: true });
      await waitVisible(box, `the "${field.field}" field`);
      await box.fill(field.value);
      continue;
    }
    const menu = dialog.getByRole("combobox", { name: field.field, exact: true });
    await waitVisible(menu, `the "${field.field}" select`);
    await menu.click();
    await pickOption(page.getByRole("option"), field.value);
  }
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  try {
    await dialog.waitFor({ state: "hidden", timeout: TIMING.controlMs });
  } catch {
    throw new HandOff("the modal did not close after Submit");
  }
}

/**
 * The command popup's entries from the preview bot. Each names its application in visible
 * text and shows the bot's avatar, whose CDN path carries the bot's user ID; either one
 * matching is enough, so renaming the application does not break the runner.
 */
function previewBotOptions(page: Page): Locator {
  const options = page.getByRole("option");
  const avatar = page.locator(`img[src*="/avatars/${PREVIEW_BOT_USER_ID}/"]`);
  return options.filter({ hasText: PREVIEW_BOT_NAME }).or(options.filter({ has: avatar }));
}

/** The command popup's entries from the conductor, which owns `/conduct`. */
function conductorOptions(page: Page): Locator {
  return page.getByRole("option").filter({ hasText: CONDUCTOR_BOT_NAME });
}

/**
 * Clears a slash-command draft a handed-back step left behind; Discord keeps it across
 * runs. The profile is the runner's alone, so a `/` draft is the runner's own. Any other
 * text is handed off rather than erased.
 */
async function clearLeftoverCommand(page: Page, box: Locator): Promise<void> {
  const text = (await box.innerText()).trim();
  if (!text) return;
  if (!text.startsWith("/")) throw new HandOff("the message box is not empty");
  await box.click();
  // A picked command holds its options as chips, so one select-all may leave the name.
  for (let attempt = 0; attempt < 3 && (await box.innerText()).trim(); attempt += 1) {
    await box.press("ControlOrMeta+a");
    await box.press("Backspace");
  }
  await page.keyboard.press("Escape");
  if ((await box.innerText()).trim()) {
    throw new HandOff("a leftover command in the message box would not clear");
  }
}

/** An option's field (pill) in Discord's command editor, matched by its name. */
function optionPill(box: Locator, name: string): Locator {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `optionPill__<hash>` is the pill itself; `optionPillValue__<hash>` is its value.
  return box.locator('[class*="optionPill__"]')
    .filter({ hasText: new RegExp(`^\\s*${escaped}(?![\\w-])`) });
}

/**
 * Puts the cursor where an option's value goes and returns the text to type before it.
 * Picking a command adds a pill for each required option, and its value is typed into
 * that pill. An optional option has no pill until `name:` is typed after the others.
 */
async function focusOption(box: Locator, name: string): Promise<string> {
  const pill = optionPill(box, name);
  if (await pill.count()) {
    await pill.first().click();
    return "";
  }
  const bounds = await box.boundingBox();
  if (!bounds) throw new HandOff("the message box has no size");
  await box.click({ position: { x: bounds.width - 2, y: bounds.height - 4 } });
  await box.press("End");
  return ` ${name}:`;
}

/** Hands the step back, naming the option, when a value did not land in its own field. */
async function assertOptionFilled(box: Locator, name: string, value: string): Promise<void> {
  const pill = optionPill(box, name);
  const text = await pill.count() ? await pill.first().innerText() : "";
  if (!text.toLowerCase().includes(value.toLowerCase())) {
    throw new HandOff(`the ${name} option did not take the value "${value}"`);
  }
}

/** Which application's popup entries a slash command is picked from. */
interface ICommandSource {
  entries: (page: Page) => Locator;
  /** Names the app in hand-off messages. */
  app: string;
}

const PREVIEW_COMMANDS: ICommandSource = { entries: previewBotOptions, app: "preview bot" };
const CONDUCTOR_COMMANDS: ICommandSource = { entries: conductorOptions, app: "conductor" };

async function runSlash(
  page: Page,
  action: ISlashAction,
  source: ICommandSource = PREVIEW_COMMANDS,
): Promise<void> {
  const box = chatBox(page);
  await waitVisible(box, "the message box");
  await clearLeftoverCommand(page, box);
  const name = `/${action.path.join(" ")}`;
  await box.click();
  await box.pressSequentially(name, { delay: TIMING.typeDelayMs });
  const entries = source.entries(page);
  await waitVisible(entries, `the ${source.app}'s entries in the command popup`);
  const command = await findOption(entries, [name, name.slice(1)]);
  if (!command) throw new HandOff(`the command popup has no ${source.app} ${name}`);
  await command.click();
  for (const option of action.options) {
    const typed = await focusOption(box, option.name);
    await box.pressSequentially(typed + option.value, { delay: TIMING.typeDelayMs });
    await page.waitForTimeout(TIMING.settleMs / 3);
    // An autocomplete or choice suggestion that matches is picked. Any other popup, such
    // as the list of remaining options, is left alone; a value Discord rejects keeps
    // the command in the box, which the send check below catches.
    const suggestion = await findOption(page.getByRole("option"), [option.value]);
    if (suggestion) await suggestion.click();
    await assertOptionFilled(box, option.name, option.value);
  }
  await box.press("Enter");
  await page.waitForTimeout(TIMING.settleMs / 3);
  if ((await box.innerText()).trim()) {
    throw new HandOff("Discord did not send the command; it is still in the message box");
  }
  if (action.modal) await fillModal(page, action.modal);
}

async function runSelect(
  page: Page,
  action: DriveAction & { kind: "select" },
): Promise<void> {
  const { menu: placeholder } = action;
  const menu = await newestWith(page, (item) => placeholder
    ? item.getByRole("combobox").filter({ hasText: placeholder })
      .or(item.getByText(placeholder, { exact: true }))
    : item.getByRole("combobox"),
  );
  await menu.click();
  for (const value of action.values) {
    await waitVisible(page.getByRole("option"), "the select menu's options");
    await pickOption(page.getByRole("option"), value);
  }
  // A multi-select submits its choices when the menu closes.
  if (action.values.length > 1) await page.keyboard.press("Escape");
}

/**
 * Sends `/conduct pr:<pr>` from the conductor's own entry, to start the PR's run. Throws
 * `HandOff` when the command cannot be sent.
 */
export async function startConductRun(page: Page, pr: number): Promise<void> {
  const action: ISlashAction = {
    kind: "slash",
    path: ["conduct"],
    options: [{ name: "pr", value: String(pr) }],
    modal: null,
  };
  await runSlash(page, action, CONDUCTOR_COMMANDS);
}

/** Performs one step's action. Throws `HandOff` when anything is not as expected. */
export async function performAction(page: Page, action: DriveAction): Promise<void> {
  switch (action.kind) {
    case "slash":
      return runSlash(page, action);
    case "click":
    case "modal": {
      const button = await newestWith(page, (item) =>
        item.getByRole("button", { name: action.button, exact: true }),
      );
      if (await button.isDisabled()) throw new HandOff(`"${action.button}" is disabled`);
      await button.click();
      if (action.kind === "modal") await fillModal(page, action.fields);
      return;
    }
    case "select":
      return runSelect(page, action);
  }
}

/** The newest message's text, to tell when a new reply lands after an action. */
export async function newestText(page: Page): Promise<string> {
  await scrollPanel(page, "bottom");
  const items = messages(page);
  return await items.count() ? items.last().innerText() : "";
}

/**
 * Waits for the reply an action produces: a new newest message for a slash command, or
 * a short settle for a component, whose reply usually updates its message in place.
 * Either way it keeps waiting while the newest message is a deferred reply's
 * "is thinking..." placeholder, which the conductor cannot judge.
 * Discord keeps only a window of messages rendered, so the count is no signal.
 */
export async function waitForReply(page: Page, before: string, slash: boolean): Promise<void> {
  const deadline = Date.now() + TIMING.replyMs;
  const pending = async (): Promise<boolean> => {
    const text = await newestText(page);
    return (slash && text === before) || isThinkingPlaceholder(text);
  };
  for (;;) {
    while (Date.now() < deadline && await pending()) await page.waitForTimeout(TIMING.pollMs);
    await page.waitForTimeout(TIMING.settleMs);
    // A component's deferred reply can show its placeholder only after the first look.
    if (Date.now() >= deadline || !isThinkingPlaceholder(await newestText(page))) return;
  }
}
