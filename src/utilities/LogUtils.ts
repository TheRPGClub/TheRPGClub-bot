// Extra string-ish fields pg attaches to query/connection errors. Worth keeping
// in logs; the noisy `client` property pg-pool attaches is intentionally dropped.
const ERROR_EXTRA_FIELDS = [
  "code",
  "severity",
  "detail",
  "hint",
  "position",
  "schema",
  "table",
  "column",
  "constraint",
  "routine",
] as const;

function normalizeError(error: Error): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
  const source = error as unknown as Record<string, unknown>;
  for (const field of ERROR_EXTRA_FIELDS) {
    if (source[field] !== undefined) normalized[field] = source[field];
  }
  return normalized;
}

export function formatStructuredLog(fields: Record<string, unknown>): string {
  // Error message/stack are non-enumerable, so a raw stringify drops them while
  // serializing any attached object (e.g. pg-pool sets err.client). Normalize
  // Errors and guard against circular references so logs stay small and useful.
  const seen = new WeakSet<object>();
  return JSON.stringify(fields, (_key, value) => {
    if (value instanceof Error) return normalizeError(value);
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  });
}

export function logError(context: string, error: unknown): void {
  console.error(formatStructuredLog({ context, error }));
}

export function logWarn(context: string, message: unknown): void {
  console.warn(formatStructuredLog({ context, message }));
}

export function logInfo(context: string, message: unknown): void {
  console.log(formatStructuredLog({ context, message }));
}
