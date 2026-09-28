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
msg+=" .claude/skills/_shared/run-watch.md#waiting-on-a-pull-request. Stay in"
msg+=" Working until CI passes and it is mergeable, then move to Self Review and"
msg+=" review it per .claude/skills/_shared/self-review.md, fixing every finding"
msg+=" and reviewing again until a pass finds nothing, then move to Needs Review."
msg+=" A turn that ends idle between passes also moves to Needs Review, and back"
msg+=" to Self Review when \`wait\` reports the CI run, per"
msg+=" .claude/skills/_shared/sidebar-groups.md. When \`wait\` prints"
msg+=" \`pr: $number merged\`, run the after-merge steps straight away and follow"
msg+=" its \`sidebar:\` line."

jq -n --arg m "$msg" \
  '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $m}}'
