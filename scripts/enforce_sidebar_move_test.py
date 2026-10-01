#!/usr/bin/env python3
"""Checks enforce_sidebar_move.py against the sample transcripts in scripts/fixtures/sidebar/.

usage: python3 scripts/enforce_sidebar_move_test.py

Each fixture writes `{SCRATCH}` where a session's scratchpad path would be. The checks copy
the fixture into a temporary directory with that filled in, alongside the catch-up ledger
and background output files the scenario needs, and point the group cache there too.
"""
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import enforce_sidebar_move as guard  # noqa: E402

FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'sidebar')
OPEN_PR = 'PR 77\tfix/x\tpr:77\thttps://github.com/o/r/pull/77\topen\tadded now\t\n'
MERGED_PR = 'PR 77\tfix/x\tpr:77\thttps://github.com/o/r/pull/77\tdone\tmerged\t\n'
OTHER_PR = 'PR 80\tfix/y\tpr:80\thttps://github.com/o/r/pull/80\topen\tadded now\t\n'
WAIT_MERGED = ('done: PR 77 - https://github.com/o/r/pull/77\n  merged\npr: 77 merged\n'
               'sidebar: a pull request closed; move this session to Working if it still '
               'holds work, otherwise Completed\n'
               'wait: 1 finished; 0 still open; act on the result, then run wait again\n')


class Scenario(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = tmp.name
        cache = mock.patch.object(guard, 'GROUP_CACHE', os.path.join(self.dir, 'groups.json'))
        cache.start()
        self.addCleanup(cache.stop)

    def ledger(self, text):
        with open(os.path.join(self.dir, 'catchup.tsv'), 'w') as f:
            f.write(text)

    def output(self, name, text):
        with open(os.path.join(self.dir, name), 'w') as f:
            f.write(text)

    def transcript(self, name, *extra):
        with open(os.path.join(FIXTURES, name)) as f:
            text = f.read().replace('{SCRATCH}', self.dir)
        path = os.path.join(self.dir, name)
        with open(path, 'w') as f:
            f.write(text + ''.join(json.dumps(e) + '\n' for e in extra))
        return path

    def run_stop(self, name, *extra, active=False):
        hook = {'session_id': 's', 'transcript_path': self.transcript(name, *extra),
                'hook_event_name': 'Stop', 'stop_hook_active': active}
        out = io.StringIO()
        with mock.patch('sys.stdin', io.StringIO(json.dumps(hook))), \
                contextlib.redirect_stdout(out):
            self.assertEqual(guard.main(['x', 'stop']), 0)
        return json.loads(out.getvalue()) if out.getvalue().strip() else None

    def assertBlocks(self, decision, *groups):
        self.assertIsNotNone(decision, 'the stop went through')
        self.assertEqual(decision['decision'], 'block')
        for group in groups:
            self.assertIn(f'`{group}`', decision['reason'])
        self.assertNotIn('\u2014', decision['reason'])


def bash(command, output, tool_id='toolu_bash'):
    """A Bash call and its result, appended after a fixture's last entry."""
    return [
        {'type': 'assistant', 'message': {'content': [
            {'type': 'tool_use', 'id': tool_id, 'name': 'Bash',
             'input': {'command': command}}]}},
        {'type': 'user', 'message': {'content': [
            {'type': 'tool_result', 'tool_use_id': tool_id, 'content': output}]}},
    ]


def move(group_id, tool_id='toolu_extra'):
    """A move_sessions call and its result, appended after a fixture's last entry."""
    return [
        {'type': 'assistant', 'message': {'content': [
            {'type': 'tool_use', 'id': tool_id, 'name': guard.MOVE_TOOL,
             'input': {'session_ids': ['self'], 'group_id': group_id}}]}},
        {'type': 'user', 'message': {'content': [
            {'type': 'tool_result', 'tool_use_id': tool_id,
             'content': [{'type': 'text', 'text': 'Moved 1 session.'}]}]}},
    ]


class Milestones(Scenario):
    def test_in_progress_without_a_move_blocks_naming_working(self):
        self.assertBlocks(self.run_stop('in-progress-no-move.jsonl'), 'Working')

    def test_in_progress_then_working_goes_through(self):
        self.assertIsNone(self.run_stop('in-progress-moved.jsonl'))

    def test_pr_opened_while_filed_under_working_blocks(self):
        self.ledger(OPEN_PR)
        decision = self.run_stop('pr-opened-still-working.jsonl')
        self.assertBlocks(decision, 'Needs Review')
        self.assertIn('pull request 77 was opened', decision['reason'])
        self.assertIn('filed under `Working`', decision['reason'])

    def test_pr_opened_then_self_review_blocks_mid_loop(self):
        self.ledger(OPEN_PR)
        decision = self.run_stop('pr-opened-self-review.jsonl')
        self.assertBlocks(decision, 'Needs Review')
        self.assertIn('wait for CI in the foreground', decision['reason'])

    def test_pr_opened_then_needs_review_goes_through(self):
        self.ledger(OPEN_PR)
        self.assertIsNone(self.run_stop('pr-opened-still-working.jsonl',
                                        *move('cg-0000-needs-review')))

    def test_blocker_then_blocked_goes_through(self):
        self.ledger('blocker\t\tissue:40\thttps://github.com/o/r/issues/40\topen\t\t\n')
        self.assertIsNone(self.run_stop('blocker-recorded.jsonl'))

    def test_blocker_while_filed_under_working_blocks(self):
        self.ledger('blocker\t\tissue:40\thttps://github.com/o/r/issues/40\topen\t\t\n')
        self.assertBlocks(self.run_stop('blocker-recorded.jsonl', *move('cg-0000-working')),
                          'Blocked')

    def test_failed_pr_create_is_no_milestone(self):
        self.assertIsNone(self.run_stop('pr-create-failed.jsonl'))


class InProgressCleared(Scenario):
    UNLABEL = bash('gh issue edit 42 --remove-label "In Progress"',
                   'https://github.com/o/r/issues/42', 'toolu_unlabel')
    CLOSE = bash('gh issue close 42 --comment "Already fixed on main"',
                 '\u2713 Closed issue o/r#42 (Fix it)', 'toolu_close')

    def test_unlabel_and_close_then_completed_goes_through(self):
        self.assertIsNone(self.run_stop('in-progress-no-move.jsonl', *self.UNLABEL,
                                        *self.CLOSE, *move('cg-0000-completed')))

    def test_close_alone_allows_completed(self):
        self.assertIsNone(self.run_stop('in-progress-no-move.jsonl', *self.CLOSE,
                                        *move('cg-0000-completed')))

    def test_unlabel_alone_allows_completed(self):
        self.assertIsNone(self.run_stop('in-progress-no-move.jsonl', *self.UNLABEL,
                                        *move('cg-0000-completed')))

    def test_completed_without_clearing_blocks(self):
        self.assertBlocks(self.run_stop('in-progress-no-move.jsonl',
                                        *move('cg-0000-completed')), 'Working')

    def test_closing_another_issue_does_not_count(self):
        close = bash('gh issue close 43', '\u2713 Closed issue o/r#43 (Other)', 'toolu_close')
        self.assertBlocks(self.run_stop('in-progress-no-move.jsonl', *close,
                                        *move('cg-0000-completed')), 'Working')

    def test_failed_close_does_not_count(self):
        close = bash('gh issue close 42', 'GraphQL: Could not resolve to an issue',
                     'toolu_close')
        self.assertBlocks(self.run_stop('in-progress-no-move.jsonl', *close,
                                        *move('cg-0000-completed')), 'Working')

    def test_unlabel_and_close_in_one_command_counts(self):
        both = bash('gh issue edit 42 --remove-label "In Progress" && gh issue close 42',
                    'https://github.com/o/r/issues/42\n\u2713 Closed issue o/r#42 (Fix it)',
                    'toolu_both')
        self.assertIsNone(self.run_stop('in-progress-no-move.jsonl', *both,
                                        *move('cg-0000-completed')))

    def test_close_while_a_pr_is_open_keeps_needs_review(self):
        self.ledger(OPEN_PR)
        ledger = os.path.join(self.dir, 'catchup.tsv')
        add = bash(f'scripts/catchup.py add-pr {ledger} 77 x', 'waiting for merge: x',
                   'toolu_add')
        decision = self.run_stop('in-progress-no-move.jsonl', *add, *self.CLOSE,
                                 *move('cg-0000-completed'))
        self.assertBlocks(decision, 'Needs Review')
        self.assertIn('issue 42 was unlabeled or closed', decision['reason'])

    def test_issue_number_reads_urls_and_flags(self):
        self.assertEqual(guard.issue_number(' --repo o/r 42'), '42')
        self.assertEqual(guard.issue_number(' https://github.com/o/r/issues/42 -c x'), '42')
        self.assertEqual(guard.issue_number(' "#42"'), '42')
        self.assertEqual(guard.issue_number(' --comment "Fixed in 1300" 42'), '42')
        self.assertEqual(guard.issue_number(' --remove-milestone 42'), '42')

    def test_each_gh_issue_call_reads_its_own_number(self):
        edits = guard.issue_edits('gh issue edit 41 --add-label bug && gh issue close 42')
        self.assertEqual([(verb, n) for verb, n, _ in edits], [('edit', '41'), ('close', '42')])


class Merged(Scenario):
    def test_merge_in_a_wait_output_file_blocks_until_completed(self):
        self.ledger(MERGED_PR)
        self.output('b1.output', WAIT_MERGED)
        decision = self.run_stop('pr-merged-notice.jsonl')
        self.assertBlocks(decision, 'Completed', 'Working')
        self.assertIn('pull request 77 merged or closed', decision['reason'])

    def test_merge_then_completed_goes_through(self):
        self.ledger(MERGED_PR)
        self.output('b1.output', WAIT_MERGED)
        self.assertIsNone(self.run_stop('pr-merged-notice.jsonl', *move('cg-0000-completed')))

    def test_merge_from_a_foreground_wait_counts_even_if_the_ledger_lags(self):
        self.ledger(OPEN_PR)
        read = bash('scripts/catchup.py wait /tmp/x/catchup.tsv', WAIT_MERGED)
        self.assertBlocks(self.run_stop('pr-opened-self-review.jsonl', *read), 'Completed')
        self.assertIsNone(self.run_stop('pr-opened-self-review.jsonl', *read,
                                        *move('cg-0000-completed')))

    def test_reading_the_notified_output_file_counts(self):
        self.ledger(OPEN_PR)
        self.output('b1.output', 'wait: 0 finished; 1 still open\n')
        read = bash(f'cat {self.dir}/b1.output', WAIT_MERGED)
        self.assertBlocks(self.run_stop('pr-merged-notice.jsonl', *read), 'Completed')

    def test_reading_an_older_wait_log_is_not_a_merge(self):
        self.ledger(OPEN_PR)
        read = bash('cat /tmp/x/wait.log', WAIT_MERGED)
        decision = self.run_stop('pr-opened-self-review.jsonl', *read)
        self.assertIn('pull request 77 was opened', decision['reason'])

    def test_a_notice_in_an_attachment_counts(self):
        self.ledger(MERGED_PR)
        self.output('b1.output', WAIT_MERGED)
        path = self.transcript('pr-opened-self-review.jsonl')
        with open(path) as f:
            uses = [b for line in f for b in json.loads(line)['message']['content']
                    if isinstance(b, dict) and b.get('type') == 'tool_use']
        wait_id = [u['id'] for u in uses if 'catchup.py wait' in str(u['input'])][-1]
        notice = {'type': 'attachment', 'attachment': {
            'type': 'queued_command', 'commandMode': 'task-notification',
            'prompt': f'<task-notification>\n<tool-use-id>{wait_id}</tool-use-id>\n'
                      f'<output-file>{self.dir}/b1.output</output-file>\n'
                      '</task-notification>'}}
        self.assertBlocks(self.run_stop('pr-opened-self-review.jsonl', notice), 'Completed')

    def test_completed_while_another_pr_is_open_blocks(self):
        self.ledger(MERGED_PR + OTHER_PR)
        self.output('b1.output', WAIT_MERGED)
        decision = self.run_stop('pr-merged-notice.jsonl', *move('cg-0000-completed'))
        self.assertBlocks(decision, 'Working', 'Needs Review')
        self.assertIsNone(self.run_stop('pr-merged-notice.jsonl', *move('cg-0000-needs-review')))

    def test_a_task_notification_is_not_a_new_prompt(self):
        """The notice starts a turn of its own, but the prompt before it still bounds it, so
        the pull request opened earlier in the turn is still the latest milestone."""
        self.ledger(MERGED_PR)
        self.output('b1.output', 'wait: 0 finished; 1 still open\n')
        decision = self.run_stop('pr-merged-notice.jsonl')
        self.assertIn('pull request 77 was opened', decision['reason'])


class IdleTurns(Scenario):
    def test_a_later_prompt_hides_earlier_milestones(self):
        self.ledger(MERGED_PR)
        self.assertIsNone(self.run_stop('question-next-turn.jsonl'))

    def test_open_pr_in_the_ledger_keeps_needs_review(self):
        self.ledger(OPEN_PR)
        self.assertIsNone(self.run_stop('question-next-turn.jsonl',
                                        *move('cg-0000-needs-review')))

    def test_open_pr_in_the_ledger_blocks_self_review(self):
        self.ledger(OPEN_PR)
        self.assertBlocks(self.run_stop('question-next-turn.jsonl'), 'Needs Review')

    def test_open_pr_in_the_ledger_blocks_working(self):
        self.ledger(OPEN_PR)
        decision = self.run_stop('question-next-turn.jsonl', *move('cg-0000-working'))
        self.assertBlocks(decision, 'Needs Review')
        self.assertIn('pull request 77 open in the ledger', decision['reason'])
        self.assertIn('catchup.py wait', decision['reason'])

    def test_a_prompt_without_origin_still_starts_a_turn(self):
        self.ledger(MERGED_PR)
        legacy = {'type': 'user', 'message': {'content': 'thanks'}}
        self.assertIsNone(self.run_stop('in-progress-no-move.jsonl', legacy))
        notice = {'type': 'user', 'message': {'content': '<task-notification>x'}}
        self.assertBlocks(self.run_stop('in-progress-no-move.jsonl', notice), 'Working')

    def test_stop_hook_active_always_goes_through(self):
        self.assertIsNone(self.run_stop('in-progress-no-move.jsonl', active=True))

    def test_missing_transcript_goes_through(self):
        hook = {'transcript_path': os.path.join(self.dir, 'gone.jsonl')}
        self.assertIsNone(guard.decide(hook))


class GroupNames(Scenario):
    def test_unknown_id_blocks_asking_for_list_groups(self):
        decision = self.run_stop('move-by-unknown-id.jsonl')
        self.assertBlocks(decision, 'Working')
        self.assertIn('cg-0000-working', decision['reason'])

    def test_cached_names_resolve_the_id(self):
        groups = [{'id': 'cg-0000-working', 'name': 'Working', 'session_count': 1, 'order': 0}]
        hook = {'tool_name': guard.LIST_TOOL,
                'tool_response': [{'type': 'text', 'text': json.dumps(groups, indent=2)}]}
        with mock.patch('sys.stdin', io.StringIO(json.dumps(hook))):
            self.assertEqual(guard.main(['x', 'cache-groups']), 0)
        with open(guard.GROUP_CACHE) as f:
            self.assertEqual(json.load(f), {'cg-0000-working': 'Working'})
        self.assertIsNone(self.run_stop('move-by-unknown-id.jsonl'))

    def test_cache_reads_a_dict_shaped_response(self):
        text = 'Groups:\n' + json.dumps([{'id': 'cg-a', 'name': 'Working'}]) + '\nsee [docs]'
        hook = {'tool_response': {'content': [{'type': 'text', 'text': text}]}}
        with mock.patch('sys.stdin', io.StringIO(json.dumps(hook))):
            guard.main(['x', 'cache-groups'])
        with open(guard.GROUP_CACHE) as f:
            self.assertEqual(json.load(f), {'cg-a': 'Working'})

    def test_cache_keeps_names_from_earlier_lists(self):
        for gid, name in (('cg-a', 'Working'), ('cg-b', 'Completed')):
            text = json.dumps([{'id': gid, 'name': name}])
            hook = {'tool_response': text}
            with mock.patch('sys.stdin', io.StringIO(json.dumps(hook))):
                guard.main(['x', 'cache-groups'])
        with open(guard.GROUP_CACHE) as f:
            self.assertEqual(json.load(f), {'cg-a': 'Working', 'cg-b': 'Completed'})

    def test_failed_move_does_not_count(self):
        failed = move('cg-0000-working', 'toolu_bad')
        failed[1]['message']['content'][0]['is_error'] = True
        self.assertBlocks(self.run_stop('in-progress-no-move.jsonl', *failed), 'Working')


class Ledgers(unittest.TestCase):
    def test_ledger_path_expands_the_commands_own_variables(self):
        call = guard.Call(0, 'Bash', {
            'command': 'S=/tmp/x/scratchpad; scripts/catchup.py wait "$S/catchup.tsv"'})
        self.assertEqual(guard.ledgers([call]), ['/tmp/x/scratchpad/catchup.tsv'])

    def test_unresolved_variable_is_skipped(self):
        call = guard.Call(0, 'Bash', {'command': 'scripts/catchup.py wait $LEDGER'})
        self.assertEqual(guard.ledgers([call]), [])

    def test_mentioning_gh_pr_create_is_not_running_it(self):
        call = guard.Call(0, 'Bash', {'command': 'grep -n "gh pr create" docs.md'})
        call.result, call.answered = 'https://github.com/o/r/pull/9', True
        self.assertEqual(guard.milestones([call], 0), [])


if __name__ == '__main__':
    unittest.main()
