import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

// eslint-rules lives outside rootDir, so load it by URL to keep tsc from pulling it in.
const RULES_URL = new URL("../../eslint-rules/index.js", import.meta.url).href;
const { default: localRules } = (await import(RULES_URL)) as {
  default: { rules: Record<string, Rule> };
};
const rule = localRules.rules["no-sanitize-url-input"];

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

ruleTester.run("no-sanitize-url-input", rule, {
  valid: [
    "const topic = sanitizeUserInput(input.topic, { maxLength: 100 });",
    "const name = sanitizeOptionalInput(feedName, { preserveNewlines: false });",
    "const note = sanitizeUserInput(securityNote);",
    "const during = sanitizeUserInput(text);",
    "const imageUrl = parseUserUrl(input.imageUrl);",
    "const payload = { title: sanitizeUserInput(title) };",
    "const label = sanitizeUserInput(url ? text : other);",
    "const note = sanitizeUserInput(\"paste the link here\");",
    "const imageUrl = sanitizeUserInput(raw) ? fallback : other;",
  ],
  invalid: [
    {
      code: "url = sanitizeUserInput(url, { preserveNewlines: false });",
      errors: [{ messageId: "noSanitizeUrl", data: { callee: "sanitizeUserInput" } }],
    },
    {
      code: "const sanitizedUrl = url ? sanitizeUserInput(url, {}) : undefined;",
      errors: [{ messageId: "noSanitizeUrl" }],
    },
    {
      code: "const value = sanitizeUserInput(input.imageUrl);",
      errors: [{ messageId: "noSanitizeUrl" }],
    },
    {
      code: "const value = sanitizeOptionalInput(feedUrl);",
      errors: [{ messageId: "noSanitizeUrl", data: { callee: "sanitizeOptionalInput" } }],
    },
    {
      code: "const payload = { imageUrl: sanitizeUserInput(raw) };",
      errors: [{ messageId: "noSanitizeUrl" }],
    },
    {
      code: "const IMAGE_URL = InteractionUtils.sanitizeUserInput(raw);",
      errors: [{ messageId: "noSanitizeUrl" }],
    },
    {
      code: "state.href = sanitizeUserInput(raw) ?? '';",
      errors: [{ messageId: "noSanitizeUrl" }],
    },
    {
      code: "const payload = { \"imageUrl\": sanitizeUserInput(raw) };",
      errors: [{ messageId: "noSanitizeUrl" }],
    },
    {
      code: "const value = sanitizeUserInput(feedURLs);",
      errors: [{ messageId: "noSanitizeUrl" }],
    },
    {
      code: "class Feed { imageUrl = sanitizeUserInput(raw); }",
      errors: [{ messageId: "noSanitizeUrl" }],
    },
    {
      code: "function save(url = sanitizeUserInput(raw)) { return url; }",
      errors: [{ messageId: "noSanitizeUrl" }],
    },
    {
      code: "const imageUrl = sanitizeUserInput(raw) satisfies string;",
      errors: [{ messageId: "noSanitizeUrl" }],
    },
  ],
});
