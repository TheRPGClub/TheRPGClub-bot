import { EmbedBuilder, MessageFlags } from "discord.js";
import type { CommandInteraction } from "discord.js";
import { getOraclePool } from "../../db/oracleClient.js";
import { getPostgresPool } from "../../db/postgresClient.js";
import { safeReply } from "../../functions/InteractionUtils.js";

export type SqlTarget = "oracle" | "postgresql";

interface HealthResult {
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
}

async function checkOracle(): Promise<HealthResult> {
  const start = Date.now();
  let connection;
  try {
    connection = await getOraclePool().getConnection();
    await connection.execute("SELECT 1 FROM DUAL");
    return { ok: true, latencyMs: Date.now() - start, error: null };
  } catch (err) {
    return { ok: false, latencyMs: null, error: String(err) };
  } finally {
    try { await connection?.close(); } catch { /* ignore */ }
  }
}

async function checkPostgres(): Promise<HealthResult> {
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
  target: SqlTarget,
): Promise<void> {
  const isOracle = target === "oracle";
  const label = isOracle ? "Oracle" : "PostgreSQL";
  const result = isOracle ? await checkOracle() : await checkPostgres();

  const embed = new EmbedBuilder()
    .setTitle(`${result.ok ? "✅" : "❌"} ${label} Health Check`)
    .setColor(result.ok ? 0x57f287 : 0xed4245)
    .setTimestamp();

  if (result.ok && result.latencyMs !== null) {
    embed.setDescription(`Connection healthy -- round-trip latency: **${result.latencyMs} ms**`);
  } else {
    embed.setDescription("Connection failed.");
    embed.addFields({ name: "Error", value: `\`\`\`${result.error}\`\`\`` });
  }

  await safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
}
