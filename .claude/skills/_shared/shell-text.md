# Text and scripts through Bash

Shared by every skill that commits, opens or edits a pull request, files or
edits an issue, posts a comment, or runs a script longer than one line.

No Bash call carries a heredoc. Claude Code's worktree isolation check reads
each Bash call before it runs, in any session working in a worktree, and
refuses one it cannot follow, saying the command is too complex to verify that
it stays inside the worktree. Calls refused this way include a body built
inline with `"$(cat <<'EOF' ... EOF)"` and a script written with
`cat > <file> <<'EOF'` and run in the same call. Each refusal costs a round
trip, and a retry in the same shape is refused again.

## Text goes in a file

Write text longer than one line with the Write tool, into the session's
scratchpad directory, and pass the command the path:

```bash
git commit -F <scratchpad>/commit-msg.txt
gh pr create --title "<title>" --body-file <scratchpad>/pr-body.md
gh issue comment <n> --body-file <scratchpad>/comment.md
```

A one-line body goes through a file too when it carries a backtick, a `$`, or
a double quote. Inside a double-quoted `--body` or `-m`, the shell expands the
first two, and the third ends the string. A plain one-line body or commit
message can stay inline.

Write the file again for each command, so text meant for one issue or commit
never goes out a second time.

## Scripts go in a file

Write a script longer than one line with the Write tool, into the scratchpad,
and run it by its literal path in a Bash call of its own:

```bash
node <scratchpad>/probe.mjs
bash <scratchpad>/check.sh
```

Never `node - <<'EOF'`, never a multi-line `node -e`, and never a script
written and run in the same call. The file stays behind, so a script that
misbehaves can be opened and run again.

## A process the session waits on

A process the session waits on, such as `scripts/catchup.py wait`, runs as its
own background Bash call rather than from inside a script. A bare `wait` in a
script waits for every child the script started, background ones included.
