#!/usr/bin/env python3
"""Sets the title of the Claude session it runs in, without the voice bridge.

usage: session_title.py work "<work name>"
       session_title.py status "<status>"
       session_title.py show

A session title reads "<base>", "<base> - <work>", and, when the session has stopped or is
waiting, "<base> - <work> (<status>)". The base is the title the session started with, such
as "Overmind 2". Setting the work name replaces the old work name and takes any status away,
since work has resumed. Setting a status keeps the base and the work name and replaces the old
status. An empty work name or an empty status takes that part away. The status is one of
STATUSES, so a title can always be taken apart again, and the voice bridge strips the same
suffix when it reads a base title.

The session is the nearest ancestor of this process that has a file in ~/.claude/sessions,
which is the Claude Code process whose shell ran this script. The title is changed the way
/rename does it: the same control message the app's session list sends is written to the
session's own inbox socket, then the session's file is read until it shows the new title.

SESSION_TITLE_SESSIONS_DIR, SESSION_TITLE_PROC_DIR and SESSION_TITLE_PID point it at fixtures
in tests. It prints what happened and exits 0, or prints why not to stderr and exits 1.
"""
import json
import os
import re
import socket
import sys
import time

STATUSES = ("idle", "waiting on you", "stuck", "stopped", "waiting on CI")
SEPARATOR = " - "
# The longest title the sidebar and the bridge take.
MAX_TITLE = 60
# How long to read the session's file for the new title before saying it did not appear.
WAIT_SECONDS = 5.0
POLL_SECONDS = 0.25
STATUS_SUFFIX = re.compile(r"\s+\((%s)\)$" % "|".join(re.escape(s) for s in STATUSES))


def split_title(title):
    """(base, work, status) for a title; work and status are empty when it has none. The
    last separator ends the base, as in the voice bridge."""
    title = title.strip()
    status = ""
    found = STATUS_SUFFIX.search(title)
    if found:
        status = found.group(1)
        title = title[:found.start()].strip()
    at = title.rfind(SEPARATOR)
    if at < 0:
        return title, "", status
    return title[:at].strip(), title[at + len(SEPARATOR):].strip(), status


def clip_to_words(text, room):
    """text cut to at most room characters, on a word when it can be."""
    if len(text) <= room:
        return text
    cut = re.sub(r"\s+\S*$", "", text[:room + 1])[:room].strip()
    return cut or text[:room]


def compose(base, work, status):
    """The title for a base, a work name and a status. The work name gives up characters
    first when the title would pass MAX_TITLE."""
    work = " ".join(work.replace(SEPARATOR, " ").split())
    tail = " (%s)" % status if status else ""
    if work:
        room = MAX_TITLE - len(base) - len(SEPARATOR) - len(tail)
        if room >= 1:
            return base + SEPARATOR + clip_to_words(work, room) + tail
        # A status is worth more than the work name, so a long base keeps the status alone.
        if tail:
            return compose(base, "", status)
        raise ValueError(
            "%r leaves no room for a work name under %d characters" % (base, MAX_TITLE))
    if len(base) + len(tail) > MAX_TITLE:
        raise ValueError("%r leaves no room for a status under %d characters" % (base, MAX_TITLE))
    return base + tail


def new_title(current, command, value):
    """The title after `command` ('work' or 'status') is given `value`."""
    base, work, status = split_title(current)
    if command == "work":
        return compose(base, value, "")
    if value and value not in STATUSES:
        raise ValueError("status is one of: %s" % ", ".join(STATUSES))
    return compose(base, work, value)


def _read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _parent_of(pid, proc_dir):
    """The parent process id of pid from /proc, or None where it cannot be read."""
    try:
        with open(os.path.join(proc_dir, str(pid), "stat")) as f:
            # The command name sits in parentheses and may hold spaces.
            return int(f.read().rsplit(")", 1)[1].split()[1])
    except (OSError, IndexError, ValueError):
        return None


def find_own_session(sessions_dir, proc_dir, start):
    """The session file entry of the nearest ancestor of process `start` (itself included)
    that has one with an inbox socket, or None."""
    seen = set()
    pid = start
    while pid and pid > 1 and pid not in seen:
        seen.add(pid)
        entry = _read_json(os.path.join(sessions_dir, "%d.json" % pid))
        if isinstance(entry, dict) and entry.get("messagingSocketPath"):
            # The file is named for the process, so the process id is known even when the
            # file does not carry it.
            entry["pid"] = pid
            return entry
        pid = _parent_of(pid, proc_dir)
    return None


def send_rename(entry, name):
    """Writes the rename control message to the session's inbox socket."""
    message = {"type": "control", "action": "rename", "name": name}
    if entry.get("sessionId"):
        message["session_id"] = entry["sessionId"]
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
        conn.settimeout(5)
        conn.connect(entry["messagingSocketPath"])
        conn.sendall((json.dumps(message) + "\n").encode("utf-8"))


def wait_for_title(sessions_dir, pid, name, wait=None):
    """Whether the session's file shows `name` within `wait` seconds (WAIT_SECONDS by
    default)."""
    deadline = time.monotonic() + (WAIT_SECONDS if wait is None else wait)
    while True:
        entry = _read_json(os.path.join(sessions_dir, "%d.json" % pid))
        if isinstance(entry, dict) and str(entry.get("name") or "").strip() == name:
            return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(POLL_SECONDS)


def main(argv, out=None, err=None):
    out = out or sys.stdout
    err = err or sys.stderr
    args = argv[1:]
    if not args or args[0] not in ("work", "status", "show") \
            or (args[0] != "show" and len(args) != 2) or (args[0] == "show" and len(args) != 1):
        print(__doc__.strip().splitlines()[2], file=err)
        return 1
    sessions_dir = os.environ.get(
        "SESSION_TITLE_SESSIONS_DIR", os.path.expanduser("~/.claude/sessions"))
    proc_dir = os.environ.get("SESSION_TITLE_PROC_DIR", "/proc")
    given = os.environ.get("SESSION_TITLE_PID") or str(os.getppid())
    if not re.fullmatch(r"[0-9]+", given):
        print("SESSION_TITLE_PID must be a process id, not %r." % given, file=err)
        return 1
    start = int(given)
    entry = find_own_session(sessions_dir, proc_dir, start)
    if entry is None:
        print("This process has no Claude session above it, so there is no title to set.",
              file=err)
        return 1
    current = str(entry.get("name") or "").strip()
    if args[0] == "show":
        print(current, file=out)
        return 0
    try:
        name = new_title(current, args[0], " ".join(args[1].split()))
    except ValueError as error:
        print(str(error), file=err)
        return 1
    if name == current:
        print("The session is already called %s." % current, file=out)
        return 0
    try:
        send_rename(entry, name)
    except OSError as error:
        print("Could not reach the session's inbox: %s" % error, file=err)
        return 1
    if wait_for_title(sessions_dir, int(entry["pid"]), name):
        print("Renamed %s to %s." % (current, name), file=out)
    else:
        print("Asked the session to rename itself to %s, but its title did not change within "
              "%g seconds." % (name, WAIT_SECONDS), file=out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
