#!/usr/bin/env bash
# PostToolUse hook on Bash, ported from PlaywrightTesting. After a `gh pr create`
# that printed a pull request URL, tells the session to record the pull request
# in its catch-up ledger and keep one `wait` running, so the merge reaches the
# session without the user reporting it, even when the pull request sits beside
# a longer task or the desktop app sends no CI monitor event.
set -euo pipefail

input=$(cat)
command=$(jq -r '.tool_input.command // ""' <<<"$input")
# Only a command that runs `gh pr create`, at its start or after a shell separator, not
# one that merely mentions it (a grep of the docs, a commit message).
grep -qE '(^|[;&|(])[[:space:]]*gh pr create' <<<"$command" || exit 0

output=$(jq -r '.tool_response | if type == "string" then . else tostring end' \
  <<<"$input")
number=$(grep -oE 'github\.com/[^/ ]+/[^/ ]+/pull/[0-9]+' <<<"$output" \
  | head -n1 | grep -oE '[0-9]+$' || true)
test -n "$number" || exit 0

msg="Pull request $number was opened. Before ending the turn, record it with"
msg+=" \`scripts/catchup.py add-pr <ledger> $number \"<label>\"\` and make sure"
msg+=" one \`scripts/catchup.py wait <ledger>\` runs in the background, per"
msg+=" .claude/skills/_shared/run-watch.md#waiting-on-a-pull-request. Once it is"
msg+=" mergeable, without waiting for CI, move to Self Review and"
msg+=" review it per .claude/skills/_shared/self-review.md, fixing every finding"
msg+=" and reviewing again until a pass finds nothing. Do not end the turn inside"
msg+=" the loop: wait for CI in the foreground. Move to Needs Review only after a"
msg+=" clean pass with CI green and nothing else in progress, per"
msg+=" .claude/skills/_shared/sidebar-groups.md. When \`wait\` prints"
msg+=" \`pr: $number merged\`, run the after-merge steps straight away and follow"
msg+=" its \`sidebar:\` line."

jq -n --arg m "$msg" \
  '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $m}}'
