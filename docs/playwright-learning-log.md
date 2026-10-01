# Playwright testing learning log

Problems met while testing PRs with the conductor and the Playwright runner, and what fixed
them. Read it before writing a PR's `## Testing` section or changing the runner, and add an
entry for every new problem. The `playwright-log` skill
(`.claude/skills/playwright-log/SKILL.md`) says when and how.

## Lessons

### Writing Testing steps

- Mark every step `Changes data: yes|no` from the code the step runs, not the command name.
  `yes` when it writes anything that outlives the test. Use only syntax the live conductor
  parses: check its commit before using a new Testing line.
- Prefer steps that stop before a write. To exercise a picker, use a partial title so the
  select menu appears, and choose an option that only shows the next prompt.
- Quote reply text exactly as the code builds it, so the conductor's checks match.
- A slash command with several required options is fine to drive. Write it on one line
  as `/command option:value option:value`, with real values from the test data.

### Running the runner

- Run it from an up-to-date `main` checkout. It refuses to start when the checkout lacks a
  runner commit from `origin/main`.
- Each run opens a clean Chrome profile. The tester signs in every time (a passkey works).
- If the bot does not respond, check that a preview container is running and which commit
  the conductor is live at, with `bash scripts/preview/fetch-logs.sh 400`.

### Changing the runner, conductor, or preview workflow

- A change to `src/conductor/` is not live until the conductor is deployed with
  `scripts/conductor/deploy.sh deploy <sha>` on the desktop. Pulling and restarting do not
  update it.
- The preview deploy job must run main's scripts and only build the PR's tree. Never let a
  PR checkout supply code that decides or reports on its own preview.
- Discord's command editor holds one field (`optionPill__`) per option. Type a value into
  its own field, and confirm it landed there before moving on.
- Every hand-back message should name what failed (which option, which control), so the
  next entry here starts from a cause, not a guess.

## Entries

### 2026-10-01: preview bot's commands never appear in the popup

- **PR under test:** #1412
- **Symptom:** step 1 handed back with "the preview bot's entries in the command popup did
  not appear".
- **Cause:** the runner ran from PR 1412's branch, cut before #1411 fixed the preview bot's
  name. That old copy looked for "RPGClub Bot (preview)"; the app is "RPGClubbot (Preview)".
  Found in the trace's `waitForSelector` call.
- **Fix:** #1411 (name and avatar match) was already on main. #1416 made the runner refuse
  to start when it lacks a runner commit from `origin/main`.
- **Lesson:** the runner must come from current main, never from the PR's branch.

### 2026-10-01: the runner asked which steps change real data

- **PR under test:** #1412
- **Symptom:** "Which driven steps (1, 2) change real data?" before every run.
- **Cause:** nothing in the PR body said whether a step writes data, so the runner asked.
- **Fix:** #1416 added the per-step `Changes data: yes|no` line, which the runner reads.
- **Lesson:** the PR author decides it from the code, once, in the body.

### 2026-10-01: "the message box is not empty"

- **PR under test:** #1412
- **Symptom:** step 1 handed back with "the message box is not empty".
- **Cause:** an earlier handed-back run left its half-typed command in the box, and
  Discord kept it as a draft.
- **Fix:** #1418 clears a leftover draft starting with `/` before a slash step.
- **Lesson:** a hand-back mid-command leaves state behind; the next run must clean it.

### 2026-10-01: runner crashed when the browser was closed

- **PR under test:** #1412
- **Symptom:** "tracing.stop: Target page, context or browser has been closed" and no
  summary.
- **Cause:** closing the window made `tracing.stop` throw inside `finally`, and the
  target-closed error was rethrown.
- **Fix:** #1418 catches both and prints the summary.
- **Lesson:** any step can find the browser gone; cleanup must never throw.

### 2026-10-01: "Cannot parse the Testing section ... Changes data: no"

- **PR under test:** #1412
- **Symptom:** the conductor rejected step 1 with "extra content after its Ephemeral line".
- **Cause:** the live conductor was still at `6de5556`, before #1416. It runs from
  `~/.local/share/rpgclub-conductor/current`, so pulling main and restarting reloaded the
  same old build. Found with `fetch-logs.sh`, whose journal showed every restart reporting
  `ready ... at 6de5556`.
- **Fix:** the user ran `bash scripts/conductor/deploy.sh deploy "$(git rev-parse HEAD)"`
  on the desktop, which made `08a08f5` live. Meanwhile, removing the new line from the body
  unblocked the test.
- **Lesson:** after a conductor change merges, deploy it before any PR body uses it.

### 2026-10-01: "The application did not respond"

- **PR under test:** #1412
- **Symptom:** the slash command got no reply. The deploy run was green.
- **Cause:** no preview was running. The deploy job checked out the PR's head and then ran
  the PR's own `plan.mjs`, whose old parser rejected `Changes data:` and tore the fresh
  preview down. The `PR preview` comment said "No preview"; `fetch-logs.sh` showed no
  container.
- **Fix:** #1420 runs main's scripts and compose file and builds only the PR's tree.
- **Lesson:** a green deploy run is not proof the preview is up; read the PR comment.

### 2026-10-01: many captcha prompts

- **PR under test:** #1412
- **Symptom:** Discord challenged the runner's browser repeatedly.
- **Cause:** not confirmed. The runner reused a persistent profile with old cookies and
  site data, and the tester wanted a clean start.
- **Fix:** #1422 starts every run with an empty profile and deletes it afterwards. The
  tester signs in with a passkey each run.
- **Lesson:** if captchas continue with a clean profile, look at automation signals next,
  and record what was found here.

### 2026-10-01: "Discord did not send the command; it is still in the message box"

- **PR under test:** #1412
- **Symptom:** step 1 (`/game-completion add title:mario completion_type:Main Story
  platform:Nintendo Switch`) was handed back, so step 2 had no prompt to act on.
- **Cause:** choosing the command makes Discord add a field per required option, with the
  cursor in `title`. The runner typed all three `name:value` pairs into `title`. Found in
  the screenshot and in the trace's `innerText` results.
- **Fix:** #1427 clicks each option's field, types only the value, and hands back naming
  the option if the value did not land.
- **Lesson:** multi-option commands need per-field input; check each field after typing.
