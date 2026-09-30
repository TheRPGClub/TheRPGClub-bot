/**
 * Entry point for the conductor, a separate Discord application that walks the
 * allowlisted tester through a PR's `## Testing` steps and reports to the PR.
 *
 * It runs as its own process with its own token so it outlives restarts of the
 * preview bot it is checking. See docs/conductor.md.
 */
import { IntentsBitField, type Interaction, type Message } from "discord.js";
import { Client } from "discordx";
import {
  checkConductorChannelAccess,
  formatChannelAccessProblem,
} from "./ConductorChannelAccess.js";
import { loadConductorSettings } from "./ConductorConfig.js";
import { readConductorRevision } from "./ConductorRevision.js";
import { setConductorRuntime } from "./ConductorRuntime.js";
import { GitHubPullClient } from "./GitHubPullClient.js";
import { startRunFromAnnouncement } from "./conductor.command.js";

const settings = loadConductorSettings();
// Read once at startup, so a checkout pulled later cannot misreport what is running.
const revision = readConductorRevision();
setConductorRuntime({
  settings,
  github: new GitHubPullClient(settings.githubToken, settings.repo),
});

const client = new Client({
  botGuilds: [settings.testGuildId],
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    // Needed to read the bot under test's replies, mirror posts, and ready announcement.
    IntentsBitField.Flags.MessageContent,
  ],
  silent: true,
});

client.once("clientReady", async (readyClient) => {
  // Runs first so it still logs when command registration fails. Logs and keeps
  // running: a permission fixed in Discord then works without a restart.
  const problems = await checkConductorChannelAccess(readyClient, settings);
  for (const problem of problems) {
    console.error(`[conductor] ${formatChannelAccessProblem(problem)}`);
  }
  await client.initApplicationCommands();
  // scripts/conductor/deploy.sh waits for this line, commit included, after a restart.
  const tag = client.user?.tag ?? "unknown";
  console.log(`[conductor] ready as ${tag} at ${revision}`);
});

client.on("interactionCreate", async (interaction: Interaction) => {
  try {
    await client.executeInteraction(interaction);
  } catch (err: unknown) {
    console.error("[conductor] interaction failed", err);
  }
});

// The preview bot announces it is ready in the dev channel; that starts its PR's run.
client.on("messageCreate", async (message: Message) => {
  try {
    await startRunFromAnnouncement(message);
  } catch (err: unknown) {
    console.error("[conductor] starting a run from an announcement failed", err);
  }
});

await client.login(settings.discordToken);
