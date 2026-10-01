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
- A partial title in an autocomplete option is not safe on its own. If the autocomplete
  suggestion is picked, the bot gets the full title, and `/game-completion add` takes the
  exact-match path and logs a completion at once. Mark such a step `Changes data: yes`,
  or use a title with no exact GameDB match.
- Quote reply text exactly as the code builds it, so the conductor's checks match.
- "by eye" anywhere in `Expected:` hands the step off. Describe output elsewhere in plain
  prose and keep the phrase out of a step the runner should drive.
- A step that expects a refusal says so first, in its label and `Expected:`, and names
  the later step that depends on it.
- The runner acts only in the test channel. A step on a message posted elsewhere (an
  announcements panel, an admin prompt) is the tester's: name the channel, the message's
  heading, and the earlier reply that links it.
- Take option values from `docs/test-plans/`, which hold values known to work against
  the test data (for example `title:Chrono Trig` and `platform:SNES`). For an
  autocomplete option, use a value the bot resolves on its own, such as an abbreviation.
  The runner may send the typed text before any suggestion loads.
- When a reply fills a defer, set `Ephemeral:` from the defer call, not the reply's flags.
  `/admin`, `/mod`, and `/superadmin` slash commands defer ephemerally by default
  (`safeDeferReply`), so their replies land only in the mirror: `Ephemeral: yes`. A form
  submitted from their buttons defers on its own and is usually public.
- "No output observed in the test channel" while "Other output" shows the expected
  mirror message means the step's `Ephemeral:` is wrong, not that the mirror cut it off.
- Never assume a record exists because its number is low. NR-GOTM started long after
  GOTM, so NR-GOTM round 1 does not exist. Use a value a test plan lists, or check a
  path that needs no data: a never-real id such as round 99999, or a form submitted
  with a value the bot rejects.
- The runner clicks buttons by exact label. A label that carries data (a round number,
  a title) cannot be clicked from a fixed step, so keep such labels fixed in code.
- A slash command with several required options is fine to drive. Write it on one line
  as `/command option:value option:value`, with real values from the test data.

### Running the runner

- The runner starts the PR's run with `/conduct pr:<pr>` when the test channel shows none
  in progress, including after an earlier run finished or was aborted. Starting it by
  hand first is no longer needed.
- Run it from an up-to-date `main` checkout. It refuses to start when the checkout lacks a
  runner commit from `origin/main`.
- Each run opens a clean Chrome profile. The tester signs in every time: the runner clicks
  the login page's passkey button, and the tester only picks the passkey.
- Discord can hang after sign-in. The runner reloads the channel until its messages show,
  up to three times, before it stops.
- If the bot does not respond, check that a preview container is running and which commit
  the conductor is live at, with `bash scripts/preview/fetch-logs.sh 400`.
- A mirror post is never cut off. A payload over 2000 characters goes whole into a
  `mirror.json` attachment, and the message keeps a short summary naming it. Before
  reporting a cut-off mirror, open that attachment.

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
- A changed newest message is not a reply. A deferred reply first shows
  "<app> is thinking..."; wait until that placeholder is gone before pressing Check.
- Discord renders only a window of messages. Read the newest messages with the panel at the
  bottom, and scroll up to find an older conductor message instead of assuming it is gone.

## Entries

### 2026-10-01: rerun exited at once with "For a person: none"

- **PR under test:** #1443
- **Symptom:** after an aborted run and a PR body edit, two reruns printed the drive plan,
  then an empty summary and the old report link, without driving anything.
- **Cause:** the newest conductor message in the test channel was the aborted run's
  "Report for PR #1443 posted" line, so `reportUrl` treated the run as finished. Editing
  the body (or redeploying the same head) does not start a new run, and the runner only
  joined runs; it never started one.
- **Fix:** #1443 made the runner send `/conduct pr:<pr>` itself, from the conductor's
  entry in the command popup (`CONDUCTOR_BOT_NAME`), whenever the channel shows no run in
  progress, then wait for step 1. If it cannot, it stops and says to start the run by hand.
- **Lesson:** a rerun after a finished or aborted run needs a new run. The runner now
  starts it; if it ever stops with "Could not start the run", run `/conduct pr:<pr>` in
  the test channel and rerun.

### 2026-10-01: tester skipped a step that was meant to be refused

- **PR under test:** #1443
- **Symptom:** steps 5 and 6 failed with "No output observed", noted "bad test, you
  closed the vote". Step 8 then found an empty runoff and failed.
- **Cause:** step 5 deliberately voted on the old, closed voting panel to check the
  refusal, but its label read like a normal vote, and the tester went to the runoff panel,
  which (correctly) has no Game 3. Step 6 looked equally wrong after that, so neither
  click was made, and the runoff closed with no votes.
- **Fix:** #1443 relabelled both steps, put OLD and NEW on the two panels, and opened each
  `Expected:` with what should happen ("meant to be refused", "meant to land") and which
  later step depends on it.
- **Lesson:** a step that expects a refusal says so first, in its label and `Expected:`.
  When two messages look alike, the step says which one, how to tell them apart, and
  what a later step needs from it.

### 2026-10-01: half the sandbox steps handed off, and the tester could not find the panel

- **PR under test:** #1443
- **Symptom:** steps 4 to 8, 12, 14 and 15 handed off as "Expected asks for a check by eye"
  or "the runner cannot read the action". The tester then did not know where the runoff
  panel step 6 named was: "Step 6 is yours" gave only the command.
- **Cause:** the `Expected:` lines said "Check by eye", which the drive plan always hands
  off. The panel steps read `select "X" on the ... panel`, which the action parser does
  not accept. The panels themselves post in the announcements channel and the tie prompt
  in the admin channel, while the runner acts only in the test channel, and no step said
  how to get there.
- **Fix:** #1443 made every `/vote-sandbox` reply link each message it posted, wherever
  it landed, and reworded the steps: no "by eye" in a step the runner can drive, and each
  panel step names the panel's heading and which earlier reply links it.
- **Lesson:** a step acting on a message outside the test channel says where that
  message is and how to reach it. Keep "by eye" out of a step the runner should drive.

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
- **Verified:** the next run (12:27) filled `title`, `completion_type` and `platform` in
  their own fields and Discord sent the command.

### 2026-10-01: "Invalid platform selection." on a step expecting a game picker

- **PR under test:** #1412
- **Symptom:** step 1 failed: missing "Select the game for", and the reply was "Invalid
  platform selection."
- **Cause:** the step used `platform:Nintendo Switch`. No autocomplete suggestion had loaded
  within the runner's one-second wait, so Discord sent the raw text.
  `resolveGameCompletionPlatformId` accepts raw text only on an exact name, abbreviation
  or code, or a single partial match, and "Nintendo Switch" matched more than one
  platform. The trace showed the field held the right text, so the runner was not at fault.
- **Fix:** the step was rewritten to `title:Chrono Trig completion_type:Main Story
  platform:Switch`. `Switch` resolves to one platform, and `Chrono Trig` (also used in
  `docs/test-plans/game-completion-1.md`) matches few games.
- **Lesson:** reuse test-plan values; never guess option values for autocomplete fields.

### 2026-10-01: "Import another game from IGDB" missing from the game picker

- **PR under test:** #1412
- **Symptom:** the conductor report for `title:mario` showed "Select the game for" with 25
  Mario titles and no "Import another game from IGDB".
- **Cause:** a bot bug, not a testing one. `/game-completion add` appended the import
  option after every search result, and the 25-option cap on a select menu cut it off.
  Found by reading the conductor's report comment on the PR, which prints every option
  the reply had.
- **Fix:** #1432 adds `withIgdbImportOption`, which keeps room for the import option, and
  uses it in all three game pickers.
- **Lesson:** read the conductor's report comment before blaming the runner; it shows the
  exact reply. A search term with many matches can push a trailing option past a select
  menu's cap, so prefer narrow terms in steps unless the step tests the cap.

### 2026-10-01: a `Changes data: no` step logged a real completion

- **PR under test:** #1412
- **Symptom:** the 12:41 run of step 1 (`/game-completion add title:Chrono Trig
  completion_type:Main Story platform:Switch`) replied "Logged completion for **Chrono
  Trigger** (Main Story)" and asked to remove it from Now Playing, where it expected the
  game picker.
- **Cause:** the bot received the title "Chrono Trigger", not "Chrono Trig", so it took the
  exact-match path, which saves immediately. That happens when the `title` autocomplete
  suggestion is chosen. No runner trace exists for that run on the laptop, so the step was
  likely done by hand, picking the suggestion. The step assumed a partial title stays
  partial.
- **Fix:** none in code. The PR was merged with a completion logged on the tester's
  account; the tester removes it with `/game-completion delete`.
- **Lesson:** decide `Changes data:` from the worst path a step can take, not the intended
  one. Any step that can reach a save path is `yes`.

### 2026-10-01: "FAIL: No output observed in the ephemeral mirror channel."

- **PR under test:** #1425
- **Symptom:** step 1 (`/game-completion delete`) handed back with "FAIL: No output observed
  in the ephemeral mirror channel." The tester pressed Check again and the step passed.
- **Cause:** the runner pressed Check about 4 seconds after sending the command. The newest
  message had changed to "RPGClubbot (Preview) is thinking...", and the runner took that
  for the reply. Found in the trace (Enter at 27.7s, Check at 32.0s) and the step
  screenshot, which still shows the placeholder. The tester also saw the conductor's step
  message scroll out of view, which the runner could not reach if Discord stopped
  rendering it.
- **Fix:** #1437. `waitForReply` waits while the newest message is a thinking placeholder,
  and the runner scrolls the message panel up to find a step message that is not rendered.
- **Lesson:** wait for the reply itself, not for any change. A slow deferred command looks
  like a missing reply to the conductor.

### 2026-10-01: three `/admin` steps "No output observed" with the right reply mirrored

- **PR under test:** #1408
- **Symptom:** steps 1, 3, and 4 failed with "No output observed in the test channel. 1
  other message(s) arrived in the window but did not match.", and the other output was
  the expected reply as a mirror message. The tester suspected the mirror was cutting
  off content.
- **Cause:** the steps said `Ephemeral: no`, but `safeDeferReply` defers `/admin`,
  `/mod`, and `/superadmin` slash commands ephemerally when no flags are passed, so the
  replies reached only the mirror. The mirrored content was complete: since #1345 a
  payload over 2000 characters goes whole into a `mirror.json` attachment. Step 4 also used
  `/admin edit-nr-gotm round:1`, and NR-GOTM has no round 1 because it started much later.
- **Fix:** #1408 marks those steps `Ephemeral: yes`, replaces the NR-GOTM round 1 step
  with the add flow and round 99999, drops the round number from the "Create ... round"
  button label so a step can click it, and rewrites `docs/test-plans/admin-rounds.md`.
- **Lesson:** read the defer call before setting `Ephemeral:`, and never pick a record
  by a guessed number.

### 2026-10-01: Discord hung after sign-in

- **Symptom:** after the tester signed in, the Discord tab hung and never showed the test
  channel until the tester refreshed it by hand. The tester also clicked the passkey sign-in
  button by hand on every run.
- **Cause:** not confirmed; a refresh always cleared it. The runner waited only for the
  URL, which already pointed at the channel, so it never noticed the hang.
- **Fix:** the runner now clicks the login page's passkey button itself, then waits for the
  channel's message list and reloads the channel when it does not show in 30 seconds, up to
  three times.
- **Lesson:** a URL is not proof a page loaded; wait for something the page renders.
