import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

// eslint-rules lives outside rootDir, so load it by URL to keep tsc from pulling it in.
const RULES_URL = new URL("../../eslint-rules/index.js", import.meta.url).href;
const { default: localRules } = (await import(RULES_URL)) as {
  default: { rules: Record<string, Rule> };
};
const rule = localRules.rules["interface-name-prefix"];

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

ruleTester.run("interface-name-prefix", rule, {
  valid: [
    "interface IUser { id: string; }",
    "export interface IGameEntry { title: string; }",
    "declare global { interface IWindowExtras { debug: boolean; } }",
    "type User = { id: string };",
  ],
  invalid: [
    {
      code: "interface User { id: string; }",
      errors: [{ messageId: "missingPrefix", data: { name: "User", pattern: "/^I[A-Z]/" } }],
    },
    {
      code: "interface Iuser { id: string; }",
      errors: [{ messageId: "missingPrefix" }],
    },
    {
      code: "interface iUser { id: string; }",
      errors: [{ messageId: "notPascalCase", data: { name: "iUser" } }],
    },
    {
      code: "interface I_User { id: string; }",
      errors: [{ messageId: "notPascalCase" }],
    },
  ],
});
