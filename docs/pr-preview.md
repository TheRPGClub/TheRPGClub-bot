# PR preview deployments

A same-repo pull request against `main` whose body has Testing steps can be built and run
in the test guild under a separate dev bot application, on a self-hosted runner on the
desktop that already runs the production bot. Deploys happen only when the user asks for
one with the `/test-guild` skill in Claude Code, so several PRs can be in flight while
the user picks which one the test guild runs. The PR gets a sticky `PR preview` comment
saying whether its preview is building, running, behind its head, failed, replaced, or
torn down.

Pieces:

- `.claude/skills/test-guild/SKILL.md` is the `/test-guild` skill. Only the user runs
  it. It lists the deployable PRs and which one holds the test guild, dispatches a
  deploy or a stop, and waits for the run.
- `.github/workflows/pr-preview.yml` deploys when dispatched with `action=deploy` and a
  PR number, and stops the running preview on `action=stop`. PR events never deploy: a
  push to the PR holding the test guild marks its comment behind, a body edit that
  removes the Testing steps tears its preview down, and a close or merge tears it down.
  It reaps orphans hourly, or on `action=reap`.
- `scripts/preview/plan.mjs` reads the PR body with `src/conductor/TestPlanParser.ts`,
  the parser `/conduct` uses, so both agree on what counts as Testing steps.
- `scripts/preview/preview.sh` does the Docker work, and is the manual control.
- `docker-compose.preview.yml` defines the `pr-preview` service. It is a separate file so
  `docker compose up -d` for production never starts it.
- `scripts/preview/comment.mjs` writes the PR comment, and `scripts/preview/status.mjs`
  reads it back for `npm run test-guild:status`, the skill's view of the test guild.

The existing `ci.yml` jobs stay on GitHub-hosted runners.

## Guarantees

- **Nothing deploys on its own.** Opening, reopening, pushing to, or editing a PR never
  builds anything. A push to the PR holding the test guild updates its comment to say
  the preview is behind the new head; the user redeploys with `/test-guild <pr>`.
- **Only testable PRs deploy.** The `plan` job refuses a closed PR, a fork PR, and one
  whose body has no, an empty, or a malformed `## Testing` section, failing the run with
  the reason before anything is built, so the preview running for another PR stays up.
  A PR that loses its Testing steps has its own preview torn down and its comment
  updated.

- **Production is untouched.** The preview runs with `TEST_GUILD_ID` set, so its slash
  commands register to the test guild only, and under the dev bot's own application, so
  the production command set is never written. `preview.sh` refuses to start when
  `TEST_GUILD_ID` is empty or when `BOT_TOKEN` decodes to `PRODUCTION_BOT_USER_ID`.
- **One preview at a time.** Every deploy removes whatever preview is running first, and
  deploys share one concurrency group that cancels an in-flight deploy when a newer one
  or a stop starts. The newest request wins, and the PR it displaced is told so in its
  comment.
- **Watchtower leaves it alone.** The container carries
  `com.centurylinklabs.watchtower.enable=false`, and its image is local only.
- **Scheduled work stays with production.** Test mode skips the background services in
  `src/services/SharedStateServices.ts`, so the preview cannot claim shared work through
  the API first and post it in the test guild.
- **The status names the preview.** `PREVIEW_PR` and `PREVIEW_SHA` reach the container,
  and `src/config/previewMode.ts` turns them into a fixed `Testing PR #N (sha)` status
  instead of the production status in `BotPresenceHistory`. `/mod presence` in the
  preview changes the status live but never writes that table, which production reads.
- **A ready preview starts its test run.** Once startup completes, the preview posts
  `Ready for testing PR #N at <sha>` in the test guild's dev channel, and the conductor
  starts that PR's Testing steps there with no further input (`docs/conductor.md`,
  Automatic start). `/test-guild <pr>` is the only step needed to get a PR tested.
- **The deploy scripts come from main.** The `deploy` job runs `preview.sh`, the
  workflow's modules, and `docker-compose.preview.yml` from the workflow's own commit.
  It checks out the PR's head separately, into `pr-src/`, and uses it only as the Docker
  build context (`PREVIEW_BUILD_CONTEXT`). A branch that predates or rewrites those files
  cannot change how its preview is deployed or judged.
- **Fork PRs never run here.** Jobs skip any PR whose head repo is not this repo, so fork
  code never reaches the runner or the dev token.

Not guaranteed: test mode does not redirect external services (see the README's test
guild section). Whatever `RPGCLUB_API_BASE_URL`, Backblaze, and GitHub values the preview
env file holds are what the preview writes to.

## One-time setup

Everything below happens on the desktop, in the WSL2 distro unless it says Windows.

### 1. Dev bot application

1. In the Discord Developer Portal, create a new application named
   `RPGClubbot (Preview)`. Never reuse the production application. The Playwright runner
   finds the bot's slash commands by this name (`PREVIEW_BOT_NAME` in
   `src/config/previewMode.ts`) or by its avatar, so keep the two in step.
2. Under Bot, reset and copy the token. Enable the Server Members, Presence, and Message
   Content privileged intents, since the bot requests all three.
3. Under OAuth2 URL Generator, pick the `bot` and `applications.commands` scopes and the
   Administrator permission, open the URL, and add the bot to the test guild only.

### 2. Preview env file

```bash
mkdir -p ~/.config/rpgclub-preview
chmod 700 ~/.config/rpgclub-preview
```

Create `~/.config/rpgclub-preview/preview.env` starting from a copy of the production
`.env`, then change:

- `BOT_TOKEN` to the dev bot token.
- `TEST_GUILD_ID=1547802424301854770`.
- `RPGCLUB_API_BASE_URL` to a staging API if one exists, and blank the Backblaze and
  GitHub app values if the preview should not touch them.

```bash
chmod 600 ~/.config/rpgclub-preview/preview.env
```

A different path works too; set `PREVIEW_ENV_FILE` in the runner's `.env` (step 5).

### 3. WSL2 and Docker

1. Docker Desktop, Windows: Settings, Resources, WSL integration, enable the distro.
2. In WSL, `docker ps` must list the production container. If it says permission
   denied, add the user to the `docker` group and reopen the shell.
3. Enable systemd in WSL so the runner can run as a service. Put this in
   `/etc/wsl.conf`:

   ```ini
   [boot]
   systemd=true
   ```

   Then run `wsl --shutdown` from Windows and reopen the distro.
4. The distro has to be running for the runner to be online. In Windows Task Scheduler,
   add a task at log on that runs `wsl.exe -d <distro> --exec /bin/true`, so the
   systemd service starts with the desktop session.

### 4. Register the runner

GitHub ships the Actions runner only as a tarball from the repository settings page,
with no apt package.

1. On GitHub: repository Settings, Actions, Runners, New self-hosted runner, Linux, x64.
2. Run the download and extract commands it shows, in a dedicated directory such as
   `~/actions-runner`.
3. Configure it with the token that page shows and the label the workflow targets:

   ```bash
   ./config.sh --url https://github.com/TheRPGClub/TheRPGClub-bot \
     --token <token from the page> --name desktop-preview \
     --labels rpgclub-preview --unattended
   ```

4. Install and start it as a service:

   ```bash
   sudo ./svc.sh install
   sudo ./svc.sh start
   ```

### 5. Runner environment

The runner reads `~/actions-runner/.env` into every job. Add:

```
PRODUCTION_BOT_USER_ID=<production bot's user ID>
```

The production bot's user ID is its application ID in the Developer Portal, or right
click the bot in Discord with developer mode on and Copy User ID. Add
`PREVIEW_ENV_FILE=<path>` here too if step 2 used a non-default path. Then restart:

```bash
sudo ./svc.sh stop
sudo ./svc.sh start
```

### 6. Repository settings

Settings, Actions, General, Fork pull request workflows from outside collaborators: pick
`Require approval for all external contributors`. The workflow already skips forks; this
is the second lock.

### 7. Turn previews on

Every job is skipped until the repository variable `PR_PREVIEW_ENABLED` is `true`, so
PRs never wait on a runner that does not exist yet. Once steps 1 to 6 are done: Settings,
Secrets and variables, Actions, Variables tab, New repository variable,
`PR_PREVIEW_ENABLED` = `true`. Set it to anything else to pause previews, for example
while the desktop is off for a while.

### 8. Verify

1. Pick any open PR against `main` with Testing steps in its body and run
   `/test-guild <pr>` in Claude Code. Once the run finishes its `PR preview` comment
   should read Running, and the dev bot should be online in the test guild with its
   slash commands listed there. It posts `Ready for testing PR #<pr> at <sha>` in the
   dev channel, and the conductor posts step 1 of that PR's Testing steps under it.
2. `docker ps` shows `rpgclub-pr-preview` next to the production container, and the
   production bot keeps answering in the main guild.
3. Close the PR. The container is gone and the comment reads torn down.

## Manual controls

From a checkout of this repo on the desktop:

```bash
bash scripts/preview/preview.sh list
```

```bash
bash scripts/preview/preview.sh kill
```

`teardown <pr>` removes the preview only if it belongs to that PR, and `current` prints
the PR and commit the running preview was built from.

From anywhere, including the laptop, `/test-guild` covers the same ground through the
workflow. Without Claude Code, run the workflow from the Actions tab or with
`gh workflow run pr-preview.yml -f action=deploy -f pr=<pr>`; `action=stop` removes the
running preview and `action=reap` removes one whose PR is closed. Re-running all jobs
of a deploy run deploys that PR's head as of the re-run.

## Reading preview logs

The preview container and the conductor log only on the desktop. The **Preview logs**
workflow (`.github/workflows/preview-logs.yml`) collects their recent output on the
runner with `scripts/preview/collect-logs.sh` and uploads it encrypted to a key whose
private half stays on the machine that reads the logs. The repository is public, so
plaintext logs never reach a job log or an artifact. Artifacts expire after a day.

One-time setup, on the machine that will read the logs:

```bash
bash scripts/preview/fetch-logs.sh init
```

That makes a key pair in `~/.config/rpgclub-preview-logs/gnupg` (override with
`PREVIEW_LOGS_GNUPGHOME`) and publishes the public key as the `PREVIEW_LOGS_PUBLIC_KEY`
repository variable. The private key has no passphrase; the directory's permissions are
its guard, and it decrypts preview logs and nothing else. Running `init` on a second
machine replaces the public key, so only the newest machine can read later logs.

Then, any time:

```bash
bash scripts/preview/fetch-logs.sh 500
```

It runs the workflow on `main`, waits for it, and prints the last 500 lines of each
preview container and of the conductor. The conductor section reads the
`rpgclub-conductor` systemd user unit; set the `CONDUCTOR_UNIT` repository variable if
yours has another name.
