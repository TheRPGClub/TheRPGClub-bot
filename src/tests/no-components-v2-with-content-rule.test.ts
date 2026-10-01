import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

// eslint-rules lives outside rootDir, so load it by URL to keep tsc from pulling it in.
const RULES_URL = new URL("../../eslint-rules/index.js", import.meta.url).href;
const { default: localRules } = (await import(RULES_URL)) as {
  default: { rules: Record<string, Rule> };
};
const rule = localRules.rules["no-components-v2-with-content"];

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

ruleTester.run("no-components-v2-with-content", rule, {
  valid: [
    "await interaction.reply({ content: \"hi\", flags: MessageFlags.Ephemeral });",
    "await interaction.reply({ components: [], flags: MessageFlags.IsComponentsV2 });",
    // A V2 flag elsewhere in the file must not leak into an unrelated payload.
    [
      "const MENU = { components: [], flags: MessageFlags.IsComponentsV2 };",
      "await safeUpdate(interaction, { content: \"x\", flags: MessageFlags.Ephemeral });",
    ].join("\n"),
  ],
  invalid: [
    {
      code: "await interaction.reply({ content: \"hi\", flags: MessageFlags.IsComponentsV2 });",
      errors: [{ messageId: "noContentWithV2" }],
    },
    {
      code: [
        "await safeReply(interaction,",
        "  { content: \"hi\", flags: buildComponentsV2Flags(true) });",
      ].join("\n"),
      errors: [{ messageId: "noContentWithV2" }],
    },
  ],
});
