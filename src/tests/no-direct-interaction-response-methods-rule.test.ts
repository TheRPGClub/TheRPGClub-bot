import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

// eslint-rules lives outside rootDir, so load it by URL to keep tsc from pulling it in.
const RULES_URL = new URL("../../eslint-rules/index.js", import.meta.url).href;
const { default: localRules } = (await import(RULES_URL)) as {
  default: { rules: Record<string, Rule> };
};
const rule = localRules.rules["no-direct-interaction-response-methods"];

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

ruleTester.run("no-direct-interaction-response-methods", rule, {
  valid: [
    "await safeRespond(interaction, []);",
    "await handler.respond([]);",
    {
      code: "await interaction.respond(choices);",
      filename: "/repo/src/functions/InteractionUtils.ts",
    },
  ],
  invalid: [
    {
      code: "await interaction.respond([]);",
      errors: [{ messageId: "useSafeMethod", data: { method: "respond" } }],
    },
    {
      code: "await autocompleteInteraction.respond(options);",
      errors: [{ messageId: "useSafeMethod", data: { method: "respond" } }],
    },
    {
      code: "await interaction.reply({ content: \"hi\" });",
      errors: [{ messageId: "useSafeMethod", data: { method: "reply" } }],
    },
  ],
});
