# Sidebar groups

Shared by every skill that works a task through to a pull request or a
finished report. The desktop app's own session states cannot be extended, so
the Code tab sidebar carries custom groups that say where each session stands.
This file is the only place the groups and their moves are written out.

The group names match the ones the PlaywrightTesting skills use, so sessions
from both repos land in the same groups. This repo uses five of them:

- `Blocked`: its task waits on another issue or pull request, and it has
  nothing else to do.
- `Working`: it holds a task and is editing, reading, testing, or deciding.
- `Self Review`: it has opened a pull request whose self review has not come
  back clean yet, per [self-review.md](self-review.md). That covers waiting on
  CI before the first pass and between passes, not only the passes themselves.
- `Needs Review`: a pull request of its own has passed self review clean and
  waits on the user, or it asked the user a question only they can answer.
- `Completed`: its last pull request merged, or its task ended with nothing
  left to wait on.

## The moves

A session files itself, and only itself, with
`mcp__ccd_sidebar__move_sessions` and `session_ids: ["self"]`. Moving any
other session asks the user first, so it is never done unasked.

- Task starts (a skill begins its work, an issue is labeled `In Progress`, or a
  branch is cut for it): `Working`.
- A dependency is still open and the skill stops on it: `Blocked`. See the
  next section.
- Pull request opened, draft or not: `Self Review`, and it stays there until a
  self review pass comes back clean. This holds for every pull request the
  session opens, including one opened on the side of a longer task.
- A clean self review pass, and the turn ends waiting on the user:
  `Needs Review`. Nothing else moves an opened pull request to
  `Needs Review`. A turn that ends idle before the first pass (CI still
  running) or between passes (fixes pushed, `wait` running on the new CI run)
  stays in `Self Review`, with one `wait` running, so the sidebar never tells
  the user a pull request is ready for them before the session has reviewed
  it. When `wait` reports the run, the session runs the next pass.
- More than one pull request open: the least finished one decides, in the
  order `Working`, then `Self Review`, then `Needs Review`. A pull request
  being fixed keeps the session in `Working`; otherwise any open pull request
  whose self review has not come back clean keeps it in `Self Review`;
  `Needs Review` needs every open pull request clean.
- The turn ends on a question only the user can answer: `Needs Review`, unless
  the session holds a pull request whose self review has not come back clean.
  Then it stays in `Self Review` and the report says the review is paused on
  the question.
- The user answers, review comments come in to act on, or CI fails on the
  session's pull request: `Working`. Once the fix is pushed: `Self Review`,
  and `Needs Review` only after the next clean pass.
- The pull request merged or closed without merging (`wait` printing
  `pr: <number> merged` or `pr: <number> closed`, a CI monitor event from the desktop app, or the user
  saying so): pick the group by what the session
  still holds. Any of these means `Working`:

  - another pull request of its own that still needs work;
  - a background task or subagent still running;
  - anything the user asked for in this session that is not finished yet.

  A session that holds another open pull request goes back to `Self Review`
  when that pull request's self review has not come back clean, and to
  `Needs Review` when it has. Only when none of these holds does the session
  go to `Completed`.
- A task that opened no pull request (an investigation, an audit, a filed
  issue) goes to `Completed` when it ends with nothing left to wait on.

## Blocked by another issue

A session is blocked when the skill stops because the work depends on
something that has not landed: a `Depends on #X` or `Blocked by #X` issue
still open, or a change it needs sitting in an unmerged pull request.

1. Report the blocker to the user the way the skill says.
2. Move to `Blocked`, unless the session has something else of its own still
   open. In that case it files by that instead: a pull request whose self
   review has not come back clean is `Self Review`, a clean pull request or a
   question waiting on the user is `Needs Review`, and work it can still do is
   `Working`.
3. Record the blocker in the session's ledger, and make sure one `wait` is
   running on it, per [run-watch.md](run-watch.md#waiting-on-a-blocking-issue):

   ```bash
   scripts/catchup.py add-issue <ledger> <blocking issue> "<short label>"
   ```

   When the blocker is a pull request with no issue behind it, record it with
   `add-pr` instead, and read its `pr: <number> merged` the same way.
4. End the turn. The watcher is the only thing running.

When `wait` prints `issue: <number> closed` and
`sidebar: a blocking issue closed`, or the user invokes the session again
first, the session moves to `Working` and starts the task over from the
skill's first step, because the blocker's merge may have changed the code or
the issue. When the task's own issue is now closed, someone else finished it:
report that and go to `Completed`.

## Rules

- Look the group up by name with `mcp__ccd_sidebar__list_groups` before each
  move, and create a missing one with `mcp__ccd_sidebar__create_group` under
  the exact name above. Ids are not stored anywhere.
- The sidebar tools may be deferred. Load them with one ToolSearch call:
  `select:mcp__ccd_sidebar__list_groups,mcp__ccd_sidebar__create_group,`
  `mcp__ccd_sidebar__move_sessions` (joined into one query).
- Custom groups only show when the sidebar is grouped by `custom`. The session
  never changes the view itself.
- A subagent does not move sessions. The session that spawned it moves itself.
- A sidebar tool that fails or is not loaded is reported in one line and
  skipped. The groups are a convenience, never a gate on any step.
