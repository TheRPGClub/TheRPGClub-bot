import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

// eslint-rules lives outside rootDir, so load it by URL to keep tsc from pulling it in.
const RULES_URL = new URL("../../eslint-rules/index.js", import.meta.url).href;
const { default: localRules } = (await import(RULES_URL)) as {
  default: { rules: Record<string, Rule> };
};
const rule = localRules.rules["no-full-member-fetch"];

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

ruleTester.run("no-full-member-fetch", rule, {
  valid: [
    "await fetchAllGuildMembers(guild);",
    "await guild.members.fetch(userId);",
    "await guild.members.fetch({ user: chunk });",
    "await guild.members.fetch({ query: name, limit: 10 });",
    "await guild.members.fetch(options);",
    "await guild.members.fetch({ ...options });",
    "await reaction.users.fetch();",
    "await guild.members[\"fetch\"]();",
    "await thread.members.fetch();",
    "await interaction.channel.thread.members.fetch();",
    "await forumThread.members.fetch({ withMember: true });",
    {
      code: "await guild.members.fetch();",
      filename: "/repo/src/functions/GuildMemberFetch.ts",
    },
  ],
  invalid: [
    {
      code: "await guild.members.fetch();",
      errors: [{ messageId: "noFullMemberFetch", data: { target: "guild.members" } }],
    },
    {
      code: "await interaction.guild.members.fetch();",
      errors: [
        { messageId: "noFullMemberFetch", data: { target: "interaction.guild.members" } },
      ],
    },
    {
      code: "await client.guilds.cache.first()?.members.fetch();",
      errors: [{ messageId: "noFullMemberFetch" }],
    },
    {
      code: "await guild.members.fetch({ withPresences: true });",
      errors: [{ messageId: "noFullMemberFetch" }],
    },
    {
      code: "await guild.members.fetch({ limit: 0, time: 30_000 });",
      errors: [{ messageId: "noFullMemberFetch" }],
    },
  ],
});
