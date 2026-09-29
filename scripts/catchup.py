#!/usr/bin/env python3
"""Watch every issue, pull request and workflow run a session is waiting on, with as few
API calls as possible.

Ported from PlaywrightTesting's scripts/catchup.py. A session records each thing it waits
on in a ledger, one line per row, and reads them all back through this script instead of
watching each one.

usage:
  scripts/catchup.py add   <ledger> <run-id> [label]    record a workflow run
  scripts/catchup.py add-pr <ledger> <pr> [label]       wait for a pull request to merge
  scripts/catchup.py add-issue <ledger> <issue> [label] wait for a blocking issue to close
  scripts/catchup.py check <ledger>                     tally what has finished, once
  scripts/catchup.py wait  <ledger> [--interval 180] [--all]
                                                        check until a row finishes
                                                        (--all: until every row has)

An issue row is the issue a blocked session waits on. `add-issue` reads it once, and
settles it at once if it is already closed. After that, the forwarder's issues close
notice settles it, with no API call. Every timer check also reads each open issue, push
or no push: a blocked session can wait for days, so a fifteen minute read is the backstop.

A pull request row works the same way. `add-pr` reads it once, and the forwarder's
pull_request close notice settles it after that. When a forwarder connects, every waiter
reads each open pull request and issue once, for a close sent while nobody was listening,
and a read that fails there is tried once more thirty seconds later. While no forwarder
is live, every timer check also reads each open pull request.

A run row is a workflow run. `check` costs one run list per branch in the ledger, plus
one job list and one log fetch per run that finished since the last check. Runs already
tallied cost nothing. The log of each finished run is saved beside the ledger as
<ledger>.logs/<run-id>.log so it can be grepped again without another fetch. `add` tries
a read that fails with a 404, a server error or no answer up to three times inside two
minutes, since a run is often read the moment it starts.

`wait` is the single watcher a session may run, and it never checks more often than
every three minutes on a timer. It exits as soon as any row finishes, so the session can
act on that result while the rest are still out, and the session then runs it again on
the rows still open. `--all` waits for every row instead. `add`, `add-pr`, `add-issue`
and `check` take a lock beside the ledger to rewrite it, so a row recorded while `wait`
is checking keeps its row. Adding a row again replaces it rather than duplicating it.

A `sidebar:` line names the move the session makes in the Code tab sidebar, per
.claude/skills/_shared/sidebar-groups.md. A `wait` that exits on a closed issue prints the
move out of Blocked. One that exits on a closed pull request prints the move back to
Working, or to Completed when nothing is left.

`wait` also listens for GitHub's workflow_run, pull_request and issues events through
`gh webhook forward` (the cli/gh-webhook extension), so a row settles within seconds.
The script never installs the extension: when it is missing, `wait` prints the command
that adds it and checks on the timer. GitHub accepts one forwarder hook per repository,
so the waiters on a machine share one. The waiter holding a lock under ~/.cache/catchup
runs the forwarder, reads its output on a thread, and writes each event to a shared
events file as one short line. Every waiter reads that file. Past a megabyte the events
file is renamed to events.jsonl.old, and readers follow the rename.

gh runs the extension as a child process, and a child that outlives its waiter keeps the
hook and blocks the next forwarder. The lock proves no live waiter owns such a process,
so the holder stops any it finds before starting a forwarder. It also deletes the last
hook a forwarder on this machine made, if GitHub has not dropped it already, and any
forwarder hook GitHub has marked inactive. An active hook made on another machine is
left alone: the forwarder here is refused, retries after a delay that doubles up to ten
minutes, and `wait` checks on the timer meanwhile. Every five minutes the holder confirms
its hook is still on the repository and restarts the forwarder when it is gone.

A gh call that fails on the wait path never ends `wait`. A failed read leaves its rows as
they were, and the next check tries again. Each read there gives up after twenty seconds,
and the pull request and issue notices that need no read settle before and after every
check, so a hung read never holds one back. When the waiter cannot reach GitHub to name
the repository, push is off and `wait` checks on the timer, setting push up again after
each check.

While the push is live the timer check runs every fifteen minutes and only catches a lost
event. While the forwarder is down, `wait` checks every three minutes.

The ledger is tab separated: label, branch, key, url, state, tally, title. A run row's
key is its run id and its url is its first job's url. A pull request row holds
pr:<number> and the pull request's url, and an issue row holds issue:<number> and the
issue's url, with no branch.
"""
import fcntl
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time

MIN_INTERVAL = 180
PUSH_FALLBACK_INTERVAL = 900
# How often a waiter reads the local events file; no API call is made.
EVENT_POLL = 5
# A notified run the API does not report completed yet is read again this often,
# this many times in all, and then left to the timer.
EVENT_RECHECK = 30
EVENT_RECHECKS = 4
# An events line is about 250 bytes, so the file holds about 4,000 events.
EVENTS_ROTATE = 1_000_000
# Rows a waiter remembers from the events files, about what the two files hold.
SEEN_LIMIT = 10_000
RANK = {'requested': 0, 'in_progress': 1, 'completed': 2}
FORWARDER_RESTART = 60
FORWARDER_RESTART_MAX = 600
HOOK_CHECK = 300
EXTENSION = 'cli/gh-webhook'
EXTENSION_TIMEOUT = 60
PUSH_DIR = os.path.expanduser('~/.cache/catchup')
FIELDS = ('label', 'branch', 'run', 'job', 'state', 'tally', 'title')
PR_PREFIX = 'pr:'
ISSUE_PREFIX = 'issue:'
FORWARDED_EVENTS = 'workflow_run,pull_request,issues'
# add reads a run the moment it starts, when the API can still answer 404 for it, or
# answer nothing at all. Each read is tried this many times, pausing this many seconds
# times the try number, and add gives up once this many seconds have passed since it began.
ADD_READ_TRIES = 3
ADD_READ_BACKOFF = 5
ADD_READ_TIMEOUT = 30
ADD_BUDGET = 120
# Every read on the wait path gives up after this many seconds, so one hung call cannot hold
# back the notices queued behind it. A read that gives up leaves its rows for the next check.
WAIT_READ_TIMEOUT = 20
ADD_JOBS_PAUSE = 10
# gh's wording for a failure worth another try: not found yet, a server error, or no answer.
TRANSIENT = re.compile(r'HTTP (404|5\d\d)|no answer in|error connecting|connection reset'
                       r'|i/o timeout|TLS handshake timeout|unexpected EOF', re.I)
# The error lines a finished run's log prints, reported when the run did not succeed.
LOG_ERROR = re.compile(r'##\[error\](.*)')
ERROR_LINES = 10


def gh(*args, timeout=None):
    try:
        r = subprocess.run(['gh', *args], capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f'no answer in {timeout}s') from None
    if r.returncode:
        raise RuntimeError(r.stderr.strip()[:300])
    return r.stdout


def run_jobs(run_id):
    return json.loads(gh('api', f'repos/{{owner}}/{{repo}}/actions/runs/{run_id}/jobs',
                         timeout=WAIT_READ_TIMEOUT))['jobs']


def job_log(job_id):
    return gh('api', f'repos/{{owner}}/{{repo}}/actions/jobs/{job_id}/logs',
              timeout=WAIT_READ_TIMEOUT)


def read_file(path):
    try:
        with open(path) as f:
            return f.read().strip()
    except FileNotFoundError:
        return ''


def write_file(path, text):
    """Replace a file whole, so a reader never sees it half written."""
    tmp = f'{path}.{os.getpid()}.tmp'
    with open(tmp, 'w') as f:
        f.write(text)
    os.replace(tmp, path)


def locked(path):
    """The ledger's lock, held while a ledger is read and rewritten."""
    lock = open(path + '.lock', 'a')
    fcntl.flock(lock, fcntl.LOCK_EX)
    return lock


def read_ledger(path):
    rows = []
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                if line.strip():
                    parts = line.rstrip('\n').split('\t') + [''] * len(FIELDS)
                    rows.append(dict(zip(FIELDS, parts)))
    return rows


def write_ledger(path, rows):
    write_file(path, ''.join('\t'.join(r[k] for k in FIELDS) + '\n' for r in rows))


def record(path, row):
    """Add a row to the ledger, replacing any row with the same key."""
    with locked(path):
        rows = [r for r in read_ledger(path) if r['run'] != row['run']]
        rows.append(row)
        write_ledger(path, rows)


def open_rows(path):
    return {r['run'] for r in read_ledger(path) if r['state'] != 'done'}


def done_rows(path):
    return {r['run'] for r in read_ledger(path) if r['state'] == 'done'}


def is_pr(key):
    return key.startswith(PR_PREFIX)


def is_issue(key):
    return key.startswith(ISSUE_PREFIX)


def is_run(key):
    """Whether a ledger key is a workflow run, rather than a pull request or an issue."""
    return not is_pr(key) and not is_issue(key)


def handed_back(path, before, every):
    """Whether wait stops now: a row finished since it started, unless it waits for all."""
    if every:
        return False
    return report_finished(path, before)


def report_finished(path, before):
    """Print the rows finished since wait started and the sidebar move. False if none."""
    finished = done_rows(path) - before
    if not finished:
        return False
    left = len(open_rows(path))
    print(f'wait: {len(finished)} finished; {left} still open'
          + ('; act on the result, then run wait again' if left else ''))
    if any(is_pr(key) for key in finished):
        print('sidebar: a pull request closed; move this session to Working if it still '
              'holds work (open rows, running agents, another open pull request, an '
              'unfinished task), or to Completed once the after-merge steps leave nothing')
    if any(is_issue(key) for key in finished):
        print('sidebar: a blocking issue closed; move this session from Blocked to Working, '
              'then start the deferred task again from its first step')
    return True


def utc(seconds=None):
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(seconds))


def pr_tally(state, sha, merged_at, closed_at):
    if state == 'merged':
        return f'merged {(sha or "")[:9]} at {merged_at}'
    return f'closed without merging at {closed_at}'


def issue_tally(reason, closed_at):
    """What a closed issue row reads: completed, not planned, or duplicate, and when."""
    reason = (reason or 'closed').lower().replace('_', ' ')
    return f'closed as {reason} at {closed_at}'


def notice_tally(event):
    """The tally for a pull request or issue row, from its close notice."""
    if event.get('event') == 'issue':
        return issue_tally(event.get('reason'), event.get('closed_at'))
    return pr_tally(event['state'], event.get('sha'), event.get('merged_at'),
                    event.get('closed_at'))


def settle_row(path, key, state, tally_text):
    """Mark an open pull request or issue row done. False when no open row has that key."""
    with locked(path):
        rows = read_ledger(path)
        hit = [r for r in rows if r['run'] == key and r['state'] != 'done']
        for r in hit:
            r['state'], r['tally'] = 'done', tally_text
        write_ledger(path, rows)
    kind, number = key.split(':', 1)
    for r in hit:
        print(f'done: {r["label"]} - {r["job"]}\n  {tally_text}')
        print(f'{kind}: {number} {state}')
    return bool(hit)


def read_pr(number):
    """One read of a pull request: its url, head branch, and (state, tally) once it is shut."""
    pr = json.loads(gh('pr', 'view', str(number), '--json',
                       'url,headRefName,state,mergedAt,closedAt,mergeCommit',
                       timeout=WAIT_READ_TIMEOUT))
    state = pr['state'].lower()
    shut = None
    if state in ('merged', 'closed'):
        sha = (pr.get('mergeCommit') or {}).get('oid')
        shut = (state, pr_tally(state, sha, pr.get('mergedAt'), pr.get('closedAt')))
    return pr, shut


def add_pr(path, number, label):
    pr, shut = read_pr(number)
    key = f'{PR_PREFIX}{number}'
    # An open row keeps the time it was recorded, so an older close notice for the same
    # pull request, from before a reopen, is not taken for this one.
    record(path, {'label': label, 'branch': pr['headRefName'], 'run': key, 'job': pr['url'],
                  'state': 'open', 'tally': f'added {utc()}', 'title': ''})
    print(f'waiting for merge: {label} - {pr["url"]}')
    if shut:
        settle_row(path, key, *shut)


def read_issue(number):
    """One read of an issue: its url, and (state, tally) once it is closed."""
    issue = json.loads(gh('api', f'repos/{{owner}}/{{repo}}/issues/{number}',
                          timeout=WAIT_READ_TIMEOUT))
    issue['url'] = issue['html_url']
    shut = None
    if issue['state'].lower() == 'closed':
        shut = ('closed', issue_tally(issue.get('state_reason'), issue.get('closed_at')))
    return issue, shut


def add_issue(path, number, label):
    issue, shut = read_issue(number)
    key = f'{ISSUE_PREFIX}{number}'
    # As with a pull request row, the time it was recorded screens out an older close
    # notice from before a reopen.
    record(path, {'label': label, 'branch': '', 'run': key, 'job': issue['url'],
                  'state': 'open', 'tally': f'added {utc()}', 'title': ''})
    print(f'waiting for close: {label} - {issue["url"]}')
    if shut:
        settle_row(path, key, *shut)


def reconcile_rows(path, keys=None, issues_only=False):
    """Read each open pull request and issue row once, for a notice nobody heard.

    Given keys, reads only those rows. With issues_only, skips the pull requests.
    Returns the keys whose read failed.
    """
    failed = set()
    for r in read_ledger(path):
        key = r['run']
        if r['state'] == 'done' or is_run(key) or (issues_only and not is_issue(key)):
            continue
        if keys is not None and key not in keys:
            continue
        kind, number = key.split(':', 1)
        try:
            _, shut = read_issue(number) if is_issue(key) else read_pr(number)
        except (RuntimeError, ValueError, KeyError) as e:
            print(f'{r["label"]}: {"issue" if kind == "issue" else "pull request"} '
                  f'read failed: {e}')
            failed.add(key)
            continue
        if shut:
            settle_row(path, key, *shut)
    return failed


def add_read(endpoint, deadline):
    """One API read for add, tried again on a transient failure while the deadline allows."""
    for attempt in range(1, ADD_READ_TRIES + 1):
        try:
            return json.loads(gh('api', endpoint, timeout=ADD_READ_TIMEOUT))
        except RuntimeError as e:
            pause = ADD_READ_BACKOFF * attempt
            if (attempt == ADD_READ_TRIES or not TRANSIENT.search(str(e))
                    or time.monotonic() + pause > deadline):
                raise
            print(f'{endpoint}: read failed, trying again in {pause}s: {e}')
            time.sleep(pause)
    raise RuntimeError(f'{endpoint}: no read attempted')


def add(path, run_id, label):
    deadline = time.monotonic() + ADD_BUDGET
    run = add_read(f'repos/{{owner}}/{{repo}}/actions/runs/{run_id}', deadline)
    # The job list is empty for a few seconds after a run starts, before the job exists.
    jobs = []
    for _ in range(6):
        jobs = add_read(f'repos/{{owner}}/{{repo}}/actions/runs/{run_id}/jobs', deadline)['jobs']
        if jobs or time.monotonic() + ADD_JOBS_PAUSE > deadline:
            break
        time.sleep(ADD_JOBS_PAUSE)
    job = jobs[0]['html_url'] if jobs else run['html_url']
    title = ' '.join(run.get('display_title', '').split())
    record(path, {'label': label, 'branch': run['head_branch'], 'run': str(run_id),
                  'job': job, 'state': 'waiting', 'tally': '', 'title': title})
    print(f'waiting: {label} - {job}')


def tally(conclusion, jobs):
    """A finished run in one line: its conclusion, and the jobs and steps that did not pass."""
    failed = []
    for job in jobs:
        if job.get('conclusion') in ('success', 'skipped', None):
            continue
        steps = [s['name'] for s in job.get('steps') or []
                 if s.get('conclusion') not in ('success', 'skipped', None)]
        failed.append(job['name'] + (f' ({", ".join(steps)})' if steps else ''))
    return f'{conclusion} jobs={len(jobs)}' + (f' failed: {"; ".join(failed)}' if failed else '')


def findings(log):
    """The error lines a failed run's log printed, the first few of them."""
    out = []
    for line in log.splitlines():
        found = LOG_ERROR.search(line)
        if found and len(out) < ERROR_LINES:
            out.append('  ' + found.group(1).strip())
    return out


def branch_runs(branch, wanted):
    """The branch's runs by id, read newest first until every wanted run has been seen."""
    runs, page = {}, 1
    while True:
        listed = json.loads(gh('api', f'repos/{{owner}}/{{repo}}/actions/runs'
                               f'?branch={branch}&per_page=100&page={page}',
                               timeout=WAIT_READ_TIMEOUT))
        runs.update({str(r['id']): r for r in listed['workflow_runs']})
        if wanted <= runs.keys() or len(listed['workflow_runs']) < 100:
            return runs
        page += 1


def read_runs(rows, by_id):
    """The run record for each row the API answered for."""
    runs = {}
    if by_id:
        for r in rows:
            try:
                runs[r['run']] = json.loads(
                    gh('api', f'repos/{{owner}}/{{repo}}/actions/runs/{r["run"]}',
                       timeout=WAIT_READ_TIMEOUT))
            except (RuntimeError, ValueError) as e:
                print(f'{r["label"]}: run read failed, nothing changed: {e}')
        return runs
    for branch in sorted({r['branch'] for r in rows}):
        wanted = {r['run'] for r in rows if r['branch'] == branch}
        try:
            listed = branch_runs(branch, wanted)
        except (RuntimeError, ValueError, KeyError) as e:
            print(f'{branch}: run list failed, nothing changed: {e}')
            continue
        for run_id in wanted:
            runs[run_id] = listed.get(run_id, {'status': 'not listed'})
    return runs


def finish(path, row, run):
    """Save a completed run's log and tally it. False when a read failed or the log came
    back empty, which a log read straight after the run finishes can do for a while."""
    try:
        jobs = run_jobs(row['run'])
        log = ''.join(job_log(job['id']) for job in jobs)
    except (RuntimeError, ValueError, KeyError) as e:
        print(f'{row["label"]}: log fetch failed, will retry next check: {e}')
        return False
    if not log.strip():
        print(f'{row["label"]}: log came back empty, will retry next check')
        return False
    logs = path + '.logs'
    os.makedirs(logs, exist_ok=True)
    with open(os.path.join(logs, row['run'] + '.log'), 'w') as f:
        f.write(log)
    row['state'], row['tally'] = 'done', tally(run['conclusion'], jobs)
    print(f'done: {row["label"]} - {row["job"]}\n  {row["tally"]}')
    if run['conclusion'] != 'success':
        for line in findings(log):
            print(line)
    return True


def check(path, notified=None):
    """Tally what has finished. Given notified run ids, reads only those runs, each by id."""
    # Pull request and issue rows settle through their own reads, so check skips them.
    rows = [r for r in read_ledger(path) if r['state'] != 'done' and is_run(r['run'])
            and (notified is None or r['run'] in notified)]
    runs = read_runs(rows, notified is not None)
    updates = {}
    for r in rows:
        run = runs.get(r['run'])
        if run is None:
            continue
        if run['status'] != 'completed':
            updates[r['run']] = (run['status'], '')
        elif finish(path, r, run):
            updates[r['run']] = ('done', r['tally'])
    # add can record a row while the calls above are out, so the ledger is read again here.
    with locked(path):
        rows = read_ledger(path)
        for r in rows:
            if r['run'] in updates and r['state'] != 'done':
                r['state'], r['tally'] = updates[r['run']]
        write_ledger(path, rows)
    waiting = [r for r in rows if r['state'] != 'done']
    counts = {}
    for r in waiting:
        counts[r['state']] = counts.get(r['state'], 0) + 1
    summary = ', '.join(f'{n} {s}' for s, n in sorted(counts.items())) or 'none'
    print(f'{len(rows) - len(waiting)} of {len(rows)} done; still waiting: {summary}')
    return len(waiting)


def installed():
    """Whether gh has the forwarder extension. It is never installed from here."""
    try:
        if EXTENSION in gh('extension', 'list', timeout=EXTENSION_TIMEOUT):
            return True
    except RuntimeError as e:
        print(f'push: could not list gh extensions: {e}')
        return False
    print(f'push: {EXTENSION} is not installed; `gh extension install {EXTENSION}` adds it')
    return False


class Push:
    """This waiter's share of the event stream on this machine."""

    def __init__(self):
        self.proc = self.hook = self.handle = None
        self.holder, self.marked, self.error, self.threads = False, '', '', []
        self.started = self.retry_at = self.checked = 0.0
        self.backoff = FORWARDER_RESTART
        self.partial = b''
        # The latest event for each row, by key.
        self.seen = {}
        # Set when GitHub gave no answer, so wait tries again on its next timer check.
        self.retryable = False
        self.usable = installed()
        if not self.usable:
            return
        try:
            self.repo = gh('repo', 'view', '--json', 'nameWithOwner',
                           '-q', '.nameWithOwner').strip()
        except RuntimeError as e:
            print(f'push: could not reach GitHub, push is off for now: {e}')
            self.usable, self.retryable = False, True
            return
        base = os.path.join(PUSH_DIR, self.repo.replace('/', '__'))
        os.makedirs(base, exist_ok=True)
        self.events = os.path.join(base, 'events.jsonl')
        self.state = os.path.join(base, 'forwarder.state')
        self.hook_file = os.path.join(base, 'forwarder.hook')
        self.lock = open(os.path.join(base, 'forwarder.lock'), 'a')
        # A row can be recorded after its event landed, so the files are read whole.
        try:
            with open(self.events + '.old', 'rb') as f:
                for line in f:
                    self.fold(line)
        except FileNotFoundError:
            pass
        self.read()

    def running(self):
        return self.proc is not None and self.proc.poll() is None

    def tend(self):
        """Hold the lock and keep a forwarder running under it. True while events arrive."""
        if not self.usable:
            return False
        if not self.holder:
            try:
                fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return read_file(self.state) == 'live'
            self.holder = True
            print(f'push: this waiter holds the forwarder for {self.repo}')
        now = time.time()
        if self.running() and now - self.checked >= HOOK_CHECK:
            self.checked = now
            if self.hook is None or self.hook_exists(self.hook) is False:
                print('push: the forwarder has no hook on the repository')
                self.halt()
        if self.running():
            self.mark('live' if self.hook else 'starting')
            return self.hook is not None
        if self.proc:
            lived = now - self.started
            print(f'push: forwarder stopped after {lived:.0f}s with {self.proc.returncode}: '
                  f'{self.error or "no error message"}')
            self.halt()
            self.proc = None
            # A forwarder refused at once, as when another machine holds the hook, waits
            # twice as long after each refusal.
            if lived >= FORWARDER_RESTART:
                self.backoff = FORWARDER_RESTART
            self.retry_at = now + self.backoff
            self.backoff = min(self.backoff * 2, FORWARDER_RESTART_MAX)
        if now < self.retry_at:
            self.mark('down')
            return False
        self.start()
        return False

    def mark(self, state):
        if state != self.marked:
            write_file(self.state, state)
            self.marked = state

    def start(self):
        orphan = f'extensions/gh-webhook/gh-webhook forward --repo {self.repo} '
        if subprocess.run(['pkill', '-f', orphan]).returncode == 0:
            print('push: stopped a forwarder that outlived its waiter')
        made_here = read_file(self.hook_file)
        if made_here:
            self.retire(made_here)
        self.clear_inactive()
        # gh runs the extension as a child process, so halt() signals the whole group.
        self.proc = subprocess.Popen(
            ['gh', 'webhook', 'forward', '--repo', self.repo, '--events', FORWARDED_EVENTS],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            start_new_session=True)
        self.hook, self.error = None, ''
        self.started = self.checked = time.time()
        self.threads = [threading.Thread(target=self.pump, args=(self.proc.stdout,)),
                        threading.Thread(target=self.keep_error, args=(self.proc.stderr,))]
        for t in self.threads:
            t.daemon = True
            t.start()
        self.mark('starting')
        print(f'push: forwarder started at {utc()}')

    def retire(self, hook):
        """Wait for GitHub to drop a hook made here, and delete it if it stays."""
        exists = None
        for _ in range(5):
            exists = self.hook_exists(hook)
            if exists is not True:
                break
            time.sleep(2)
        if exists:
            try:
                gh('api', '-X', 'DELETE', f'repos/{self.repo}/hooks/{hook}')
                print(f'push: deleted hook {hook}, which a forwarder here left behind')
                exists = False
            except RuntimeError as e:
                print(f'push: could not delete hook {hook}: {e}')
        if exists is False and os.path.exists(self.hook_file):
            os.remove(self.hook_file)

    def clear_inactive(self):
        """Delete forwarder hooks GitHub has marked inactive, which no forwarder is using."""
        try:
            hooks = json.loads(gh('api', f'repos/{self.repo}/hooks'))
        except (RuntimeError, ValueError) as e:
            print(f'push: could not list hooks: {e}')
            return
        for hook in hooks:
            # A forwarder's hook is named cli and stays active while one is connected.
            if hook.get('name') != 'cli' or hook.get('active'):
                continue
            last = hook.get('last_response') or {}
            try:
                gh('api', '-X', 'DELETE', f'repos/{self.repo}/hooks/{hook["id"]}')
                print(f'push: deleted inactive hook {hook["id"]}, made '
                      f'{hook.get("created_at")}, last delivery {last.get("code")} '
                      f'{last.get("status")}')
            except RuntimeError as e:
                print(f'push: could not delete inactive hook {hook["id"]}: {e}')

    def hook_exists(self, hook):
        """Whether the repository has the hook, or None when the API gave no answer."""
        try:
            gh('api', '--silent', f'repos/{self.repo}/hooks/{hook}')
            return True
        except RuntimeError as e:
            return False if 'HTTP 404' in str(e) else None

    def pump(self, pipe):
        """Write each event the forwarder prints to the events file as one short line."""
        for raw in pipe:
            try:
                line = self.event_line(json.loads(raw))
                if line is None:
                    continue
                if os.path.exists(self.events) and os.path.getsize(self.events) > EVENTS_ROTATE:
                    os.replace(self.events, self.events + '.old')
                with open(self.events, 'a') as f:
                    f.write(json.dumps(line) + '\n')
            # A bad line is skipped: a stopped thread leaves the forwarder blocked on a full pipe.
            except Exception as e:
                print(f'push: skipped a forwarder line: {e!r}'[:200])

    def event_line(self, event):
        """The events file line for one forwarded event, or None for one no row reads."""
        run = event.get('workflow_run')
        if run:
            return {'event': 'run', 'run': str(run['id']), 'attempt': run.get('run_attempt'),
                    'action': event.get('action'), 'conclusion': run.get('conclusion'),
                    'updated': run.get('updated_at'), 'branch': run.get('head_branch'),
                    'at': utc()}
        # Only a close settles a row; opens, pushes, labels, reviews and reopens do not.
        if event.get('pull_request'):
            if event.get('action') != 'closed':
                return None
            pr = event['pull_request']
            return {'event': 'pr', 'run': f'{PR_PREFIX}{pr["number"]}', 'action': 'closed',
                    'state': 'merged' if pr.get('merged') else 'closed',
                    'sha': pr.get('merge_commit_sha'), 'merged_at': pr.get('merged_at'),
                    'closed_at': pr.get('closed_at'),
                    'branch': (pr.get('head') or {}).get('ref'), 'at': utc()}
        if event.get('issue'):
            if event.get('action') != 'closed':
                return None
            issue = event['issue']
            return {'event': 'issue', 'run': f'{ISSUE_PREFIX}{issue["number"]}',
                    'action': 'closed', 'state': 'closed', 'reason': issue.get('state_reason'),
                    'closed_at': issue.get('closed_at'), 'at': utc()}
        if 'hook_id' in event:
            self.hook = event['hook_id']
            write_file(self.hook_file, str(self.hook))
            return {'event': 'hook', 'hook': self.hook, 'at': utc()}
        return None

    def keep_error(self, pipe):
        """Keep the forwarder's error message; its other lines are usage text and event logs."""
        detail = False
        for raw in pipe:
            text = raw.decode(errors='replace').strip()
            if text.startswith('Error'):
                self.error, detail = text, True
            elif detail and text:
                self.error, detail = f'{self.error} {text}', False

    def halt(self):
        """Stop the forwarder's process group and let the threads write what it printed."""
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(self.proc.pid, sig)
            except ProcessLookupError:
                pass
            for t in self.threads:
                t.join(timeout=10)
            if not any(t.is_alive() for t in self.threads):
                break
        self.proc.wait()

    def stop(self):
        if not self.holder:
            return
        if self.proc:
            self.halt()
            self.proc = None
        self.mark('down')
        fcntl.flock(self.lock, fcntl.LOCK_UN)
        self.holder = False

    def read(self):
        """Fold the events added since the last read into seen. True if a forwarder connected."""
        connected = False
        for line in self.new_lines():
            connected = self.fold(line) or connected
        return connected

    def new_lines(self):
        """Complete lines added to the events file since the last read, across a rename.

        A reader that misses two renames between reads loses the file between them, and
        the timer check covers those rows.
        """
        try:
            inode = os.stat(self.events).st_ino
        except FileNotFoundError:
            return []
        lines = []
        if self.handle and os.fstat(self.handle.fileno()).st_ino != inode:
            lines = self.drain()
            self.handle.close()
            self.handle = None
        if not self.handle:
            self.handle, self.partial = open(self.events, 'rb'), b''
        return lines + self.drain()

    def drain(self):
        *lines, self.partial = (self.partial + self.handle.read()).split(b'\n')
        return lines

    def fold(self, raw):
        """Record one events line. True when the line says a forwarder connected."""
        try:
            line = json.loads(raw)
        except ValueError:
            return False
        if not isinstance(line, dict):
            return False
        if line.get('event') == 'hook':
            return True
        key = line.get('run')
        if line.get('event') in ('pr', 'issue'):
            # The latest close wins: either can be closed, reopened and closed again.
            if key and not is_run(key):
                self.remember(key, line)
            return False
        if line.get('event') != 'run' or not key or line.get('action') not in RANK:
            return False
        # Deliveries can land out of order, so a later attempt or a later action wins.
        old = self.seen.pop(key, None)
        if old and ((old.get('attempt') or 1, RANK[old['action']])
                    >= (line.get('attempt') or 1, RANK[line['action']])):
            line = old
        self.remember(key, line)
        return False

    def remember(self, key, line):
        self.seen.pop(key, None)
        self.seen[key] = line
        if len(self.seen) > SEEN_LIMIT:
            del self.seen[next(iter(self.seen))]


def settle_notices(path, push, acted):
    """Read new events, then settle open pull request and issue rows from their close notices.

    These cost no API call, so wait runs this before and after every read it makes rather
    than leaving a notice queued behind one. True if a forwarder connected.
    """
    connected = push.read()
    for row in read_ledger(path):
        key = row['run']
        if row['state'] == 'done' or is_run(key):
            continue
        event = push.seen.get(key)
        added = row['tally'].removeprefix('added ')
        if event and event.get('at', '') >= added and acted.get(key) != event:
            acted[key] = event
            print(f'push: notice for {key} arrived {event.get("at")}')
            settle_row(path, key, event['state'], notice_tally(event))
    return connected


def wait(path, interval, every=False):
    # Nothing to wait on means no forwarder, and no hook made on the repository for it.
    if not open_rows(path):
        print('wait: nothing open in the ledger')
        return
    push = Push()
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    signal.signal(signal.SIGHUP, lambda *_: sys.exit(0))
    before = done_rows(path)
    try:
        if not push.usable:
            print('push: off, checking on the timer only')
        # A push that failed to reach GitHub is set up again after each timer check, and
        # the waiter moves on to the push loop below once it comes up.
        while not push.usable:
            # With no forwarder, the timer is the only way a pull request or issue row settles.
            reconcile_rows(path)
            check(path)
            if handed_back(path, before, every):
                return
            if not open_rows(path):
                report_finished(path, before)
                return
            sys.stdout.flush()
            time.sleep(interval)
            if push.retryable:
                push = Push()
                if push.usable:
                    print('push: reached GitHub, push is on')
        push.tend()
        # By key: the event last acted on, and for each notified run still open, when it is
        # read next and how many reads it has left.
        acted, pending, gap = {}, {}, False
        reconnect = settle_notices(path, push, acted)
        if handed_back(path, before, every):
            return
        check(path)
        # A forwarder that connects while a check is out is acted on at the next poll.
        reconnect = settle_notices(path, push, acted) or reconnect
        remaining, last = len(open_rows(path)), time.time()
        # Pull request and issue reads that failed on connect, and when they are read again.
        retry, retry_at = set(), 0.0
        while remaining and not handed_back(path, before, every):
            sys.stdout.flush()
            time.sleep(EVENT_POLL)
            live = push.tend()
            # A forwarder that just connected missed what closed before it.
            connected = settle_notices(path, push, acted) or reconnect
            reconnect = False
            gap = connected or gap
            now = time.time()
            if connected:
                retry, retry_at = reconcile_rows(path), now + EVENT_RECHECK
            elif retry and now >= retry_at:
                # One retry; a read that fails again waits for the next connect.
                for key in reconcile_rows(path, retry):
                    print(f'{key} read failed twice; waiting for its push notice '
                          'or the next forwarder connect')
                retry = set()
            remaining = len(open_rows(path))
            for row in read_ledger(path):
                key = row['run']
                if row['state'] == 'done' or not is_run(key):
                    continue
                event = push.seen.get(key)
                if event and event['action'] == 'completed' and acted.get(key) != event:
                    acted[key] = event
                    print(f'push: notice for {key} arrived {event.get("at")}; '
                          f'run updated_at {event.get("updated")}')
                    pending[key] = (now, EVENT_RECHECKS)
            due = {r for r, (at, _) in pending.items() if at <= now}
            timer = interval if gap or not live else max(interval, PUSH_FALLBACK_INTERVAL)
            if now - last >= timer:
                # A close sent while the forwarder is down never arrives, so the timer reads
                # the rows itself. Issue rows are read even while it is live, since a blocked
                # session can wait for days and one read per timer check is cheap.
                reconcile_rows(path, issues_only=live)
                reconnect = settle_notices(path, push, acted)
                check(path)
                last, gap, due = now, False, set(pending)
            elif due:
                check(path, due)
            else:
                continue
            reconnect = settle_notices(path, push, acted) or reconnect
            remaining = len(open_rows(path))
            still_open = open_rows(path)
            for key in due:
                reads = pending.pop(key)[1] - 1
                if key in still_open and reads:
                    pending[key] = (now + EVENT_RECHECK, reads)
        # The loop test skips handed_back once nothing is open, so the last row's
        # sidebar move is printed here.
        if not remaining:
            report_finished(path, before)
    finally:
        push.stop()


def main(argv):
    if len(argv) >= 4 and argv[1] == 'add':
        try:
            add(argv[2], argv[3], ' '.join(argv[4:]) or argv[3])
        except (RuntimeError, ValueError, KeyError) as e:
            print(f'add: run {argv[3]} not recorded: {e}')
            return 1
    elif len(argv) == 3 and argv[1] == 'check':
        check(argv[2])
    elif len(argv) >= 3 and argv[1] == 'wait':
        interval = MIN_INTERVAL
        if '--interval' in argv:
            interval = max(MIN_INTERVAL, int(argv[argv.index('--interval') + 1]))
        return wait(argv[2], interval, '--all' in argv) or 0
    elif len(argv) >= 4 and argv[1] in ('add-pr', 'add-issue'):
        number = argv[3].lstrip('#')
        kind = 'pull request' if argv[1] == 'add-pr' else 'issue'
        adder = add_pr if argv[1] == 'add-pr' else add_issue
        try:
            adder(argv[2], number, ' '.join(argv[4:]) or f'{kind} {number}')
        except (RuntimeError, ValueError, KeyError) as e:
            print(f'{argv[1]}: {kind} {number} not recorded: {e}')
            return 1
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
