import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initPostgresPool, pgQuery } from "../db/postgresClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../../db/postgres");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ITableRow {
  table_schema: string;
  table_name: string;
  table_type: string;
  row_estimate: string;
}

interface IColumnRow {
  column_name: string;
  ordinal_position: number;
  data_type: string;
  udt_name: string;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
  is_nullable: string;
  column_default: string | null;
  is_identity: string;
  identity_generation: string | null;
  description: string | null;
}

interface IIndexRow {
  index_name: string;
  index_type: string;
  is_unique: boolean;
  is_primary: boolean;
  columns: string;
  index_def: string;
}

interface IFkRow {
  constraint_name: string;
  column_name: string;
  foreign_table_schema: string;
  foreign_table_name: string;
  foreign_column_name: string;
  on_update: string;
  on_delete: string;
}

interface ITriggerRow {
  trigger_name: string;
  event_manipulation: string;
  action_timing: string;
  action_orientation: string;
  action_statement: string;
}

interface ICheckRow {
  constraint_name: string;
  check_clause: string;
}

interface IViewRow {
  table_schema: string;
  view_name: string;
  is_updatable: string;
  is_insertable_into: string;
  definition: string;
}

interface ISeqRow {
  sequence_schema: string;
  sequence_name: string;
  data_type: string;
  start_value: string;
  minimum_value: string;
  maximum_value: string;
  increment: string;
  cycle_option: string;
  owned_by: string;
}

interface IFuncRow {
  routine_schema: string;
  routine_name: string;
  routine_type: string;
  data_type: string;
  language: string;
  definition: string;
}

interface IExtRow {
  name: string;
  version: string;
  schema: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

async function fetchTables(schema: string): Promise<ITableRow[]> {
  return pgQuery<ITableRow>(`
    SELECT
      t.table_schema,
      t.table_name,
      t.table_type,
      pg_stat_get_live_tuples(c.oid)::text AS row_estimate
    FROM information_schema.tables t
    LEFT JOIN pg_class c
      ON c.relname = t.table_name
      AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = t.table_schema)
    WHERE t.table_schema = $1
    ORDER BY t.table_name
  `, [schema]);
}

async function fetchColumns(schema: string, table: string): Promise<IColumnRow[]> {
  return pgQuery<IColumnRow>(`
    SELECT
      a.attname          AS column_name,
      a.attnum           AS ordinal_position,
      format_type(a.atttypid, a.atttypmod) AS data_type,
      t.typname          AS udt_name,
      information_schema._pg_char_max_length(a.atttypid, a.atttypmod)
                         AS character_maximum_length,
      information_schema._pg_numeric_precision(a.atttypid, a.atttypmod)
                         AS numeric_precision,
      information_schema._pg_numeric_scale(a.atttypid, a.atttypmod)
                         AS numeric_scale,
      CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
      pg_get_expr(d.adbin, d.adrelid)
                         AS column_default,
      CASE WHEN a.attidentity = '' THEN 'NO' ELSE 'YES' END AS is_identity,
      CASE a.attidentity
        WHEN 'a' THEN 'ALWAYS'
        WHEN 'd' THEN 'BY DEFAULT'
        ELSE NULL
      END                AS identity_generation,
      col_description(a.attrelid, a.attnum) AS description
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_type t ON t.oid = a.atttypid
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = $1
      AND c.relname = $2
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY a.attnum
  `, [schema, table]);
}

async function fetchIndexes(schema: string, table: string): Promise<IIndexRow[]> {
  return pgQuery<IIndexRow>(`
    SELECT
      i.relname                           AS index_name,
      am.amname                           AS index_type,
      ix.indisunique                      AS is_unique,
      ix.indisprimary                     AS is_primary,
      array_to_string(
        ARRAY(
          SELECT a.attname
          FROM pg_attribute a
          WHERE a.attrelid = t.oid
            AND a.attnum = ANY(ix.indkey)
          ORDER BY array_position(ix.indkey, a.attnum)
        ), ', '
      )                                   AS columns,
      pg_get_indexdef(ix.indexrelid)      AS index_def
    FROM pg_index ix
    JOIN pg_class t  ON t.oid  = ix.indrelid
    JOIN pg_class i  ON i.oid  = ix.indexrelid
    JOIN pg_am am    ON am.oid = i.relam
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = $1
      AND t.relname = $2
    ORDER BY i.relname
  `, [schema, table]);
}

async function fetchForeignKeys(schema: string, table: string): Promise<IFkRow[]> {
  return pgQuery<IFkRow>(`
    SELECT
      kcu.constraint_name,
      kcu.column_name,
      ccu.table_schema   AS foreign_table_schema,
      ccu.table_name     AS foreign_table_name,
      ccu.column_name    AS foreign_column_name,
      rc.update_rule     AS on_update,
      rc.delete_rule     AS on_delete
    FROM information_schema.key_column_usage kcu
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = kcu.constraint_name
      AND rc.constraint_schema = kcu.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = rc.unique_constraint_name
      AND ccu.table_schema   = rc.unique_constraint_schema
    WHERE kcu.table_schema = $1
      AND kcu.table_name   = $2
    ORDER BY kcu.constraint_name, kcu.ordinal_position
  `, [schema, table]);
}

async function fetchTriggers(schema: string, table: string): Promise<ITriggerRow[]> {
  return pgQuery<ITriggerRow>(`
    SELECT
      trigger_name,
      event_manipulation,
      action_timing,
      action_orientation,
      action_statement
    FROM information_schema.triggers
    WHERE event_object_schema = $1
      AND event_object_table  = $2
    ORDER BY trigger_name, event_manipulation
  `, [schema, table]);
}

async function fetchChecks(schema: string, table: string): Promise<ICheckRow[]> {
  return pgQuery<ICheckRow>(`
    SELECT
      cc.constraint_name,
      cc.check_clause
    FROM information_schema.check_constraints cc
    JOIN information_schema.table_constraints tc
      ON tc.constraint_name   = cc.constraint_name
      AND tc.constraint_schema = cc.constraint_schema
    WHERE tc.table_schema = $1
      AND tc.table_name   = $2
    ORDER BY cc.constraint_name
  `, [schema, table]);
}

async function fetchViews(schema: string): Promise<IViewRow[]> {
  return pgQuery<IViewRow>(`
    SELECT
      table_schema,
      table_name   AS view_name,
      is_updatable,
      is_insertable_into,
      view_definition AS definition
    FROM information_schema.views
    WHERE table_schema = $1
    ORDER BY table_name
  `, [schema]);
}

async function fetchSequences(schema: string): Promise<ISeqRow[]> {
  return pgQuery<ISeqRow>(`
    SELECT
      s.sequence_schema,
      s.sequence_name,
      s.data_type,
      s.start_value,
      s.minimum_value,
      s.maximum_value,
      s.increment,
      s.cycle_option,
      COALESCE(
        (SELECT n2.nspname || '.' || c2.relname || '.' || a.attname
         FROM pg_depend dep
         JOIN pg_class c2 ON c2.oid = dep.refobjid
         JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
         JOIN pg_attribute a ON a.attrelid = dep.refobjid AND a.attnum = dep.refobjsubid
         JOIN pg_class sc ON sc.relname = s.sequence_name
         JOIN pg_namespace sn ON sn.nspname = s.sequence_schema AND sn.oid = sc.relnamespace
         WHERE dep.objid = sc.oid AND dep.deptype = 'a'
         LIMIT 1
        ), 'none'
      ) AS owned_by
    FROM information_schema.sequences s
    WHERE s.sequence_schema = $1
    ORDER BY s.sequence_name
  `, [schema]);
}

async function fetchFunctions(schema: string): Promise<IFuncRow[]> {
  return pgQuery<IFuncRow>(`
    SELECT
      routine_schema,
      routine_name,
      routine_type,
      data_type,
      external_language AS language,
      routine_definition AS definition
    FROM information_schema.routines
    WHERE routine_schema = $1
      AND routine_type IN ('FUNCTION', 'PROCEDURE')
    ORDER BY routine_name
  `, [schema]);
}

async function fetchExtensions(): Promise<IExtRow[]> {
  return pgQuery<IExtRow>(`
    SELECT
      e.extname AS name,
      e.extversion AS version,
      n.nspname AS schema,
      c.description
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    LEFT JOIN pg_description c ON c.objoid = e.oid
    ORDER BY e.extname
  `);
}

// ---------------------------------------------------------------------------
// MD helpers
// ---------------------------------------------------------------------------

function esc(s: string | null | undefined): string {
  return (s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function nullable(v: string): string {
  return v === "YES" ? "Yes" : "No";
}

function buildTableMd(
  schema: string,
  table: ITableRow,
  columns: IColumnRow[],
  indexes: IIndexRow[],
  fks: IFkRow[],
  triggers: ITriggerRow[],
  checks: ICheckRow[],
): string {
  const lines: string[] = [];
  const fullName = `${schema}.${table.table_name}`;

  lines.push(`# ${fullName}`);
  lines.push("");
  lines.push(`**Type:** ${table.table_type}  `);
  lines.push(`**Estimated rows:** ${table.row_estimate ?? "unknown"}`);
  lines.push("");

  // Columns
  lines.push("## Columns");
  lines.push("");
  lines.push("| # | Column | Type | Nullable | Default | Identity | Description |");
  lines.push("| - | ------ | ---- | -------- | ------- | -------- | ----------- |");
  for (const col of columns) {
    lines.push(
      `| ${col.ordinal_position} | ${esc(col.column_name)} | ${esc(col.data_type)}` +
      ` | ${nullable(col.is_nullable)} | ${esc(col.column_default)} | ${esc(col.identity_generation)}` +
      ` | ${esc(col.description)} |`,
    );
  }
  lines.push("");

  // Indexes
  if (indexes.length > 0) {
    lines.push("## Indexes");
    lines.push("");
    lines.push("| Name | Type | Unique | Primary | Columns |");
    lines.push("| ---- | ---- | ------ | ------- | ------- |");
    for (const idx of indexes) {
      lines.push(
        `| ${esc(idx.index_name)} | ${esc(idx.index_type)}` +
        ` | ${idx.is_unique ? "Yes" : "No"} | ${idx.is_primary ? "Yes" : "No"}` +
        ` | ${esc(idx.columns)} |`,
      );
    }
    lines.push("");

    lines.push("### Index Definitions");
    lines.push("");
    lines.push("```sql");
    for (const idx of indexes) {
      lines.push(idx.index_def + ";");
    }
    lines.push("```");
    lines.push("");
  }

  // Foreign keys
  if (fks.length > 0) {
    lines.push("## Foreign Keys");
    lines.push("");
    lines.push("| Constraint | Column | References | On Update | On Delete |");
    lines.push("| ---------- | ------ | ---------- | --------- | --------- |");
    for (const fk of fks) {
      const ref = `${fk.foreign_table_schema}.${fk.foreign_table_name}(${fk.foreign_column_name})`;
      lines.push(
        `| ${esc(fk.constraint_name)} | ${esc(fk.column_name)}` +
        ` | ${esc(ref)} | ${esc(fk.on_update)} | ${esc(fk.on_delete)} |`,
      );
    }
    lines.push("");
  }

  // Triggers
  if (triggers.length > 0) {
    lines.push("## Triggers");
    lines.push("");
    lines.push("| Name | Event | Timing | Orientation | Action |");
    lines.push("| ---- | ----- | ------ | ----------- | ------ |");
    for (const trg of triggers) {
      lines.push(
        `| ${esc(trg.trigger_name)} | ${esc(trg.event_manipulation)}` +
        ` | ${esc(trg.action_timing)} | ${esc(trg.action_orientation)}` +
        ` | ${esc(trg.action_statement)} |`,
      );
    }
    lines.push("");
  }

  // Check constraints
  if (checks.length > 0) {
    lines.push("## Check Constraints");
    lines.push("");
    lines.push("| Constraint | Clause |");
    lines.push("| ---------- | ------ |");
    for (const chk of checks) {
      lines.push(`| ${esc(chk.constraint_name)} | ${esc(chk.check_clause)} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function buildViewsMd(schema: string, views: IViewRow[]): string {
  const lines: string[] = [];
  lines.push(`# ${schema} -- Views`);
  lines.push("");
  for (const v of views) {
    lines.push(`## ${v.view_name}`);
    lines.push("");
    lines.push(`**Updatable:** ${v.is_updatable}  **Insertable:** ${v.is_insertable_into}`);
    lines.push("");
    lines.push("```sql");
    lines.push(v.definition.trimEnd());
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n");
}

function buildSequencesMd(schema: string, seqs: ISeqRow[]): string {
  const lines: string[] = [];
  lines.push(`# ${schema} -- Sequences`);
  lines.push("");
  lines.push("| Name | Type | Start | Min | Max | Increment | Cycle | Owned By |");
  lines.push("| ---- | ---- | ----- | --- | --- | --------- | ----- | -------- |");
  for (const s of seqs) {
    lines.push(
      `| ${esc(s.sequence_name)} | ${esc(s.data_type)}` +
      ` | ${esc(s.start_value)} | ${esc(s.minimum_value)} | ${esc(s.maximum_value)}` +
      ` | ${esc(s.increment)} | ${esc(s.cycle_option)} | ${esc(s.owned_by)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function buildFunctionsMd(schema: string, funcs: IFuncRow[]): string {
  const lines: string[] = [];
  lines.push(`# ${schema} -- Functions & Procedures`);
  lines.push("");
  for (const f of funcs) {
    lines.push(`## ${f.routine_name}`);
    lines.push("");
    lines.push(
      `**Type:** ${f.routine_type}  **Returns:** ${f.data_type}  **Language:** ${f.language}`,
    );
    lines.push("");
    if (f.definition) {
      lines.push("```sql");
      lines.push(f.definition.trimEnd());
      lines.push("```");
      lines.push("");
    }
  }
  return lines.join("\n");
}

function buildExtensionsMd(exts: IExtRow[]): string {
  const lines: string[] = [];
  lines.push("# Installed Extensions");
  lines.push("");
  lines.push("| Extension | Version | Schema | Description |");
  lines.push("| --------- | ------- | ------ | ----------- |");
  for (const e of exts) {
    lines.push(
      `| ${esc(e.name)} | ${esc(e.version)} | ${esc(e.schema)} | ${esc(e.description)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function buildIndexMd(schema: string, tables: ITableRow[]): string {
  const lines: string[] = [];
  lines.push(`# ${schema} -- Schema Index`);
  lines.push("");
  lines.push("| Table | Type | Estimated Rows | Doc |");
  lines.push("| ----- | ---- | -------------- | --- |");
  for (const t of tables) {
    const file = `${t.table_name}.md`;
    lines.push(
      `| ${t.table_name} | ${t.table_type} | ${t.row_estimate ?? "?"} | [${file}](./${file}) |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await initPostgresPool();

  const schema = process.env.PG_SCHEMA ?? "public";
  console.log(`Exploring schema: ${schema}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const tables = await fetchTables(schema);
  console.log(`Found ${tables.length} tables/views`);

  for (const table of tables) {
    const [columns, indexes, fks, triggers, checks] = await Promise.all([
      fetchColumns(schema, table.table_name),
      fetchIndexes(schema, table.table_name),
      fetchForeignKeys(schema, table.table_name),
      fetchTriggers(schema, table.table_name),
      fetchChecks(schema, table.table_name),
    ]);

    const md = buildTableMd(schema, table, columns, indexes, fks, triggers, checks);
    const filePath = path.join(OUT_DIR, `${table.table_name}.md`);
    fs.writeFileSync(filePath, md, "utf8");
    console.log(`  wrote ${filePath}`);
  }

  const views = await fetchViews(schema);
  if (views.length > 0) {
    const filePath = path.join(OUT_DIR, "_views.md");
    fs.writeFileSync(filePath, buildViewsMd(schema, views), "utf8");
    console.log(`  wrote ${filePath}`);
  }

  const seqs = await fetchSequences(schema);
  if (seqs.length > 0) {
    const filePath = path.join(OUT_DIR, "_sequences.md");
    fs.writeFileSync(filePath, buildSequencesMd(schema, seqs), "utf8");
    console.log(`  wrote ${filePath}`);
  }

  const funcs = await fetchFunctions(schema);
  if (funcs.length > 0) {
    const filePath = path.join(OUT_DIR, "_functions.md");
    fs.writeFileSync(filePath, buildFunctionsMd(schema, funcs), "utf8");
    console.log(`  wrote ${filePath}`);
  }

  const exts = await fetchExtensions();
  if (exts.length > 0) {
    const filePath = path.join(OUT_DIR, "_extensions.md");
    fs.writeFileSync(filePath, buildExtensionsMd(exts), "utf8");
    console.log(`  wrote ${filePath}`);
  }

  const indexMd = buildIndexMd(schema, tables);
  const indexPath = path.join(OUT_DIR, "_index.md");
  fs.writeFileSync(indexPath, indexMd, "utf8");
  console.log(`  wrote ${indexPath}`);

  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
