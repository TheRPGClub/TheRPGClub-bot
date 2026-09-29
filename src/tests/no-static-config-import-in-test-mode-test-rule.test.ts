import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

// eslint-rules lives outside rootDir, so load it by URL to keep tsc from pulling it in.
const RULES_URL = new URL("../../eslint-rules/index.js", import.meta.url).href;
const { default: localRules } = (await import(RULES_URL)) as {
  default: { rules: Record<string, Rule> };
};
const rule = localRules.rules["no-static-config-import-in-test-mode-test"];

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

const TEST_FILE = "src/tests/example.test.ts";
const ASSIGN = "process.env.TEST_GUILD_ID = \"1\";";
const CHANNELS_IMPORT = "import { ADMIN_CHANNEL_ID } from \"../config/channels.js\";";

ruleTester.run("no-static-config-import-in-test-mode-test", rule, {
  valid: [
    { code: CHANNELS_IMPORT, filename: TEST_FILE },
    {
      code: `${CHANNELS_IMPORT}\nconst id = process.env.TEST_GUILD_ID;`,
      filename: TEST_FILE,
    },
    { code: `${CHANNELS_IMPORT}\n${ASSIGN}`, filename: "src/functions/Example.ts" },
    {
      code: [
        "import test from \"node:test\";",
        "import assert from \"node:assert/strict\";",
        "import { strict } from \"node:assert\";",
        "import { MessageFlags } from \"discord.js\";",
        "import type { AnyRepliable } from \"../functions/InteractionUtils.js\";",
        "export type { Foo } from \"../config/channels.js\";",
        "import { type Bar } from \"../config/tags.js\";",
        "export { type Baz } from \"../config/users.js\";",
        ASSIGN,
        "const { ADMIN_CHANNEL_ID } = await import(\"../config/channels.js\");",
      ].join("\n"),
      filename: TEST_FILE,
    },
  ],
  invalid: [
    {
      code: `${CHANNELS_IMPORT}\n${ASSIGN}`,
      filename: TEST_FILE,
      errors: [{ messageId: "staticImport", data: { source: "../config/channels.js" } }],
    },
    {
      code: `import { buildTextReply } from "../functions/ComponentsV2Utils.js";\n${ASSIGN}`,
      filename: TEST_FILE,
      errors: [{ messageId: "staticImport" }],
    },
    {
      code: `import "../config/channels.js";\nprocess.env["TEST_GUILD_ID"] = "1";`,
      filename: TEST_FILE,
      errors: [{ messageId: "staticImport" }],
    },
    {
      code: `import { type Bar, ADMIN_TAG_ID } from "../config/tags.js";\n${ASSIGN}`,
      filename: TEST_FILE,
      errors: [{ messageId: "staticImport" }],
    },
    {
      code: `export * from "../config/tags.js";\n${ASSIGN}`,
      filename: "/home/user/bot/src/tests/example.test.ts",
      errors: [{ messageId: "staticImport" }],
    },
  ],
});
