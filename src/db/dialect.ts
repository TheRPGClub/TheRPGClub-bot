import type { Dialect } from "./sql/types.js";

export function getDialect(): Dialect {
  const raw = process.env.DB_DIALECT ?? "oracle";
  if (raw === "oracle" || raw === "postgres") return raw;
  throw new Error(`Unknown DB_DIALECT: "${raw}". Expected "oracle" or "postgres".`);
}
