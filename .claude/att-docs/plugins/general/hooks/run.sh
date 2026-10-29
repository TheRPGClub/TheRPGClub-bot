#!/usr/bin/env bash
# usage: run.sh <section> <script> [args...] < <hook payload>
# Runs one repo-hooks script for a session in any repository. hooks.json calls it for
# every hook, so the plugin's hooks work at user scope without the repository carrying a
# hook entry of its own.
#
# The repository's extension file is .claude/skills/repo-hooks/extension.json and each
# hook reads one section of it, named by <section>. A repository without the file, or
# whose file has no such section, gets no hook: this exits 0 and prints nothing. The
# script runs with the repository root as its working directory and takes the file as
# --config.
#
# A repository that vendors this plugin registers the vendored run.sh in its own settings.
# A copy of run.sh anywhere else (the plugin installed at user scope) steps aside for such
# a repository, so a hook never fires twice.
here=$(dirname "$(readlink -f "$0")")
section=${1:?usage: run.sh <section> <script> [args...]}
script=${2:?usage: run.sh <section> <script> [args...]}
shift 2
project=${CLAUDE_PROJECT_DIR:-$PWD}

vendored=$project/.claude/att-docs/plugins/general/hooks
if [[ $here != "$(readlink -f "$vendored" 2>/dev/null)" ]]; then
  for settings in "$project/.claude/settings.json" "$project/.claude/settings.local.json"; do
    jq -e '[.hooks[]?[]?.hooks[]?.command // empty]
      | any(test("plugins/general/hooks/run\\.sh"))' "$settings" >/dev/null 2>&1 && exit 0
  done
fi

config=$project/.claude/skills/repo-hooks/extension.json
[[ -f $config ]] || exit 0
jq -e --arg s "$section" '.[$s] | type == "object"' "$config" >/dev/null 2>&1 || exit 0

cd "$project" || exit 0
case $script in
  *.sh) exec bash "$here/$script" --config "$config" "$@" ;;
  *) exec python3 "$here/$script" --config "$config" "$@" ;;
esac
