import { truncateWithEllipsis } from "../utilities/ValidationUtils.js";

export type ISlashOptionNode = {
  name: string;
  value?: unknown;
  options?: readonly ISlashOptionNode[];
};

/** Option paths whose values never reach the command log: a donated game key. */
const SECRET_SLASH_OPTION_PATHS = new Set(["giveaway donate key"]);

function sanitizeSlashValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(truncateWithEllipsis(value, 120));
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  if (value === null || value === undefined) {
    return "null";
  }

  try {
    const serialized = JSON.stringify(value);
    if (!serialized) return "\"\"";
    return truncateWithEllipsis(serialized, 200);
  } catch {
    return String(value);
  }
}

function formatSlashOption(option: ISlashOptionNode, parentPath: string): string {
  const path = parentPath ? `${parentPath} ${option.name}` : option.name;
  if (option.options && option.options.length > 0) {
    const nested = option.options.map((child) => formatSlashOption(child, path)).join(", ");
    return `${option.name}={${nested}}`;
  }

  if (option.value === undefined) {
    return option.name;
  }

  const value = SECRET_SLASH_OPTION_PATHS.has(path)
    ? "REDACTED"
    : sanitizeSlashValue(option.value);
  return `${option.name}=${value}`;
}

/**
 * The options of a slash command as one log line. `commandName` roots the option paths
 * so a secret option is masked by its full path.
 */
export function formatSlashCommandParams(
  commandName: string,
  options: readonly ISlashOptionNode[] | null | undefined,
): string {
  if (!options || options.length === 0) return "none";
  return options.map((option) => formatSlashOption(option, commandName)).join("; ");
}
