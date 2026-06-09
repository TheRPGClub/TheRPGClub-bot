export type Dialect = "oracle" | "postgres";

export interface ISqlEntry {
  oracle: string;
  postgres: string;
}
