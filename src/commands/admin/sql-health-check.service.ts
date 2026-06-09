import { EmbedBuilder, MessageFlags } from "discord.js";
import { COLOR_HEALTH_OK, COLOR_HEALTH_FAIL } from "../../config/colors.js";
import type { CommandInteraction } from "discord.js";
import { oraWithConnection } from "../../db/SqlManager.js";
import { getPostgresPool } from "../../db/postgresClient.js";
import { safeReply } from "../../functions/InteractionUtils.js";

export type SqlTarget = "oracle" | "postgresql";

interface IHealthResult {
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
}

async function checkOracle(): Promise<IHealthResult> {
  const start = Date.now();
  try {
    await oraWithConnection(async (conn) => {
      await conn.execute("SELECT 1 FROM DUAL");
    });
    return { ok: true, latencyMs: Date.now() - start, error: null };
  } catch (err) {
    return { ok: false, latencyMs: null, error: String(err) };
  }
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
  target: SqlTarget,
): Promise<void> {
  const isOracle = target === "oracle";
  const label = isOracle ? "Oracle" : "PostgreSQL";
  const result = isOracle ? await checkOracle() : await checkPostgres();

  const embed = new EmbedBuilder()
    .setTitle(`${result.ok ? "✅" : "❌"} ${label} Health Check`)
    .setColor(result.ok ? COLOR_HEALTH_OK : COLOR_HEALTH_FAIL)
    .setTimestamp();

  if (result.ok && result.latencyMs !== null) {
    embed.setDescription(`Connection healthy -- round-trip latency: **${result.latencyMs} ms**`);
  } else {
    embed.setDescription("Connection failed.");
    embed.addFields({ name: "Error", value: `\`\`\`${result.error}\`\`\`` });
  }

  await safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
}
