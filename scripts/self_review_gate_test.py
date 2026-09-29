#!/usr/bin/env python3
"""Checks self_review_gate.py's hook events against stubbed GitHub reads.

usage: python3 scripts/self_review_gate_test.py
"""
import io
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import self_review_gate as gate  # noqa: E402

HEAD = 'a' * 40
NEW_HEAD = 'b' * 40
PASSED = [{'status': 'COMPLETED', 'conclusion': 'SUCCESS'}]
RUNNING = [{'status': 'IN_PROGRESS', 'conclusion': ''}]
FAILED = [{'status': 'COMPLETED', 'conclusion': 'FAILURE'}]


def pr(head=HEAD, checks=PASSED, state='OPEN'):
    return {'number': 7, 'state': state, 'headRefOid': head, 'mergeable': 'MERGEABLE',
            'statusCheckRollup': checks}


URL = 'https://github.com/o/r/pull/7'


GROUPS = {'g-needs': 'Needs Review', 'g-self': 'Self Review'}


def fresh():
    return {'prs': [], 'passes': []}


def review(state, findings):
    gate.on_review(state, {'tool_input': {'skill': 'code-review', 'args': f'high {URL}'}})
    gate.on_findings(state, {'tool_input': {'findings': [{'file': 'x'}] * findings}})


class GateTest(unittest.TestCase):
    def setUp(self):
        self.read = mock.patch.object(gate, 'read_pr', return_value=pr()).start()
        mock.patch.object(gate, 'group_names', return_value=GROUPS).start()
        # No test reaches GitHub over git; a test that wants a head patches this itself.
        mock.patch.object(gate, 'head_from_git', side_effect=RuntimeError('offline')).start()
        self.addCleanup(mock.patch.stopall)

    def test_opened_pr_blocks_stop_until_a_clean_pass(self):
        state = fresh()
        gate.on_pr_opened(state, {'tool_input': {'command': 'gh pr create --title t'},
                                  'tool_response': f'{URL}\n'})
        self.assertEqual(state['prs'], [URL])
        self.assertEqual(gate.on_stop(state, {})['decision'], 'block')
        review(state, 2)
        self.assertEqual(gate.on_stop(state, {})['decision'], 'block')
        review(state, 0)
        self.assertIsNone(gate.on_stop(state, {}))

    def test_url_inside_other_output_is_not_tracked(self):
        state = fresh()
        gate.on_pr_opened(state, {'tool_input': {'command': 'x && gh pr create'},
                                  'tool_response': {'stdout': f"'tool_response': '{URL}'\n"}})
        self.assertEqual(state['prs'], [])
        gate.on_pr_opened(state, {'tool_input': {'command': 'x && gh pr create'},
                                  'tool_response': {'stdout': f'Creating...\n{URL}\n'}})
        self.assertEqual(state['prs'], [URL])

    def test_missing_pr_is_dropped(self):
        state = fresh()
        state['prs'] = [URL]
        self.read.side_effect = RuntimeError('GraphQL: Could not resolve to a Repository')
        self.assertIsNone(gate.on_stop(state, {}))
        self.assertEqual(state['prs'], [])

    def test_transient_404_keeps_the_pr(self):
        state = fresh()
        state['prs'] = [URL]
        self.read.side_effect = RuntimeError('HTTP 404: Not Found')
        self.assertIn('could not read', gate.on_stop(state, {})['systemMessage'])
        self.assertEqual(state['prs'], [URL])

    def test_unknown_group_id_is_denied_while_unfinished(self):
        state = fresh()
        state['prs'] = [URL]
        move = {'tool_input': {'group_id': 'g-unknown', 'session_ids': ['self']}}
        denied = gate.on_sidebar(state, move)['hookSpecificOutput']
        self.assertIn('list_groups', denied['permissionDecisionReason'])
        review(state, 0)
        self.assertIsNone(gate.on_sidebar(state, move))

    def test_mentioning_gh_pr_create_does_not_track(self):
        state = fresh()
        gate.on_pr_opened(state, {'tool_input': {'command': 'grep "gh pr create" x.md'},
                                  'tool_response': URL})
        self.assertEqual(state['prs'], [])

    def test_reviewing_an_untracked_pr_does_not_gate_it(self):
        state = fresh()
        review(state, 3)
        self.assertEqual(state['prs'], [])
        self.assertIsNone(gate.on_stop(state, {}))

    def test_new_commit_needs_a_new_pass(self):
        state = fresh()
        state['prs'] = [URL]
        review(state, 0)
        self.read.return_value = pr(head=NEW_HEAD)
        self.assertIn('no clean pass', gate.on_stop(state, {})['reason'])

    def test_outcome_rereport_is_not_a_pass(self):
        state = fresh()
        state['prs'] = [URL]
        review(state, 3)
        gate.on_findings(state, {'tool_input': {'findings': [{'outcome': 'fixed'}] * 3}})
        self.assertEqual([p['findings'] for p in state['passes']], [3])
        self.assertEqual(gate.on_stop(state, {})['decision'], 'block')

    def test_other_skills_are_not_passes(self):
        state = fresh()
        gate.on_review(state, {'tool_input': {'skill': 'simplify', 'args': '7'}})
        self.assertEqual(state['passes'], [])

    def test_pending_or_failed_ci_on_a_clean_head_blocks(self):
        state = fresh()
        state['prs'] = [URL]
        review(state, 0)
        self.read.return_value = pr(checks=RUNNING)
        self.assertIn('still running', gate.on_stop(state, {})['reason'])
        self.read.return_value = pr(checks=FAILED)
        self.assertIn('CI failed', gate.on_stop(state, {})['reason'])

    def test_pr_without_checks_is_finished_on_a_clean_pass(self):
        state = fresh()
        state['prs'] = [URL]
        self.read.return_value = pr(checks=[])
        review(state, 0)
        self.assertIsNone(gate.on_stop(state, {}))

    def test_merged_pr_is_dropped(self):
        state = fresh()
        state['prs'] = [URL]
        self.read.return_value = pr(state='MERGED')
        self.assertIsNone(gate.on_stop(state, {}))
        self.assertEqual(state['prs'], [])

    def test_total_outage_warns_instead_of_trapping(self):
        state = fresh()
        state['prs'] = [URL]
        self.read.side_effect = RuntimeError('no answer in 20s')
        self.assertIn('could not read', gate.on_stop(state, {})['systemMessage'])

    def test_api_outage_still_blocks_a_missing_pass(self):
        state = fresh()
        state['prs'] = [URL]
        self.read.side_effect = RuntimeError('no answer in 20s')
        with mock.patch.object(gate, 'head_from_git', return_value=HEAD):
            self.assertIn('no clean pass', gate.on_stop(state, {})['reason'])
            review_pass = {'pr': URL, 'sha': HEAD, 'findings': 0}
            state['passes'].append(review_pass)
            self.assertIn('unchecked', gate.on_stop(state, {})['systemMessage'])

    def test_needs_review_move_is_denied_until_finished(self):
        state = fresh()
        state['prs'] = [URL]
        move = {'tool_input': {'group_id': 'g-needs', 'session_ids': ['self']}}
        denied = gate.on_sidebar(state, move)['hookSpecificOutput']
        self.assertEqual(denied['permissionDecision'], 'deny')
        self.assertIsNone(gate.on_sidebar(state, {'tool_input': {'group_id': 'g-self'}}))
        review(state, 0)
        self.assertIsNone(gate.on_sidebar(state, move))

    def test_unreadable_group_cache_fails_closed(self):
        state = fresh()
        state['prs'] = [URL]
        mock.patch.object(gate, 'group_names', return_value={}).start()
        move = {'tool_input': {'group_id': 'g-needs', 'session_ids': ['self']}}
        denied = gate.on_sidebar(state, move)['hookSpecificOutput']
        self.assertEqual(denied['permissionDecision'], 'deny')

    def test_group_names_swallows_import_errors(self):
        mock.patch.stopall()
        with mock.patch.dict(sys.modules, {'enforce_sidebar_move': None}):
            self.assertEqual(gate.group_names(), {})

    def test_read_failure_denies_a_needs_review_move(self):
        state = fresh()
        state['prs'] = [URL]
        self.read.side_effect = RuntimeError('no answer in 20s')
        move = {'tool_input': {'group_id': 'g-needs', 'session_ids': ['self']}}
        denied = gate.on_sidebar(state, move)['hookSpecificOutput']
        self.assertIn('could not read', denied['permissionDecisionReason'])

    def test_review_falls_back_to_git_for_the_head(self):
        state = fresh()
        self.read.side_effect = RuntimeError('no answer in 20s')
        with mock.patch.object(gate, 'head_from_git', return_value=HEAD):
            gate.on_review(state, {'tool_input': {'skill': 'code-review',
                                                  'args': f'high {URL}'}})
        self.assertEqual(state['passes'], [{'pr': URL, 'sha': HEAD, 'findings': None}])

    def test_review_unrecorded_when_both_reads_fail(self):
        state = fresh()
        self.read.side_effect = RuntimeError('no answer in 20s')
        result = gate.on_review(state, {'tool_input': {'skill': 'code-review',
                                                       'args': f'high {URL}'}})
        self.assertIn('NOT recorded', result['systemMessage'])
        self.assertEqual(state['passes'], [])

    def test_read_pr_retries_transient_errors(self):
        mock.patch.stopall()
        replies = [RuntimeError('error connecting'), RuntimeError('error connecting'),
                   '{"state": "OPEN"}']
        with mock.patch.object(gate, 'gh', side_effect=replies), \
                mock.patch.object(gate.time, 'sleep') as sleep:
            self.assertEqual(gate.read_pr(URL), {'state': 'OPEN'})
        self.assertEqual([c.args[0] for c in sleep.call_args_list], [2, 5])

    def test_review_target_forms(self):
        self.assertEqual(gate.review_target(f'high {URL}'), URL)
        with mock.patch.object(gate, 'gh', return_value=URL + '\n') as gh:
            self.assertEqual(gate.review_target('high #7 --comment'), URL)
            gh.assert_called_with('pr', 'view', '7', '--json', 'url', '--jq', '.url')
            self.assertEqual(gate.review_target('high'), URL)
            gh.assert_called_with('pr', 'view', '--json', 'url', '--jq', '.url')

    def test_pr_opened_in_another_repo_keeps_its_repo(self):
        state = fresh()
        other = 'https://github.com/o/other/pull/42'
        gate.on_pr_opened(state, {'tool_input': {'command': 'cd ../x && gh pr create'},
                                  'tool_response': other})
        self.assertEqual(state['prs'], [other])

    def test_conflicting_clean_pr_blocks(self):
        state = fresh()
        state['prs'] = [URL]
        review(state, 0)
        self.read.return_value = dict(pr(), mergeable='CONFLICTING')
        self.assertIn('conflicts', gate.on_stop(state, {})['reason'])

    def test_findings_do_not_close_an_older_open_pass(self):
        state = fresh()
        state['prs'] = [URL]
        gate.on_review(state, {'tool_input': {'skill': 'code-review', 'args': f'high {URL}'}})
        state['passes'].append({'pr': URL, 'sha': 'old', 'findings': 4})
        gate.on_findings(state, {'tool_input': {'findings': []}})
        self.assertEqual(state['passes'][0]['findings'], None)
        self.assertEqual(gate.on_stop(state, {})['decision'], 'block')

    def test_number_keyed_state_is_dropped_on_load(self):
        with mock.patch('builtins.open', mock.mock_open(
                read_data='{"prs": [7, "u"], "passes": [{"pr": 7}], "groups": {}}')):
            self.assertEqual(gate.load('x'), {'prs': ['u'], 'passes': []})

    def test_irrelevant_calls_skip_the_state_file(self):
        self.assertFalse(gate.RELEVANT['pr-opened']({'command': 'git status'}))
        self.assertFalse(gate.RELEVANT['review']({'skill': 'simplify'}))

    def test_ci_state(self):
        self.assertEqual(gate.ci_state(pr(checks=[])), 'none')
        self.assertEqual(gate.ci_state(pr(checks=[{'state': 'PENDING'}])), 'pending')
        self.assertEqual(gate.ci_state(pr(checks=[{'state': 'ERROR'}])), 'failed')
        self.assertEqual(gate.ci_state(pr(checks=PASSED + [{'state': 'SUCCESS'}])), 'passed')


class MainTest(unittest.TestCase):
    """main() end to end: the relevance filter, the state file, and the hook output."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.path = os.path.join(self.dir.name, 'self-review', 's.json')
        mock.patch.object(gate, 'state_path', return_value=self.path).start()
        mock.patch.object(gate, 'read_pr', return_value=pr()).start()
        self.addCleanup(mock.patch.stopall)

    def run_main(self, payload):
        out = io.StringIO()
        with mock.patch('sys.stdin', io.StringIO(json.dumps(payload))), \
                mock.patch('sys.stdout', out):
            self.assertEqual(gate.main(), 0)
        return json.loads(out.getvalue()) if out.getvalue() else None

    def test_unrelated_bash_call_never_creates_state(self):
        self.run_main({'session_id': 's', 'hook_event_name': 'PostToolUse',
                       'tool_name': 'Bash', 'tool_input': {'command': 'ls'}})
        self.assertFalse(os.path.exists(self.path))

    def test_opened_pr_persists_and_blocks_stop(self):
        self.run_main({'session_id': 's', 'hook_event_name': 'PostToolUse',
                       'tool_name': 'Bash', 'tool_input': {'command': 'gh pr create -t x'},
                       'tool_response': {'stdout': URL + '\n'}})
        with open(self.path) as f:
            self.assertEqual(json.load(f)['prs'], [URL])
        stop = {'session_id': 's', 'hook_event_name': 'Stop'}
        self.assertEqual(self.run_main(stop)['decision'], 'block')

    def test_unknown_event_is_ignored(self):
        self.run_main({'session_id': 's', 'hook_event_name': 'PostToolUse', 'tool_name': 'Read'})
        self.assertFalse(os.path.exists(self.path))


if __name__ == '__main__':
    unittest.main()
