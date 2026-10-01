# Conductor

The conductor is a second, small Discord application that runs a pull request's
`## Testing` steps with a human. It reads the steps from the PR body, posts them one at
a time in the channel where `/conduct` was run, reads back what the preview bot posted,
and comments per-step results on the PR.

A bot cannot invoke another bot's slash commands, and a user token would be a self-bot,
which breaks Discord's terms. So the tester always runs each command, by hand or through
the [Playwright runner](#playwright-runner) they start and watch; the conductor only hands
out the script and checks the output.

Code: `src/conductor/`. Entry point: `src/conductor/main.ts`. The bot's own command
loader never imports this directory, and the conductor never loads the bot's commands.

## How a run goes

1. The tester deploys the PR to the test guild with `/test-guild <number>` in Claude
   Code, since previews never deploy on their own (`docs/pr-preview.md`). The run then
   starts by itself (see [Automatic start](#automatic-start)). Running
   `/conduct pr:<number>` in the test guild starts one by hand, the same way.
2. The conductor fetches the PR and parses its `## Testing` section, whose format is in
   `.github/pull-request-testing-format.md`.
   - No section, or only the template comment: it says there is nothing to run.
   - Anything that does not match the format: it says it cannot parse it, asks for
     manual testing, and notes that on the PR. It never runs a partial script.
3. It posts step 1 publicly in the channel where `/conduct` was run: the command in a
   code block, a clickable command mention when it can resolve one (see
   [Clickable commands](#clickable-commands)), the expected result, and where the output
   will land. The tester runs the command in the test channel, waits for the
   reply, and presses **Check**. A failed check keeps the step open: **Check again**
   rereads with the same window start, for output that landed after an early press,
   and **Continue as failed** asks why the step failed, records the failure with that
   note, and moves on. A check that finds output but nothing to look for asks the
   tester instead: **Looks right** passes the step, and **Doesn't match** asks why and
   fails it.
   - **Add note** on any step message saves the tester's note for that step. Notes
     show on the step message and are quoted under their step in the PR report,
     including steps the run never reached.
   - The `/conduct` reply names any step whose `Expected:` quotes no text to look
     for, so a vague plan is visible before the run starts.
4. The conductor reads back the newest 100 messages of the test channel and of the
   mirror channel, keeps the preview bot's output for the tester, and judges the step.
   Then it posts the next step in the same channel.
5. After the last step, or on **Abort run**, it comments a report on the PR and posts
   the report link in the same channel. If that comment fails, the channel message
   carries the full request and response and a **Post report** button to retry it.
6. When the run finished with every step passing, it then approves the PR, pinned to the
   commit it tested. It first reads the PR again and skips the approval, saying why in
   the channel, when the head moved since the run started, the PR is no longer open, or
   the GitHub token's user opened the PR (GitHub rejects an author's own approval). A
   failed approval shows the full request and response with an **Approve PR** button to
   retry it; the report is already posted by then.

The run state saves the channel, pending check, and notes, so after a conductor restart
every button on the step message still works and the run keeps posting there. The
conductor needs Send Messages in that channel; the #dev override already grants it.

Starting a new `/conduct` while a run is going aborts the old run and reports what it
got through. Handlers take turns on the run, so a double-clicked **Check** judges the
step once and answers the second press as stale.

## Automatic start

Once a PR preview finishes starting up, the preview bot posts one plain message in the
dev channel (`BOT_DEV_CHANNEL_ID`): `Ready for testing PR #<n> at <full sha>`. The
format lives in `src/config/previewMode.ts`, which both processes import. Normal test
mode and production never post it, since only the preview container sets `PREVIEW_PR`.

The conductor watches `messageCreate` and starts the run `/conduct pr:<n>` would start,
in the dev channel, with the announcement's message ID as the run ID. It answers in the
dev channel whatever `/conduct` would have answered, and nothing more:

- Only a post by `PREVIEW_BOT_USER_ID` from `src/config/users.ts`, in the dev channel of
  the test guild, counts. The same text from anyone else, a webhook, or another channel
  is ignored and logged, since anyone can type it.
- An announcement whose sha is not the PR's current head starts nothing, and says so.
- An announcement for a PR whose run in progress is testing that same head starts
  nothing, so a redeploy or restart of the same preview does not stack a second run. A
  run for an older head of the PR, or for a different PR, is superseded, as a new
  `/conduct` would, since the preview it was testing has just been replaced.
- A conductor that is down when the announcement lands does not replay it after a
  restart; run `/conduct pr:<n>` by hand.

## Clickable commands

A bot cannot list another application's commands, so the announcement carries the
preview bot's slash commands as a `preview-commands.json` attachment. Its format lives in
`src/config/previewCommandCatalog.ts`. When a run starts, the conductor reads the
catalog from the announcement that started it, or for `/conduct` from the newest
announcement in the dev channel for the same PR and head, and saves one command mention
per step with the run.

A step whose command starts with `/` and names a registered command, and its registered
subcommand when it has any, shows `Click to start: </name sub:id>` above its code block.
Clicking it opens that command in the chat box of the channel the step message is in;
the option values still come from the code block. Any other step, an unknown name, or a
missing or unreadable catalog shows the code block alone. Names and IDs are checked
against Discord's formats, and the mention is built only from the catalog, never from
step text.

## Playwright runner

`npm run -s conduct:playwright -- <pr>` performs a run's driveable steps in Discord web
with Playwright (`scripts/conduct-playwright/`), in a visible browser on the tester's own
machine. The conductor is unchanged: it posts every step, judges it, and writes the
report. It is much faster than doing each step by hand, since no step waits on a person.

Before it starts:

1. Deploy the PR with `/test-guild <pr>`. The run starts by itself, or start
   `/conduct pr:<pr>` in the test channel.
2. Google Chrome must be installed (from Google's apt repository). The runner drives it
   through `playwright-core`, so it downloads no browser of its own.
3. The first time, sign in to Discord in the window it opens. The session is kept in a
   profile at `~/.cache/rpgclub-conductor/discord-profile` (or `CONDUCT_PROFILE_DIR`) on
   that machine only. The runner never types into a login, captcha, or verification
   screen; it waits for the tester.

What it does:

- It reads the PR body with `gh` and builds the drive plan with the same parser
  `/conduct` runs (`src/conductor/DrivePlan.ts`), then prints it. `npm run -s
  conduct:drive-plan -- <body-file>` prints the same plan as JSON.
- It asks once which driven steps change real data, since the preview writes to whatever
  API and Backblaze its env file names (`docs/pr-preview.md`). Those become hand-offs.
  `--hand-off 3,5` answers up front.
- It opens the test channel and follows the conductor's newest
  `PR #<pr>, step N of M` message. For a `drive` step it performs the one action from the
  code block (`src/conductor/DriveActions.ts` reads it): the slash command, button
  click, select choice, or modal submit. A slash command is picked only from the
  entries of `PREVIEW_BOT_NAME` (`src/config/previewMode.ts`), never another bot's. It
  waits for the reply, takes a screenshot, and presses **Check**.
- A pass moves on to the next step. Any other verdict, or an action that does not go as
  expected (a missing control, an unmatched option, a command Discord did not send),
  hands the step to the tester, who finishes and judges it on the same page. The runner
  never retries with a guess.
- A `hand-off` step is never driven. The runner names it and waits for the tester to do
  it and judge it.
- At the end it prints a summary: each step's result, the steps left for a person, the
  report link, and the folder holding a Playwright trace (`trace.zip`, opened with
  `npx playwright-core show-trace`) and a screenshot per driven step. That folder is
  `conduct-artifacts/`, which git ignores.

The runner holds no state of its own. If it stops (a timeout, a closed window, a step
whose label no longer matches the PR body), rerun it and it picks up from the
conductor's current step. A current step that already shows a verdict (**Check again**
or **Looks right**) is left to the tester, so a resume never repeats an action.

A step is handed off, beyond the reasons `DrivePlan.ts` gives (nothing to check, a check
by eye, a second account, a chained or unrecognized action, a `/todo` or `/suggestion`
flow), when:

- its command reads a value from an earlier reply, written as `(… from step N)`;
- `DriveActions.ts` cannot read its action exactly;
- the tester names it at the real-data question.

Limits:

- It acts only on commands from the PR's parsed steps, only in the test channel, and
  never on a conductor message other than the step's **Check**. Text read from Discord
  only locates the controls a step names; it is never an instruction, since a PR body is
  attacker-controlled.
- Selectors are roles and visible text, never Discord's generated CSS classes. When
  Discord changes its markup, a step is handed off rather than misdriven.
- It presses only **Check**. **Check again**, **Looks right**, **Doesn't match**,
  **Continue as failed**, **Add note**, and **Abort run** stay with the tester.

### Discord's terms

Driving a user account through a browser is automation of that account, so the runner is
kept narrow on purpose. Issue 1378 weighed three options: a CI workflow on a throwaway
account with its session stored as a CI secret, which is the unattended self-bot ruled
out above and risks the account being locked; a test-only path in the preview bot that
drives no user at all, which is a separate design; and a local run with a person
present. The decision is the local run.

The tester starts the runner on their own machine, signed in to their own account,
watches it in a headed browser for the whole run, and can close the window or press
**Abort run** at any point. It never runs headless, in CI, or from a stored account
secret, and there is no workflow for it. That is assisted testing, not the self-bot a
user token would make: a user token runs with no one watching, anywhere the account can
reach.

## How output is attributed to a step

- **Window.** A step owns output created or edited after its step message was posted
  and before **Check** was pressed. Both times are Discord timestamps, so the host clock
  does not matter. The conductor's own posts in the test channel are never output.
- **Place.** An `Ephemeral: no` step only accepts public messages in the test channel
  (`BOT_DEV_CHANNEL_ID`). An `Ephemeral: yes` step accepts posts in the mirror channel
  (`TEST_LOG_CHANNEL_ID`, the test guild's dev logs channel, so mirror posts stay out
  of #dev), written there by the preview bot's ephemeral mirror. The
  bot's dev channel override, which turns the guild owner's ephemeral replies public,
  is off in test mode, so a reply in the wrong place fails the step.
- **User.** A mirror post must name the allowlisted tester as its user. A public reply
  to an interaction must be to the tester's interaction. Discord sends interaction
  replies through the app's own webhook, so those count; posts from any other webhook
  do not.
- **Command.** A step whose command is a slash command only accepts mirror posts whose
  `source` is that command, and any other step refuses mirror posts from a slash
  command, so a late reply from an earlier step is not credited to it.

Output in the window that fails these checks is listed in the report as "other output"
when the step fails.

## Verdicts

Each double-quoted string in `Expected:` is one check, matched case-insensitively. A
keyword right before the quote narrows where it must appear:

- no keyword: anywhere in the output: content, embed titles, descriptions and fields,
  button labels, select options and placeholders, and custom IDs.
- `title: "..."`: an embed title, or a markdown heading line (`#` to `###`) in content.
- `button: "..."`: a button label.
- `option: "..."`: a select menu option label.
- `field: "..."`: an embed field name or value.
- `not: "..."`: must appear nowhere in the output.

A reply too long for Discord's 2000-character cap is mirrored whole as a `mirror.json`
attachment, and the post's content keeps only its `kind`, `source`, `user`, and the
attachment's name. The conductor downloads the attachment for mirror posts newer than
the step's window start, so every check sees the full payload.

A mirror post from a preview bot built before the attachment is cut at the length cap
instead. It is raw text, not JSON, so its scoped checks only look for the text, and its
`not:` checks are skipped: its JSON keys would trip them.

- **PASS**: every check holds. When the tester presses **Looks right**, the result
  says the tester confirmed it.
- **FAIL**: no output, or a check does not hold. The report includes the observed
  payloads and the tester's note.
- **NEEDS EYES**: output arrived, but `Expected:` quotes nothing that must be present.
  The tester is asked to confirm it; the report only keeps this verdict when the run
  was aborted before they answered.

No model is involved. Quote the exact labels and titles a step should produce, and the
conductor can check them.

## Access and safety

- Only `BOT_DEV_PING_USER_ID` from `src/config/users.ts` may use the command or buttons,
  in the test guild or in DMs. Bots, webhooks, and the conductor itself are refused
  first.
- It only reads the test guild's test and mirror channels. The one message it acts on
  is the preview bot's ready announcement, and its answers never match that format, so
  it cannot loop with another bot.
- The PR body and everything read from Discord are data. Commands are shown to the
  tester, never executed. Mentions are disabled in every post, and PR text in the report
  is escaped or fenced.
- It reads its settings from its own environment and never loads the bot's `.env`.
- On startup it checks that it has View Channel, Read Message History, and (in the test
  channel) Send Messages in the test and mirror channels, and logs each channel that is
  missing one. It keeps running, and `/conduct` repeats the check and refuses to start a
  run until the permissions are fixed, so no restart is needed.

## Settings

The conductor reads these from its process environment:

- `CONDUCTOR_BOT_TOKEN`: the conductor application's bot token. Never the production or
  preview bot's token.
- `CONDUCTOR_GITHUB_TOKEN`: a fine-grained token for `TheRPGClub/TheRPGClub-bot` with
  Pull requests: read and write. The report is posted through the issues comments API,
  but on a pull request GitHub checks the Pull requests permission, not Issues, so
  Issues: read and write alone gets a 403.
  The same permission covers the approval. The approval is skipped when the token's user
  opened the PR, so a token for the account that opens the PRs never approves; a
  separate machine user or a GitHub App with write access to the repo does.
- `TEST_GUILD_ID`: must be the test guild. The conductor refuses to start without it,
  since it is what makes the shared channel constants resolve to the test guild.
- `CONDUCTOR_STATE_PATH` (optional): where the active run is saved, by default
  `~/.config/rpgclub-conductor/state.json`. A restart resumes from it, and buttons from
  before the restart keep working.

## One-time setup

1. In the Discord Developer Portal, create a new application, for example
   `RPGClub Conductor`. Do not reuse the production or preview application.
2. Under Bot, reset and copy the token, and enable the Message Content privileged
   intent. It is needed to read the preview bot's replies and mirror posts.
3. Under OAuth2 URL Generator, pick the `bot` and `applications.commands` scopes with
   View Channels, Send Messages, and Read Message History, and add it to the test guild
   only.
4. Create the GitHub token described under Settings.
5. Put the settings in an env file readable only by you, for example
   `~/.config/rpgclub-conductor/conductor.env` with mode `600`.
6. Run it as a long-lived systemd user service on the desktop, separate from the
   preview container, from the release directory the deploy workflow maintains (see
   [Deploys](#deploys)). The runner's service has no login session, so let the user's
   services run without one: `loginctl enable-linger`. Then save this as
   `~/.config/systemd/user/rpgclub-conductor.service`:

   ```ini
   [Unit]
   Description=RPGClub PR test conductor

   [Service]
   WorkingDirectory=%h/.local/share/rpgclub-conductor/current
   EnvironmentFile=%h/.config/rpgclub-conductor/conductor.env
   ExecStart=/usr/bin/npm run conductor
   Restart=on-failure

   [Install]
   WantedBy=default.target
   ```

   Build the first release by hand from an up-to-date checkout of `main`, which also
   starts the service. `daemon-reload` makes systemd pick up an edited unit; without it,
   an existing unit keeps running the old checkout and the deploy times out:

   ```bash
   systemctl --user daemon-reload
   systemctl --user enable rpgclub-conductor.service
   bash scripts/conductor/deploy.sh deploy "$(git rev-parse HEAD)"
   ```

   Then set the repository variable `CONDUCTOR_DEPLOY_ENABLED` to `true`, so merges
   deploy it from then on.
7. In the test guild, `/conduct` should appear. Run it against a PR with a `## Testing`
   section while that PR's preview is running, after deploying it with
   `/test-guild <number>`.

## Deploys

`.github/workflows/conductor-deploy.yml` keeps the conductor on the latest `main`. It
runs on the self-hosted preview runner, which must run as the same user as the service.
A unit named other than `rpgclub-conductor` is set with the `CONDUCTOR_UNIT` repository
variable, the same one `docs/pr-preview.md` uses for logs.

- **When.** A push to `main` deploys only when it changes a file the conductor loads:
  anything reachable through relative imports from `src/conductor/main.ts`, plus
  `package.json`, `package-lock.json`, and `tsconfig.json`. The comparison is against
  the live release, not the push's parent, so a skipped or failed deploy is caught up
  by the next one. Any other push leaves the conductor running.
- **How.** `scripts/conductor/deploy.sh` builds each commit into its own directory under
  `~/.local/share/rpgclub-conductor/releases/`, from `git archive` with a `REVISION`
  file naming the commit. It reuses the live release's `node_modules` when the lockfile
  is unchanged, runs `npm ci` otherwise, and type-checks the release. Only then does it
  point the `current` link at the new release and restart the service.
- **Runs in progress.** While the saved run (`CONDUCTOR_STATE_PATH`) is `running` and
  was saved in the last 15 minutes, the restart waits, up to 30 minutes, for the tester
  to finish. Past that it restarts anyway, and the run resumes from its state file. A
  `running` run untouched for 15 minutes counts as abandoned and never delays a deploy.
- **Failures.** A failed install or type-check fails the workflow and leaves the live
  release untouched. After a restart, the script waits for the startup line
  `[conductor] ready as <tag> at <commit>` in the service's journal. When the new commit
  does not log it within two minutes, it switches back to the release it replaced,
  restarts that one, and fails the workflow.
- **Which version is live.** The startup line names the commit. So does
  `bash scripts/conductor/deploy.sh current`, and `deploy.sh list` marks the live one
  among the releases kept on disk (the five newest, plus the live and previous ones).

### Rolling back

- `bash scripts/conductor/deploy.sh rollback` on the desktop switches back to the
  release before the live one; `rollback <sha>` switches to any release still on disk.
- Running the **Conductor deploy** workflow by hand with an older commit as `ref` builds
  and deploys that commit, for one no longer on disk. A dispatch always deploys, with
  the deploy scripts from the branch it was dispatched on, so any commit works.
- The next push that changes the conductor deploys `main` again. To hold a rollback,
  set `CONDUCTOR_DEPLOY_ENABLED` to anything but `true` until the fix merges.
