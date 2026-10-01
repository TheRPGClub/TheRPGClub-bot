---
name: playwright-log
description: Read and grow the Playwright testing learning log (docs/playwright-learning-log.md). Use before writing a PR's Testing steps, before changing the Playwright runner or the conductor, and after any runner or conductor run that fails, hands a step back, or needs a manual workaround. Triggers include "/playwright-log", "log this playwright issue", "what have we learned about playwright testing".
---

# Playwright learning log

`docs/playwright-learning-log.md` records every problem met while testing a PR with the
conductor and the Playwright runner (`npm run -s conduct:playwright -- <pr>`), and what
fixed it. It exists so each session writes better Testing steps and fixes the runner
faster than the last one. It is committed to the repo; it is not memory.

## When to read it

Read the whole log, it is short on purpose:

- before writing or editing the `## Testing` section of a PR body;
- before changing `scripts/conduct-playwright/`, `src/conductor/`, `scripts/preview/`, or
  `.github/workflows/pr-preview.yml`;
- when a runner or conductor run fails, before investigating, since the same symptom may
  already have an entry.

Apply what the `Lessons` sections say. A lesson that turns out wrong or outdated is
corrected in the log in the same pull request that finds it out.

## When to add an entry

Add one for every problem a test run hits, even one fixed in minutes:

- the runner hands a step back for a reason other than the step's own design;
- the conductor cannot parse a Testing section, or judges a step wrongly;
- a preview fails to deploy, is torn down, or the bot does not respond;
- the tester had to do something by hand that the runner or the skills should have done;
- a Testing step had to be rewritten to be driveable or checkable.

Do not add an entry for a step that fails because the PR's code is wrong. That is a bug
in the PR, not a lesson about testing.

## How to write an entry

Append to the `## Entries` section, newest last, in this shape. No tables, no em dashes,
lines under 100 characters:

```markdown
### YYYY-MM-DD: <short symptom, as the tester saw it>

- **PR under test:** #<n>
- **Symptom:** <the exact message or behaviour, quoted>
- **Cause:** <what was actually wrong, and how it was found (trace, logs, screenshot)>
- **Fix:** <what fixed it, with the PR number, or "workaround: ..." when nothing merged>
- **Lesson:** <what to do differently when writing steps or changing the runner>
```

Then, when the entry teaches something general, add or update one bullet in
`## Lessons` at the top of the log, under the heading it belongs to. `Lessons` is the
part sessions act on; keep each bullet to one rule, and remove a bullet when the code
makes it obsolete.

Commit the log change on the branch of the pull request that fixes the problem. When
there is no fix to ship (a manual workaround, a deploy), commit it on its own `docs/`
branch and open a pull request for it, per `CLAUDE.md`.

## Finding the cause

The runner saves a trace and a screenshot per driven step in
`conduct-artifacts/pr-<n>-<timestamp>/`. Read the screenshot first. The trace
(`trace.zip`) holds every call and its result: unzip it and read `trace.trace` as JSON
lines to see what was typed, what the message box held, and which wait timed out.
`bash scripts/preview/fetch-logs.sh 400` shows whether a preview container is running and
which commit the conductor is live at (see `.claude/skills/_shared/test-commands.md`).
