#!/usr/bin/env python3
"""Checks self_review_gate.py's hook events against stubbed GitHub reads.

usage: python3 scripts/self_review_gate_test.py
"""
import os
import sys
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


def fresh():
    return {'prs': [], 'passes': [], 'groups': {'g-needs': 'Needs Review', 'g-self': 'Self Review'}}


def review(state, findings):
    gate.on_review(state, {'tool_input': {'skill': 'code-review', 'args': 'high 7'}})
    gate.on_findings(state, {'tool_input': {'findings': [{'file': 'x'}] * findings}})


class GateTest(unittest.TestCase):
    def setUp(self):
        self.read = mock.patch.object(gate, 'read_pr', return_value=pr()).start()
        self.addCleanup(mock.patch.stopall)

    def test_opened_pr_blocks_stop_until_a_clean_pass(self):
        state = fresh()
        gate.on_pr_opened(state, {'tool_input': {'command': 'gh pr create --title t'},
                                  'tool_response': 'https://github.com/o/r/pull/7\n'})
        self.assertEqual(state['prs'], [7])
        self.assertEqual(gate.on_stop(state, {})['decision'], 'block')
        review(state, 2)
        self.assertEqual(gate.on_stop(state, {})['decision'], 'block')
        review(state, 0)
        self.assertIsNone(gate.on_stop(state, {}))

    def test_mentioning_gh_pr_create_does_not_track(self):
        state = fresh()
        gate.on_pr_opened(state, {'tool_input': {'command': 'grep "gh pr create" x.md'},
                                  'tool_response': 'github.com/o/r/pull/7'})
        self.assertEqual(state['prs'], [])

    def test_new_commit_needs_a_new_pass(self):
        state = fresh()
        review(state, 0)
        self.read.return_value = pr(head=NEW_HEAD)
        self.assertIn('no clean pass', gate.on_stop(state, {})['reason'])

    def test_outcome_rereport_is_not_a_pass(self):
        state = fresh()
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
        review(state, 0)
        self.read.return_value = pr(checks=RUNNING)
        self.assertIn('still running', gate.on_stop(state, {})['reason'])
        self.read.return_value = pr(checks=FAILED)
        self.assertIn('CI failed', gate.on_stop(state, {})['reason'])

    def test_pr_without_checks_is_finished_on_a_clean_pass(self):
        state = fresh()
        self.read.return_value = pr(checks=[])
        review(state, 0)
        self.assertIsNone(gate.on_stop(state, {}))

    def test_merged_pr_is_dropped(self):
        state = fresh()
        state['prs'] = [7]
        self.read.return_value = pr(state='MERGED')
        self.assertIsNone(gate.on_stop(state, {}))
        self.assertEqual(state['prs'], [])

    def test_read_failure_warns_instead_of_trapping(self):
        state = fresh()
        state['prs'] = [7]
        self.read.side_effect = RuntimeError('no answer in 20s')
        self.assertIn('could not read', gate.on_stop(state, {})['systemMessage'])

    def test_needs_review_move_is_denied_until_finished(self):
        state = fresh()
        state['prs'] = [7]
        move = {'tool_input': {'group_id': 'g-needs', 'session_ids': ['self']}}
        denied = gate.on_sidebar(state, move)['hookSpecificOutput']
        self.assertEqual(denied['permissionDecision'], 'deny')
        self.assertIsNone(gate.on_sidebar(state, {'tool_input': {'group_id': 'g-self'}}))
        review(state, 0)
        self.assertIsNone(gate.on_sidebar(state, move))

    def test_groups_are_learned_from_list_groups(self):
        state = {'prs': [], 'passes': [], 'groups': {}}
        blocks = [{'type': 'text', 'text': '[{"id": "g1", "name": "Needs Review"}]'}]
        gate.on_groups(state, {'tool_response': blocks})
        self.assertEqual(state['groups'], {'g1': 'Needs Review'})
        gate.on_groups(state, {'tool_response': '[{"id": "g2", "name": "Working"}]'})
        self.assertEqual(state['groups']['g2'], 'Working')

    def test_review_target_forms(self):
        self.assertEqual(gate.review_target('high 1187'), 1187)
        self.assertEqual(gate.review_target('high #12 --comment'), 12)
        self.assertEqual(gate.review_target('https://github.com/o/r/pull/99'), 99)

    def test_ci_state(self):
        self.assertEqual(gate.ci_state(pr(checks=[])), 'none')
        self.assertEqual(gate.ci_state(pr(checks=[{'state': 'PENDING'}])), 'pending')
        self.assertEqual(gate.ci_state(pr(checks=[{'state': 'ERROR'}])), 'failed')
        self.assertEqual(gate.ci_state(pr(checks=PASSED + [{'state': 'SUCCESS'}])), 'passed')


if __name__ == '__main__':
    unittest.main()
