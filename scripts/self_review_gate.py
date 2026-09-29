#!/usr/bin/env python3
"""Hooks that record self review passes and refuse a handoff before a clean one.

usage: python3 scripts/self_review_gate.py <event> < hook-input.json

A pass is recorded by the hooks, never by the session: `review` runs after the
`code-review` skill starts and stores the pull request and the head commit it
reviews, and `findings` runs after `ReportFindings` and stores how many findings
came back. A clean pass is a recorded pass with zero findings at the pull
request's current head. A pull request that gets a new commit needs a new one.

Events:
  pr-opened  PostToolUse on Bash. Tracks a pull request `gh pr create` opened.
  review     PostToolUse on Skill. Starts a pass when the skill is code-review.
  findings   PostToolUse on ReportFindings. Closes the open pass with its count.
  groups     PostToolUse on mcp__ccd_sidebar__list_groups. Learns group names.
  sidebar    PreToolUse on mcp__ccd_sidebar__move_sessions. Denies a move to
             Needs Review while a tracked pull request's loop is unfinished.
  stop       Stop. Blocks the end of a turn while a tracked pull request's
             loop is unfinished.

A loop is finished when the pull request's current head has a clean pass and
its CI has passed or runs no checks. Pending CI on a clean head still blocks:
the session waits for it in the foreground rather than ending the turn.

State lives in <git common dir>/self-review/<session id>.json, outside the
working tree and shared by every worktree of the repo. A GitHub read that fails
lets the event through with a warning, so a network outage cannot trap a
session; everything else fails closed.
"""
import json
import os
import re
import subprocess
import sys

NEEDS_REVIEW_GROUP = 'Needs Review'
GH_TIMEOUT = 20
PR_URL = re.compile(r'github\.com/[^/\s]+/[^/\s]+/pull/(\d+)')
GH_PR_CREATE = re.compile(r'(^|[;&|(])\s*gh pr create')
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
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {'prs': [], 'passes': [], 'groups': {}}


def save(path, state):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f'{path}.tmp'
    with open(tmp, 'w') as f:
        json.dump(state, f, indent=1)
    os.replace(tmp, path)


def text_of(value):
    return value if isinstance(value, str) else json.dumps(value)


def read_pr(number):
    fields = 'number,state,headRefOid,mergeable,statusCheckRollup'
    return json.loads(gh('pr', 'view', str(number), '--json', fields))


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


def clean_at(state, number, sha):
    return any(p['pr'] == number and p['sha'] == sha and p.get('findings') == 0
               for p in state['passes'])


def track(state, number):
    if number not in state['prs']:
        state['prs'].append(number)


def review_target(args):
    """The pull request number a code-review invocation names, or the branch's own."""
    for token in reversed((args or '').split()):
        match = re.fullmatch(r'#?(\d+)', token) or PR_URL.search(token)
        if match:
            return int(match.group(1))
    try:
        return int(gh('pr', 'view', '--json', 'number', '--jq', '.number').strip())
    except (RuntimeError, ValueError):
        return None


def on_pr_opened(state, payload):
    command = payload.get('tool_input', {}).get('command', '')
    if not GH_PR_CREATE.search(command):
        return None
    match = PR_URL.search(text_of(payload.get('tool_response', '')))
    if match:
        track(state, int(match.group(1)))
    return None


def on_review(state, payload):
    tool_input = payload.get('tool_input', {})
    if tool_input.get('skill') != 'code-review':
        return None
    number = review_target(tool_input.get('args'))
    if number is None:
        return None
    try:
        sha = read_pr(number)['headRefOid']
    except RuntimeError as err:
        return {'systemMessage': f'self review gate: could not read PR {number}: {err}. '
                                 'This pass is not recorded.'}
    track(state, number)
    state['passes'].append({'pr': number, 'sha': sha, 'findings': None})
    return None


def on_findings(state, payload):
    findings = payload.get('tool_input', {}).get('findings') or []
    # A re-report carrying outcomes updates earlier findings; it is not a new pass.
    if any('outcome' in f for f in findings):
        return None
    for entry in reversed(state['passes']):
        if entry.get('findings') is None:
            entry['findings'] = len(findings)
            break
    return None


def response_text(response):
    """An MCP tool's result as text, whether it arrives raw or as content blocks."""
    if isinstance(response, list):
        return ''.join(b.get('text', '') for b in response if isinstance(b, dict))
    if isinstance(response, dict) and isinstance(response.get('content'), list):
        return response_text(response['content'])
    return text_of(response)


def on_groups(state, payload):
    try:
        groups = json.loads(response_text(payload.get('tool_response', '')))
    except json.JSONDecodeError:
        return None
    for group in groups if isinstance(groups, list) else []:
        if isinstance(group, dict) and 'id' in group and 'name' in group:
            state['groups'][group['id']] = group['name']
    return None


def unfinished(state):
    """Why each tracked open pull request's loop is unfinished, plus GitHub read errors."""
    problems, errors = [], []
    for number in list(state['prs']):
        try:
            pr = read_pr(number)
        except RuntimeError as err:
            errors.append(f'PR {number}: {err}')
            continue
        if pr['state'] != 'OPEN':
            state['prs'].remove(number)
            continue
        head = pr['headRefOid'][:7]
        ci = ci_state(pr)
        if not clean_at(state, number, pr['headRefOid']):
            problems.append(f'PR {number} has no clean pass at head {head}: run '
                            f'`code-review high {number}` (a reread is not a pass), fix every '
                            'finding that holds, push, and review again until a pass reports '
                            'zero findings')
        elif ci == 'pending':
            problems.append(f'PR {number} is clean at {head} but CI is still running: wait for '
                            'it in the foreground with `scripts/catchup.py wait <ledger>`')
        elif ci == 'failed':
            problems.append(f'PR {number} is clean at {head} but CI failed: the failure is a '
                            'finding, so fix it, push, and review again')
    return problems, errors


def warning(errors):
    if not errors:
        return None
    return {'systemMessage': 'self review gate could not read ' + '; '.join(errors)}


def on_sidebar(state, payload):
    group = state['groups'].get(payload.get('tool_input', {}).get('group_id'))
    if group != NEEDS_REVIEW_GROUP:
        return None
    problems, errors = unfinished(state)
    if not problems:
        return warning(errors)
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
    'groups': on_groups,
    'sidebar': on_sidebar,
    'stop': on_stop,
}


def main(argv):
    if len(argv) != 2 or argv[1] not in HANDLERS:
        sys.stderr.write(f'usage: {argv[0]} {{{",".join(HANDLERS)}}} < hook-input.json\n')
        return 2
    payload = json.load(sys.stdin)
    path = state_path(payload.get('session_id'))
    state = load(path)
    result = HANDLERS[argv[1]](state, payload)
    save(path, state)
    if result:
        print(json.dumps(result))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
