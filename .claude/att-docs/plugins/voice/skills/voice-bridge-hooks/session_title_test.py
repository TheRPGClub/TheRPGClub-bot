#!/usr/bin/env python3
"""Checks session_title.py against fake session files, process folders and inbox sockets.

usage: python3 session_title_test.py
"""
import contextlib
import io
import json
import os
import shutil
import socket
import sys
import tempfile
import threading
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import session_title as st  # noqa: E402


class Titles(unittest.TestCase):
    def test_split_takes_the_status_then_the_last_separator(self):
        self.assertEqual(st.split_title("Overmind 2"), ("Overmind 2", "", ""))
        self.assertEqual(st.split_title("Overmind 2 - read window"),
                         ("Overmind 2", "read window", ""))
        self.assertEqual(st.split_title("Overmind 2 - read window (waiting on CI)"),
                         ("Overmind 2", "read window", "waiting on CI"))
        self.assertEqual(st.split_title("Overmind 2 (idle)"), ("Overmind 2", "", "idle"))
        self.assertEqual(st.split_title("Login - staging - one"),
                         ("Login - staging", "one", ""))
        # Parentheses that are not one of the statuses stay part of the title.
        self.assertEqual(st.split_title("Overmind (draft)"), ("Overmind (draft)", "", ""))

    def test_work_replaces_the_work_name_and_takes_the_status_away(self):
        title = st.new_title("Overmind 2 - old work (stuck)", "work", "read   window")
        self.assertEqual(title, "Overmind 2 - read window")
        self.assertEqual(st.new_title("Overmind 2 - read window", "work", ""), "Overmind 2")
        self.assertEqual(st.new_title("Overmind 2", "work", "one - two"),
                         "Overmind 2 - one two")

    def test_status_keeps_the_base_and_the_work_name(self):
        self.assertEqual(st.new_title("Overmind 2 - read window", "status", "waiting on you"),
                         "Overmind 2 - read window (waiting on you)")
        self.assertEqual(st.new_title("Overmind 2 - read window (stuck)", "status", "idle"),
                         "Overmind 2 - read window (idle)")
        self.assertEqual(st.new_title("Overmind 2 - read window (idle)", "status", ""),
                         "Overmind 2 - read window")
        self.assertEqual(st.new_title("Overmind 2", "status", "stopped"), "Overmind 2 (stopped)")
        with self.assertRaises(ValueError):
            st.new_title("Overmind 2", "status", "napping")

    def test_a_long_work_name_is_cut_on_a_word_to_leave_room_for_the_status(self):
        title = st.new_title("Overmind 2", "work",
                             "a very long work name that would not fit in the sidebar at all")
        self.assertLessEqual(len(title), st.MAX_TITLE)
        self.assertEqual(title, "Overmind 2 - a very long work name that would not fit in the")
        # A status added later takes room from the work name.
        again = st.new_title(title, "status", "waiting on CI")
        self.assertLessEqual(len(again), st.MAX_TITLE)
        self.assertTrue(again.endswith(" (waiting on CI)"))
        self.assertEqual(st.split_title(again)[0], "Overmind 2")

    def test_a_base_with_no_room_is_refused(self):
        with self.assertRaises(ValueError):
            st.compose("x" * 59, "work", "")
        with self.assertRaises(ValueError):
            st.compose("x" * 58, "", "waiting on you")

    def test_a_long_base_keeps_the_status_and_drops_the_work_name(self):
        base = "x" * 40
        title = st.compose(base, "read window", "waiting on you")
        self.assertEqual(title, base + " (waiting on you)")
        self.assertLessEqual(len(title), st.MAX_TITLE)


class Sessions(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)
        self.sessions = os.path.join(self.dir, "sessions")
        self.proc = os.path.join(self.dir, "proc")
        os.makedirs(self.sessions)
        os.makedirs(self.proc)

    def proc_entry(self, pid, parent):
        os.makedirs(os.path.join(self.proc, str(pid)), exist_ok=True)
        fields = ["S", str(parent)] + ["0"] * 20
        with open(os.path.join(self.proc, str(pid), "stat"), "w") as f:
            f.write("%d (a name) with parens) %s" % (pid, " ".join(fields)))

    def session_file(self, pid, name, sock="/nowhere.sock"):
        with open(os.path.join(self.sessions, "%d.json" % pid), "w") as f:
            json.dump({"pid": pid, "name": name, "sessionId": "s-%d" % pid,
                       "messagingSocketPath": sock, "kind": "interactive"}, f)

    def test_the_nearest_ancestor_with_a_session_file_is_the_session(self):
        # shell 30 -> script's parent 20 -> claude 10 -> init 1; another session is elsewhere.
        self.proc_entry(30, 20)
        self.proc_entry(20, 10)
        self.proc_entry(10, 1)
        self.session_file(10, "Overmind 2")
        self.session_file(99, "Other")
        entry = st.find_own_session(self.sessions, self.proc, 30)
        self.assertEqual(entry["pid"], 10)
        self.assertIsNone(st.find_own_session(self.sessions, self.proc, 77))

    def test_a_file_without_a_pid_gets_the_process_id_it_is_named_for(self):
        with open(os.path.join(self.sessions, "40.json"), "w") as f:
            json.dump({"name": "No pid", "messagingSocketPath": "/x.sock"}, f)
        self.assertEqual(st.find_own_session(self.sessions, self.proc, 40)["pid"], 40)
        with open(os.path.join(self.sessions, "41.json"), "w") as f:
            json.dump({"pid": None, "messagingSocketPath": "/x.sock"}, f)
        self.assertEqual(st.find_own_session(self.sessions, self.proc, 41)["pid"], 41)

    def test_a_loop_in_the_process_tree_ends(self):
        self.proc_entry(5, 6)
        self.proc_entry(6, 5)
        self.assertIsNone(st.find_own_session(self.sessions, self.proc, 5))


class Main(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(dir="/tmp")
        self.addCleanup(shutil.rmtree, self.dir)
        self.sessions = os.path.join(self.dir, "sessions")
        self.proc = os.path.join(self.dir, "proc")
        os.makedirs(self.sessions)
        os.makedirs(os.path.join(self.proc, "10"))
        with open(os.path.join(self.proc, "10", "stat"), "w") as f:
            f.write("10 (claude) S 1 " + " ".join(["0"] * 20))
        self.sock_path = os.path.join(self.dir, "inbox.sock")
        self.received = []
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server.bind(self.sock_path)
        self.server.listen(1)
        self.addCleanup(self.server.close)
        self.write_session("Overmind 2 - read window")
        self.env = mock.patch.dict(os.environ, {
            "SESSION_TITLE_SESSIONS_DIR": self.sessions, "SESSION_TITLE_PROC_DIR": self.proc,
            "SESSION_TITLE_PID": "10"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def write_session(self, name):
        with open(os.path.join(self.sessions, "10.json"), "w") as f:
            json.dump({"pid": 10, "name": name, "sessionId": "s-10",
                       "messagingSocketPath": self.sock_path, "kind": "interactive"}, f)

    def serve(self, apply=True):
        """Answers one rename the way the session does: it writes the new title to its file."""
        def run():
            conn, _ = self.server.accept()
            with conn:
                line = conn.makefile().readline()
            message = json.loads(line)
            self.received.append(message)
            if apply:
                self.write_session(message["name"])
        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        return thread

    def run_main(self, *args):
        out, err = io.StringIO(), io.StringIO()
        code = st.main(["session_title.py", *args], out=out, err=err)
        return code, out.getvalue(), err.getvalue()

    def test_work_sends_the_rename_control_message_and_reads_the_title_back(self):
        thread = self.serve()
        code, out, _ = self.run_main("work", "main checkout guard")
        thread.join(5)
        self.assertEqual(code, 0)
        self.assertEqual(self.received, [{
            "type": "control", "action": "rename",
            "name": "Overmind 2 - main checkout guard", "session_id": "s-10"}])
        self.assertEqual(out.strip(),
                         "Renamed Overmind 2 - read window to Overmind 2 - main checkout guard.")

    def test_status_then_work_again_takes_the_status_off(self):
        thread = self.serve()
        self.assertEqual(self.run_main("status", "waiting on you")[0], 0)
        thread.join(5)
        self.assertEqual(self.received[-1]["name"],
                         "Overmind 2 - read window (waiting on you)")
        thread = self.serve()
        self.assertEqual(self.run_main("work", "read window")[0], 0)
        thread.join(5)
        self.assertEqual(self.received[-1]["name"], "Overmind 2 - read window")

    def test_a_title_that_is_already_right_sends_nothing(self):
        code, out, _ = self.run_main("work", "read window")
        self.assertEqual((code, self.received), (0, []))
        self.assertIn("already called", out)

    def test_show_prints_the_current_title(self):
        self.assertEqual(self.run_main("show")[1].strip(), "Overmind 2 - read window")

    def test_bad_input_and_a_missing_session_exit_1(self):
        self.assertEqual(self.run_main()[0], 1)
        self.assertEqual(self.run_main("status", "napping")[0], 1)
        self.assertEqual(self.run_main("work")[0], 1)
        with mock.patch.dict(os.environ, {"SESSION_TITLE_PID": "999"}):
            code, _, err = self.run_main("show")
        self.assertEqual(code, 1)
        self.assertIn("no Claude session", err)
        with mock.patch.dict(os.environ, {"SESSION_TITLE_PID": "abc"}):
            code, _, err = self.run_main("show")
        self.assertEqual(code, 1)
        self.assertIn("must be a process id", err)

    def test_a_title_that_does_not_change_is_said_so(self):
        self.serve(apply=False)
        with mock.patch.object(st, "WAIT_SECONDS", 0.3):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = st.main(["session_title.py", "work", "other"])
        self.assertEqual(code, 0)
        self.assertIn("did not change", out.getvalue())

    def test_an_unreachable_inbox_exits_1(self):
        self.server.close()
        os.remove(self.sock_path)
        code, _, err = self.run_main("work", "other")
        self.assertEqual(code, 1)
        self.assertIn("Could not reach", err)


if __name__ == "__main__":
    unittest.main()
