# PR preview deployments

Every same-repo pull request against `main` is built and run in the test guild under a
separate dev bot application, on a self-hosted runner on the desktop that already runs
the production bot. The PR gets a sticky `PR preview` comment saying whether its preview
is building, running, failed, replaced, or torn down, and the `deploy` job doubles as a
check.

Pieces:

- `.github/workflows/pr-preview.yml` deploys on open, reopen, and push (including
  force-push), tears down on close or merge, and reaps orphans hourly.
- `scripts/preview/preview.sh` does the Docker work, and is the manual control.
- `docker-compose.preview.yml` defines the `pr-preview` service. It is a separate file so
  `docker compose up -d` for production never starts it.
- `scripts/preview/comment.mjs` writes the PR comment.

The existing `ci.yml` jobs stay on GitHub-hosted runners.

## Guarantees

- **Production is untouched.** The preview runs with `TEST_GUILD_ID` set, so its slash
  commands register to the test guild only, and under the dev bot's own application, so
  the production command set is never written. `preview.sh` refuses to start when
  `TEST_GUILD_ID` is empty or when `BOT_TOKEN` decodes to `PRODUCTION_BOT_USER_ID`.
- **One preview at a time.** Every deploy removes whatever preview is running first, and
  deploys share one concurrency group that cancels an in-flight deploy when a newer one
  starts. The newest push wins, and the PR it displaced is told so in its comment.
- **Watchtower leaves it alone.** The container carries
  `com.centurylinklabs.watchtower.enable=false`, and its image is local only.
- **Scheduled work stays with production.** Test mode skips the background services in
  `src/services/SharedStateServices.ts`, so the preview cannot claim shared work through
  the API first and post it in the test guild.
- **Fork PRs never run here.** Jobs skip any PR whose head repo is not this repo, so fork
  code never reaches the runner or the dev token.

Not guaranteed: test mode does not redirect external services (see the README's test
guild section). Whatever `RPGCLUB_API_BASE_URL`, Backblaze, and GitHub values the preview
env file holds are what the preview writes to.

## One-time setup

Everything below happens on the desktop, in the WSL2 distro unless it says Windows.

### 1. Dev bot application

1. In the Discord Developer Portal, create a new application, for example
   `RPGClub Bot (preview)`. Never reuse the production application.
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

1. Open any PR against `main`. Within a minute or two its `PR preview` comment should
   read Running, and the dev bot should be online in the test guild with its slash
   commands listed there.
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

`teardown <pr>` removes the preview only if it belongs to that PR. Re-running the
`deploy` job of a PR's latest workflow run brings its preview back. Running the workflow
by hand from the Actions tab runs the reaper, which removes a preview whose PR is closed.
