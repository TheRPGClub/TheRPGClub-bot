---
name: voice-bridge-hooks
description: The hook scripts that announce aloud what a session needs, read its replies aloud in speech mode, and hand its replies, questions and permission prompts to a voice bridge a phone follows. Use when wiring these hooks into a repository, changing what they say or when, or working out why a session spoke, stayed quiet, or never reached the phone. Also use when /tmp reports no space left on device while it still has space free, or a bridge update fails for that reason.
---

# Voice bridge hooks

Scripts a session's hooks run. They speak the session's name and what it needs
when it stops, asks a question, or labels a pull request ready for review; read
each reply aloud while speech mode is on; and keep the files a voice bridge reads
to relay a session to a phone. The bridge itself is not part of this skill: it
reads and writes the files under `$XDG_RUNTIME_DIR/voice-bridge/` that
`voice_bridge_reply.py` describes. How a reply the hooks read aloud should be
worded is set out in the `voice-request` skill's spoken-reply rules.

The consuming repository's extension supplies the values below. Where it names
none, ask the user rather than guessing.

| Placeholder | Meaning |
| --- | --- |
| `<config>` | The extension's `extension.json`, which the scripts that read repository values take as `--config` |
| `<hook-settings>` | Where the hook commands that run these scripts are registered |
| `<entry-points>` | The paths the hook commands and the bridge call, when the repository keeps its own |
| `<review-label>` | The label the ready signal adds to a pull request |
| `<ready-line>` | The line a reply carries when a pull request is ready for review |
| `<ledger-module>` | The module that reads the run and pull request ledger a session waits on |
| `<bridge>` | The voice bridge that reads the files these scripts write |

## The scripts

All of them ship in this folder.

| Script | What it does | `--config` |
| --- | --- | --- |
| `speak-attention.sh` | Speaks on Stop, on an `AskUserQuestion` call, and when a Bash call adds `<review-label>`; reads replies aloud in speech mode; pushes a followed session's text to the bridge's feed | yes |
| `stop_attention.py` | Says what a stopped session needs from the user, or exits 3 to stay quiet | yes |
| `voice_bridge_reply.py` | Writes a stopped session's reply, its attention marks, its feed entries and its ready records for `<bridge>`, and answers a permission prompt with the answer the bridge relays | yes |
| `transcript.py` | Reads a session transcript; `blocked` prints the ledgers, issues and pull requests a session waits on | yes, for `blocked` |
| `ready_line.py` | Reads `<ready-line>` and a `<review-label>` add out of a reply and a command, imported by the three above | through its importer |
| `speechctl` | Drives the speech `speak-attention.sh` reads aloud: `status`, `skip`, `next`, `clear`, `pause`/`resume`/`toggle`, `volume`, `voice`/`voices`, `sessions` and `speech <session> on\|alerts\|off\|cycle`. Put it on `PATH` for the conky widget and keyboard shortcuts | no |
| `sessions.py` | Lists the open Claude sessions the way the bridge's `list_sessions` does; imported by `speechctl` | no |
| `speak_pending.py` | Picks the text blocks a turn has not had read aloud yet | no |
| `background_pending.py` | Names the background work still due to wake a session, so a stop stays quiet | no |
| `hook_config.py` | Reads `<config>` | |
| `defaults.json` | The config for a repository with no extension file; the plugin's `hooks/run.sh` passes it | |

`--config <file>` comes first, ahead of a subcommand. A missing option, a missing
file, or a missing field exits 64. A module that imports `ready_line.py` or
`transcript.py` calls `hook_config.use(<file>)` first. Siblings are found beside
the script, so a script runs from this folder or from any copy of it.

## Speech state and control

`speak-attention.sh` keeps these files in `$XDG_RUNTIME_DIR/speak-attention/`, and
`speechctl` reads and writes them. The conky widget (merph518/conky-widgets) does the same
through `speechctl`.

| File | Meaning |
| --- | --- |
| `<session>.replies` | Speech **On**: the session's replies are read aloud as they land |
| `<session>.muted` | Speech **Off**: the session says nothing, announcements included. Its voice-bridge feed is unaffected |
| neither | **Alerts only** (the default): just the short announcements |
| `<session>.queue`, `.cursor`, `.name` | The lines waiting to be read, how far the turn was read, the name the voice gives the session. Edits to the first two take `<session>.cursor.lock` |
| `now.json` | The clip playing: `session` and `name` of the session whose line it is (not always the hook's own, since a hook reads other sessions' queues after its own), `text`, `started`, `clip`, `hook_pid`, `player_pid` (null while Piper renders), `engine` (`piper` or `spd-say`). Written atomically, removed when the clip ends or its hook is killed |
| `paused` | Present while speech is held. A Piper clip is paused by stopping its player; a Speech Dispatcher clip is cancelled and its line put back at the head of the queue (`requeue` names the clip). A held line stays queued, and a hook gives up the hold after about 1100 s |
| `skip` | Left by `speechctl skip` while Piper is still rendering; the hook drops the clip when the render ends |
| `settings.json` | `voice` (a model in `~/.local/share/piper/`), `volume` (0.0 to 2.0, the `pw-play` level; default 1.2), `pace` (Piper length scale). Read before each clip, so a change applies from the next one, and overrides `SPEAK_PIPER_MODEL` and `SPEAK_PIPER_LENGTH`. `SPEAK_VOICE` still picks the Speech Dispatcher fallback voice |

The hook that holds the voice reads its own session's queue first, then every other
session's with lines left, oldest first. `speechctl next` drops what is queued for the
speaking session, so the next session's reply plays; lines queued afterwards still play.

`/implement-with-speech` sets a session to On and clears Off. A typed `/implement` takes On
to Alerts only and leaves Off alone.

## The config

`hook_config.py` lists every field. A path in the file is relative to the git
toplevel of the folder the file sits in.

- `reviewLabel`, `reviewAnnouncement`: the label, and the words spoken after
  "has pull request N" once a label add goes through.
- `readyLine`: `<ready-line>`, with `<N>` where the number goes. It is read in any
  case, with `#` or emphasis around the number.
- `spokenTerms`: words the voice would misread, such as acronyms, and how to say
  them. A word whose sound depends on its sense, such as "lives", cannot be
  fixed this way, so the `voice-request` skill's wording rules have replies
  avoid it.
- `scriptsDir`, `ledgerModule`: where `<ledger-module>` lives. It provides
  `read_ledger(path)`, whose rows carry `run`, `state`, `branch` and `title`, and
  `STATIC_CHECKS_NAME`, which starts the title of a pull request's checks row.
- `ledgerTool`, `ledgerSubcommands`, `dispatchTool`, `dispatchLedgerFlag`,
  `drivers`, `driverLedger`: the commands whose arguments name a ledger.

## What the scripts assume

- Pull requests are opened and labeled with a command line client whose create,
  edit and API calls `ready_line.py` and `voice_bridge_reply.py` recognize.
- Speech comes from Piper with a voice model when one is installed, else from
  Speech Dispatcher. A machine without `jq` and `python3`, or with neither
  speaker, stays quiet.
- Speech mode is turned on by the `implement-with-speech` skill and off by a
  typed `/implement`.

## Wiring

Register the hook commands in `<hook-settings>`, each calling a script, or its
entry point under `<entry-points>`, with `<config>`. A repository that keeps entry points at
its own paths makes each one a shim that hands over with `os.execv` or
`exec bash` and passes `--config`, so the process, its arguments, its input and
its exit code stay the hook's own.

### At user scope

The `voice` plugin registers every one of these hooks itself, in
`plugins/voice/hooks/hooks.json`, so a machine that installs the plugin at user
scope gets them in every repository without a hook entry in any of them:

```
claude plugin marketplace add merph518/Overmind
claude plugin install voice@att-docs --scope user
```

Each hook calls `hooks/run.sh`, which picks the config for the session's repository:

- `$CLAUDE_PROJECT_DIR/.claude/skills/voice-bridge-hooks/extension.json` when the
  repository has one. This is the path a repository's extension keeps its values at.
- `defaults.json` otherwise. It names a generic review label and ready line and no
  ledger, so the reply relay, the spoken replies and the attention announcements work and
  a session is never reported as waiting on a ledger.

A repository whose own `.claude/settings.json` or `settings.local.json` still registers
`voice_bridge_reply` or `speak-attention` keeps those hooks, and `run.sh` exits quietly
so no hook fires twice. A repository moves to the plugin by deleting its voice entries
and keeping its extension file.

Hook changes load when a session starts, so a session open during the switch keeps the
hooks it started with. The plugin runs from the plugin cache, not from a vendored copy,
so a pin move in a repository is followed by `claude plugin update voice@att-docs`. The plugin holds only this skill and
`voice-request`, so a session lists this skill once more as `voice:voice-bridge-hooks`
beside a repository's extension of it, and no copy of `implement`.

## Tests

From this folder, `python3 <script>_test.py` for each Python script and
`bash speak-attention_test.sh` and `bash speechctl_test.sh` (stub players, a scratch
`XDG_RUNTIME_DIR`, about half a minute). They read `test-config.json`, whose values are
examples, and `transcript_test.py` writes a stand-in ledger module into a scratch
git work tree.

## When /tmp says it is full but is not

/tmp is a tmpfs with a fixed number of inodes, one per file or folder, and it can run
out of them with most of its space free. Then nothing can make a file there: a bridge
update fails, and Claude Code's Bash tool stops running commands with `ENOSPC` or "No
space left on device". Use another shell, such as Desktop Commander, until it is cleared.

1. Confirm it. `df -h /tmp` shows space free while `df -i /tmp` shows inodes at or near
   100%.
2. Find what holds them, in one pass over /tmp:

   ```bash
   find /tmp -xdev -mindepth 1 2>/dev/null | awk -F/ '{c["/tmp/"$3]++} END{for(k in c) print c[k]"\t"k}' | sort -rn | head
   ```

   Count folders with `find /tmp -maxdepth 1 -name '<pattern>' | wc -l`, never `ls` with
   a glob, which fails with "Argument list too long" at this size. Thousands of
   `voice-bridge-XXXXXX` folders are scratch folders from the bridge tests in
   `plugins/voice/bridge`, which remove their own folders when they finish, so a run that
   was killed or a copy of the tests from before that leaves them behind.
3. Ask the user before deleting anything, with how many folders there are and what made
   them.
4. Remove only those leftover test folders: older than ten minutes, and not the working
   folder of a process or open by one. Never touch `/tmp/claude-*`, sockets,
   `voice-bridge-check-*` (a bridge update's own check), or anything else in /tmp.

   ```bash
   before=$(df --output=iused /tmp | tail -1)
   open=$(ls -l /proc/[0-9]*/cwd /proc/[0-9]*/fd/ 2>/dev/null | grep -o '/tmp/voice-bridge-[A-Za-z0-9]\{6\}' | sort -u)
   find /tmp -maxdepth 1 -type d -name 'voice-bridge-??????' -mmin +10 -print0 \
     | grep -zvxF -f <(printf '%s\n' $open) | xargs -0 -r rm -rf
   echo "inodes freed: $(( before - $(df --output=iused /tmp | tail -1) ))"
   ```

5. Report the inodes freed and the `df -i /tmp` use after. When the leftovers came from
   something other than the bridge tests, say what made them rather than deleting them.
