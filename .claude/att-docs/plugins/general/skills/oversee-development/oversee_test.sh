#!/usr/bin/env bash
# Cases for oversee.sh. A stub gh reads issues and pull requests from files in the sandbox,
# and the queue and ledger live in a throwaway git repository, so nothing real is touched.
# usage: bash oversee_test.sh
set -uo pipefail

command -v jq > /dev/null || { echo "jq is required"; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT
mkdir -p "$SANDBOX/bin" "$SANDBOX/repo"
export PATH="$SANDBOX/bin:$PATH"
export FIXTURES="$SANDBOX/fixtures"
mkdir -p "$FIXTURES"

# gh stub: `issue list` and `pr list` read the fixture files, `issue view <n>` one issue, and
# `api` moves labels in a per-issue file. --jq is applied with jq, as gh does.
cat > "$SANDBOX/bin/gh" <<'STUB'
#!/usr/bin/env bash
jqx=.
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  [ "${args[i]}" = --jq ] && jqx=${args[i + 1]}
done
case "$1 $2" in
  "issue list") jq -r "$jqx" "$FIXTURES/issues.json" ;;
  "pr list") jq -r "$jqx" "$FIXTURES/prs.json" ;;
  "issue view") jq -c ".[] | select(.number == $3)" "$FIXTURES/issues.json" | jq -r "$jqx" ;;
  "api "*)
    method=GET; for a in "$@"; do [ "$a" = DELETE ] && method=DELETE; [ "$a" = POST ] && method=POST; done
    url=; for a in "$@"; do [[ $a == repos/* ]] && url=$a; done
    n=${url#*/issues/}; n=${n%%/*}
    f="$FIXTURES/labels-$n"; touch "$f"
    if [ "$method" = DELETE ]; then
      name=${url##*/labels/}; name=${name//%20/ }
      grep -vxF "$name" "$f" > "$f.new"; mv "$f.new" "$f"
    else
      for a in "$@"; do [[ $a == labels\[\]=* ]] && echo "${a#'labels[]='}" >> "$f"; done
      jq -Rn '[inputs | {name: .}]' < "$f" | jq -r "$jqx"
    fi ;;
esac
STUB
chmod +x "$SANDBOX/bin/gh"

git -C "$SANDBOX/repo" init -q
cd "$SANDBOX/repo" || exit 1
OS="$HERE/oversee.sh"
LEDGER="$SANDBOX/repo/.claude/oversee/ledger.tsv"
fails=0

check() {
  if [ "$1" = "$2" ]; then echo "ok   $3"; else
    echo "FAIL $3: got [$1], wanted [$2]"; fails=$((fails + 1)); fi
}
# usage: as <session> <pid> <args...>; runs oversee.sh as one conductor session.
as() { local s=$1 p=$2; shift 2; CLAUDE_CODE_SESSION_ID=$s CLAUDE_PID=$p bash "$OS" "$@"; }
first() { head -n 1 | cut -f1-2; }

echo '[
 {"number":5,"title":"voice: first","state":"OPEN","labels":[{"name":"enhancement"}]},
 {"number":6,"title":"voice: second","state":"OPEN","labels":[]},
 {"number":7,"title":"Install a thing","state":"OPEN","labels":[]},
 {"number":8,"title":"voice: waits","state":"OPEN","labels":[{"name":"Blocked"}]},
 {"number":9,"title":"att-docs: other area","state":"OPEN","labels":[{"name":"In Progress"}]},
 {"number":10,"title":"Tracking","state":"OPEN","labels":[{"name":"Tracker"}]}
]' > "$FIXTURES/issues.json"
echo '[]' > "$FIXTURES/prs.json"
LIVE=$$

# --- the queue
as A "$LIVE" init > /dev/null
check "$(cut -f1 "$SANDBOX/repo/.claude/oversee/queue.tsv" | tr '\n' ' ')" "5 6 7 " \
  "the queue holds the workable issues, oldest first, and drops excluded labels"
check "$(as A "$LIVE" next | first)" "NEXT	5" "next serves the oldest issue"
check "$(cut -f2 "$SANDBOX/repo/.claude/oversee/queue.tsv" | tr '\n' ' ')" "voice voice - " \
  "an area is the word before the colon in the title"

# --- two sessions
as A "$LIVE" start 5 feat/issue-5-first
check "$?" 0 "start records the issue"
as B "$LIVE" start 5 feat/issue-5-other 2> /dev/null
check "$?" 1 "a second session cannot start an issue held by a live one"
check "$(as A "$LIVE" next | first)" "INFLIGHT	5" "the holder is told to resume its issue"
out=$(as B "$LIVE" next)
check "$(grep -c '^ELSEWHERE	5' <<< "$out")" 1 "another session sees the issue as in flight elsewhere"
check "$(grep -c '^DEFER	6.*area held by issue 5' <<< "$out")" 1 "an issue in the same area is deferred"
check "$(grep -c '^NEXT	7' <<< "$out")" 1 "an issue with no area is served"

# --- finish and an open pull request
as A "$LIVE" finish 5 done 20 "ready"
echo '[{"number":20}]' > "$FIXTURES/prs.json"
out=$(as B "$LIVE" next)
check "$(grep -c '^DEFER	6.*area held by PR #20' <<< "$out")" 1 \
  "a finished issue's open pull request holds its area"
echo '[]' > "$FIXTURES/prs.json"
check "$(as B "$LIVE" next | first)" "NEXT	6" "the area is free once the pull request closes"

# --- a start that is no longer workable
echo '[{"number":6,"title":"voice: second","state":"OPEN","labels":[{"name":"Blocked"}]},
 {"number":7,"title":"Install a thing","state":"OPEN","labels":[]}]' > "$FIXTURES/issues.json"
as B "$LIVE" start 6 feat/issue-6-second 2> /dev/null
check "$?" 1 "start refuses an issue that picked up an excluded label"
check "$(tail -n 1 "$LEDGER" | cut -f2-3)" "6	skipped" "and records it as skipped"
check "$(as B "$LIVE" next | first)" "NEXT	7" "next passes over it"

# --- withdraw
as B "$LIVE" start 7 feat/issue-7-install
as B "$LIVE" withdraw 7
check "$(as B "$LIVE" next | first)" "NEXT	7" "a withdrawn start puts the issue back in the queue"
as A "$LIVE" withdraw 7 2> /dev/null
check "$?" 1 "withdraw refuses when the issue has no start row"

# --- an orphan
sleep 0 & DEAD=$!; wait "$DEAD"
as C "$DEAD" start 7 feat/issue-7-install
check "$(as A "$LIVE" next | first)" "INFLIGHT	7" "a start whose process has exited is served as an orphan"
check "$(as A "$LIVE" next | cut -f6)" "orphan" "and is marked orphan"
as A "$LIVE" adopt 7
check "$(as A "$LIVE" next | cut -f6)" "mine" "adopt makes the issue the session's own"

# --- label swap
printf 'In Progress\nenhancement\n' > "$FIXTURES/labels-7"
check "$(as A "$LIVE" swap 7 "In Progress" Blocked)" "enhancement,Blocked" \
  "swap moves a label and reads the labels back"
as A "$LIVE" finish 7 done - "ok"
check "$(as A "$LIVE" next | first)" "EMPTY" "next reports EMPTY when nothing is left"

if ((fails)); then echo "$fails failed"; exit 1; fi
echo "all passed"
