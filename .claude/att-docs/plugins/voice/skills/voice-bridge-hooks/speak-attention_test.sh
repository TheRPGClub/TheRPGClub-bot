#!/usr/bin/env bash
# Cases for the Stop path of speak-attention.sh. A stub spd-say records what it would say,
# and each case writes a small transcript, so nothing is spoken.
# usage: bash speak-attention_test.sh
set -uo pipefail

for bin in jq python3; do
  command -v "$bin" > /dev/null || { echo "$bin is required"; exit 1; }
done

HERE="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$HERE/test-config.json"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

# The hook takes Piper from HOME's pipx install alone, so HOME is the sandbox's.
export HOME="$SANDBOX/home"
mkdir -p "$SANDBOX/bin" "$HOME/.local/bin"
# The stub lists no output modules for -O and appends the spoken text to SPOKEN.
printf '%s\n' '#!/bin/sh' '[ "$1" = -O ] && exit 0' \
  'for a in "$@"; do last=$a; done' 'echo "$last" >> "$SPOKEN"' > "$SANDBOX/bin/spd-say"
# The piper stub writes its input to the -f file, or fails when PIPER_FAIL is set, and
# the pw-play stub appends that file to SPOKEN behind a "piper: " mark. A piper on PATH
# speaks as "path piper: ", which no case expects.
printf '%s\n' '#!/bin/sh' 'echo "$*" >> "${PIPER_ARGS:-/dev/null}"' \
  '[ -n "$PIPER_FAIL" ] && exit 1' \
  'while [ $# -gt 0 ] && [ "$1" != -f ]; do shift; done' 'cat > "$2"' \
  > "$HOME/.local/bin/piper"
printf '%s\n' '#!/bin/sh' 'while [ $# -gt 0 ] && [ "$1" != -f ]; do shift; done' \
  'printf "path " > "$2"' > "$SANDBOX/bin/piper"
printf '%s\n' '#!/bin/sh' 'for a in "$@"; do last=$a; done' \
  'printf "piper: %s" "$(cat "$last")" >> "$SPOKEN"' > "$SANDBOX/bin/pw-play"
chmod +x "$SANDBOX/bin/spd-say" "$SANDBOX/bin/piper" "$SANDBOX/bin/pw-play" \
  "$HOME/.local/bin/piper"
export PATH="$SANDBOX/bin:$PATH"
# Cases speak through Speech Dispatcher unless they name a model that exists.
export SPEAK_PIPER_MODEL="$SANDBOX/none.onnx"
export SPOKEN="$SANDBOX/spoken"
export XDG_RUNTIME_DIR="$SANDBOX/run"
# A Stop in speech mode waits for a reply row the transcript lacks; cases do not wait.
export STOP_WAIT=0
TRANSCRIPT="$SANDBOX/session.jsonl"
OWED="$XDG_RUNTIME_DIR/speak-attention/s1.owed"
: > "$TRANSCRIPT"

fails=0

# usage: check <got> <wanted> <case>
check() {
  if [ "$1" = "$2" ]; then
    echo "ok   $3"
  else
    echo "FAIL $3: got [$1], wanted [$2]"
    fails=$((fails + 1))
  fi
}

# usage: row <json>; appends one transcript row.
row() { printf '%s\n' "$1" >> "$TRANSCRIPT"; }

# usage: prompt <origin kind> <text> [seconds from now]; the row carries a timestamp only
# when it is given one.
prompt() {
  local at=
  [[ -n "${3:-}" ]] && at=$(date -u -d "$3 seconds" +%Y-%m-%dT%H:%M:%S.%3NZ)
  row "$(jq -cn --arg k "$1" --arg t "$2" --arg at "$at" \
    '{type:"user", origin:{kind:$k}, message:{role:"user", content:$t}}
      + (if $at == "" then {} else {timestamp:$at} end)')"
}

# usage: result <toolUseResult json>; appends a tool result row carrying it.
result() {
  row "$(jq -cn --argjson r "$1" '{type:"user", timestamp:"2026-10-19T13:00:00.000Z",
    toolUseResult:$r, message:{role:"user", content:[{type:"tool_result", content:""}]}}')"
}

# A persistent Monitor stays due to wake the session until it is stopped.
monitor() { result '{"taskId":"m1","persistent":true}'; }
stopped() { result '{"message":"Successfully stopped task: m1","task_id":"m1"}'; }

# usage: stop <reply> [unwritten]; writes the reply row unless told the transcript lags the
# hook, runs the Stop hook and prints what it said, or nothing.
stop() {
  : > "$SPOKEN"
  [[ -n "${2:-}" ]] ||
    row "$(jq -cn --arg r "$1" '{type:"assistant", message:{role:"assistant", content:$r}}')"
  jq -cn --arg t "$TRANSCRIPT" --arg r "$1" \
    '{hook_event_name:"Stop", session_id:"s1", transcript_path:$t,
      last_assistant_message:$r, cwd:"/x/demo"}' | "$HERE/speak-attention.sh" --config "$CONFIG"
  cat "$SPOKEN"
}

prompt human "run the suite"
check "$(stop 'Done.')" "demo session finished" "a user turn says finished"

prompt task-notification "<task-notification>x</task-notification>"
check "$(stop 'Merged.')" "" "an event turn with nothing owed is quiet"

prompt human "watch the run"
monitor
check "$(stop 'Watching.')" "" "a stop held by background work is quiet"
check "$([ -e "$OWED" ] && echo owed)" "owed" "the held stop owes an announcement"

prompt task-notification "<task-notification>x</task-notification>"
stopped
check "$(stop 'The run is green.')" "demo session finished" "the next quiet stop pays the debt"
check "$([ -e "$OWED" ] && echo owed)" "" "paying the debt clears it"

prompt task-notification "<task-notification>y</task-notification>"
check "$(stop 'Still green.')" "" "a later event turn is quiet again"

prompt peer "report"
check "$(stop 'Should I merge it?')" "demo session is waiting for you" "a question waits"

prompt peer "report" -3
check "$(stop 'Merge it now?' unwritten)" "demo session is waiting for you" \
  "a question waits before its reply row is written"
row '{"type":"assistant","message":{"role":"assistant","content":"Merge it now?"}}'

prompt human "start the sweep"
monitor
check "$(stop 'Which suite first?')" "" "a question held by background work is quiet"
prompt task-notification "<task-notification>z</task-notification>"
stopped
check "$(stop 'Sweep is running.')" "demo session is waiting for you" "the held question is repaid"

# An event the app delivers once the hook has started opens the next turn, so an owed
# announcement waits for that turn's stop.
prompt task-notification "<task-notification>v</task-notification>" -3
row '{"type":"assistant","message":{"role":"assistant","content":"Done."}}'
prompt task-notification "<task-notification>w</task-notification>" 5
mkdir -p "${OWED%/*}" && printf 'finished' > "$OWED"
check "$(stop 'Done.' unwritten)" "" "an event delivered after the stop is quiet"
check "$([ -e "$OWED" ] && echo owed)" "owed" "the owed announcement waits for that turn"
rm -f "$OWED"
: > "$TRANSCRIPT"

# usage: label <stdout>; runs the PostToolUse hook for a label add with that output.
label() {
  : > "$SPOKEN"
  printf '%s' "$1" > "$SANDBOX/stdout"
  jq -cn --rawfile o "$SANDBOX/stdout" '{hook_event_name:"PostToolUse", tool_name:"Bash",
    session_id:"s1", cwd:"/x/demo",
    tool_input:{command:"gh pr edit 12 --add-label \"Awaiting Final Review\""},
    tool_response:{stdout:$o}}' | "$HERE/speak-attention.sh" --config "$CONFIG"
  cat "$SPOKEN"
}

check "$(label 'https://github.com/o/r/pull/12')" \
  "demo session has pull request 12 awaiting final review" "a label add that went through speaks"
check "$(label '')" "" "a label add with no output is quiet"
big="$(head -c 200000 /dev/zero | tr '\0' x) https://github.com/o/r/pull/12"
check "$(label "$big")" \
  "demo session has pull request 12 awaiting final review" "a label add with long output speaks"

: > "$SANDBOX/voice.onnx"
prompt human "run the suite"
check "$(SPEAK_PIPER_MODEL="$SANDBOX/voice.onnx" stop 'Done.')" "piper: demo session finished" \
  "Piper speaks when its model is installed"
prompt human "run the suite"
check "$(PIPER_FAIL=1 SPEAK_PIPER_MODEL="$SANDBOX/voice.onnx" stop 'Done.')" \
  "demo session finished" "Speech Dispatcher speaks when Piper fails"
check "$(ls "$XDG_RUNTIME_DIR/speak-attention" | grep -c wav)" "0" "no clip is left behind"

# Piper options come from settings.json and are passed only when set
export PIPER_ARGS="$SANDBOX/piper-args"
settings="$XDG_RUNTIME_DIR/speak-attention/settings.json"
prompt human "run the suite"; : > "$PIPER_ARGS"
SPEAK_PIPER_MODEL="$SANDBOX/voice.onnx" stop 'Done.' > /dev/null
check "$(grep -cE -- '--(speaker|noise-scale|noise-w-scale|sentence-silence)' "$PIPER_ARGS")" 0 \
  "Piper options that are not set are left out"
echo '{"speaker":3,"noise":0.4,"noise_w":0.5,"silence":0.2}' > "$settings"
prompt human "run the suite"; : > "$PIPER_ARGS"
SPEAK_PIPER_MODEL="$SANDBOX/voice.onnx" stop 'Done.' > /dev/null
for opt in '--speaker 3' '--noise-scale 0.4' '--noise-w-scale 0.5' '--sentence-silence 0.2'; do
  check "$(grep -c -- "$opt" "$PIPER_ARGS")" 1 "Piper gets $opt when it is set"
done
echo '{"speaker":0}' > "$settings"
prompt human "run the suite"; : > "$PIPER_ARGS"
SPEAK_PIPER_MODEL="$SANDBOX/voice.onnx" stop 'Done.' > /dev/null
check "$(grep -c -- '--speaker 0' "$PIPER_ARGS")" 1 "speaker 0 is passed, not mistaken for unset"
check "$(grep -c -- '--noise-scale' "$PIPER_ARGS")" 0 "the options still unset stay out"
rm -f "$settings"; unset PIPER_ARGS

# usage: ask <question> [cwd]; runs the PreToolUse hook for an AskUserQuestion call.
ask() {
  : > "$SPOKEN"
  jq -cn --arg q "$1" --arg c "${2:-/x/demo}" '{hook_event_name:"PreToolUse",
    tool_name:"AskUserQuestion", session_id:"s1", cwd:$c,
    tool_input:{questions:[{question:$q}]}}' |
    "$HERE/speak-attention.sh" --config "$CONFIG"
  cat "$SPOKEN"
}

row '{"type":"custom-title","customTitle":"Voice Session"}'
check "$(stop 'Done?')" "Voice session is waiting for you" \
  "a title ending in session says it once"
row '{"type":"custom-title","customTitle":"session "}'
check "$(stop 'Done?')" "session is waiting for you" "a bare session title says it once"
row '{"type":"custom-title","customTitle":"[UI] copy note"}'
check "$(stop 'Done?')" "U I copy note session is waiting for you" \
  "a session title says the spoken terms as configured"
: > "$TRANSCRIPT"
check "$(ask q /x/voice-session)" "voice session has a question" \
  "a folder name ending in -session says it once"
check "$(ask 'Which suite first?')" "demo session has a question" \
  "a question is announced, not read aloud"

# usage: typed <prompt>; runs the UserPromptSubmit hook for that prompt.
typed() {
  jq -cn --arg p "$1" --arg t "$TRANSCRIPT" '{hook_event_name:"UserPromptSubmit",
    session_id:"s1", prompt:$p, transcript_path:$t, cwd:"/x/demo"}' |
    "$HERE/speak-attention.sh" --config "$CONFIG"
}

# usage: skill <name> <args>; runs the PostToolUse hook for a Skill call.
skill() {
  jq -cn --arg s "$1" --arg a "$2" --arg t "$TRANSCRIPT" '{hook_event_name:"PostToolUse",
    tool_name:"Skill", session_id:"s1", transcript_path:$t, cwd:"/x/demo",
    tool_input:{skill:$s, args:$a}}' |
    "$HERE/speak-attention.sh" --config "$CONFIG"
}

: > "$TRANSCRIPT"
reply='## Status

Run [4638](https://github.com/o/r/issues/4638) is **green** at https://x.test/run.
See [`speak-attention.sh`](scripts/speak-attention.sh:90), [Worker](#local_1),
[o/r#12](https://github.com/o/r/pull/12), [Node.js](https://nodejs.org) and <https://x.test>.

| Spec | Result |
|------|--------|
| `a.spec.ts` | pass |

```bash
gh run list
```'
prompt human "run the suite"
check "$(stop 'Done.')" "demo session finished" "speech mode starts off"
typed "/implement-with-speech 4638"
prompt human "run the suite"
said="demo session says: Status Run is green at the following link."
said+=" See, Worker, 12, Node.js and the following link."
check "$(stop "$reply")" "$said Spec Result a.spec.ts pass" \
  "/implement-with-speech reads the reply as plain text"
prompt human "time it"
said="demo session says: Took 7.0 seconds, the 30 seconds cap, 5 minutes, 2 hours,"
said+=" 1 hour 30 minutes and 1 minute; 3e4s, 10ms, option 1 m, the 1990s"
said+=", 1000s of rows and 3m rows stay; 5 minutes is fine after 30 seconds of idle."
spoken='Took 7.0s, the 30s cap, 5 min, 2 hrs, 1h30m and 1m; 3e4s, 10ms, option 1 m,'
spoken+=' the 1990s, 1000s of rows and 3m rows stay; 5m is fine after 30s of idle.'
check "$(stop "$spoken")" "$said" \
  "speech mode reads durations with their units spelled out"
prompt human "report the runs"
said="demo session says: U I passed, see the job; sequel and U I wait on the sign-ins;"
said+=" run red, run green; ui.chromium, passed 19 of 19 and each run"
said+=" 2 minutes apart stay."
spoken='[UI passed](https://github.com/o/r/actions/runs/39694/job/1195), see the'
spoken+=' [job 39694323023](https://github.com/o/r/actions/runs/39694323023/job/1); SQL and'
spoken+=' UI wait on the sign-ins; run 39694323023-1 red,'
spoken+=' run 4638 green https://github.com/o/r/actions/runs/4638; ui.chromium,'
spoken+=' [passed 19 of 19](https://github.com/o/r/actions/runs/1/job/2) and each run'
spoken+=' 2 min apart stay.'
check "$(stop "$spoken")" "$said" \
  "speech mode says the spoken terms and drops run links and ids"
prompt human "watch the run"
monitor
check "$(stop 'Watching.')" "demo session says: Watching." \
  "speech mode reads a reply held by background work"
stopped
skill implement "4638"
check "$(stop 'Working.')" "demo session says: Working." \
  "the Skill call to implement it hands off to leaves it on"
typed "please /implement the next one"
check "$(stop 'Next.')" "demo session says: Next." \
  "a prompt not opening with /implement leaves it on"
check "$(label 'https://github.com/o/r/pull/12')" "" "speech mode leaves the label to the reply"
typed "/implement 4639"
check "$(stop 'Done.')" "demo session finished" "a typed /implement turns it off"
skill implement-with-speech "214"
check "$(stop 'Started.')" "demo session says: Started." "a Skill call to it turns it on"
typed "<command-message>implement</command-message>
<command-name>/implement</command-name>
<command-args>214</command-args>"
check "$(stop 'Done.')" "demo session finished" "an expanded /implement turns it off"
typed "<command-name>/implement-with-speech</command-name>"
check "$(stop 'On.')" "demo session says: On." "an expanded /implement-with-speech turns it on"
prompt human "show the command"
check "$(stop '```bash
gh run list
```')" "" "a reply that is only code is quiet"
check "$(ask 'Which suite first?')" "" "speech mode drops the has-a-question announcement"
typed "/implement-with-speechless 1"
check "$(stop 'Still.')" "demo session says: Still." "another command leaves the mode alone"

# usage: text <text>; appends an assistant row holding one text block, as the app writes
# a block ahead of the tool call that follows it.
text() {
  row "$(jq -cn --arg t "$1" '{type:"assistant",
    message:{role:"assistant", content:[{type:"text", text:$t}]}}')"
}

# usage: call [tool] [tool use id]; runs the PreToolUse hook for a tool call and prints
# what it said.
call() {
  : > "$SPOKEN"
  jq -cn --arg t "$TRANSCRIPT" --arg n "${1:-Bash}" --arg i "${2:-}" '{
    hook_event_name:"PreToolUse", tool_name:$n, session_id:"s1", transcript_path:$t,
    cwd:"/x/demo"} + (if $i == "" then {} else {tool_use_id:$i} end)' |
    "$HERE/speak-attention.sh" --config "$CONFIG"
  cat "$SPOKEN"
}

prompt human "run the sweep"
text "Cutting the branch now."
row '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use"}]}}'
check "$(call)" "demo session says: Cutting the branch now." \
  "text ahead of a tool call is read when the call starts"
check "$(call Read)" "" "a second call in the same message reads nothing again"
result '{}'
text "Dispatching **39** specs."
check "$(call)" "Dispatching 39 specs." "a later block is read without the name"
check "$(call)" "" "a call with no new text is quiet"
# The session moves its transcript when it enters a worktree, while a hook that began
# before the move still holds the old path.
check "$(TRANSCRIPT="$SANDBOX/moved/session.jsonl" call)" "" \
  "a call on a transcript that moved reads nothing"
check "$(TRANSCRIPT="$SANDBOX/moved/session.jsonl" stop 'Closing.' unwritten)" \
  "demo session says: Closing." "a stop on a transcript that moved still speaks its message"
text "Entered the worktree."
check "$(call)" "Entered the worktree." \
  "the next call on the new path reads only the block after the move"
text "The sweep is running."
check "$(stop 'The sweep is running.' unwritten)" "The sweep is running." \
  "the stop reads only the block no call has read"
prompt human "status?"
check "$(stop 'Half done.' unwritten)" "demo session says: Half done." \
  "the stop reads a reply the transcript has not written yet"
text "Half done."
check "$(call)" "" "the reply row written after the stop is not read twice"
prompt human "summarize"
text "Part one."
text "Part two."
check "$(stop 'Part one.

Part two.' unwritten)" "demo session says: Part one.
Part two." "a written reply of several blocks is read once"
prompt human "again"
text "Done."
result '{}'
check "$(stop 'Done.' unwritten)" "demo session says: Done.
Done." "a reply that repeats the block before it is still read"
prompt human "one more"
result '{}'
( sleep 1; text "Landed late." ) &
check "$(STOP_WAIT=5 stop 'Landed late.' unwritten)" "demo session says: Landed late." \
  "the stop waits for a reply the app writes late"
wait
prompt human "think first"
row '{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking"}]}}'
check "$(stop 'Thought it through.' unwritten)" "demo session says: Thought it through." \
  "a thinking row on disk does not stand in for the reply"
prompt human "run it"
text "First."
text "Second."
check "$(call)" "demo session says: First.
Second." "blocks that land together are read in order"
check "$([ -s "$XDG_RUNTIME_DIR/speak-attention/s1.queue" ] && echo queued)" "" \
  "nothing is left on the queue"
( sleep 1; text "Written late."
  row '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu_9"}]}}' ) &
check "$(call Bash tu_9)" "Written late." "the call waits for a batch the app writes late"
wait
mkdir -p "$XDG_RUNTIME_DIR/speak-attention" && printf 'Queued earlier.\n' > \
  "$XDG_RUNTIME_DIR/speak-attention/s1.queue"
text "Next."
check "$(call)" "Queued earlier.
Next." "a block waiting on the queue is read before a newer one"
prompt human "pick one"
text "Two ways to go."
row "$(jq -cn '{type:"assistant", message:{role:"assistant", content:[{type:"tool_use",
  id:"tu_q", name:"AskUserQuestion", input:{questions:[{question:"Which fix first?",
  options:[{label:"Fix 1"}, {label:"Fix 2"}, {label:"Neither"}]}]}}]}}')"
check "$(call AskUserQuestion tu_q)" "demo session says: Two ways to go.
Question: Which fix first? Options: Fix 1, Fix 2, or Neither." \
  "a question call is read with its options after the text ahead of it"
result '{}'
text "Merged the fix."
row "$(jq -cn '{type:"assistant", message:{role:"assistant", content:[{type:"tool_use",
  id:"tu_w", name:"mcp__ccd_turn__wrap_up", input:{recap:"Fixed.", ask:"Open the PR?",
  actions:[{action:"create_pr"}, {label:"Not now"}]}}]}}')"
check "$(call mcp__ccd_turn__wrap_up tu_w)" "Merged the fix." \
  "a wrap-up call holds its question back"
text "All green."
check "$(stop 'All green.' unwritten)" "All green.
Question: Open the PR? Options: create pr or Not now." \
  "the stop reads the wrap-up question after the closing reply"
text "One more fix."
check "$(call)" "demo session says: One more fix." \
  "a turn that goes on after its stop reads the next block"
text "Still green."
check "$(stop 'Still green.' unwritten)" "Still green." \
  "the wrap-up question already read is not read again"
row "$(jq -cn '{type:"assistant", message:{role:"assistant", content:[{type:"tool_use",
  id:"tu_m", name:"AskUserQuestion", input:{questions:[{question:"Pick the suites",
  multiSelect:true, options:[{label:"UI"}, {label:"SQL"}]}]}}]}}')"
said="demo session says: Question: Pick the suites? Pick any of: U I and sequel."
check "$(call AskUserQuestion tu_m)" "$said" \
  "a multi-select question says any of them can be picked"
row "$(jq -cn '{type:"assistant", message:{role:"assistant", content:[{type:"tool_use",
  id:"tu_x", name:"mcp__ccd_turn__wrap_up", input:{recap:"Done.", ask:"Push it?"}}]}}')"
row "$(jq -cn '{type:"assistant", message:{role:"assistant", content:[{type:"tool_use",
  id:"tu_y", name:"mcp__ccd_turn__wrap_up", input:{recap:"Done."}}]}}')"
text "Pushed."
check "$(stop 'Pushed.' unwritten)" "Pushed." "only the last wrap-up call's question is read"
prompt human "and now"
row "$(jq -cn '{type:"assistant", message:{role:"assistant", content:[{type:"tool_use",
  id:"tu_r", name:"mcp__ccd_turn__wrap_up", input:{recap:"Done."}}]}}')"
text "Nothing left."
check "$(stop 'Nothing left.' unwritten)" "demo session says: Nothing left." \
  "a wrap-up with no question reads only the reply"
prompt human "push it"
text "Pushed."
text "Then this."
check "$(CLAUDE_CODE_MESSAGING_SOCKET=/x/77.sock call)" "demo session says: Pushed.
Then this." "a socket session still reads aloud"
check "$(jq -c '[.[].text]' "$XDG_RUNTIME_DIR/voice-bridge/feed/77.json")" \
  '["demo session says: Pushed.\n\nThen this."]' "the blocks reach the voice feed as one entry"
typed "/implement"
prompt human "run it"
text "Quiet."
check "$(call)" "" "a tool call outside speech mode is quiet"
prompt human "followed run"
text "Cutting the branch."
FOLLOW_DIR="$XDG_RUNTIME_DIR/voice-bridge/follow"
mkdir -p "$FOLLOW_DIR" && : > "$FOLLOW_DIR/88"
check "$(CLAUDE_CODE_MESSAGING_SOCKET=/x/88.sock call)" "" \
  "a followed session outside speech mode says nothing aloud"
check "$(jq -c '[.[].text]' "$XDG_RUNTIME_DIR/voice-bridge/feed/88.json")" \
  '["demo session says: Cutting the branch."]' \
  "mid-turn text reaches the feed of a followed session"
text "Dispatching."
CLAUDE_CODE_MESSAGING_SOCKET=/x/88.sock call > /dev/null
check "$(jq -c '[.[].text]' "$XDG_RUNTIME_DIR/voice-bridge/feed/88.json")" \
  '["demo session says: Cutting the branch.","Dispatching."]' \
  "a later block is added once"
result '{}'
CLAUDE_CODE_MESSAGING_SOCKET=/x/88.sock stop 'Final reply.' unwritten > /dev/null
check "$(jq 'length' "$XDG_RUNTIME_DIR/voice-bridge/feed/88.json")" "2" \
  "the stop leaves the final reply to the bridge's own hook"
text "Final reply."
CLAUDE_CODE_MESSAGING_SOCKET=/x/88.sock call > /dev/null
check "$(jq 'length' "$XDG_RUNTIME_DIR/voice-bridge/feed/88.json")" "2" \
  "a stop that goes on does not send the final reply later"
prompt human "ask me"
row "$(jq -cn '{type:"assistant", message:{role:"assistant", content:[{type:"tool_use",
  id:"tu_f", name:"AskUserQuestion", input:{questions:[{question:"Ship it?",
  options:[{label:"Yes"}, {label:"No"}]}]}}]}}')"
check "$(CLAUDE_CODE_MESSAGING_SOCKET=/x/88.sock call AskUserQuestion tu_f)" \
  "demo session has a question" "a followed question is still announced aloud"
check "$(jq -r '.[-1].text' "$XDG_RUNTIME_DIR/voice-bridge/feed/88.json" | head -1)" \
  "demo session says: Question: Ship it? Options: Yes or No." \
  "a followed question reaches the feed"
prompt human "wrap up"
text "Late note."
result '{}'
CLAUDE_CODE_MESSAGING_SOCKET=/x/88.sock stop 'Final two.' > /dev/null
check "$(jq 'length' "$XDG_RUNTIME_DIR/voice-bridge/feed/88.json")" "3" \
  "the stop leaves the feed to the bridge's own hook"
text "After the stop."
CLAUDE_CODE_MESSAGING_SOCKET=/x/88.sock call > /dev/null
check "$(jq -r '.[-1].text' "$XDG_RUNTIME_DIR/voice-bridge/feed/88.json")" \
  "demo session says: After the stop." "a turn that goes on after its stop is fed again"
touch -d '2 hours ago' "$FOLLOW_DIR/88"
text "Stale follow."
CLAUDE_CODE_MESSAGING_SOCKET=/x/88.sock call > /dev/null
check "$(jq 'length' "$XDG_RUNTIME_DIR/voice-bridge/feed/88.json")" "4" \
  "a follow nobody has polled lately feeds nothing"
rm -f "$FOLLOW_DIR/88"
text "Unfollowed."
CLAUDE_CODE_MESSAGING_SOCKET=/x/88.sock call > /dev/null
check "$(jq 'length' "$XDG_RUNTIME_DIR/voice-bridge/feed/88.json")" "4" \
  "an unfollowed session feeds nothing"
typed "/implement"
: > "$TRANSCRIPT"

[ "$fails" -eq 0 ] || { echo "$fails failed"; exit 1; }
echo "all passed"
