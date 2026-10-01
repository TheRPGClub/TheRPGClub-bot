import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

// eslint-rules lives outside rootDir, so load it by URL to keep tsc from pulling it in.
const RULES_URL = new URL("../../eslint-rules/index.js", import.meta.url).href;
const { default: localRules } = (await import(RULES_URL)) as {
  default: { rules: Record<string, Rule> };
};
const rule = localRules.rules["api-error-reply-shows-request"];

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

const SAFE_REPLY_MESSAGE =
  "async function f() { try { await api(); } catch (err) { " +
  "await safeReply(i, buildTextReply(err.message, true)); } }";

ruleTester.run("api-error-reply-shows-request", rule, {
  valid: [
    // A try with no await wraps local validation, such as date parsing.
    "async function f() { try { parse(); } catch (err) { " +
      "await safeReply(i, buildTextReply(err.message, true)); } }",
    "async function f() { try { await api(); } catch (err) { " +
      "await safeReply(i, buildTextReply(buildCaughtErrorMessage(\"Failed\", err), true)); } }",
    // Logging the message is fine; only replies are checked.
    "async function f() { try { await api(); } catch (err) { logError(\"x\", err.message); } }",
    "async function f() { try { await api(); } catch (err) { " +
      "if (err instanceof SteamApiError) { " +
      "await safeReply(i, buildTextReply(err.message, true)); } } }",
    // An await inside a nested callback does not run inside this try.
    "async function f() { try { run(async () => { await api(); }); } catch (err) { " +
      "await safeReply(i, buildTextReply(err.message, true)); } }",
  ],
  invalid: [
    {
      code: SAFE_REPLY_MESSAGE,
      errors: [{ messageId: "messageOnlyReply", data: { shown: "err.message" } }],
    },
    {
      code: "async function f() { try { await api(); } catch (e) { " +
        "await safeEditReply(i, buildErrorReply(`Failed: ${e?.message}`)); } }",
      errors: [{ messageId: "messageOnlyReply", data: { shown: "e.message" } }],
    },
    {
      code: "async function f() { try { await api(); } catch (err) { " +
        "await safeReply(i, buildTextReply(extractErrorMessage(err), true)); } }",
      errors: [
        { messageId: "messageOnlyReply", data: { shown: "extractErrorMessage(err)" } },
      ],
    },
  ],
});
