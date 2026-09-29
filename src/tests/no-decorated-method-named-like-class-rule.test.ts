import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

// eslint-rules lives outside rootDir, so load it by URL to keep tsc from pulling it in.
const RULES_URL = new URL("../../eslint-rules/index.js", import.meta.url).href;
const { default: localRules } = (await import(RULES_URL)) as {
  default: { rules: Record<string, Rule> };
};
const rule = localRules.rules["no-decorated-method-named-like-class"];

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

ruleTester.run("no-decorated-method-named-like-class", rule, {
  valid: [
    "@Discord() class hltb { @Slash({ name: \"hltb\" }) async execute() {} }",
    "class hltb { async hltb() {} }",
    "@Discord() class hltb { async other() {} static create() {} }",
    "@Discord() class hltb { [\"hltb\"]() {} }",
    "@Discord() class hltb { hltb = 1; }",
  ],
  invalid: [
    {
      code: "@Discord() export class hltb { @Slash({}) async hltb() {} }",
      errors: [{ messageId: "methodNamedLikeClass", data: { name: "hltb" } }],
    },
    {
      code: "@Discord() class gamedb { gamedb() {} }",
      errors: [{ messageId: "methodNamedLikeClass", data: { name: "gamedb" } }],
    },
  ],
});
