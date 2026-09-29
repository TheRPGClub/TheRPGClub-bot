import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

// eslint-rules lives outside rootDir, so load it by URL to keep tsc from pulling it in.
const RULES_URL = new URL("../../eslint-rules/index.js", import.meta.url).href;
const { default: localRules } = (await import(RULES_URL)) as {
  default: { rules: Record<string, Rule> };
};
const rule = localRules.rules["no-plain-text-v1-reply"];

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

const STRING_ERROR = { messageId: "useTextReplyForString" };
const OBJECT_ERROR = { messageId: "useTextReply" };

ruleTester.run("no-plain-text-v1-reply", rule, {
  valid: [
    "safeReply(interaction, buildTextReply('Saved.', true));",
    "safeUpdate(interaction, buildTextReply(`Saved ${n}.`, true));",
    "safeReply(interaction, reply);",
    "safeReply(interaction, { components: [c], content: undefined });",
    "safeReply(interaction, { ...buildTextReply('x', true), __forceFollowUp: true });",
    "message.reply('hi');",
    "logInfo('safeReply', 'step');",
  ],
  invalid: [
    { code: "safeReply(interaction, 'Invalid platform selection.');", errors: [STRING_ERROR] },
    { code: "safeUpdate(interaction, `Removed ${title}.`);", errors: [STRING_ERROR] },
    { code: "safeReply(interaction, 'a ' + title);", errors: [STRING_ERROR] },
    { code: "safeReply(interaction, err?.message ?? 'Failed.');", errors: [STRING_ERROR] },
    { code: "safeReply(interaction, ok ? 'Yes.' : detail);", errors: [STRING_ERROR] },
    { code: "safeFollowUp(interaction, 'Done.');", errors: [STRING_ERROR] },
    { code: "safeEditReply(interaction, 'Saved.');", errors: [STRING_ERROR] },
    { code: "safeFollowUpIfSettled(interaction, `Done ${n}.`);", errors: [STRING_ERROR] },
    { code: "safeReply(interaction, { content: 'Hi' });", errors: [OBJECT_ERROR] },
  ],
});
