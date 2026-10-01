#!/usr/bin/env python3
"""Holds a turn open until the session has filed itself in the sidebar group its work calls for.

usage: enforce_sidebar_move.py stop          (Stop hook)
       enforce_sidebar_move.py cache-groups  (PostToolUse hook on mcp__ccd_sidebar__list_groups)

Both read the hook's JSON on stdin. The groups and moves are the ones in
.claude/skills/_shared/sidebar-groups.md.

stop walks the transcript since the last prompt the user typed and finds the latest milestone:

- `gh issue edit ... --add-label "In Progress"` that printed the issue URL: Working (or Needs
  Review, for a question)
- a later `gh issue edit <n> --remove-label "In Progress"` or `gh issue close <n>` for that
  same issue that names it in its output: Completed or Working, since the task ended (say
  it was already fixed on main), or Working or Needs Review while a pull request is open
- `gh pr create` that printed a pull request URL: Needs Review
- `scripts/catchup.py add-issue` that recorded a blocker: Blocked (or Needs Review, for an open
  pull request)
- `pr: <n> merged` or `pr: <n> closed` from `catchup.py wait`: Completed or Working, or Working
  or Needs Review while another pull request in the ledger is still open

With no milestone in the turn, a pull request still open in the session's catch-up ledger
calls for Needs Review. The self review loop waits for CI in the foreground and never ends a
turn, so a turn that ends under Self Review stopped inside the loop.

The session's group is the one its last successful `mcp__ccd_sidebar__move_sessions` call
filed it in, anywhere in the transcript. A missing or
wrong group blocks the stop with a reason naming the group to move to. A stop that a block
already sent back (`stop_hook_active`) is let through, so the hook never loops.

Group ids are resolved to names from `list_groups` and `create_group` results in the
transcript, then from the cache cache-groups keeps under ~/.cache/claude-sidebar/.
"""
import json
import os
import re
import shlex
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catchup  # noqa: E402

GROUP_CACHE = os.path.expanduser('~/.cache/claude-sidebar/groups.json')
DOC = '.claude/skills/_shared/sidebar-groups.md'
MOVE_TOOL = 'mcp__ccd_sidebar__move_sessions'
LIST_TOOL = 'mcp__ccd_sidebar__list_groups'
CREATE_TOOL = 'mcp__ccd_sidebar__create_group'

WORKING = 'Working'
BLOCKED = 'Blocked'
SELF_REVIEW = 'Self Review'
NEEDS_REVIEW = 'Needs Review'
COMPLETED = 'Completed'
# A turn only ends with a pull request open once its self review came back clean.
PR_OPEN = (NEEDS_REVIEW,)
MID_LOOP = ('Self review never ends a turn: wait for CI in the foreground and finish the '
            'loop per .claude/skills/_shared/self-review.md, then move to `Needs Review`.')

# A command that runs the tool, at its start or after a shell separator, not one that only
# mentions it (a grep of the docs, a commit message).
RUNS = r'(?:^|[;&|(\n])\s*(?:\S*/)?'
IN_PROGRESS = re.compile(RUNS + r'gh issue edit\b[^\n;&|]*--add-label[= ]+["\']?[^"\'\n]*'
                         r'In Progress')
GH_ISSUE = re.compile(RUNS + r'gh issue (edit|close)\b([^\n;&|]*)')
ADDS_IN_PROGRESS = re.compile(r'--add-label[= ]+["\']?[^"\'\n]*In Progress')
DROPS_IN_PROGRESS = re.compile(r'--remove-label[= ]+["\']?[^"\'\n]*In Progress')
ISSUE_REF = re.compile(r'^#?(\d+)$|/issues/(\d+)$')
# `gh issue edit` and `gh issue close` flags that take no value.
BARE_FLAGS = ('--remove-milestone',)
PR_CREATE = re.compile(RUNS + r'gh pr create\b')
PR_URL = re.compile(r'github\.com/[^/\s]+/[^/\s]+/pull/(\d+)')
ISSUE_URL = re.compile(r'github\.com/[^/\s]+/[^/\s]+/issues/\d+')
ADD_ISSUE = re.compile(RUNS + r'(?:python3\s+)?(?:\S*/)?catchup\.py add-issue\b')
LEDGER_ARG = re.compile(r'catchup\.py\s+(?:add-pr|add-issue|add|wait|check)\s+(?:--\S+\s+)*'
                        r'(\S+)')
PR_SHUT = re.compile(r'^pr: (\d+) (merged|closed)$', re.M)
ASSIGN = re.compile(r'(?:^|[;&\n])\s*(?:export\s+)?([A-Za-z_]\w*)=([^\s;&|]+)')
VAR = re.compile(r'\$(?:\{(\w+)\}|(\w+))')
GROUP_ID = re.compile(r'\bcg-[0-9a-f-]+\b')
NOTICE_TOOL_USE = re.compile(r'<tool-use-id>([^<]+)</tool-use-id>')
NOTICE_OUTPUT = re.compile(r'<output-file>([^<]+)</output-file>')


def text_of(content):
    """The text of a message or tool result, which is a string or a list of blocks."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return '\n'.join(text_of(b) for b in content)
    if isinstance(content, dict):
        return text_of(content.get('text', content.get('content', '')))
    return ''


def read_transcript(path):
    entries = []
    try:
        with open(path) as f:
            for line in f:
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                if isinstance(entry, dict) and not entry.get('isSidechain'):
                    entries.append(entry)
    except OSError:
        pass
    return entries


def is_prompt(entry):
    """A prompt the user typed, which starts a turn. Tool results, skill bodies and task
    notifications come in as user entries too, and do not."""
    if entry.get('type') != 'user' or entry.get('isMeta'):
        return False
    if entry.get('isCompactSummary'):
        return True
    origin = entry.get('origin')
    if isinstance(origin, dict):
        return origin.get('kind') == 'human'
    content = (entry.get('message') or {}).get('content')
    if isinstance(content, list) and any(
            isinstance(b, dict) and b.get('type') == 'tool_result' for b in content):
        return False
    return not text_of(content).lstrip().startswith('<task-notification>')


def notice_of(entry):
    """The text of a task notification, from a user entry or a queued command attachment."""
    if entry.get('type') == 'user' and not is_prompt(entry):
        text = text_of((entry.get('message') or {}).get('content'))
    elif entry.get('type') == 'attachment':
        text = str((entry.get('attachment') or {}).get('prompt') or '')
    else:
        return ''
    return text if '<task-notification>' in text else ''


class Call:
    def __init__(self, pos, name, args):
        self.pos = pos
        self.name = name
        self.args = args if isinstance(args, dict) else {}
        self.result = ''
        self.error = False
        self.answered = False

    @property
    def command(self):
        return str(self.args.get('command') or '')


def read_session(entries):
    """The tool calls in order with their results, the task notifications, and where the
    current turn starts."""
    calls, by_id, notices, start = [], {}, [], 0
    for pos, entry in enumerate(entries):
        if is_prompt(entry):
            start = pos
        notice = notice_of(entry)
        if notice:
            notices.append((pos, notice))
        content = (entry.get('message') or {}).get('content')
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get('type') == 'tool_use':
                call = Call(pos, block.get('name', ''), block.get('input'))
                calls.append(call)
                by_id[block.get('id')] = call
            elif block.get('type') == 'tool_result' and block.get('tool_use_id') in by_id:
                call = by_id[block['tool_use_id']]
                call.result = text_of(block.get('content'))
                call.error = bool(block.get('is_error'))
                call.answered = True
    return calls, by_id, notices, start


def expand(word, command):
    """A ledger argument with ~ and the command's own VAR=value assignments filled in."""
    names = {m.group(1): m.group(2) for m in ASSIGN.finditer(command)}
    for _ in range(3):
        word = VAR.sub(lambda m: names.get(m.group(1) or m.group(2), m.group(0)), word)
    try:
        word = shlex.split(word)[0]
    except (ValueError, IndexError):
        pass
    return os.path.expanduser(word)


def ledgers(calls):
    found = []
    for call in calls:
        if call.name != 'Bash':
            continue
        for m in LEDGER_ARG.finditer(call.command):
            path = expand(m.group(1), call.command)
            if '$' not in path and path not in found:
                found.append(path)
    return found


def open_prs(paths):
    numbers = set()
    for path in paths:
        for row in catchup.read_ledger(path):
            if row['run'].startswith(catchup.PR_PREFIX) and row['state'] != 'done':
                numbers.add(row['run'][len(catchup.PR_PREFIX):])
    return numbers


def shut_prs(calls, by_id, notices, start):
    """(position, number) for each pull request `wait` reported merged or closed this turn:
    from a catchup.py call's own result, from reading the output file of a background `wait`
    that finished this turn, or from that file directly. A read of any other log (an older
    wait.log) is not a report."""
    outputs = [m.group(1) for pos, notice in notices if pos >= start
               for m in NOTICE_OUTPUT.finditer(notice)]
    shut = []
    for call in calls:
        if call.pos < start or not call.answered:
            continue
        said = json.dumps(call.args)
        if 'catchup.py' in call.command or any(out in said for out in outputs):
            shut += [(call.pos, m.group(1)) for m in PR_SHUT.finditer(call.result)]
    for pos, notice in notices:
        if pos < start:
            continue
        use, out = NOTICE_TOOL_USE.search(notice), NOTICE_OUTPUT.search(notice)
        call = by_id.get(use.group(1)) if use else None
        if not out or not call or 'catchup.py wait' not in call.command:
            continue
        try:
            with open(out.group(1)) as f:
                shut += [(pos, m.group(1)) for m in PR_SHUT.finditer(f.read())]
        except OSError:
            pass
    return shut


def issue_number(args):
    """The issue a `gh issue edit` or `gh issue close` acts on: its first positional
    argument, skipping flags and their values. None when there is none."""
    try:
        words = shlex.split(args)
    except ValueError:
        words = args.split()
    skip = False
    for word in words:
        if skip:
            skip = False
        elif word.startswith('-'):
            skip = '=' not in word and word not in BARE_FLAGS
        else:
            m = ISSUE_REF.search(word)
            return (m.group(1) or m.group(2)) if m else None
    return None


def issue_edits(command):
    """(verb, issue number, args) for each `gh issue edit` or `gh issue close` the command
    runs."""
    return [(m.group(1), issue_number(m.group(2)), m.group(2))
            for m in GH_ISSUE.finditer(command)]


def cleared(verb, number, args, result):
    """Whether a `gh issue edit` that dropped In Progress, or a `gh issue close`, printed
    proof it worked on that issue: its URL, or gh's `Closed issue o/r#N` or
    `Issue o/r#N (...) is already closed`."""
    url = re.search(rf'/issues/{number}\b', result)
    if verb == 'edit':
        return bool(DROPS_IN_PROGRESS.search(args) and url)
    return bool(url or re.search(rf'\b(?:Closed issue|Issue) \S*#{number}\b', result))


def milestones(calls, start, still_open=frozenset()):
    """(position, what, groups) for each milestone in the turn. An In Progress issue that is
    later unlabeled or closed ends the task: Completed, unless a pull request is still open
    in the ledger."""
    found, labeled = [], set()
    ended = (WORKING,) + PR_OPEN if still_open else (COMPLETED, WORKING)
    for call in calls:
        if call.pos < start or call.name != 'Bash' or call.error:
            continue
        command = call.command
        if IN_PROGRESS.search(command) and ISSUE_URL.search(call.result):
            labeled.update(n for verb, n, args in issue_edits(command)
                           if n and verb == 'edit' and ADDS_IN_PROGRESS.search(args))
            found.append((call.pos, 'an issue was labeled In Progress',
                          (WORKING, NEEDS_REVIEW)))
        for verb, number, args in issue_edits(command):
            if number in labeled and cleared(verb, number, args, call.result):
                found.append((call.pos, f'issue {number} was unlabeled or closed', ended))
        opened = PR_CREATE.search(command) and PR_URL.search(call.result)
        if opened:
            found.append((call.pos, f'pull request {opened.group(1)} was opened', PR_OPEN))
        if ADD_ISSUE.search(command) and 'waiting for close:' in call.result:
            found.append((call.pos, 'a blocking issue was recorded', (BLOCKED, NEEDS_REVIEW)))
    return found


def load_cache():
    try:
        with open(GROUP_CACHE) as f:
            cached = json.load(f)
        return cached if isinstance(cached, dict) else {}
    except (OSError, ValueError):
        return {}


def groups_in(text):
    """{id: name} from every JSON array of groups in a list_groups result."""
    found, decoder, at = {}, json.JSONDecoder(), text.find('[')
    while at != -1:
        try:
            rows, end = decoder.raw_decode(text, at)
        except ValueError:
            rows, end = None, at + 1
        if isinstance(rows, list):
            found.update({r['id']: r['name'] for r in rows
                          if isinstance(r, dict) and 'id' in r and 'name' in r})
        at = text.find('[', end)
    return found


def group_names(calls):
    names = load_cache()
    for call in calls:
        if not call.answered or call.error:
            continue
        if call.name == LIST_TOOL:
            names.update(groups_in(call.result))
        elif call.name == CREATE_TOOL:
            made = GROUP_ID.search(call.result)
            if made and call.args.get('name'):
                names[made.group(0)] = call.args['name']
    return names


def current_group(calls):
    """(position, group id) of the last move that filed this session, or None."""
    for call in reversed(calls):
        if call.name != MOVE_TOOL or not call.answered or call.error:
            continue
        if 'self' not in (call.args.get('session_ids') or []):
            continue
        if re.search(r'\b(fail|error|denied|not found)', call.result, re.I):
            continue
        return call.pos, call.args.get('group_id')
    return None


def expected(calls, by_id, notices, start, ledger_open):
    """(what happened, allowed group names), or None when the turn calls for no group."""
    shut = shut_prs(calls, by_id, notices, start)
    still_open = ledger_open - {number for _, number in shut}
    events = milestones(calls, start, still_open)
    for pos, number in shut:
        groups = (WORKING,) + PR_OPEN if still_open else (COMPLETED, WORKING)
        events.append((pos, f'pull request {number} merged or closed', groups))
    if events:
        _, what, groups = max(events, key=lambda e: e[0])
        return what, groups
    if still_open:
        listed = ', '.join(sorted(still_open, key=int))
        return (f'the turn is ending with pull request {listed} open in the ledger (if it '
                'already merged or closed, run `scripts/catchup.py wait <ledger>` so the row '
                'settles)', PR_OPEN)
    return None


def decide(hook):
    """The reason to block the stop, or None to let it through."""
    if hook.get('stop_hook_active'):
        return None
    entries = read_transcript(hook.get('transcript_path') or '')
    if not entries:
        return None
    calls, by_id, notices, start = read_session(entries)
    want = expected(calls, by_id, notices, start, open_prs(ledgers(calls)))
    if not want:
        return None
    what, groups = want
    target = ' or '.join(f'`{g}`' for g in groups)
    how = (f'Look the group up with `{LIST_TOOL}` and move this session with `{MOVE_TOOL}` '
           f'and `session_ids: ["self"]`, per {DOC}. If none of these fits because the '
           'session still holds other work, move to the group that work calls for.')
    moved = current_group(calls)
    if not moved:
        return f'Sidebar: {what}, but this session never filed itself. Move to {target}. {how}'
    name = group_names(calls).get(moved[1])
    if name is None:
        return (f'Sidebar: {what}, and the last move used group id `{moved[1]}`, which no '
                f'`{LIST_TOOL}` result names. Move to {target}. {how}')
    if name == SELF_REVIEW and groups == PR_OPEN:
        return f'Sidebar: {what}, but this session is still under `{name}`. {MID_LOOP}'
    if name not in groups:
        return (f'Sidebar: {what}, but this session is filed under `{name}`. '
                f'Move to {target}. {how}')
    return None


def cache_groups(hook):
    response = hook.get('tool_response')
    found = groups_in(text_of(response))
    if not found:
        return
    names = load_cache()
    names.update(found)
    os.makedirs(os.path.dirname(GROUP_CACHE), exist_ok=True)
    catchup.write_file(GROUP_CACHE, json.dumps(names, indent=2) + '\n')


def main(argv):
    try:
        hook = json.load(sys.stdin)
    except ValueError:
        return 0
    if len(argv) == 2 and argv[1] == 'cache-groups':
        cache_groups(hook)
    elif len(argv) == 2 and argv[1] == 'stop':
        reason = decide(hook)
        if reason:
            print(json.dumps({'decision': 'block', 'reason': reason}))
    else:
        print(__doc__.split('\n\n')[1], file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
