import axios from "axios";

export function formatApiError(
  method: string,
  url: string,
  requestBody: unknown,
  status: number | undefined,
  responseBody: unknown,
): string {
  const req = JSON.stringify(
    { method: method.toUpperCase(), url, body: requestBody ?? null },
    null, 2,
  );
  const res = JSON.stringify({ status: status ?? null, body: responseBody ?? null }, null, 2);
  return `Request:\n\`\`\`json\n${req}\n\`\`\`\nResponse:\n\`\`\`json\n${res}\n\`\`\``;
}

function tryParseJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function buildApiErrorMessage(label: string, err: unknown): string {
  if (!axios.isAxiosError(err)) {
    const msg = err instanceof Error ? err.message : String(err);
    return `${label}: ${msg}`;
  }
  return `${label}\n${formatApiError(
    err.config?.method ?? "?",
    err.config?.url ?? "?",
    tryParseJson(err.config?.data as string | null | undefined),
    err.response?.status,
    err.response?.data,
  )}`;
}
