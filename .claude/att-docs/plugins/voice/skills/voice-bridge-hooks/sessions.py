#!/usr/bin/env python3
"""Lists the Claude sessions that are open, the way the voice bridge's listSessions does.

Claude Code keeps one file per running session in ~/.claude/sessions, named for the process
id. It carries the session id, the title shown in the app's sidebar, the working directory,
whether a turn is running and the kind. The .key files beside them hold secrets and are never
opened. Interactive sessions are the ones the sidebar shows; background sessions, the kind
start_session makes, are listed too and marked as such. Two sessions with one name are told
apart by a number, in process id order.

SPEAK_SESSIONS_DIR and SPEAK_PROC_DIR point it at fixtures in tests.
"""
import json
import os
import re

KINDS = ("interactive", "bg")


def _read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def list_sessions(sessions_dir=None, proc_dir=None):
    sessions_dir = sessions_dir or os.environ.get(
        "SPEAK_SESSIONS_DIR", os.path.expanduser("~/.claude/sessions"))
    proc_dir = proc_dir or os.environ.get("SPEAK_PROC_DIR", "/proc")
    try:
        files = os.listdir(sessions_dir)
    except OSError:
        return []
    sessions = []
    for name in files:
        # only <pid>.json; the .key files beside them are secrets and are never opened
        if not re.fullmatch(r"\d+\.json", name):
            continue
        entry = _read_json(os.path.join(sessions_dir, name))
        if not isinstance(entry, dict):
            continue
        if not entry.get("messagingSocketPath") or entry.get("kind") not in KINDS:
            continue
        # the file can outlive its process, so the process has to still be there
        if not os.path.exists(os.path.join(proc_dir, str(entry.get("pid")))):
            continue
        cwd = str(entry.get("cwd") or "")
        sessions.append({
            "id": str(entry.get("sessionId") or ""),
            "name": str(entry.get("name") or "").strip() or os.path.basename(cwd),
            "busy": entry.get("status") == "busy",
            "background": entry.get("kind") == "bg",
            "pid": int(entry.get("pid")),
            "cwd": cwd,
        })
    seen = {}
    for s in sorted(sessions, key=lambda s: s["pid"]):
        base = s["name"].lower()
        seen[base] = seen.get(base, 0) + 1
        if seen[base] > 1:
            s["name"] = "%s %d" % (s["name"], seen[base])
    return sorted(sessions, key=lambda s: s["pid"])


def find_session(sessions, ref):
    """The one session ref names: an id, a unique id prefix, a name (numbered ones too), or
    a unique part of a name. Raises LookupError, naming the candidates when there are many."""
    ref = ref.strip()
    low = ref.lower()
    for test in (
        lambda s: s["id"] == ref,
        lambda s: bool(ref) and s["id"].startswith(ref),
        lambda s: s["name"].lower() == low,
        lambda s: bool(low) and low in s["name"].lower(),
    ):
        found = [s for s in sessions if test(s)]
        if len(found) == 1:
            return found[0]
        if len(found) > 1:
            raise LookupError("%r matches %s" % (ref, ", ".join(s["name"] for s in found)))
    raise LookupError("no session matches %r" % ref)
