import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

// eslint-rules lives outside rootDir, so load it by URL to keep tsc from pulling it in.
const RULES_URL = new URL("../../eslint-rules/index.js", import.meta.url).href;
const { default: localRules } = (await import(RULES_URL)) as {
  default: { rules: Record<string, Rule> };
};
const rule = localRules.rules["no-reply-after-defer-update"];

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

const WITH_ERROR_REPLY_ERROR = {
  messageId: "replyAfterDeferUpdate",
  data: { helper: "withErrorReply", target: "interaction", deferHelper: "safeDeferUpdate" },
};

const wrap = (body: string): string => `async function handle(interaction, other) {\n${body}\n}`;

ruleTester.run("no-reply-after-defer-update", rule, {
  valid: [
    wrap("await safeReply(interaction, reply);\nawait safeDeferUpdate(interaction);"),
    wrap("await safeDeferUpdate(interaction);\nawait safeFollowUpIfSettled(interaction, reply);"),
    wrap("await safeDeferUpdate(interaction);\nawait safeEditReply(interaction, panel);"),
    wrap("await safeDeferUpdate(other);\nawait safeReply(interaction, reply);"),
    wrap(
      "await safeDeferUpdate(interaction);\n" +
        "await safeReply(interaction, { ...reply, __forceFollowUp: true });",
    ),
    wrap(
      "if (ready) {\n  await safeDeferUpdate(interaction);\n  return;\n}\n" +
        "await safeReply(interaction, reply);",
    ),
    wrap(
      "if (ready) await safeDeferUpdate(interaction);\n" +
        "else await safeReply(interaction, reply);",
    ),
    wrap(
      "switch (kind) {\n  case 1: await safeDeferUpdate(interaction); break;\n" +
        "  case 2: await safeReply(interaction, reply); break;\n}",
    ),
    wrap(
      "await safeDeferUpdate(interaction);\n" +
        "collector.on('collect', async (i) => { await safeReply(interaction, reply); });",
    ),
    wrap(
      "await withErrorReply(interaction, async () => {\n" +
        "  await safeDeferUpdate(other);\n  await work();\n});",
    ),
    wrap("await safeDeferUpdate(interaction);\nawait helpers[\"safeReply\"](interaction, reply);"),
    wrap(
      "try {\n  await work();\n} catch {\n  await safeDeferUpdate(interaction);\n}\n" +
        "await safeReply(interaction, reply);",
    ),
    wrap(
      "await safeReply(interaction, reply);\n" +
        "await withClickedRowDisabled(interaction, async () => {\n" +
        "  await safeEditReply(interaction, panel);\n});",
    ),
    wrap(
      "await withClickedRowDisabled(interaction, async () => {\n" +
        "  await safeFollowUpIfSettled(interaction, reply);\n});",
    ),
  ],
  invalid: [
    {
      code: wrap(
        "await withClickedRowDisabled(interaction, async () => work());\n" +
          "await safeReply(interaction, reply);",
      ),
      errors: [{ messageId: "replyAfterDeferUpdate" }],
    },
    {
      code: wrap(
        "await withClickedRowDisabled(interaction, async () => {\n" +
          "  await safeReply(interaction, reply);\n});",
      ),
      errors: [
        {
          messageId: "replyAfterDeferUpdate",
          data: {
            helper: "safeReply",
            target: "interaction",
            deferHelper: "withClickedRowDisabled",
          },
        },
      ],
    },
    {
      code: wrap("await safeDeferUpdate(interaction);\nawait safeReply(interaction, reply);"),
      errors: [
        {
          messageId: "replyAfterDeferUpdate",
          data: { helper: "safeReply", target: "interaction", deferHelper: "safeDeferUpdate" },
        },
      ],
    },
    {
      code: wrap(
        "await safeDeferUpdate(interaction);\n" +
          "await withErrorReply(interaction, async () => work());",
      ),
      errors: [WITH_ERROR_REPLY_ERROR],
    },
    {
      code: wrap(
        "await withErrorReply(interaction, async () => {\n" +
          "  await safeDeferUpdate(interaction);\n  await work();\n});",
      ),
      errors: [WITH_ERROR_REPLY_ERROR],
    },
    {
      code: wrap(
        "if (!(await safeDeferUpdateOrBail(interaction))) return;\n" +
          "if (missing) {\n  safeIgnore(safeReply(interaction, reply));\n}",
      ),
      errors: [{ messageId: "replyAfterDeferUpdate" }],
    },
    {
      code: wrap(
        "await InteractionUtils.safeDeferUpdate(this.interaction);\n" +
          "await InteractionUtils.safeReply(this.interaction, reply);",
      ),
      errors: [
        {
          messageId: "replyAfterDeferUpdate",
          data: {
            helper: "safeReply",
            target: "this.interaction",
            deferHelper: "safeDeferUpdate",
          },
        },
      ],
    },
    {
      code: wrap(
        "try {\n  await safeDeferUpdate(interaction);\n  await work();\n} catch {\n" +
          "  await safeReply(interaction, reply);\n}",
      ),
      errors: [{ messageId: "replyAfterDeferUpdate" }],
    },
    {
      code: wrap(
        "await safeDeferUpdate(interaction);\n" +
          "await safeReply(interaction, { ...reply, __forceFollowUp: false });",
      ),
      errors: [{ messageId: "replyAfterDeferUpdate" }],
    },
  ],
});
