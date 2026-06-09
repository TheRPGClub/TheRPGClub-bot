export function formatStructuredLog(fields: Record<string, unknown>): string {
  return JSON.stringify(fields);
}
