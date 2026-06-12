import { COLOR_HEALTH_OK, COLOR_HEALTH_FAIL } from "../../config/colors.js";
import type { CommandInteraction } from "discord.js";
import { getPostgresPool } from "../../db/postgresClient.js";
import { safeReply } from "../../functions/InteractionUtils.js";
import {
  buildTitledContainer,
  buildComponentsV2Flags,
} from "../../functions/ComponentsV2Utils.js";

export type SqlTarget = "postgresql";

interface IHealthResult {
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
}

async function checkPostgres(): Promise<IHealthResult> {
  const start = Date.now();
  let client;
  try {
    client = await getPostgresPool().connect();
    await client.query("SELECT 1");
    return { ok: true, latencyMs: Date.now() - start, error: null };
  } catch (err) {
    return { ok: false, latencyMs: null, error: String(err) };
  } finally {
    try { client?.release(); } catch { /* ignore */ }
  }
}

export async function handleSqlHealthCheck(
  interaction: CommandInteraction,
): Promise<void> {
  const label = "PostgreSQL";
  const result = await checkPostgres();

  let body: string;
  if (result.ok && result.latencyMs !== null) {
    body = `Connection healthy -- round-trip latency: **${result.latencyMs} ms**`;
  } else {
    body = `Connection failed.\n\n**Error**\n\`\`\`${result.error}\`\`\``;
  }
  const container = buildTitledContainer(
    `${result.ok ? "✅" : "❌"} ${label} Health Check`,
    body,
    { color: result.ok ? COLOR_HEALTH_OK : COLOR_HEALTH_FAIL },
  );

  await safeReply(interaction, { components: [container], flags: buildComponentsV2Flags(true) });
}
