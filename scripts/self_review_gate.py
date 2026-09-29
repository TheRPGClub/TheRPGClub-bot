#!/usr/bin/env python3
"""Hooks that record self review passes and refuse a handoff before a clean one.

usage: python3 scripts/self_review_gate.py < hook-input.json

The handler is picked from the payload's hook_event_name and tool_name, so every
hook in .claude/settings.local.json runs the same command.

A pass is recorded by the hooks, never by the session: `review` runs after the
`code-review` skill starts and stores the pull request and the head commit it
reviews, and `findings` runs after `ReportFindings` and stores how many findings
came back. A clean pass is a recorded pass with zero findings at the pull
request's current head. A pull request that gets a new commit needs a new one.

Events:
  pr-opened  PostToolUse on Bash. Tracks a pull request `gh pr create` opened.
  review     PostToolUse on Skill. Starts a pass when the skill is code-review.
             A review does not track its pull request: only one this session
             opened is gated, so reviewing a pull request it did not open never
             holds the session until that pull request is clean.
  findings   PostToolUse on ReportFindings. Closes the open pass with its count.
  sidebar    PreToolUse on mcp__ccd_sidebar__move_sessions. Denies a move to
             Needs Review while a tracked pull request's loop is unfinished.
  stop       Stop. Blocks the end of a turn while a tracked pull request's
             loop is unfinished.

A loop is finished when the pull request's current head has a clean pass, its
CI has passed or runs no checks, and it is not in conflict with its base.
Pending CI on a clean head still blocks: the session waits for it in the
foreground rather than ending the turn.

Pull requests are keyed by URL, so one opened in another repository is read
from that repository. A pass is only as honest as the review behind it: the gate
knows code-review ran and what ReportFindings said, not how carefully.

State lives in <git common dir>/self-review/<session id>.json, outside the
working tree and shared by every worktree of the repo. A GitHub read that fails
lets the event through with a warning, so a network outage cannot trap a
session; everything else fails closed.
"""
import fcntl
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

NEEDS_REVIEW_GROUP = 'Needs Review'
GH_TIMEOUT = 20
PR_URL = re.compile(r'https://github\.com/([^/\s]+/[^/\s]+)/pull/(\d+)')
GH_PR_CREATE = re.compile(r'(^|[;&|(])\s*gh pr create')
# gh's wording when the repository does not exist; such a PR is dropped. A 404 is not
# enough, since GitHub can answer 404 for a pull request opened seconds ago.
MISSING_PR = re.compile(r'Could not resolve to a Repository', re.I)
FAILED_CONCLUSIONS = {'FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED',
                      'STARTUP_FAILURE'}
PENDING_STATUS_STATES = {'PENDING', 'EXPECTED'}
FAILED_STATUS_STATES = {'FAILURE', 'ERROR'}


def gh(*args):
    try:
        r = subprocess.run(['gh', *args], capture_output=True, text=True, timeout=GH_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f'no answer in {GH_TIMEOUT}s') from None
    if r.returncode:
        raise RuntimeError(r.stderr.strip()[:300])
    return r.stdout


def state_path(session_id):
    common = subprocess.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
                            capture_output=True, text=True, check=True).stdout.strip()
    safe = re.sub(r'[^A-Za-z0-9_-]', '_', session_id or 'unknown')
    return os.path.join(common, 'self-review', f'{safe}.json')


def load(path):
    try:
        with open(path) as f:
            state = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        state = {}
    # Entries keyed by a bare number predate URL keys and are dropped.
    return {'prs': [u for u in state.get('prs', []) if isinstance(u, str)],
            'passes': [p for p in state.get('passes', []) if isinstance(p.get('pr'), str)]}


def save(path, state):
    tmp = f'{path}.tmp'
    with open(tmp, 'w') as f:
        json.dump(state, f, indent=1)
    os.replace(tmp, path)


def text_of(value):
    return value if isinstance(value, str) else json.dumps(value)


def read_pr(url):
    fields = 'number,state,headRefOid,mergeable,statusCheckRollup'
    return json.loads(gh('pr', 'view', url, '--json', fields))


def pr_url(match):
    return f'https://github.com/{match.group(1)}/pull/{match.group(2)}'


def short(url):
    match = PR_URL.search(url)
    return f'{match.group(1)}#{match.group(2)}' if match else url


def ci_state(pr):
    """'none', 'pending', 'failed', or 'passed' for the head's checks."""
    checks = pr.get('statusCheckRollup') or []
    if not checks:
        return 'none'
    failed = False
    for check in checks:
        if 'status' in check:  # a CheckRun
            if (check['status'] or '').upper() != 'COMPLETED':
                return 'pending'
            failed |= (check.get('conclusion') or '').upper() in FAILED_CONCLUSIONS
        else:  # a StatusContext
            status = (check.get('state') or '').upper()
            if status in PENDING_STATUS_STATES:
                return 'pending'
            failed |= status in FAILED_STATUS_STATES
    return 'failed' if failed else 'passed'


def clean_at(state, url, sha):
    return any(p['pr'] == url and p['sha'] == sha and p.get('findings') == 0
               for p in state['passes'])


def track(state, url):
    if url not in state['prs']:
        state['prs'].append(url)


def review_target(args):
    """The URL of the pull request a code-review invocation names, or of the branch's own."""
    ref = []
    for token in reversed((args or '').split()):
        match = PR_URL.search(token)
        if match:
            return pr_url(match)
        number = re.fullmatch(r'#?(\d+)', token)
        if number:
            ref = [number.group(1)]
            break
    try:
        return gh('pr', 'view', *ref, '--json', 'url', '--jq', '.url').strip() or None
    except RuntimeError:
        return None


def on_pr_opened(state, payload):
    command = payload.get('tool_input', {}).get('command', '')
    if not GH_PR_CREATE.search(command):
        return None
    # gh pr create prints the new URL on a line of its own; a URL inside other output
    # (test data, a grep of the docs) is not a pull request this command opened.
    response = payload.get('tool_response', '')
    stdout = response.get('stdout', '') if isinstance(response, dict) else text_of(response)
    for line in stdout.splitlines():
        match = PR_URL.fullmatch(line.strip())
        if match:
            track(state, pr_url(match))
    return None


def on_review(state, payload):
    tool_input = payload.get('tool_input', {})
    if tool_input.get('skill') != 'code-review':
        return None
    url = review_target(tool_input.get('args'))
    if url is None:
        return {'systemMessage': 'self review gate: could not tell which pull request this '
                                 'code-review targets, so this pass is not recorded.'}
    try:
        sha = read_pr(url)['headRefOid']
    except RuntimeError as err:
        return {'systemMessage': f'self review gate: could not read {short(url)}: {err}. '
                                 'This pass is not recorded.'}
    state['passes'].append({'pr': url, 'sha': sha, 'findings': None})
    return None


def on_findings(state, payload):
    findings = payload.get('tool_input', {}).get('findings') or []
    # A re-report carrying outcomes updates earlier findings; it is not a new pass.
    if any('outcome' in f for f in findings):
        return None
    # Only the pass the latest code-review started takes the count; an older pass left open
    # by an interrupted review stays open and never counts as clean.
    if state['passes'] and state['passes'][-1].get('findings') is None:
        state['passes'][-1]['findings'] = len(findings)
    return None


def group_names():
    """Group names by id, from the cache enforce_sidebar_move.py keeps from list_groups
    results, so the two hooks never disagree about which id is which group. Imported here,
    not at the top, so a problem in that script can only affect the sidebar event. When the
    cache cannot be read, no id is known, and on_sidebar denies the move while a loop is
    unfinished instead of letting it through."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        from enforce_sidebar_move import load_cache
        return load_cache()
    except Exception:  # noqa: BLE001 - any failure here must fail closed
        return {}


def read_all(urls):
    """Each URL paired with its pull request, or with the error reading it, read in parallel."""
    def read(url):
        try:
            return url, read_pr(url)
        except RuntimeError as err:
            return url, err
    with ThreadPoolExecutor(max_workers=8) as pool:
        return list(pool.map(read, urls))


def unfinished(state):
    """Why each tracked open pull request's loop is unfinished, plus GitHub read errors."""
    problems, errors = [], []
    for url, pr in read_all(list(state['prs'])):
        name = short(url)
        if isinstance(pr, RuntimeError):
            if MISSING_PR.search(str(pr)):
                state['prs'].remove(url)
            else:
                errors.append(f'{name}: {pr}')
            continue
        if pr['state'] != 'OPEN':
            state['prs'].remove(url)
            continue
        head = pr['headRefOid'][:7]
        ci = ci_state(pr)
        if not clean_at(state, url, pr['headRefOid']):
            problems.append(f'{name} has no clean pass at head {head}: run '
                            f'`code-review high {pr["number"]}` from its repository (a reread '
                            'is not a pass), fix every finding that holds, push, and review '
                            'again until a pass reports zero findings')
        elif pr.get('mergeable') == 'CONFLICTING':
            problems.append(f'{name} is clean at {head} but conflicts with its base: resolve '
                            'it per pr-mergeability.md, push, and review again')
        elif ci == 'pending':
            problems.append(f'{name} is clean at {head} but CI is still running: wait for it '
                            'in the foreground with `scripts/catchup.py wait <ledger>`')
        elif ci == 'failed':
            problems.append(f'{name} is clean at {head} but CI failed: the failure is a '
                            'finding, so fix it, push, and review again')
    return problems, errors


def warning(errors):
    if not errors:
        return None
    return {'systemMessage': 'self review gate could not read ' + '; '.join(errors)}


def on_sidebar(state, payload):
    group = group_names().get(payload.get('tool_input', {}).get('group_id'))
    if group is not None and group != NEEDS_REVIEW_GROUP:
        return None
    problems, errors = unfinished(state)
    if not problems:
        return warning(errors)
    if group is None:
        reason = ('The self review gate does not know this group id, and a tracked pull '
                  'request is unfinished. Call mcp__ccd_sidebar__list_groups first, then move.')
    else:
        reason = ('Not ready for Needs Review. ' + ' '.join(f'{p}.' for p in problems)
                  + ' Stay in Self Review until every loop is finished.')
    return {'hookSpecificOutput': {'hookEventName': 'PreToolUse',
                                   'permissionDecision': 'deny',
                                   'permissionDecisionReason': reason}}


def on_stop(state, payload):
    problems, errors = unfinished(state)
    if not problems:
        return warning(errors)
    reason = ('Self review is not finished, per .claude/skills/_shared/self-review.md. '
              + ' '.join(f'{p}.' for p in problems))
    return {'decision': 'block', 'reason': reason}


HANDLERS = {
    'pr-opened': on_pr_opened,
    'review': on_review,
    'findings': on_findings,
    'sidebar': on_sidebar,
    'stop': on_stop,
}
EVENTS = {
    ('PostToolUse', 'Bash'): 'pr-opened',
    ('PostToolUse', 'Skill'): 'review',
    ('PostToolUse', 'ReportFindings'): 'findings',
    ('PreToolUse', 'mcp__ccd_sidebar__move_sessions'): 'sidebar',
    ('Stop', None): 'stop',
}


def event_of(payload):
    hook = payload.get('hook_event_name')
    return EVENTS.get((hook, None if hook == 'Stop' else payload.get('tool_name')))

# Cheap checks on the tool input, so the hooks on every Bash and Skill call return before
# touching git or the state file when the call has nothing to do with the gate.
RELEVANT = {
    'pr-opened': lambda tool_input: bool(GH_PR_CREATE.search(tool_input.get('command', ''))),
    'review': lambda tool_input: tool_input.get('skill') == 'code-review',
}


def main():
    payload = json.load(sys.stdin)
    event = event_of(payload)
    if event is None:
        return 0
    relevant = RELEVANT.get(event)
    if relevant and not relevant(payload.get('tool_input') or {}):
        return 0
    path = state_path(payload.get('session_id'))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # Hooks from parallel tool calls run at once; the lock keeps one from overwriting
    # another's update.
    with open(f'{path}.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = load(path)
        before = json.dumps(state, sort_keys=True)
        result = HANDLERS[event](state, payload)
        if json.dumps(state, sort_keys=True) != before:
            save(path, state)
    if result:
        print(json.dumps(result))
    return 0


if __name__ == '__main__':
    sys.exit(main())
