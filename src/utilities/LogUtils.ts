export function formatStructuredLog(fields: Record<string, unknown>): string {
  return JSON.stringify(fields);
}

export function logError(context: string, error: unknown): void {
  console.error(formatStructuredLog({ context, error }));
}

export function logWarn(context: string, message: unknown): void {
  console.warn(formatStructuredLog({ context, message }));
}
