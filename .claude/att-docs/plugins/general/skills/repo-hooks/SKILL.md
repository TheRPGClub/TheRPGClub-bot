---
name: repo-hooks
description: Four session hooks every repository can reuse, each driven by one section of the repository's extension.json. They refuse a pull request body whose Testing section a checker cannot parse, remind the session to put a new pull request in its catch-up ledger and keep a merge watch running, run the unit test that belongs to an edited file, and run Prettier on an edited file. Use when wiring these hooks into a repository, changing a repository's values for them, or working out why one fired or stayed quiet.
---

# Repo hooks

Hooks that carry no repository detail of their own. The `general` plugin registers them
in `hooks/hooks.json`, and each one reads its values from one section of the
repository's extension file, `.claude/skills/repo-hooks/extension.json`. A repository
with no extension file, or a file with no section for a hook, gets no hook: the runner
exits 0 and prints nothing.

The scripts are in `plugins/general/hooks/`, beside `hooks.json` and the runner
`run.sh`. Each has a `_test.sh` or `_test.py` beside it.

## Wiring

Install the plugin and write the extension file:

```
claude plugin install general@att-docs --scope user
```

A repository that vendors this repository instead registers the vendored runner in its
own `.claude/settings.json`, once per hook, with the same matcher, timeout, section and
script that `hooks/hooks.json` gives it:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [
        { "type": "command", "timeout": 90,
          "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/att-docs/plugins/general/hooks/run.sh\" prTestingGate pr_testing_gate.py" } ] }
    ]
  }
}
```

When a project's settings name `plugins/general/hooks/run.sh`, the plugin's own copy of
the runner steps aside for that project, so a hook never fires twice. A vendoring
repository adds `plugins/general/hooks` to the paths its sync script copies.

The runner runs each script from the repository root (`CLAUDE_PROJECT_DIR`, or the
working directory) and hands it the extension file as `--config <file>`. A script run by
hand with a missing `--config` exits 64.

## The extension file

One JSON object. Each hook reads only its own section, and a path in it is relative to
the repository root.

```json
{
  "prTestingGate": {
    "checker": ["node", "--no-warnings=ExperimentalWarning", "--import", "tsx", "scripts/check-pr-testing.ts"],
    "checkerLabel": "npm run check:pr-testing -- <file>",
    "failureMarker": "The ## Testing section cannot be parsed"
  },
  "mergeWatchReminder": {
    "ledgerTool": "scripts/catchup.py"
  },
  "testOnEdit": {
    "testDir": "src/tests",
    "testName": "<name>.test<ext>",
    "extensions": [".ts"],
    "command": ["node", "--no-warnings=ExperimentalWarning", "--import", "tsx", "--test"],
    "tailLines": 10
  },
  "prettierOnSave": {
    "globs": ["*.ts", "*.tsx"],
    "command": ["npx", "prettier", "--write"]
  }
}
```

## PR testing gate

`pr_testing_gate.py`, PreToolUse on Bash, section `prTestingGate`. It reads the body
file of `gh pr create` or `gh pr edit` (`--body-file <path>`, `-F <path>`) and of
`gh api ... pulls[/<N>] -F body=@<path>`, runs the repository's checker on it, and denies
the call with the checker's output as the reason when the body fails. A body passed
inline that carries a `## Testing` heading is denied with a pointer at `--body-file`,
since the checker cannot read it. A body read from stdin is not checked. The hook sees
through `cd`, `NAME=value` and `export` earlier in the same command when it works out the
file's path.

Keys:

- `checker`, required: the checker as a list of words. The body file's path is added as
  the last word and the command runs from the repository root. Exit 0 means the body is
  fine, exit 1 means the Testing section is malformed, and any other exit means the
  checker could not read the file. Without a `checker` the hook lets everything through.
- `checkerLabel`: how a denial names the command, with `<file>` for the path. Defaults to
  the checker's words followed by the path.
- `failureMarker`: text the checker prints when it rejects a body. When set, an exit 1
  without it is reported as a checker that could not run (a missing dependency, for
  example) instead of a failed body.

## Merge-watch reminder

`remind-pr-merge-watch.sh`, PostToolUse on Bash, section `mergeWatchReminder`. After a
command that runs `gh pr create` and prints a pull request URL on a line of its own, it
adds a reminder to the session's context, one per pull request opened. It stays quiet for
a command that only mentions `gh pr create`, and for a URL buried in other output.

Keys, at least one of which must be set:

- `ledgerTool`: the repository's catch-up ledger script. The default wording tells the
  session to run `<ledgerTool> add-pr <ledger> <N> "<label>"` and to keep one
  `<ledgerTool> wait <ledger>` running in the background until the pull request merges.
- `message`: the whole reminder, replacing the default. `<N>` stands for the pull request
  number and `<ledgerTool>` for the tool. A repository whose ledger commands differ from
  the default, or whose reminder points at its own procedure, writes the full text here.

## Unit test on edit

`test-on-edit.sh`, PostToolUse on Edit|Write, section `testOnEdit`. For an edited source
file it looks for its test file under `testDir`, runs the test command on it, and puts the
last lines of the output in the session's context when the test fails. A passing run, a
file with no test file, an extension not listed, and a file outside the repository stay
quiet.

Keys:

- `testDir`, required: where to look for the test file.
- `command`, required: the test command as a list of words. The test file's path is added
  last.
- `testName`: the test file's name, with `<name>` for the edited file's name without its
  extension and `<ext>` for the extension. Defaults to `<name>.test<ext>`. The first match
  under `testDir`, in name order, runs.
- `extensions`: the edited files that have tests, with the dot. The longest match is
  stripped to make `<name>`. Defaults to `[".ts"]`.
- `tailLines`: how many of the last output lines a failure reports. Defaults to 10.

## Prettier on save

`prettier-on-save.sh`, PostToolUse on Edit|Write, section `prettierOnSave`. It formats an
edited file that matches a glob, when the repository has a Prettier config. A formatter
that fails never blocks the edit, and the hook prints nothing. The section may be an empty
object to take every default.

Keys, all optional:

- `globs`: bash patterns matched against the edited file's path from the repository root,
  where `*` also matches a slash. Defaults to `["*.ts", "*.tsx"]`.
- `command`: the formatter as a list of words. The file's path is added last. Defaults to
  `["npx", "prettier", "--write"]`.
- `configFiles`: the file names that count as a Prettier config, looked for in the edited
  file's folder and each folder above it up to the repository root. Defaults to the names
  Prettier reads (`.prettierrc` and its variants, `prettier.config.*`). A `package.json`
  with a `prettier` key also counts, whatever this says. A repository with no config at
  all gets no formatting.

## Tests

```
bash plugins/general/hooks/run_test.sh
bash plugins/general/hooks/remind-pr-merge-watch_test.sh
bash plugins/general/hooks/test-on-edit_test.sh
bash plugins/general/hooks/prettier-on-save_test.sh
python3 plugins/general/hooks/pr_testing_gate_test.py
```

All of them need `jq`, and the gate's test needs `python3`. None needs a repository's
own checker, formatter or test runner: they use stand-ins.
