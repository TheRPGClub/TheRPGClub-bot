#!/usr/bin/env python3
"""Checks pr_testing_gate.py: which commands it matches and when it denies them.

usage: python3 scripts/pr_testing_gate_test.py

The end-to-end cases run the real checker through node and tsx, and are skipped when
node_modules/tsx is missing (run `npm ci`).
"""
import os
import shlex
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pr_testing_gate as gate  # noqa: E402

VALID = '''## Summary
- x

## Testing

### Step 1: Ping
```
/ping
```
Expected: the reply says "Pong".
Ephemeral: no
'''
MALFORMED = '''## Testing

### Step 1: Ping
Expected: the reply says "Pong".
Ephemeral: maybe
'''
NO_TESTING = '## Summary\n- nothing to test in Discord\n'


def payload(command, cwd='/repo'):
    return {'hook_event_name': 'PreToolUse', 'tool_name': 'Bash', 'cwd': cwd,
            'tool_input': {'command': command}}


class Matcher(unittest.TestCase):
    def test_pr_create_body_file_forms(self):
        for cmd in ('gh pr create --title t --body-file /s/b.md',
                    'gh pr create --title t --body-file=/s/b.md',
                    'gh pr create -F /s/b.md --title t',
                    'gh pr create -F/s/b.md',
                    'git push -u origin HEAD && gh pr create --body-file /s/b.md',
                    'GH_PAGER= gh pr create --body-file /s/b.md'):
            with self.subTest(cmd=cmd):
                self.assertEqual(gate.body_sources(cmd), [('file', '/s/b.md')])

    def test_pr_edit_body_file(self):
        self.assertEqual(gate.body_sources('gh pr edit 12 --body-file b.md'),
                         [('file', 'b.md')])

    def test_api_patch_body_field(self):
        for cmd in ('gh api -X PATCH repos/{owner}/{repo}/pulls/12 -F body=@/s/b.md',
                    'gh api --method PATCH repos/o/r/pulls/12 --field body=@/s/b.md',
                    'gh api repos/o/r/pulls/12 -XPATCH -Fbody=@/s/b.md',
                    'gh api /repos/o/r/pulls -F title=t -F body=@/s/b.md'):
            with self.subTest(cmd=cmd):
                self.assertEqual(gate.body_sources(cmd), [('file', '/s/b.md')])

    def test_inline_bodies(self):
        self.assertEqual(gate.body_sources('gh pr create --body "hi there"'),
                         [('inline', 'hi there')])
        self.assertEqual(gate.body_sources('gh pr create -b hi'), [('inline', 'hi')])
        self.assertEqual(gate.body_sources('gh api -X PATCH repos/o/r/pulls/1 -f body=x'),
                         [('inline', 'x')])

    def test_unrelated_commands(self):
        for cmd in ('gh pr view 12 --json body',
                    'gh pr list --search "gh pr create --body-file x"',
                    'grep -n "gh pr create --body-file" CLAUDE.md',
                    'gh api repos/o/r/issues/12 -X PATCH -F body=@b.md',
                    'gh api repos/o/r/pulls/12/comments -F body=@b.md',
                    'gh issue create --body-file b.md',
                    'echo gh pr create --body-file b.md',
                    "gh pr create --body-file - <<'EOF'\nit's\nEOF",
                    'npm test'):
            with self.subTest(cmd=cmd):
                self.assertEqual(gate.body_sources(cmd), [])

    def test_newlines_and_comments_separate_commands(self):
        for cmd in ('cd /w\ngh pr create --body-file /s/b.md',
                    'git push # first\ngh pr create --body-file /s/b.md',
                    'git push &&\n  gh pr create --body-file /s/b.md'):
            with self.subTest(cmd=cmd):
                self.assertEqual(gate.body_sources(cmd), [('file', '/s/b.md')])

    def test_cd_and_variables_in_the_command(self):
        self.assertEqual(gate.body_sources('cd sub && gh pr create --body-file b.md'),
                         [('file', 'sub/b.md')])
        self.assertEqual(gate.body_sources('cd /a; cd b\ngh pr edit 1 -F c.md'),
                         [('file', '/a/b/c.md')])
        self.assertEqual(gate.body_sources('B=/s/pr.md; gh pr create --body-file "$B"'),
                         [('file', '/s/pr.md')])
        self.assertEqual(
            gate.body_sources('export D=/s\ngh api repos/o/r/pulls/1 -F body=@${D}/b.md'),
            [('file', '/s/b.md')])

    def test_resolve_relative_to_cwd(self):
        self.assertEqual(gate.resolve('b.md', '/work'), '/work/b.md')
        self.assertEqual(gate.resolve('/abs/b.md', '/work'), '/abs/b.md')


class Decision(unittest.TestCase):
    def run_with(self, command, code, output='why'):
        seen = []

        def fake(path):
            seen.append(path)
            return code, output
        return gate.decide(payload(command), run=fake), seen

    def test_malformed_denies_with_reason(self):
        result, seen = self.run_with('gh pr create --body-file b.md', 1,
                                     'The ## Testing section cannot be parsed: x')
        self.assertEqual(seen, ['/repo/b.md'])
        out = result['hookSpecificOutput']
        self.assertEqual(out['permissionDecision'], 'deny')
        self.assertIn('cannot be parsed', out['permissionDecisionReason'])
        self.assertNotIn('—', out['permissionDecisionReason'])

    def test_unreadable_denies(self):
        result, _ = self.run_with('gh api -X PATCH repos/o/r/pulls/3 -F body=@/x.md', 2,
                                  'Cannot read /x.md: ENOENT')
        reason = result['hookSpecificOutput']['permissionDecisionReason']
        self.assertIn('Cannot read /x.md', reason)
        self.assertIn('could not be checked', reason)

    def test_valid_passes(self):
        result, seen = self.run_with('gh pr create --body-file b.md', 0)
        self.assertIsNone(result)
        self.assertEqual(len(seen), 1)

    def test_stdin_body_not_checked(self):
        result, seen = self.run_with('gh pr create --body-file -', 1)
        self.assertIsNone(result)
        self.assertEqual(seen, [])

    def test_inline_with_testing_denied(self):
        result, seen = self.run_with('gh pr create --body ' + shlex.quote(VALID), 0)
        self.assertEqual(seen, [])
        self.assertIn('--body-file', result['hookSpecificOutput']['permissionDecisionReason'])

    def test_inline_without_testing_passes(self):
        result, _ = self.run_with('gh pr create --body "short body"', 1)
        self.assertIsNone(result)

    def test_other_tools_ignored(self):
        self.assertIsNone(gate.decide({'tool_name': 'Read', 'tool_input': {}}))


@unittest.skipUnless(os.path.isdir(os.path.join(gate.ROOT, 'node_modules', 'tsx')),
                     'node_modules/tsx is missing; run npm ci')
class EndToEnd(unittest.TestCase):
    def check(self, body):
        with tempfile.NamedTemporaryFile('w', suffix='.md', delete=False) as f:
            f.write(body)
        self.addCleanup(os.remove, f.name)
        return gate.decide(payload(f'gh pr create --title t --body-file {f.name}'))

    def test_valid_body_passes(self):
        self.assertIsNone(self.check(VALID))

    def test_body_without_testing_passes(self):
        self.assertIsNone(self.check(NO_TESTING))

    def test_malformed_body_denied(self):
        reason = self.check(MALFORMED)['hookSpecificOutput']['permissionDecisionReason']
        self.assertIn('cannot be parsed', reason)

    def test_missing_file_denied(self):
        result = gate.decide(payload('gh pr create --body-file /nonexistent/pr-body.md'))
        self.assertIn('Cannot read', result['hookSpecificOutput']['permissionDecisionReason'])


if __name__ == '__main__':
    unittest.main()
