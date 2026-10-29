#!/usr/bin/env bash
# Queue and ledger state for the oversee-development skill.
#
# State lives in the main checkout, not in a worktree, so every worktree and
# every session reads the same files. The ledger is the source of truth: a
# session that dies mid-issue is resumed by reading it, not by remembering.
#
# usage:
#   oversee.sh init [label]                build the queue from open issues
#   oversee.sh refresh [label]             rebuild it for new issues, same label
#   oversee.sh next                        what to work, or why nothing is workable
#   oversee.sh start <issue> <branch>
#   oversee.sh adopt <issue>               claim an orphaned in-flight issue
#   oversee.sh withdraw <issue>            take back this session's own start
#   oversee.sh finish <issue> <done|stalled|skipped> <pr|-> <note...>
#   oversee.sh swap <issue> <from> <to>    move a label, read back
#   oversee.sh status                      counts and the tail of the ledger
set -euo pipefail

COMMON=$(git rev-parse --git-common-dir)
MAIN=$(cd "$COMMON/.." && pwd)
DIR="$MAIN/.claude/oversee"
QUEUE="$DIR/queue.tsv"
LEDGER="$DIR/ledger.tsv"
FILTER="$DIR/filter"
OPEN="$DIR/open"

mkdir -p "$DIR"
[ -f "$LEDGER" ] || : > "$LEDGER"
[ -f "$QUEUE" ] || : > "$QUEUE"
[ -f "$OPEN" ] || : > "$OPEN"

# Labels that mean the issue is not available for unattended work: already
# claimed, waiting on something outside the branch, already delivered, a
# tracker rather than work, a reference copy, or declined.
EXCLUDED='["In Progress","Blocked","Tracker","Already Done","DO NOT MERGE",'
EXCLUDED+='"question","wontfix","duplicate","invalid"]'

die() { echo "$*" >&2; exit 1; }

# Holds the ledger for the rest of this process, so a command that reads the
# ledger and then appends to it cannot interleave with another session doing
# the same. The lock goes with the process.
lock_ledger() {
  exec 9>"$LEDGER.lock"
  flock -w 30 9 || die "the ledger is locked by another session; try again"
}

# The latest row for an issue, whole, or nothing.
latest_row() {
  awk -F'\t' -v i="$1" '$2==i {r=$0} END {if (r != "") print r}' "$LEDGER"
}

# The session id and process id an owner tag names, as "<sid> <pid>", with "-"
# for a part the tag lacks so the pair always reads back in order.
tag_owner() {
  local sid=- pid=-
  [[ $1 =~ session\ ([^ ]+) ]] && sid=${BASH_REMATCH[1]}
  [[ $1 =~ pid\ ([0-9]+) ]] && pid=${BASH_REMATCH[1]}
  printf '%s %s' "$sid" "$pid"
}

# The session that owns an in-flight issue. The id survives a worktree switch,
# and the process id says whether that session is still running.
SESSION=${CLAUDE_CODE_SESSION_ID:-}
owner_tag() {
  [ -n "$SESSION" ] || return 0
  printf 'session %s pid %s' "$SESSION" "${CLAUDE_PID:-}"
}

# One ledger row. Tabs and newlines in the note would corrupt the file, so the
# note is flattened before it is written.
row() {
  local issue=$1 status=$2 branch=$3 pr=$4
  shift 4
  local note
  note=$(printf '%s' "$*" | tr '\t\n' '  ')
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$issue" "$status" \
    "${branch:--}" "${pr:--}" "${note:--}" >> "$LEDGER"
}

cmd_init() {
  local label="${1:-}"
  if [ -s "$QUEUE" ] && [ "${OVERSEE_FORCE:-}" != 1 ]; then
    die "queue already has $(wc -l < "$QUEUE") entries; OVERSEE_FORCE=1 to rebuild"
  fi

  local want
  want=$(jq -n --arg s "$label" '$s')

  # A title that opens with `<area>:` names the plugin folder or part of the
  # repository the issue touches, so the area is readable from the title alone.
  # That is what keeps two sessions off the same files without opening any
  # issue body. The fourth column flags an issue carrying an excluded label, and
  # the fifth an issue carrying the label the queue was built for. The read
  # covers every open issue, so next can tell whether the issue a skipped row
  # waited on is still open. A failed read leaves the queue as it was rather
  # than writing an empty one.
  local listed
  listed=$(gh issue list --state open --limit 1000 --json number,title,labels --jq '
    .[]
    | . as $i
    | ([$i.labels[].name] | any(. as $n | '"$EXCLUDED"' | index($n))) as $out
    | ('"$want"' as $w | $w == "" or ([$i.labels[].name] | index($w)) != null) as $in
    | ($i.title | if test("^[A-Za-z][A-Za-z0-9_-]{0,19}\\s*:")
                  then capture("^(?<area>[A-Za-z][A-Za-z0-9_-]{0,19})\\s*:").area | ascii_downcase
                  else "-" end) as $area
    | [$i.number, $area, $i.title,
       (if $out then 1 else 0 end), (if $in then 1 else 0 end)]
    | @tsv') || return 1

  printf '%s\n' "$listed" | awk -F'\t' 'NF { print $1 }' > "$OPEN.tmp.$$"
  mv "$OPEN.tmp.$$" "$OPEN"

  # An excluded issue the ledger already names stays in the queue, flag and
  # all. In Progress drops every issue a session holds, and next finds held
  # areas and in-flight rows only through queue rows.
  printf '%s\n' "$listed" |
  awk -F'\t' -v OFS='\t' -v ledger="$LEDGER" '
    FILENAME == ledger { known[$2]=1; next }
    NF && $5 && (!$4 || known[$1]) { print $1, $2, $3, $4 }' "$LEDGER" - |
  # Oldest issue first, so an issue lands before the later ones that build on
  # it. Two issues in one area never run together: next defers the second
  # until the first one's pull request merges.
  sort -t$'\t' -k1,1n > "$QUEUE.tmp.$$"

  mv "$QUEUE.tmp.$$" "$QUEUE"
  printf '%s\n' "$label" > "$FILTER"
  echo "queued $(wc -l < "$QUEUE") issues -> $QUEUE"
}

# A rebuild scoped to the label the queue was built with, unless one is given.
cmd_refresh() {
  local label="${1:-}"
  [ -n "$label" ] || [ ! -f "$FILTER" ] || label=$(cat "$FILTER")
  OVERSEE_FORCE=1 cmd_init "$label"
}

cmd_next() {
  # Every call reads the live backlog first, so an issue filed, relabeled or
  # unblocked since the last call is served now. When a read fails, next
  # serves from the last queue, says so, and serves no skip again, since stale
  # lists cannot say a blocker has closed.
  local open_prs stale=0
  if ! cmd_refresh > /dev/null; then
    stale=1
    echo "next: the backlog read failed; serving the last queue" >&2
  fi
  open_prs=$(gh pr list --state open --limit 200 --json number --jq '.[].number') ||
    stale=1
  open_prs=$(printf '%s' "$open_prs" | tr '\n' ' ')

  # The ledger is matched by name rather than by FNR==NR: on the first run it is
  # empty, and an empty first file makes FNR==NR true for every queue row.
  awk -F'\t' -v open_prs=" $open_prs " -v ledger="$LEDGER" -v openf="$OPEN" \
    -v me="$SESSION" -v stale="$stale" '
    # A skipped row is served again once what stopped it has cleared. A start
    # refused on a label or a closed state has cleared when the queue row is
    # open and carries no excluded label. Any other skip has cleared when every
    # issue or pull request its note names is closed. A name is a number of
    # two to four digits other than the issue itself, so run and process ids
    # are not read as blockers. A skip whose note names nothing stays skipped,
    # and so does every skip when a read failed.
    function cleared(n,   t, m, refs) {
      if (stale) return 0
      if (note[n] ~ /^not workable at start:/) return 1
      t = note[n]
      refs = 0
      while (match(t, /[0-9]+/)) {
        m = substr(t, RSTART, RLENGTH)
        t = substr(t, RSTART + RLENGTH)
        if (length(m) < 2 || length(m) > 4 || m == n) continue
        refs++
        if ((m in open) || index(open_prs, " " m " ") > 0) return 0
      }
      return refs > 0
    }
    FILENAME == openf { open[$1]=1; next }
    FILENAME == ledger { status[$2]=$3; branch[$2]=$4; pr[$2]=$5; note[$2]=$6; next }
    {
      line[FNR]=$1 "\t" $2 "\t" $3; num[FNR]=$1; area[FNR]=$2
      excluded[FNR]=($4 == 1); total=FNR
    }
    END {
      # Each session works one issue at a time; other sessions hold their own.
      # An in-flight row is mine when it carries my session id, orphaned when
      # its owner process has exited, and live elsewhere otherwise. A row with
      # no owner predates the tags and counts as live elsewhere.
      for (i=1; i<=total; i++) {
        n = num[i]
        if (status[n] != "start") continue
        sid = ""; pid = ""
        if (match(note[n], /session [^ ]+/)) sid = substr(note[n], RSTART + 8, RLENGTH - 8)
        if (match(note[n], /pid [0-9]+/)) pid = substr(note[n], RSTART + 4, RLENGTH - 4)
        if (sid != "" && sid == me) owner[n] = "mine"
        else if (pid != "" && system("ps -p " pid " >/dev/null") != 0) owner[n] = "orphan"
        else owner[n] = "elsewhere"
      }

      # My own unfinished start row outranks everything: resume it, never
      # restart it. An orphaned one comes next, for any session to adopt.
      for (pass = 1; pass <= 2; pass++)
        for (i=1; i<=total; i++) {
          n = num[i]
          if (owner[n] == (pass == 1 ? "mine" : "orphan")) {
            print "INFLIGHT\t" line[i] "\tbranch " branch[n] "\t" owner[n]
            exit
          }
        }

      # A finished issue whose pull request is still open still owns its area,
      # and so does an issue in flight in another session.
      for (i=1; i<=total; i++) {
        n = num[i]
        if (status[n] == "done" && pr[n] != "-" && index(open_prs, " " pr[n] " ") > 0)
          held[area[i]] = "PR #" pr[n]
        if (owner[n] == "elsewhere") {
          print "ELSEWHERE\t" line[i] "\tbranch " branch[n]
          busy++
          if (area[i] != "-") held[area[i]] = "issue " n " in another session"
        }
      }

      for (i=1; i<=total; i++) {
        # A withdrawn start leaves the issue as unworked as no row at all, and
        # so does a skip that has cleared.
        n = num[i]
        s = status[n]
        if (s == "skipped" && !excluded[i] && cleared(n)) s = ""
        if (s != "" && s != "withdrawn") continue
        if (area[i] != "-" && area[i] in held) {
          print "DEFER\t" line[i] "\tarea held by " held[area[i]]
          deferred++
          continue
        }
        print "NEXT\t" line[i]
        exit
      }
      print ((deferred || busy) ? "BLOCKED" : "EMPTY")
    }' "$OPEN" "$LEDGER" <(sort -t$'\t' -k1,1n "$QUEUE")
}

# The queue is a snapshot from init, and labels move after it: another session
# claims an issue, or the user blocks or closes one. So the labels are read
# again here. An issue no longer workable gets a skipped row, which next passes
# over, and start fails so the caller asks next again.
cmd_start() {
  local issue=$1 branch=$2 why
  why=$(gh issue view "$issue" --json state,labels --jq '
    [.labels[].name] as $have
    | ('"$EXCLUDED"' | map(select(. as $n | $have | index($n)))) as $hit
    | if .state != "OPEN" then "state \(.state)"
      elif ($hit | length) > 0 then "labeled \($hit | join(", "))"
      else "" end')

  # The holder check comes first: a holder's own In Progress label must not
  # turn its start row into a skipped one.
  lock_ledger
  refuse_if_held "$issue"
  if [ -n "$why" ]; then
    row "$issue" skipped - - "not workable at start: $why"
    die "issue $issue is not workable ($why); recorded as skipped, run next again"
  fi
  row "$issue" start "$branch" - "$(owner_tag)"
}

# Two sessions can both read NEXT for one issue and both call start. The second
# one finds the first one's row here, under the lock, and stands down. A row
# whose owner process has exited is an orphan, which adopt claims rather than
# start, and a row with no owner tag predates the tags and holds nothing. A row
# naming a session but no process counts as live, the same as next reads it.
refuse_if_held() {
  local issue=$1 last status note sid pid
  last=$(latest_row "$issue")
  [ -n "$last" ] || return 0
  status=$(cut -f3 <<< "$last")
  note=$(cut -f6 <<< "$last")
  [ "$status" = start ] || return 0
  read -r sid pid <<< "$(tag_owner "$note")"
  [ "$sid" != - ] && [ "$sid" != "$SESSION" ] || return 0
  [ "$pid" = - ] || ps -p "$pid" > /dev/null || return 0
  die "issue $issue is held by session $sid (pid $pid); run next again"
}

# Claims an orphaned in-flight issue for this session. Its labels are not read
# again: the dead worker left `In Progress` on it, and that label is this
# session's claim now.
cmd_adopt() {
  local issue=$1 branch
  lock_ledger
  branch=$(awk -F'\t' -v i="$issue" '$2==i {s=$3; b=$4} END {if (s == "start") print b}' "$LEDGER")
  [ -n "$branch" ] || die "issue $issue is not in flight; nothing to adopt"
  row "$issue" start "$branch" - "$(owner_tag) adopted"
}

# Takes back a start this session wrote, when the session cannot work the
# issue after all, without recording anything about the issue itself. The row
# before the start comes back as it was, owner included, or the issue goes back
# to the queue when the start was its first row.
cmd_withdraw() {
  local issue=$1 last prev sid st branch pr note
  lock_ledger
  last=$(latest_row "$issue")
  [ "$(cut -f3 <<< "$last")" = start ] || die "issue $issue has no start row to withdraw"
  read -r sid _ <<< "$(tag_owner "$(cut -f6 <<< "$last")")"
  [ -n "$SESSION" ] && [ "$sid" = "$SESSION" ] ||
    die "issue $issue was started by session $sid, not this one"
  prev=$(awk -F'\t' -v i="$issue" '$2==i {p=r; r=$0} END {if (p != "") print p}' "$LEDGER")
  if [ -z "$prev" ]; then
    row "$issue" withdrawn - - "$(owner_tag)"
    return
  fi
  IFS=$'\t' read -r _ _ st branch pr note <<< "$prev"
  row "$issue" "$st" "$branch" "$pr" "$note"
}

# Moves a label on an issue through the REST endpoints, since `gh issue edit`
# fails here on the classic projects lookup, and reads the labels back. The
# new label must already exist in the repository; it is never created.
cmd_swap() {
  local issue=$1 from=$2 to=$3 have
  gh api -X DELETE "repos/{owner}/{repo}/issues/$issue/labels/${from// /%20}" > /dev/null ||
    true
  have=$(gh api -X POST "repos/{owner}/{repo}/issues/$issue/labels" -f "labels[]=$to" \
    --jq '[.[].name] | join(",")')
  case ",$have," in
    *",$to,"*) ;;
    *) die "label $to did not land on issue $issue (has: $have)" ;;
  esac
  case ",$have," in
    *",$from,"*) die "label $from is still on issue $issue (has: $have)" ;;
  esac
  echo "$have"
}

cmd_status() {
  awk -F'\t' '
    { status[$2]=$3 }
    END { for (i in status) n[status[i]]++
          printf "done %d  stalled %d  skipped %d  in-flight %d\n",
                 n["done"], n["stalled"], n["skipped"], n["start"] }' "$LEDGER"
  echo "queued $(wc -l < "$QUEUE") total"
  tail -n 8 "$LEDGER"
}

case "${1:-}" in
  init)   shift; cmd_init "$@" ;;
  refresh) shift; cmd_refresh "$@" ;;
  next)   cmd_next ;;
  start)  [ $# -ge 3 ] || die "usage: oversee.sh start <issue> <branch>"
          cmd_start "$2" "$3" ;;
  adopt)  [ $# -ge 2 ] || die "usage: oversee.sh adopt <issue>"
          cmd_adopt "$2" ;;
  withdraw) [ $# -ge 2 ] || die "usage: oversee.sh withdraw <issue>"
          cmd_withdraw "$2" ;;
  swap)   [ $# -ge 4 ] || die "usage: oversee.sh swap <issue> <from> <to>"
          cmd_swap "$2" "$3" "$4" ;;
  finish) [ $# -ge 4 ] || die "usage: oversee.sh finish <issue> <status> <pr|-> <note>"
          issue=$2 st=$3 pr=$4; shift 4
          lock_ledger
          # Carry the branch from this issue's start row: a stalled issue is
          # picked up again later, and its branch is the only way back to it.
          branch=$(awk -F'\t' -v i="$issue" '$2==i && $4!="-" {b=$4} END {print (b?b:"-")}' \
                   "$LEDGER")
          row "$issue" "$st" "$branch" "$pr" "$@" ;;
  status) cmd_status ;;
  *)      die "usage: oversee.sh" \
              "init|refresh|next|start|adopt|withdraw|swap|finish|status" ;;
esac
