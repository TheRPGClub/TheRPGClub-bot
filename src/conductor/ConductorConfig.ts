/**
 * Runtime settings for the conductor process, read from its own environment.
 *
 * The conductor never loads the bot's `.env` file; its process manager supplies
 * these variables directly. It requires `TEST_GUILD_ID` so the shared channel
 * and user constants resolve to the test guild.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { BOT_DEV_CHANNEL_ID, TEST_LOG_CHANNEL_ID } from "../config/channels.js";
import { TODO_REPOS } from "../config/repos.js";
import { IS_TEST_MODE, TEST_GUILD_ID } from "../config/testMode.js";
import { BOT_DEV_PING_USER_ID, PREVIEW_BOT_USER_ID } from "../config/users.js";
import type { IGitHubRepoRef } from "./GitHubPullClient.js";

export interface IConductorSettings {
  discordToken: string;
  githubToken: string;
  statePath: string;
  testGuildId: string;
  /** Where commands are run and public replies land. */
  testChannelId: string;
  /** Where the bot under test mirrors its ephemeral replies. */
  mirrorChannelId: string;
  allowedUserId: string;
  /** The only author whose ready announcement starts a run. */
  previewBotId: string;
  repo: IGitHubRepoRef;
}

const DEFAULT_STATE_PATH = join(homedir(), ".config", "rpgclub-conductor", "state.json");

/** The conductor reports to the bot repository, the same one `/todo` browses as "b". */
const CONDUCTOR_REPO: IGitHubRepoRef = { owner: TODO_REPOS.b.owner, name: TODO_REPOS.b.name };

function requireEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} must be set to run the conductor.`);
  return value;
}

export function loadConductorSettings(): IConductorSettings {
  if (!IS_TEST_MODE) {
    throw new Error("TEST_GUILD_ID must be set: the conductor only runs in the test guild.");
  }
  return {
    discordToken: requireEnv("CONDUCTOR_BOT_TOKEN"),
    githubToken: requireEnv("CONDUCTOR_GITHUB_TOKEN"),
    statePath: (process.env.CONDUCTOR_STATE_PATH ?? "").trim() || DEFAULT_STATE_PATH,
    testGuildId: TEST_GUILD_ID,
    testChannelId: BOT_DEV_CHANNEL_ID,
    mirrorChannelId: TEST_LOG_CHANNEL_ID,
    allowedUserId: BOT_DEV_PING_USER_ID,
    previewBotId: PREVIEW_BOT_USER_ID,
    repo: CONDUCTOR_REPO,
  };
}
