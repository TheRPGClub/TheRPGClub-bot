#!/usr/bin/env bash
# usage: bash run_test.sh
# Tests run.sh against stand-in scripts, so no real hook script runs.
set -u
here=$(dirname "$(readlink -f "$0")")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fail=0

mkdir -p "$work/plugin/hooks"
cp "$here/run.sh" "$work/plugin/hooks/run.sh"
printf '%s\n' 'import os, sys; print("py", *sys.argv[1:], os.getcwd(), sys.stdin.read().strip())' \
  >"$work/plugin/hooks/probe.py"
printf '%s\n' 'echo "sh $* $PWD $(cat)"' >"$work/plugin/hooks/probe.sh"
run="$work/plugin/hooks/run.sh"

# usage: check <name> <expected> <actual>
check() {
  if [[ $2 != "$3" ]]; then
    echo "FAIL $1: expected [$2] got [$3]" >&2
    fail=1
  fi
}

mkdir -p "$work/bare"
out=$(CLAUDE_PROJECT_DIR=$work/bare "$run" gate probe.py <<<payload)
check "quiet when the project has no extension file" "" "$out"
CLAUDE_PROJECT_DIR=$work/bare "$run" gate probe.py <<<payload
check "exit 0 when the project has no extension file" 0 $?

mkdir -p "$work/own/.claude/skills/repo-hooks"
cfg=$work/own/.claude/skills/repo-hooks/extension.json
printf '%s\n' '{"gate":{},"other":"text"}' >"$cfg"
check "python script gets --config and runs in the project" \
  "py --config $cfg $work/own payload" \
  "$(CLAUDE_PROJECT_DIR=$work/own "$run" gate probe.py <<<payload)"
check "shell script gets --config and extra arguments" \
  "sh --config $cfg x $work/own payload" \
  "$(CLAUDE_PROJECT_DIR=$work/own "$run" gate probe.sh x <<<payload)"
check "quiet when the file has no section for the hook" "" \
  "$(CLAUDE_PROJECT_DIR=$work/own "$run" missing probe.py <<<payload)"
check "quiet when the section is not an object" "" \
  "$(CLAUDE_PROJECT_DIR=$work/own "$run" other probe.py <<<payload)"

printf '%s\n' 'not json' >"$cfg"
check "quiet when the extension file is not JSON" "" \
  "$(CLAUDE_PROJECT_DIR=$work/own "$run" gate probe.py <<<payload)"

printf '%s\n' '{"gate":{}}' >"$cfg"
(cd "$work/own" && "$run" gate probe.py <<<payload >"$work/fallback.out")
check "the working directory stands in for CLAUDE_PROJECT_DIR" \
  "py --config $cfg $work/own payload" "$(cat "$work/fallback.out")"

mkdir -p "$work/vendored/.claude/att-docs/plugins/general" "$work/vendored/.claude/skills/repo-hooks"
cp -r "$work/plugin/hooks" "$work/vendored/.claude/att-docs/plugins/general/hooks"
printf '%s\n' '{"gate":{}}' >"$work/vendored/.claude/skills/repo-hooks/extension.json"
printf '%s\n' '{"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"bash .claude/att-docs/plugins/general/hooks/run.sh gate probe.py"}]}]}}' \
  >"$work/vendored/.claude/settings.json"
check "the plugin copy steps aside when the project registers its vendored copy" "" \
  "$(CLAUDE_PROJECT_DIR=$work/vendored "$run" gate probe.py <<<payload)"
check "the vendored copy runs" \
  "py --config $work/vendored/.claude/skills/repo-hooks/extension.json $work/vendored payload" \
  "$(CLAUDE_PROJECT_DIR=$work/vendored "$work/vendored/.claude/att-docs/plugins/general/hooks/run.sh" gate probe.py <<<payload)"

mkdir -p "$work/perm/.claude/skills/repo-hooks"
printf '%s\n' '{"gate":{}}' >"$work/perm/.claude/skills/repo-hooks/extension.json"
printf '%s\n' '{"permissions":{"allow":["Bash(bash plugins/general/hooks/run.sh *)"]}}' \
  >"$work/perm/.claude/settings.local.json"
check "a permission naming the runner is not a hook" "yes" \
  "$([[ $(CLAUDE_PROJECT_DIR=$work/perm "$run" gate probe.py <<<payload) == py* ]] && echo yes)"

printf '%s\n' 'import sys; sys.exit(3)' >"$work/plugin/hooks/fail.py"
CLAUDE_PROJECT_DIR=$work/own "$run" gate fail.py </dev/null
check "the script's exit code passes through" 3 $?

check "hooks.json names a section and script that exist" "" "$(
  jq -r '.hooks[][].hooks[].command' "$here/hooks.json" |
    sed -nE 's#.*run\.sh" ([A-Za-z]+) ([^ "]+).*#\1 \2#p' |
    while read -r section script; do
      [[ -f $here/$script ]] || echo "missing $script"
      [[ -n $section ]] || echo "no section for $script"
    done
)"
check "hooks.json registers four hooks" 4 \
  "$(jq -r '.hooks[][].hooks[].command' "$here/hooks.json" | grep -c 'run.sh')"

exit $fail
