---
name: investigate
description: Investigate an error reported in a GitHub issue, trace it through the codebase, and rewrite the issue with findings. Use when asked to "/investigate N", "investigate issue #N", or "dig into issue #N".
---

This skill takes a GitHub issue number, reads the reported error or problem, investigates the
codebase to find root causes and relevant context, then rewrites the issue body with structured
findings so it is ready to implement.

The issue number is passed as the skill argument (e.g. `/investigate 123`).

## Sidebar moves

The session files itself in the Code tab sidebar at each step below. These
moves are part of the steps, not optional extras, and skipping one leaves the
user unable to see where the session stands.

Before the first move, load the tools in one call:

```
ToolSearch select:mcp__ccd_sidebar__list_groups,mcp__ccd_sidebar__create_group,mcp__ccd_sidebar__move_sessions
```

Each move: `mcp__ccd_sidebar__list_groups`, take the id of the group by name
(create it with `mcp__ccd_sidebar__create_group` when missing), then
`mcp__ccd_sidebar__move_sessions` with `session_ids: ["self"]` and that id.
Ids are never stored; look them up every time. A tool that fails is reported
in one line and skipped, per
[sidebar-groups.md](../_shared/sidebar-groups.md#rules).

- Step 1, once the issue is found open: `Working`.
- Step 8, after the report: `Completed`, since an investigation opens no pull
  request. When the session still holds other work, the group
  sidebar-groups.md names for it instead.

## Steps (always run in order)

### 1. Fetch the issue

```bash
gh issue view <N> --json number,title,body,labels,state,comments
```

Read the full body and all comments. Extract:
- The reported error message (exact text, stack traces, log lines)
- Steps to reproduce (if any)
- Files or commands mentioned
- Any prior analysis already in comments

If the issue is closed or does not exist, stop and report that to the user.

Otherwise move the session to `Working` (see [Sidebar moves](#sidebar-moves)).

### 2. Identify search targets

From the error message and issue text, extract concrete search terms:
- Function names, method names, class names mentioned in stack traces
- Error string literals
- Command names (Discord slash commands, event names)
- File paths or module names

### 3. Trace the code

Using targeted greps and narrow file reads, trace the code path related to the error.
Do NOT read entire large files -- use grep, then read only the relevant line ranges.

For each relevant finding, record:
- File path and line number(s)
- What the code does
- Why it is relevant to the reported error

Look for:
- The exact function or handler where the error likely originates
- Any data flow leading to that point (inputs, upstream callers)
- Error handling gaps or incorrect assumptions
- Related code that may be affected

```bash
grep -rn "<term>" src/ --include="*.ts" | grep -v node_modules
```

### 4. Check git history for context

If the error involves a specific function or file, check recent changes:

```bash
git log --oneline -20 -- <file>
```

This may surface a recent commit that introduced the regression.

### 5. Formulate findings

Based on the investigation, produce:

- **Root cause**: one or two sentences describing exactly why the error occurs
- **Code location**: file:line where the fix needs to happen
- **Reproduction path**: the exact sequence of events that triggers it
- **Suggested fix**: a concrete, scoped description of what to change (not implementation -- just direction)
- **Related files**: any other files that will need to be touched

If the root cause is unclear after investigation, document what was ruled out and what
still needs to be determined.

### 6. Rewrite the issue

Update the issue body using `gh issue edit`. Preserve the original report in a collapsed
`<details>` block. Structure the new body as:

```
## Summary
- <1-3 bullets: what the bug is and why it matters>

## Root Cause
<One paragraph: exactly why the error occurs, with file:line references>

## Reproduction Path
1. <step>
2. <step>
...

## Code Location
- `<file>:<line>` -- <what is wrong here>
- `<file>:<line>` -- <any related location>

## Suggested Fix
<Concrete description of what to change, scoped to the root cause.
Not a full implementation -- just enough for /implement to take over.>

## Original Report
<details>
<summary>Original issue body</summary>

<original body text here>

</details>
```

**Formatting rules -- enforced, no exceptions:**
- Do NOT use markdown tables. Use bullet lists or plain `file:line` references.
- Do not use emdashes. Use a double-hyphen ( -- ) or rephrase.
- No line-length limit: the 100-character rule in `CLAUDE.md` is for code only, so let
  issue text run as long as reads well.

Apply the edit. Write the rewritten body to `<scratchpad>/issue-body.md` with the Write tool,
never through a heredoc, per [shell-text.md](../_shared/shell-text.md):

```bash
gh issue edit <N> --body-file <scratchpad>/issue-body.md
```

### 7. Add an investigation comment

Post a brief comment summarizing the findings so the history is preserved:

Write it to `<scratchpad>/comment.md`:

```
**Investigation complete.**

Root cause: <one sentence>
Fix location: `<file>:<line>`

Issue body updated with full findings.
```

```bash
gh issue comment <N> --body-file <scratchpad>/comment.md
```

### 8. Report back

Print the issue URL and a one-line summary of the root cause. Then move the session to
`Completed`, or to whatever group the rest of the session's work calls for
(see [Sidebar moves](#sidebar-moves)).

## Common mistakes to avoid

- Do NOT rewrite the issue without doing real codebase investigation first.
- Do NOT guess at root causes -- trace the actual code path.
- Do NOT lose the original report -- always wrap it in `<details>`.
- Do NOT use markdown tables in the issue body.
- Do NOT put multiple concerns in one root cause -- if there are multiple bugs, say so clearly.
- Do NOT read entire large files -- always grep first, then read targeted line ranges.
- Do NOT skip a sidebar move. Each one in [Sidebar moves](#sidebar-moves) is
  part of its step.
