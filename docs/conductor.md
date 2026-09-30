# Conductor

The conductor is a second, small Discord application that runs a pull request's
`## Testing` steps with a human. It reads the steps from the PR body, posts them one at
a time in the channel where `/conduct` was run, reads back what the preview bot posted,
and comments per-step results on the PR.

A bot cannot invoke another bot's slash commands, and a user token would be a self-bot,
which breaks Discord's terms. So the tester always runs each command; the conductor only
hands out the script and checks the output.

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
   code block, the expected result, and where the output will land. The tester runs the command in the test channel, waits for the
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
6. Run it as a long-lived service on the desktop, separate from the preview container,
   for example a systemd user unit:

   ```ini
   [Unit]
   Description=RPGClub PR test conductor

   [Service]
   WorkingDirectory=%h/Code/bot
   EnvironmentFile=%h/.config/rpgclub-conductor/conductor.env
   ExecStart=/usr/bin/npm run conductor
   Restart=on-failure

   [Install]
   WantedBy=default.target
   ```

7. In the test guild, `/conduct` should appear. Run it against a PR with a `## Testing`
   section while that PR's preview is running, after deploying it with
   `/test-guild <number>`.
