import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

// eslint-rules lives outside rootDir, so load it by URL to keep tsc from pulling it in.
const RULES_URL = new URL("../../eslint-rules/index.js", import.meta.url).href;
const { default: localRules } = (await import(RULES_URL)) as {
  default: { rules: Record<string, Rule> };
};
const rule = localRules.rules["no-direct-reaction-fetch"];

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

ruleTester.run("no-direct-reaction-fetch", rule, {
  valid: [
    "await resolveReactionMessage(reaction, user.id);",
    "await channel.messages.fetch(id);",
    "await reaction.users.fetch();",
    "await message.fetch();",
    "await reaction[\"fetch\"]();",
    {
      code: "await reaction.message.fetch();",
      filename: "/repo/src/utilities/ReactionFetchUtils.ts",
    },
  ],
  invalid: [
    {
      code: "await reaction.fetch();",
      errors: [{ messageId: "noDirectReactionFetch", data: { target: "reaction" } }],
    },
    {
      code: "await reaction.message.fetch();",
      errors: [{ messageId: "noDirectReactionFetch", data: { target: "reaction.message" } }],
    },
    {
      code: "safeIgnore(reaction.fetch());",
      errors: [{ messageId: "noDirectReactionFetch" }],
    },
    {
      code: "await partialReaction.message.fetch();",
      errors: [
        { messageId: "noDirectReactionFetch", data: { target: "partialReaction.message" } },
      ],
    },
  ],
});
