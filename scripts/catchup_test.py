#!/usr/bin/env python3
"""Checks catchup.py add, run tallies, and pull request and issue rows, against a stub gh
that fails the way the real one does.

usage: python3 scripts/catchup_test.py

The stub sits first on PATH, so catchup.gh runs it as a real process and add sees gh's own
stderr wording. Pauses are skipped, so the checks run in about a second.
"""
import contextlib
import io
import json
import os
import stat
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catchup  # noqa: E402

STUB = """#!/usr/bin/env python3
import json, os, sys
state = os.environ['STUB_GH_STATE']
calls = int(open(state).read() or 0) + 1 if os.path.exists(state) else 1
open(state, 'w').write(str(calls))
if calls <= int(os.environ['STUB_GH_FAILS']):
    sys.stderr.write(os.environ['STUB_GH_ERROR'] + '\\n')
    sys.exit(1)
if sys.argv[-1].endswith('/jobs'):
    print(json.dumps({'jobs': [{'html_url': 'https://example.test/job/7'}]}))
else:
    print(json.dumps({'head_branch': 'fix/stub', 'html_url': 'https://example.test/run/42',
                      'display_title': 'CI  on   fix/stub'}))
"""

NOT_FOUND = 'gh: Not Found (HTTP 404)'


class TempLedger(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = tmp.name
        self.ledger = os.path.join(self.dir, 'ledger.tsv')


class StubGh(TempLedger):
    def setUp(self):
        super().setUp()
        gh = os.path.join(self.dir, 'gh')
        with open(gh, 'w') as f:
            f.write(STUB)
        os.chmod(gh, os.stat(gh).st_mode | stat.S_IEXEC)
        self.state = os.path.join(self.dir, 'calls')
        path = self.dir + os.pathsep + os.environ.get('PATH', '')
        env = mock.patch.dict(os.environ, {'PATH': path, 'STUB_GH_STATE': self.state})
        env.start()
        self.addCleanup(env.stop)
        sleep = mock.patch.object(catchup.time, 'sleep')
        sleep.start()
        self.addCleanup(sleep.stop)

    def run_add(self, fails, error=NOT_FOUND):
        os.environ['STUB_GH_FAILS'] = str(fails)
        os.environ['STUB_GH_ERROR'] = error
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            code = catchup.main(['catchup.py', 'add', self.ledger, '42', 'stub label'])
        return code, out.getvalue()

    def calls(self):
        with open(self.state) as f:
            return int(f.read())


class AddRetry(StubGh):
    def test_two_404s_then_success_records_one_row(self):
        code, out = self.run_add(fails=2)
        rows = catchup.read_ledger(self.ledger)
        self.assertEqual(code, 0, out)
        self.assertEqual([r['run'] for r in rows], ['42'])
        self.assertEqual(rows[0]['job'], 'https://example.test/job/7')
        self.assertEqual(rows[0]['title'], 'CI on fix/stub')
        self.assertEqual(out.count('trying again'), 2, out)
        self.assertNotIn('Traceback', out)

    def test_adding_again_keeps_one_row(self):
        self.run_add(fails=0)
        os.remove(self.state)
        code, out = self.run_add(fails=2)
        self.assertEqual(code, 0, out)
        self.assertEqual(len(catchup.read_ledger(self.ledger)), 1)

    def test_three_404s_record_nothing_and_exit_nonzero(self):
        code, out = self.run_add(fails=3)
        self.assertEqual(code, 1, out)
        self.assertEqual(catchup.read_ledger(self.ledger), [])
        self.assertIn('add: run 42 not recorded: gh: Not Found (HTTP 404)', out)
        self.assertEqual(self.calls(), 3)
        self.assertNotIn('Traceback', out)

    def test_a_refusal_is_not_retried(self):
        code, out = self.run_add(fails=1, error='gh: Bad credentials (HTTP 401)')
        self.assertEqual(code, 1, out)
        self.assertEqual(self.calls(), 1)
        self.assertNotIn('trying again', out)


LOG = '\n'.join((
    '2026-09-26T21:38:17.4039201Z Run npx tsc --noEmit',
    '2026-09-26T21:38:19.0000000Z src/x.ts(3,1): error TS2304: Cannot find name y.',
    '2026-09-26T21:38:19.1000000Z ##[error]Process completed with exit code 2.',
))
JOBS = [{'id': 108, 'name': 'lint', 'conclusion': 'success', 'steps': []},
        {'id': 109, 'name': 'typecheck', 'conclusion': 'failure',
         'steps': [{'name': 'Checkout', 'conclusion': 'success'},
                   {'name': 'Type-check', 'conclusion': 'failure'}]}]


class FinishLog(TempLedger):
    """finish reads a finished run's jobs and logs, saves the log, and tallies the run."""

    def run_finish(self, conclusion='failure', log=LOG):
        row = {'label': 'stub', 'run': '42', 'job': 'https://example.test/job/108'}
        calls = []

        def fake_gh(*gh_args, timeout=None):
            calls.append(gh_args[-1])
            if gh_args[-1].endswith('/runs/42/jobs'):
                return json.dumps({'jobs': JOBS})
            if gh_args[-1].endswith('/logs'):
                return log
            raise AssertionError(f'unexpected gh call {gh_args}')

        out = io.StringIO()
        with mock.patch.object(catchup, 'gh', side_effect=fake_gh), \
                contextlib.redirect_stdout(out):
            done = catchup.finish(self.ledger, row, {'conclusion': conclusion})
        saved = None
        if os.path.exists(self.ledger + '.logs/42.log'):
            with open(self.ledger + '.logs/42.log') as f:
                saved = f.read()
        return done, row, out.getvalue(), calls, saved

    def test_a_failed_run_names_its_failed_job_step_and_errors(self):
        done, row, out, calls, saved = self.run_finish()
        self.assertTrue(done)
        self.assertEqual(calls[1:], ['repos/{owner}/{repo}/actions/jobs/108/logs',
                                     'repos/{owner}/{repo}/actions/jobs/109/logs'])
        self.assertEqual(saved, LOG * 2)
        self.assertEqual(row['tally'], 'failure jobs=2 failed: typecheck (Type-check)')
        self.assertIn('  Process completed with exit code 2.', out)

    def test_a_green_run_prints_no_error_lines(self):
        _, row, out, _, _ = self.run_finish(conclusion='success')
        self.assertTrue(row['tally'].startswith('success jobs=2'))
        self.assertNotIn('Process completed', out)

    def test_an_empty_log_leaves_the_row_open_for_the_next_check(self):
        done, row, out, _, saved = self.run_finish(log='')
        self.assertFalse(done)
        self.assertNotIn('state', row)
        self.assertIsNone(saved)
        self.assertIn('log came back empty, will retry next check', out)


OPEN_ISSUE = {'html_url': 'https://example.test/issues/9', 'state': 'open',
              'state_reason': None, 'closed_at': None}
CLOSED_ISSUE = {'html_url': 'https://example.test/issues/9', 'state': 'closed',
                'state_reason': 'completed', 'closed_at': '2026-09-23T18:00:00Z'}
OPEN_PR = {'url': 'https://example.test/pull/5', 'headRefName': 'fix/stub', 'state': 'OPEN',
           'mergedAt': None, 'closedAt': None, 'mergeCommit': None}
MERGED_PR = {**OPEN_PR, 'state': 'MERGED', 'mergedAt': '2026-09-23T19:00:00Z',
             'mergeCommit': {'oid': 'abcdef1234567'}}


class Rows(TempLedger):
    def run_main(self, *args, answer=OPEN_ISSUE):
        out = io.StringIO()
        with mock.patch.object(catchup, 'gh', return_value=json.dumps(answer)) as gh, \
                contextlib.redirect_stdout(out):
            code = catchup.main(['catchup.py', *args])
        return code, out.getvalue(), gh


class IssueRow(Rows):
    """An issue row waits for a blocking issue to close."""

    def test_an_open_issue_records_one_open_row(self):
        code, out, gh = self.run_main('add-issue', self.ledger, '#9', 'blocker')
        self.assertEqual(code, 0, out)
        self.assertIn('waiting for close: blocker - https://example.test/issues/9', out)
        self.assertEqual(gh.call_args.args, ('api', 'repos/{owner}/{repo}/issues/9'))
        rows = catchup.read_ledger(self.ledger)
        self.assertEqual([(r['run'], r['state']) for r in rows], [('issue:9', 'open')])

    def test_a_closed_issue_settles_at_once(self):
        code, out, _ = self.run_main('add-issue', self.ledger, '9', answer=CLOSED_ISSUE)
        self.assertEqual(code, 0, out)
        self.assertIn('issue: 9 closed', out)
        row = catchup.read_ledger(self.ledger)[0]
        self.assertEqual(row['state'], 'done')
        self.assertEqual(row['tally'], 'closed as completed at 2026-09-23T18:00:00Z')

    def test_a_failed_read_records_nothing_and_exits_nonzero(self):
        out = io.StringIO()
        with mock.patch.object(catchup, 'gh', side_effect=RuntimeError('HTTP 404')), \
                contextlib.redirect_stdout(out):
            code = catchup.main(['catchup.py', 'add-issue', self.ledger, '9'])
        self.assertEqual(code, 1)
        self.assertIn('add-issue: issue 9 not recorded', out.getvalue())
        self.assertEqual(catchup.read_ledger(self.ledger), [])

    def test_check_does_not_read_an_issue_row(self):
        self.run_main('add-issue', self.ledger, '9')
        code, out, gh = self.run_main('check', self.ledger)
        self.assertEqual(code, 0, out)
        gh.assert_not_called()
        self.assertIn('0 of 1 done; still waiting: 1 open', out)

    def test_a_closed_issue_names_the_move_out_of_blocked(self):
        self.run_main('add-issue', self.ledger, '9')
        before = catchup.done_rows(self.ledger)
        out = io.StringIO()
        with mock.patch.object(catchup, 'gh', return_value=json.dumps(CLOSED_ISSUE)), \
                contextlib.redirect_stdout(out):
            self.assertEqual(catchup.reconcile_rows(self.ledger, issues_only=True), set())
            self.assertTrue(catchup.report_finished(self.ledger, before))
        self.assertIn('issue: 9 closed', out.getvalue())
        self.assertIn('sidebar: a blocking issue closed; move this session from Blocked',
                      out.getvalue())

    def test_issues_only_leaves_pull_request_rows_unread(self):
        with open(self.ledger, 'w') as f:
            f.write('pr\tfix/stub\tpr:5\turl\topen\tadded 2026-09-23T00:00:00Z\t\n')
        with mock.patch.object(catchup, 'gh') as gh:
            catchup.reconcile_rows(self.ledger, issues_only=True)
        gh.assert_not_called()


class PullRequestRow(Rows):
    def test_an_open_pull_request_records_one_open_row(self):
        code, out, _ = self.run_main('add-pr', self.ledger, '5', answer=OPEN_PR)
        self.assertEqual(code, 0, out)
        self.assertIn('waiting for merge: pull request 5 - https://example.test/pull/5', out)
        row = catchup.read_ledger(self.ledger)[0]
        self.assertEqual((row['run'], row['branch'], row['state']), ('pr:5', 'fix/stub', 'open'))

    def test_a_merged_pull_request_settles_and_names_the_move(self):
        self.run_main('add-pr', self.ledger, '5', answer=OPEN_PR)
        before = catchup.done_rows(self.ledger)
        out = io.StringIO()
        with mock.patch.object(catchup, 'gh', return_value=json.dumps(MERGED_PR)), \
                contextlib.redirect_stdout(out):
            catchup.reconcile_rows(self.ledger)
            catchup.report_finished(self.ledger, before)
        self.assertIn('merged abcdef123 at 2026-09-23T19:00:00Z', out.getvalue())
        self.assertIn('pr: 5 merged', out.getvalue())
        self.assertIn('sidebar: a pull request closed', out.getvalue())


class Forwarder(TempLedger):
    """The forwarder writes close notices to the events file and the reader keeps them."""

    def push(self):
        push = object.__new__(catchup.Push)
        push.events = os.path.join(self.dir, 'events.jsonl')
        push.hook_file = os.path.join(self.dir, 'hook')
        push.seen = {}
        return push

    def pumped(self, push, *events):
        with contextlib.redirect_stdout(io.StringIO()):
            push.pump([json.dumps(e).encode() for e in events])
        with open(push.events, 'rb') as f:
            return f.read().splitlines()

    def test_an_issue_close_is_written_and_an_edit_is_not(self):
        push = self.push()
        closed = {'action': 'closed', 'issue': {'number': 9, 'state_reason': 'completed',
                                                'closed_at': '2026-09-23T18:00:00Z'}}
        lines = self.pumped(push, {'action': 'labeled', 'issue': {'number': 9}}, closed)
        self.assertEqual(len(lines), 1)
        push.fold(lines[0])
        self.assertEqual(catchup.notice_tally(push.seen['issue:9']),
                         'closed as completed at 2026-09-23T18:00:00Z')

    def test_a_merge_notice_reads_as_merged(self):
        push = self.push()
        merged = {'action': 'closed', 'pull_request': {
            'number': 5, 'merged': True, 'merge_commit_sha': 'abcdef1234567',
            'merged_at': '2026-09-23T19:00:00Z', 'closed_at': '2026-09-23T19:00:00Z'}}
        lines = self.pumped(push, merged)
        push.fold(lines[0])
        self.assertEqual(catchup.notice_tally(push.seen['pr:5']),
                         'merged abcdef123 at 2026-09-23T19:00:00Z')

    def test_a_late_in_progress_event_does_not_hide_the_completed_one(self):
        push = self.push()
        run = {'id': 42, 'run_attempt': 1}
        lines = self.pumped(push, {'action': 'completed', 'workflow_run': run},
                            {'action': 'in_progress', 'workflow_run': run})
        for line in lines:
            push.fold(line)
        self.assertEqual(push.seen['42']['action'], 'completed')


if __name__ == '__main__':
    unittest.main()
