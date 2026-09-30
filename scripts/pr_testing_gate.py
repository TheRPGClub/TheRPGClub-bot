#!/usr/bin/env python3
"""PreToolUse hook on Bash that refuses a pull request body `/conduct` cannot parse.

usage: python3 scripts/pr_testing_gate.py < hook-input.json

Matches the Bash calls that create or patch a pull request body from a file:

  gh pr create ... --body-file <path>     (also -F <path>, --body-file=<path>)
  gh pr edit ... --body-file <path>
  gh api [-X PATCH] repos/{owner}/{repo}/pulls[/<N>] -F body=@<path>

and runs scripts/check-pr-testing.ts on that file, the same check the implement and
open-pr skills run by hand. A malformed `## Testing` section (exit 1) or an unreadable
file (exit 2) denies the call with the checker's output as the reason, so the session
fixes the body and retries. A valid body, or one with no Testing section, goes through.

A body passed inline (`--body "..."`, `-f body=...`) cannot be checked from a file. It
goes through unless it carries a `## Testing` section, which is denied with a pointer at
`--body-file`. A body read from stdin (`--body-file -`) is not checked.
"""
import json
import os
import re
import shlex
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECKER = os.path.join('scripts', 'check-pr-testing.ts')
NODE = ['node', '--no-warnings=ExperimentalWarning', '--import', 'tsx']
TIMEOUT = 60

# Cheap test on the raw command, so every other Bash call returns before any parsing.
MAYBE = re.compile(r'\bgh\s+(pr\s+(create|edit)|api)\b')
# Every token made only of these ends a simple command: `;`, `&&`, `|`, a newline, a
# subshell parenthesis, and runs of them such as `)\n`.
SEPARATOR_CHARS = set(';&|()\n')
ASSIGNMENT = re.compile(r'^([A-Za-z_][A-Za-z0-9_]*)=(.*)$', re.S)
VARIABLE = re.compile(r'\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))')
PULLS = re.compile(r'^/?repos/[^/]+/[^/]+/pulls(/[^/]+)?$')
TESTING = re.compile(r'^##[ \t]+Testing[ \t]*$', re.M)


def segments(command):
    """Splits a shell command into the simple commands between separators."""
    lexer = shlex.shlex(command, posix=True, punctuation_chars='();<>|&\n')
    lexer.whitespace_split = True
    # A newline separates commands rather than words, and `#` is left in the words: a
    # comment read by shlex would swallow the newline that ends it.
    lexer.whitespace = ' \t\r'
    lexer.commenters = ''
    seg = []
    for token in lexer:
        if set(token) <= SEPARATOR_CHARS:
            if seg:
                yield seg
            seg = []
        else:
            seg.append(token)
    if seg:
        yield seg


def flag_values(args, longs, shorts):
    """Yields each value given to one of the flags, in any of the forms gh accepts."""
    i = 0
    while i < len(args):
        arg = args[i]
        if arg in longs or arg in shorts:
            if i + 1 < len(args):
                yield args[i + 1]
            i += 2
            continue
        for name in longs:
            if arg.startswith(name + '='):
                yield arg[len(name) + 1:]
        for name in shorts:
            if arg.startswith(name) and len(arg) > len(name):
                yield arg[len(name):].removeprefix('=')
        i += 1


def pr_bodies(args):
    """Body sources of `gh pr create` or `gh pr edit`, given the arguments after it."""
    for path in flag_values(args, ('--body-file',), ('-F',)):
        yield ('file', path)
    for text in flag_values(args, ('--body',), ('-b',)):
        yield ('inline', text)


def api_bodies(args):
    """Body sources of `gh api` when it writes a pull request."""
    positional = [a for a in args if not a.startswith('-')]
    if not any(PULLS.match(a) for a in positional):
        return
    for field in flag_values(args, ('--field',), ('-F',)):
        if field.startswith('body=@'):
            yield ('file', field[len('body=@'):])
        elif field.startswith('body='):
            yield ('inline', field[len('body='):])
    for field in flag_values(args, ('--raw-field',), ('-f',)):
        if field.startswith('body='):
            yield ('inline', field[len('body='):])


def expand(word, env):
    """Expands `~` and `$NAME` in a path, preferring values the command itself set."""
    def value(match):
        name = match.group(1) or match.group(2)
        return env.get(name, os.environ.get(name, match.group(0)))
    return os.path.expanduser(VARIABLE.sub(value, word))


def body_sources(command):
    """Every ('file', path) or ('inline', text) body the command passes to a PR.

    A relative path is joined onto the directory an earlier `cd` in the command moved to,
    and variables the command assigned earlier are expanded in it.
    """
    if not MAYBE.search(command):
        return []
    try:
        segs = list(segments(command))
    except ValueError:
        # Unbalanced quoting, usually a heredoc: nothing here can be read reliably.
        return []
    found = []
    env = {}
    cd = ''
    for seg in segs:
        if seg and seg[0] == 'export':
            seg = seg[1:]
        while seg and ASSIGNMENT.match(seg[0]):
            name, value = ASSIGNMENT.match(seg[0]).groups()
            env[name] = expand(value, env)
            seg = seg[1:]
        if len(seg) == 2 and seg[0] == 'cd':
            cd = os.path.join(cd, expand(seg[1], env))
            continue
        if len(seg) < 2 or seg[0] != 'gh':
            continue
        if seg[1] == 'pr' and len(seg) > 2 and seg[2] in ('create', 'edit'):
            sources = pr_bodies(seg[3:])
        elif seg[1] == 'api':
            sources = api_bodies(seg[2:])
        else:
            continue
        for kind, value in sources:
            if kind == 'file' and value != '-':
                value = os.path.join(cd, expand(value, env))
            found.append((kind, value))
    return found


def resolve(path, cwd):
    return path if os.path.isabs(path) else os.path.join(cwd or ROOT, path)


def run_checker(path):
    """Runs the checker on a body file. Returns (exit code, its combined output)."""
    try:
        done = subprocess.run(NODE + [CHECKER, path], cwd=ROOT, capture_output=True,
                              text=True, timeout=TIMEOUT)
    except (OSError, subprocess.TimeoutExpired) as err:
        return 2, f'Could not run {CHECKER}: {err}'
    return done.returncode, (done.stdout + done.stderr).strip()


def deny(reason):
    return {'hookSpecificOutput': {'hookEventName': 'PreToolUse',
                                   'permissionDecision': 'deny',
                                   'permissionDecisionReason': reason}}


def decide(payload, run=run_checker):
    """The hook's output for one payload, or None to let the call through."""
    if payload.get('tool_name') != 'Bash':
        return None
    command = (payload.get('tool_input') or {}).get('command', '')
    for kind, value in body_sources(command):
        if kind == 'inline':
            if TESTING.search(value):
                return deny('This pull request body has a `## Testing` section passed '
                            'inline, which the Testing check cannot read. Write the body '
                            'to a file and pass it with `--body-file <path>` (or '
                            '`-F body=@<path>` for `gh api`).')
            continue
        if value == '-':
            continue
        code, output = run(resolve(value, payload.get('cwd')))
        if code == 1 and 'The ## Testing section cannot be parsed' in output:
            return deny(f'The pull request body in {value} failed the Testing check '
                        f'(`npm run check:pr-testing -- {value}`):\n{output}'
                        '\nFix the body and run the command again.')
        if code != 0:
            return deny(f'The pull request body in {value} could not be checked '
                        f'(`npm run check:pr-testing -- {value}` exited {code}):\n{output}'
                        '\nFix the path or the checker (a missing tsx means `npm ci`), '
                        'then run the command again.')
    return None


def main():
    result = decide(json.load(sys.stdin))
    if result:
        print(json.dumps(result))
    return 0


if __name__ == '__main__':
    sys.exit(main())
