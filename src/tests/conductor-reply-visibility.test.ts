import test from "node:test";
import assert from "node:assert/strict";
import {
  MessageFlags,
  MessageFlagsBitField,
  type CommandInteraction,
  type MessageFlagsResolvable,
} from "discord.js";

import type { IConductorSettings } from "../conductor/ConductorConfig.js";
import { setConductorRuntime } from "../conductor/ConductorRuntime.js";
import type { GitHubPullClient, IPullRequestInfo } from "../conductor/GitHubPullClient.js";
import { ConductorCommand } from "../conductor/conductor.command.js";

const CONTEXT = { allowedUserId: "100", testGuildId: "500" };

type Payload = { flags?: MessageFlagsResolvable } | undefined;

interface IFakeCalls {
  defer: Payload[];
  reply: Payload[];
  edit: Payload[];
}

function isEphemeral(payload: Payload): boolean {
  const flags = payload?.flags;
  if (flags === undefined || flags === null) return false;
  return new MessageFlagsBitField(flags).has(MessageFlags.Ephemeral);
}

function fakeConductInteraction(userId: string): {
  interaction: CommandInteraction;
  calls: IFakeCalls;
} {
  const calls: IFakeCalls = { defer: [], reply: [], edit: [] };
  const fake = {
    id: "1",
    user: { id: userId, bot: false },
    guildId: CONTEXT.testGuildId,
    channelId: "700",
    commandName: "conduct",
    createdTimestamp: 0,
    client: { user: { id: "900" } },
    deferred: false,
    replied: false,
    isChatInputCommand: (): boolean => true,
    isMessageComponent: (): boolean => false,
    isModalSubmit: (): boolean => false,
    isRepliable: (): boolean => true,
    async deferReply(options: Payload): Promise<void> {
      calls.defer.push(options);
      fake.deferred = true;
    },
    async reply(options: Payload): Promise<void> {
      calls.reply.push(options);
      fake.replied = true;
    },
    async editReply(options: Payload): Promise<void> {
      calls.edit.push(options);
    },
    async followUp(options: Payload): Promise<void> {
      calls.reply.push(options);
    },
  };
  return { interaction: fake as unknown as CommandInteraction, calls };
}

function useRuntime(getPullRequest: () => Promise<IPullRequestInfo>): void {
  const github = {
    getPullRequest,
    postComment: async (): Promise<string> => "https://example.test/comment",
  } as unknown as GitHubPullClient;
  const settings = {
    ...CONTEXT,
    statePath: "/nonexistent/state.json",
  } as IConductorSettings;
  setConductorRuntime({ settings, github });
}

function pull(state: string, body: string): IPullRequestInfo {
  return { number: 1272, state, headSha: "abc", body, htmlUrl: "https://example.test/pr" };
}

const OUTCOMES: [string, () => Promise<IPullRequestInfo>][] = [
  ["PR read failure", async () => { throw new Error("boom"); }],
  ["PR not open", async () => pull("closed", "")],
  ["no Testing steps", async () => pull("open", "## Summary\n- nothing to run\n")],
  ["malformed plan", async () => pull("open", "## Testing\n\n### Step 1: Broken\n")],
];

for (const [name, getPullRequest] of OUTCOMES) {
  test(`an allowed /conduct replies publicly on ${name}`, async () => {
    useRuntime(getPullRequest);
    const { interaction, calls } = fakeConductInteraction(CONTEXT.allowedUserId);

    await new ConductorCommand().conduct(1272, interaction);

    assert.equal(calls.defer.length, 1);
    assert.equal(isEphemeral(calls.defer[0]), false);
    assert.equal(calls.edit.length, 1);
    assert.equal(isEphemeral(calls.edit[0]), false);
    assert.deepEqual(calls.reply, []);
  });
}

test("a denied /conduct still replies ephemerally", async () => {
  useRuntime(async () => pull("open", ""));
  const { interaction, calls } = fakeConductInteraction("101");

  await new ConductorCommand().conduct(1272, interaction);

  assert.deepEqual(calls.defer, []);
  assert.equal(calls.reply.length, 1);
  assert.equal(isEphemeral(calls.reply[0]), true);
});
