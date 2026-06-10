export function formatStructuredLog(fields: Record<string, unknown>): string {
  return JSON.stringify(fields);
}

export function logError(context: string, error: unknown): void {
  console.error(formatStructuredLog({ context, error }));
}
