import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

// eslint-rules lives outside rootDir, so load it by URL to keep tsc from pulling it in.
const RULES_URL = new URL("../../eslint-rules/index.js", import.meta.url).href;
const { default: localRules } = (await import(RULES_URL)) as {
  default: { rules: Record<string, Rule> };
};
const rule = localRules.rules["v2-builders-from-discordjs-builders"];

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

ruleTester.run("v2-builders-from-discordjs-builders", rule, {
  valid: [
    "import { ContainerBuilder, FileBuilder } from \"@discordjs/builders\";",
    "import { ButtonBuilder, MessageFlags } from \"discord.js\";",
    "import type { ContainerBuilder } from \"discord.js\";",
    "import { type TextDisplayBuilder, MessageFlags } from \"discord.js\";",
  ],
  invalid: [
    {
      code: "import { FileBuilder } from \"discord.js\";",
      errors: [{ messageId: "useBuildersPackage", data: { name: "FileBuilder" } }],
    },
    {
      code: "import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from \"discord.js\";",
      errors: [
        { messageId: "useBuildersPackage", data: { name: "ContainerBuilder" } },
        { messageId: "useBuildersPackage", data: { name: "TextDisplayBuilder" } },
      ],
    },
    {
      code: "import { SectionBuilder as Section } from \"discord.js\";",
      errors: [{ messageId: "useBuildersPackage", data: { name: "SectionBuilder" } }],
    },
  ],
});
