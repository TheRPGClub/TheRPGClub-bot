/**
 * Checks that the conductor can use the channels it is configured for, so a
 * missing permission surfaces at startup instead of when a tester presses Check.
 */
import { type Channel, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import type { IConductorSettings } from "./ConductorConfig.js";

/** The slice of the discord.js client the check uses, so tests can fake it. */
export interface IChannelAccessClient {
  user: { id: string };
  channels: { fetch(channelId: string): Promise<Channel | null> };
}

export interface IChannelAccessProblem {
  channelId: string;
  /** `#name` when the channel was fetched, a mention otherwise. */
  channelName: string;
  reason: string;
  /** The fetch error, kept so a reply can show the full request and response. */
  error?: unknown;
}

type ConductorSettingsForAccess = Pick<
  IConductorSettings,
  "testGuildId" | "testChannelId" | "mirrorChannelId"
>;

const READ_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
];

/**
 * The test channel is read back and is where `/conduct` posts its steps. The
 * mirror channel is only read back.
 */
function requiredPermissions(
  settings: ConductorSettingsForAccess,
): Map<string, bigint[]> {
  const required = new Map<string, bigint[]>();
  required.set(settings.testChannelId, [...READ_PERMISSIONS, PermissionFlagsBits.SendMessages]);
  if (!required.has(settings.mirrorChannelId)) {
    required.set(settings.mirrorChannelId, READ_PERMISSIONS);
  }
  return required;
}

/** `ReadMessageHistory` becomes `Read Message History`, as Discord's settings name it. */
function describePermissions(permissions: bigint[]): string {
  return new PermissionsBitField(permissions)
    .toArray()
    .map((name) => name.replace(/(?<=[a-z])(?=[A-Z])/g, " "))
    .join(", ");
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function checkChannel(
  client: IChannelAccessClient,
  settings: ConductorSettingsForAccess,
  channelId: string,
  permissions: bigint[],
): Promise<IChannelAccessProblem | null> {
  const mention = `<#${channelId}>`;
  const needed = describePermissions(permissions);
  let channel: Channel | null;
  try {
    channel = await client.channels.fetch(channelId);
  } catch (err: unknown) {
    return {
      channelId,
      channelName: mention,
      reason: `fetching it failed (${describeError(err)}); needs ${needed}`,
      error: err,
    };
  }
  if (!channel) return { channelId, channelName: mention, reason: "channel not found" };
  if (!channel.isTextBased() || channel.isDMBased()) {
    return { channelId, channelName: mention, reason: "not a guild text channel" };
  }
  const channelName = `#${channel.name}`;
  if (channel.guildId !== settings.testGuildId) {
    return { channelId, channelName, reason: "not in the test guild" };
  }
  const granted = channel.permissionsFor(client.user.id);
  if (!granted) {
    return { channelId, channelName, reason: `cannot resolve permissions; needs ${needed}` };
  }
  const missing = permissions.filter((permission) => !granted.has(permission));
  if (!missing.length) return null;
  return { channelId, channelName, reason: `missing ${describePermissions(missing)}` };
}

/** Every configured channel the conductor cannot fully use, in settings order. */
export async function checkConductorChannelAccess(
  client: IChannelAccessClient,
  settings: ConductorSettingsForAccess,
): Promise<IChannelAccessProblem[]> {
  const problems: IChannelAccessProblem[] = [];
  for (const [channelId, permissions] of requiredPermissions(settings)) {
    const problem = await checkChannel(client, settings, channelId, permissions);
    if (problem) problems.push(problem);
  }
  return problems;
}

export function formatChannelAccessProblem(problem: IChannelAccessProblem): string {
  return `Cannot use ${problem.channelName} (${problem.channelId}): ${problem.reason}.`;
}
