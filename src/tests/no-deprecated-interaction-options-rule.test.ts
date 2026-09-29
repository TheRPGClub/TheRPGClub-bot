import { describe, it } from "node:test";
import { RuleTester, type Rule } from "eslint";

// eslint-rules lives outside rootDir, so load it by URL to keep tsc from pulling it in.
const RULES_URL = new URL("../../eslint-rules/index.js", import.meta.url).href;
const { default: localRules } = (await import(RULES_URL)) as {
  default: { rules: Record<string, Rule.RuleModule> };
};
const rule = localRules.rules["no-deprecated-interaction-options"];

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester();

const deprecated = [{ messageId: "deprecatedOption" }];

ruleTester.run("no-deprecated-interaction-options", rule, {
  valid: [
    "interaction.reply({ content: 'hi', flags: MessageFlags.Ephemeral });",
    "safeReply(interaction, { content: 'hi', flags: MessageFlags.Ephemeral });",
    "safeReply({ ephemeral: true }, { content: 'hi' });",
    "someOtherHelper(interaction, { ephemeral: true });",
  ],
  invalid: [
    {
      code: "interaction.reply({ content: 'hi', ephemeral: true });",
      output: "interaction.reply({ content: 'hi', flags: MessageFlags.Ephemeral });",
      errors: deprecated,
    },
    {
      code: "safeReply(interaction, { content: 'hi', ephemeral: true });",
      output: "safeReply(interaction, { content: 'hi', flags: MessageFlags.Ephemeral });",
      errors: deprecated,
    },
    {
      code: "safeFollowUp(interaction, { ephemeral: false, content: 'hi' });",
      output: "safeFollowUp(interaction, {  content: 'hi' });",
      errors: deprecated,
    },
    {
      code: "safeDeferReply(interaction, { ephemeral: isPrivate });",
      output: null,
      errors: deprecated,
    },
    {
      code: "safeReply(interaction, { flags: 0, ephemeral: true });",
      output: null,
      errors: deprecated,
    },
    {
      code: "safeReply(interaction, { content: 'hi', fetchReply: true });",
      output: null,
      errors: deprecated,
    },
    {
      code: "const msg = await interaction.fetchReply();",
      output: null,
      errors: [{ messageId: "deprecatedFetchReply" }],
    },
  ],
});
