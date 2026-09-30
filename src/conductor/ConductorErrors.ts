import {
  CONDUCTOR_ABORT_PREFIX,
  CONDUCTOR_ACCEPT_PREFIX,
  CONDUCTOR_CHECK_PREFIX,
  CONDUCTOR_CONFIRM_PREFIX,
  CONDUCTOR_NOTE_MODAL_PREFIX,
  CONDUCTOR_NOTE_PREFIX,
  CONDUCTOR_REPORT_PREFIX,
} from "../config/customIdPrefixes.js";
import {
  buildApiErrorMessage,
  buildDiscordErrorMessage,
  type IErrorMessageOptions,
} from "../utilities/ApiErrorUtils.js";

/** The conductor's DMs and the test guild have no dev role to mention. */
export const CONDUCTOR_ERROR_OPTIONS: IErrorMessageOptions = { devPing: false };

const CONDUCTOR_COMMAND_SOURCE = "/conduct";
const CONDUCTOR_CUSTOM_ID_PREFIXES: readonly string[] = [
  CONDUCTOR_ABORT_PREFIX,
  CONDUCTOR_ACCEPT_PREFIX,
  CONDUCTOR_CHECK_PREFIX,
  CONDUCTOR_CONFIRM_PREFIX,
  CONDUCTOR_NOTE_MODAL_PREFIX,
  CONDUCTOR_NOTE_PREFIX,
  CONDUCTOR_REPORT_PREFIX,
];

/** Whether a `describeInteraction` source names the conductor's command or components. */
export function isConductorSource(source: string): boolean {
  return source === CONDUCTOR_COMMAND_SOURCE ||
    CONDUCTOR_CUSTOM_ID_PREFIXES.some((prefix) => source.startsWith(`${prefix}:`));
}

export function conductorApiError(label: string, err: unknown): string {
  return buildApiErrorMessage(label, err, CONDUCTOR_ERROR_OPTIONS);
}

export function conductorDiscordError(label: string, err: unknown): string {
  return buildDiscordErrorMessage(label, err, CONDUCTOR_ERROR_OPTIONS);
}
