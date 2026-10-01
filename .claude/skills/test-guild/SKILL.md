---
name: test-guild
description: Deploy one pull request to the test guild as the PR preview, list which PRs can be deployed and which one holds the test guild, or stop the running preview. Only the user starts this skill, by typing /test-guild.
disable-model-invocation: true
argument-hint: "[<pr> | stop]"
---

# Test guild

The test guild runs one PR preview at a time, and nothing deploys on its own: opening,
pushing to, or editing a pull request never deploys it. This skill is the only way a
preview starts. It dispatches `.github/workflows/pr-preview.yml` on the desktop's
self-hosted runner, so it works from the laptop. How the preview itself is built and
guarded is in `docs/pr-preview.md`.

Only the user starts this skill. Other skills and sessions never run it, never dispatch
the workflow with `action=deploy` themselves, and never suggest deploying as a step they
take. They may tell the user that `/test-guild <pr>` is how to get a PR into the test
guild.

Arguments:

- `/test-guild <pr>` (also `#<pr>` or a PR URL): deploy that PR's current head.
- `/test-guild` with no argument: show the open PRs and ask which one to deploy.
- `/test-guild stop`: tear down the running preview, whichever PR it belongs to.

Every question goes through `AskUserQuestion`, per
[asking-the-user.md](../_shared/asking-the-user.md). Text longer than one line goes in a
scratchpad file, never a heredoc, per [shell-text.md](../_shared/shell-text.md).

## 1. Read the open PRs

```bash
gh pr list --state open --json number,title,body,isCrossRepository,comments \
  > <scratchpad>/prs.json
npm run -s test-guild:status -- <scratchpad>/prs.json
```

The first line names the PR holding the test guild, read from each PR's sticky
`PR preview` comment: `running`, `behind` (running an older commit than the PR's head),
or `building`. The container itself is on the desktop, so the comments are the only view
of it from here. Each following line is one PR and whether it can be deployed.

With `stop`, go to step 4. With a PR number, go to step 2.

With no argument, list every `deployable` row in the turn text with its preview state,
then ask which one to deploy. Offer up to four PRs as choices, highest number first; the
user can type any other number under Other. When no row is deployable, say so,
name what each PR is missing, and stop.

## 2. Check the PR

Find the PR's row from step 1.

- Not in the list: it is closed or does not exist. Say so and stop.
- `fork, never deployed`: fork code never runs on the preview runner. Say so and stop.
- `no Testing steps` or `Testing section malformed`: the workflow would refuse it.
  Write the body out and run the parser `/conduct` uses, so the user sees why:

  ```bash
  gh pr view <pr> --json body --jq .body > <scratchpad>/pr-<pr>-body.md
  npm run check:pr-testing -- <scratchpad>/pr-<pr>-body.md
  ```

  Report what it prints and stop. Fixing the body is the PR owner's call, not this
  skill's.

When another PR holds the test guild, say which one and that its preview will stop.
When the requested PR already holds it and is `running`, its head is already deployed:
say so and ask whether to redeploy it anyway. Otherwise go straight on; the user asked
for this deploy by typing the command.

## 3. Deploy

```bash
date -u +%Y-%m-%dT%H:%M:%SZ
gh workflow run pr-preview.yml --ref main -f action=deploy -f pr=<pr>
```

Find the run it started. Its title is `PR preview deploy <pr>`, and it was created after
the time printed above. Dispatch takes a few seconds to show up, so list again if it is
not there yet:

```bash
gh run list --workflow pr-preview.yml --event workflow_dispatch --limit 5 \
  --json databaseId,displayTitle,createdAt,status,url
```

Tell the user the run URL, then go to step 5.

## 4. Stop

```bash
date -u +%Y-%m-%dT%H:%M:%SZ
gh workflow run pr-preview.yml --ref main -f action=stop
```

Find the run as step 3 does, titled `PR preview stop` and created after the printed time.
A stop also cancels a deploy that is still building. Tell the user the run URL.

## 5. Wait for the run

A deploy takes several minutes, so record the run and wait on it with the session's one
watcher, per [run-watch.md](../_shared/run-watch.md):

```bash
scripts/catchup.py add <scratchpad>/catchup.tsv <run-id> "test guild <pr>"
scripts/catchup.py wait <scratchpad>/catchup.tsv
```

Run `wait` in the background and end the turn. If a `wait` is already running on the
ledger, the new row is picked up by it; do not start a second one.

## 6. Report

When the run finishes:

- Success on a deploy: PR #<pr> is running in the test guild. Link the PR's
  `PR preview` comment. If step 1 showed another PR holding the guild, say its preview
  stopped. Then always give the Playwright runner command in its own `bash` block, so
  the tester has it without asking:

  ```bash
  npm run -s conduct:playwright -- <pr>
  ```

  Before giving it, make sure `node_modules/playwright-core` exists in the session's
  checkout, and run `npm ci` there when it does not. The runner also refuses to start
  when the checkout lacks a commit `origin/main` made to `scripts/conduct-playwright`;
  when `git log HEAD..origin/main -- scripts/conduct-playwright` prints anything, sync
  the branch with main first. Say that the runner opens a fresh
  Chrome profile to sign in to Discord in, that the run starts by itself (or by hand with
  `/conduct pr:<pr>` in the test channel), and that steps the runner cannot drive are
  left to the tester. The full rules for offering the block are in
  `.claude/skills/_shared/test-commands.md`.
- Success on a stop: the preview is torn down, naming the PR it belonged to, or that
  nothing was running.
- Failure: read the failed step's log from `<scratchpad>/catchup.tsv.logs/<run-id>.log`
  (grep it; do not fetch the log again) and report the error lines. A failed `plan` job
  is a refusal, and its message says why. A failed `deploy` job leaves whatever preview
  was running before in place when the build failed, and none when the new container
  failed to start.

A green run does not prove the preview is up. The deploy job asks the PR again after the
build and tears the preview down when the answer changed, while still reporting success.
Read the PR's `PR preview` comment before saying it is running. `No preview` with a
reason (malformed, untested, closed) means it was torn down; report that reason.

When the tester says the preview bot does not respond ("The application did not
respond"), fetch the desktop's logs with `bash scripts/preview/fetch-logs.sh 400`. Under
`preview containers`, an empty table means no preview is running at all. The conductor
section's `ready as <tag> at <sha>` line names the commit the conductor is running; see
`.claude/skills/_shared/test-commands.md#the-live-conductor`.

Never redeploy on your own after a failure or after a later push. A push to the PR in
the test guild only marks its comment `behind`; the user runs `/test-guild <pr>` again
when they want the new head.

## Common mistakes to avoid

- Do NOT run this skill, or dispatch the workflow with `action=deploy`, unless the user
  typed `/test-guild`.
- Do NOT run `scripts/preview/preview.sh` from the laptop. The container is on the
  desktop, and the workflow is how the laptop reaches it.
- Do NOT deploy a fork PR or a closed PR, or try to get around a `plan` refusal.
- Do NOT poll the run with `gh run watch` or a loop. Use `scripts/catchup.py wait`.
