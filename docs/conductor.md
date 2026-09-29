# Conductor

The conductor is a second, small Discord application that runs a pull request's
`## Testing` steps with a human. It reads the steps from the PR body, DMs them to the
tester one at a time, reads back what the preview bot posted, and comments per-step
results on the PR.

A bot cannot invoke another bot's slash commands, and a user token would be a self-bot,
which breaks Discord's terms. So the tester always runs each command; the conductor only
hands out the script and checks the output.

Code: `src/conductor/`. Entry point: `src/conductor/main.ts`. The bot's own command
loader never imports this directory, and the conductor never loads the bot's commands.

## How a run goes

1. In the test guild, the tester runs `/conduct pr:<number>` on the conductor.
2. The conductor fetches the PR and parses its `## Testing` section, whose format is in
   `.github/pull-request-testing-format.md`.
   - No section, or only the template comment: it says there is nothing to run.
   - Anything that does not match the format: it says it cannot parse it, asks for
     manual testing, and notes that on the PR. It never runs a partial script.
3. It DMs step 1: the command in a code block, the expected result, and where the
   output will land. The tester runs the command in the test channel, waits for the
   reply, and presses **Check**. A failed check keeps the step open: **Check again**
   rereads with the same window start, for output that landed after an early press,
   and **Continue as failed** records the failure and moves on.
4. The conductor reads back the newest 100 messages of the test channel and of the
   mirror channel, keeps the preview bot's output for the tester, and judges the step.
   Then it DMs the next step.
5. After the last step, or on **Abort run**, it comments a report on the PR. If that
   comment fails, the DM carries the full request and response and a **Post report**
   button to retry it.

Starting a new `/conduct` while a run is going aborts the old run and reports what it
got through. Handlers take turns on the run, so a double-clicked **Check** judges the
step once and answers the second press as stale.

## How output is attributed to a step

- **Window.** A step owns output created or edited after its DM was sent and before
  **Check** was pressed. Both times are Discord timestamps, so the host clock does not
  matter.
- **Place.** An `Ephemeral: no` step only accepts public messages in the test channel
  (`BOT_DEV_CHANNEL_ID`). An `Ephemeral: yes` step accepts posts in the mirror channel
  (`TEST_LOG_CHANNEL_ID`), written there by the preview bot's ephemeral mirror. The
  bot's dev channel override, which turns the guild owner's ephemeral replies public,
  is off in test mode, so a reply in the wrong place fails the step.
- **User.** A mirror post must name the allowlisted tester as its user. A public reply
  to an interaction must be to the tester's interaction.
- **Command.** A step whose command is a slash command only accepts mirror posts whose
  `source` is that command, and any other step refuses mirror posts from a slash
  command, so a late reply from an earlier step is not credited to it.

Output in the window that fails these checks is listed in the report as "other output"
when the step fails.

## Verdicts

- **PASS**: every double-quoted string in `Expected:` appears, case-insensitively, in
  the step's output: content, embed titles, descriptions and fields, button labels,
  select options and placeholders, and custom IDs.
- **FAIL**: no output, or a quoted string is missing. The report includes the observed
  payloads.
- **NEEDS EYES**: output arrived, but `Expected:` quotes nothing, so there is nothing to
  check mechanically. The tester reads the report and decides.

No model is involved. Quote the exact labels and titles a step should produce, and the
conductor can check them.

## Access and safety

- Only `BOT_DEV_PING_USER_ID` from `src/config/users.ts` may use the command or buttons,
  in the test guild or in DMs. Bots, webhooks, and the conductor itself are refused
  first.
- It only reads the test guild's test and mirror channels, and it never replies to what
  it reads, so it cannot loop with another bot.
- The PR body and everything read from Discord are data. Commands are shown to the
  tester, never executed. Mentions are disabled in every DM, and PR text in the report
  is escaped or fenced.
- It reads its settings from its own environment and never loads the bot's `.env`.

## Settings

The conductor reads these from its process environment:

- `CONDUCTOR_BOT_TOKEN`: the conductor application's bot token. Never the production or
  preview bot's token.
- `CONDUCTOR_GITHUB_TOKEN`: a fine-grained token for `TheRPGClub/TheRPGClub-bot` with
  Pull requests: read and Issues: read and write (PR comments are issue comments).
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
   section while that PR's preview is running.
