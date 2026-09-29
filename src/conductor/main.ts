/**
 * Entry point for the conductor, a separate Discord application that walks the
 * allowlisted tester through a PR's `## Testing` steps and reports to the PR.
 *
 * It runs as its own process with its own token so it outlives restarts of the
 * preview bot it is checking. See docs/conductor.md.
 */
import { IntentsBitField, type Interaction } from "discord.js";
import { Client } from "discordx";
import { loadConductorSettings } from "./ConductorConfig.js";
import { setConductorRuntime } from "./ConductorRuntime.js";
import { GitHubPullClient } from "./GitHubPullClient.js";
import "./conductor.command.js";

const settings = loadConductorSettings();
setConductorRuntime({
  settings,
  github: new GitHubPullClient(settings.githubToken, settings.repo),
});

const client = new Client({
  botGuilds: [settings.testGuildId],
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    // Needed to read the bot under test's replies and mirror posts.
    IntentsBitField.Flags.MessageContent,
  ],
  silent: true,
});

client.once("clientReady", async () => {
  await client.initApplicationCommands();
  console.log(`[conductor] ready as ${client.user?.tag ?? "unknown"}`);
});

client.on("interactionCreate", async (interaction: Interaction) => {
  try {
    await client.executeInteraction(interaction);
  } catch (err: unknown) {
    console.error("[conductor] interaction failed", err);
  }
});

await client.login(settings.discordToken);
