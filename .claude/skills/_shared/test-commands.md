# Test commands at handover

Shared by `/implement`, `/open-pr`, and any pull request a session opens outside a skill.
When a session hands a pull request over for manual review and its body has a `Testing`
section, the report closes with the two commands that test it, each in its own fenced code
block tagged `bash`. The Code tab puts a Run button on each block, so the user starts
either one from the terminal without retyping it.

Skip both blocks when the body has no `Testing` section: there is nothing for the
conductor to run.

## The blocks

Fill in the pull request number. Nothing else changes, and the two never share a block.

1. Deploy the pull request to the test guild:

   ```bash
   claude "/test-guild <N>"
   ```

2. Once the preview is up, drive the conductor's steps in Discord web with the Playwright
   runner (`docs/conductor.md#playwright-runner`):

   ```bash
   npm run -s conduct:playwright -- <N>
   ```

Say in a line that the runner needs the deploy finished first, that the run starts by
itself (or by hand with `/conduct pr:<N>` in the test channel when it does not), and that
steps the runner cannot drive are left to the tester there.

The Run button runs a block in the session's own checkout, so before offering the runner
block, check that `node_modules/playwright-core` exists there. A worktree cut before the
runner landed, or with stale dependencies, lacks it and the runner fails to load. When it
is missing, run `npm ci` in that checkout first.

## Rules

- The blocks are offered, never run. Only the user starts `/test-guild`, and only the
  user starts the runner, which acts as their own Discord account. The session never
  dispatches a deploy or runs either command itself, per
  [conductor-merge.md](conductor-merge.md).
- `/test-guild` is a Claude skill, not a shell command, so its block starts a new
  `claude` session with the skill as its first prompt. That is what makes it runnable
  from a terminal.
- One command per block, with no `$` prompt and no output inside the fence.
