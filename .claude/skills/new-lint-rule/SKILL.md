---
name: new-lint-rule
description: Scaffold a new custom ESLint rule: add it to eslint-rules/index.js, register it in eslint.config.ts, and verify it loads. Use when asked to "create a lint rule", "new eslint rule", or "scaffold lint rule".
---

This skill scaffolds a new custom ESLint rule for this project. All custom rules live in a single
file (`eslint-rules/index.js`) and are registered in `eslint.config.ts`.

## Arguments

The skill accepts one or two arguments:

- **Rule name** (required): kebab-case name, e.g. `no-raw-snowflake` or `require-defer-before-fetch`
- **Description** (optional): short plain-English summary of what the rule enforces

If only the rule name is provided, derive a short description from it.

## Steps (always run in order)

### 1. Confirm no collision

Check that the rule name does not already exist:

```bash
grep -n "<rule-name>" eslint-rules/index.js
```

If a match is found, stop and tell the user the rule already exists.

### 2. Scaffold the rule in `eslint-rules/index.js`

Read the end of the `rules` export object (search for the last `},` before `export default {`
or before the closing `},` of the `rules` property). Insert the new rule entry **before** the
closing `},` of the `rules` object.

Rule template -- replace `RULE_NAME`, `DESCRIPTION`, `MESSAGE_ID`, and `MESSAGE_TEXT`:

```js
    "RULE_NAME": {
      meta: {
        type: "problem",
        docs: {
          description:
            "DESCRIPTION",
        },
        schema: [],
        messages: {
          MESSAGE_ID: "MESSAGE_TEXT",
        },
      },
      create(context) {
        return {
          // TODO: implement AST visitor(s)
        };
      },
    },
```

Guidelines for filling in the template:

- `RULE_NAME`: the exact kebab-case name passed as argument
- `DESCRIPTION`: the provided description, or one derived from the rule name
- `MESSAGE_ID`: a camelCase key that names the violation (e.g. `noRawSnowflake`)
- `MESSAGE_TEXT`: a clear, actionable message the developer will see (e.g. "Do not use raw
  snowflake strings; import the constant from src/config/.")
- `type`: use `"problem"` for correctness rules, `"suggestion"` for style/preference rules,
  `"layout"` for formatting rules
- Keep lines under 100 characters

If the user provided a concrete description of what to detect, implement the AST visitor logic
now instead of leaving the TODO comment. Common patterns in this codebase:

- Checking `CallExpression` callee names or method chains
- Checking `Literal` node values
- Checking `VariableDeclarator` identifiers by name suffix
- Using `context.getFilename()` to restrict rules to specific files

### 3. Register the rule in `eslint.config.ts`

Add a new line to the `rules` block inside the `{ files: ["src/**/*.ts"] }` config object.
Insert it after the last `"local/..."` entry, before the closing `},` of the rules object.

```
      "local/RULE_NAME": "error",
```

Use `"warn"` instead of `"error"` only if the rule is advisory (`type: "suggestion"`).

### 4. Verify the rule loads

```bash
npm run lint
```

The lint run may report new violations if the scaffolded rule already matches something in the
codebase -- that is expected and correct. What must NOT happen:

- A parse error or `Definition for rule 'local/RULE_NAME' was not found` error
- Any syntax error in `eslint-rules/index.js`

If lint fails with a rule-load error, check the JSON structure around the new rule entry
(missing/extra commas, bracket mismatch).

### 5. Report back

Tell the user:

- The rule name and where it was added (file + approximate line number)
- The message ID and placeholder message text
- Whether any existing violations were found by the new rule
- A reminder that the `create(context)` TODO still needs real logic if they left it as a stub

## Common mistakes to avoid

- Do NOT create a new file -- all rules go in `eslint-rules/index.js`.
- Do NOT use TypeScript syntax in `eslint-rules/index.js` -- it is plain JavaScript.
- Do NOT add the rule under the `{ files: ["**/*.ts"] }` config block at the bottom of
  `eslint.config.ts` -- use the `{ files: ["src/**/*.ts"] }` block that already has the
  `local` plugin registered.
- Do NOT forget the trailing comma after the new rule entry in the `rules` object.
- Do NOT skip step 4 -- a structurally invalid rule will silently break all lint output.
