# Test plans

Each file here is a full manual test plan for one area of the bot. Its `## Testing`
section follows `.github/pull-request-testing-format.md`, so it can be pasted into a PR
body and run with `/conduct` against the preview bot, or followed by hand. A plan holds
at most 25 steps, so large areas are split into numbered parts. Read each plan's preamble
before running it: it names who must run it, the data it needs, and the data it changes.

Plans that change real data clean up after themselves where the bot allows it. Actions
that cannot be undone (real round edits, closing real votes, IGDB imports into GameDB)
are tested only on their cancel, error, or permission paths.

## Member commands

- `now-playing.md`: /now-playing (the worked example)
- `collection-1.md`, `collection-2.md`, `collection-3.md`: /collection
- `collection-import.md`: /collection CSV and Steam imports
- `backlog-1.md`, `backlog-2.md`, `backlog-3.md`: /backlog, including pick
- `game-completion-1.md`, `game-completion-2.md`: /game-completion
- `game-completion-import.md`: /game-completion Completionator import
- `gamedb-1.md`, `gamedb-2.md`: /gamedb, including its admin subcommands
- `game-journal-1.md`, `game-journal-2.md`, `game-journal-3.md`: game journals
- `profile.md`: /profile, /avatar-history, and the user context menus
- `lookups.md`: /hltb, /timestamp, and /mp-info
- `gotm.md`: /nominate, /noms, /round, and /round-history
- `voting.md`: /vote and /generate-vote-image
- `voting-sandbox-1.md`, `voting-sandbox-2.md`: /vote-sandbox
- `giveaway.md`: /gamegiveaway
- `suggestion.md`: /suggestion
- `threads.md`: /create-thread and /thread
- `help.md`, `help-2.md`: /help

## Staff commands

- `todo.md`: /todo
- `publicreminder.md`: /publicreminder
- `rss.md`: /rss
- `admin-help.md`, `admin-voting.md`, `admin-rounds.md`, `admin-nominations.md`: /admin
- `mod.md`: /mod
- `superadmin.md`: /superadmin

## Event handlers

- `events.md`: message edit and delete logs, pins, reactions, names, link previews
- `events-server.md`: role, channel, emoji, and server change logs
- `events-members.md`: member join, leave, kick, and ban logs (needs a second account)

## Fixtures

- `fixtures/completionator-test.csv`: rows that match no game, for the import plan
