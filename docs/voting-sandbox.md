# Voting sandbox

`/vote-sandbox` walks a whole GOTM / NR-GOTM voting round in the test guild without
touching production. It exists only in test mode (`TEST_GUILD_ID` set): the command
registers in the test guild and nowhere else, and it refuses to run if it ever reaches
a production bot.

## What is real and what is sandboxed

Real, the same code production runs:

- The voting event handlers (`src/services/VotingEventHandlers.ts`) for every event
  kind, including their "this no longer applies" skips.
- The delivery loop (`processVotingEvents`): events go out oldest first, a failed post
  stays queued and holds back the round's later events.
- The vote panels, their game buttons (or the vote select past 25 games), My Votes and
  Results buttons, the results announcement, the runoff panels and runoff results, the
  tie prompt and the tie-break select.
- Channel routing: posts go to the test guild's announcements, admin and nomination
  channels through the normal `src/config/channels.ts` constants.
- The Discord scheduled event for the next round's vote, created in the test guild.

Sandboxed:

- The round, its nominations, votes, tallies, ties and winners live in memory and in
  one wizard session row per admin (`command_key` `vote-sandbox:current`). Nothing is
  written to a voting round, a nomination or a vote in the API.
- The round's lifecycle is driven by the commands below instead of the API's clock.
  Closing and tie-breaking follow the API's rules: the top game wins, a category with no
  votes has no winner, and a vote past the cap drops the member's oldest vote with a
  warning. A shared top count opens a runoff between only the tied games, one vote per
  member, for a day. When the runoff closes, a sole leader wins. A runoff that ties again
  narrows to its leaders, and one with no votes keeps the whole tie; either way the
  category goes to the admins' tie prompt.
- `round_decided` skips reloading the GOTM caches and creating winner threads, since
  both write through the API. It posts a "Sandbox Round N decided" summary to the admin
  channel in their place. The results announcement carries the TEST MODE banner and
  never creates a winner thread, as with `/admin voting-results channel:`.

Every sandbox post carries a banner, and the sandbox round defaults to Round 999.

## Commands

- `/vote-sandbox start` starts a fresh round in the nominating phase, replacing your
  previous sandbox (whose panels then refuse votes). Options: `round`, `cap` (votes per
  member per category), `gotm-nominations` and `nr-gotm-nominations` (0 to 30
  games each), and `source-round` to copy a real round's nominations read only. Without
  `source-round`, a category nominates past winners from the GOTM and NR-GOTM caches,
  earliest round first, borrowing from the other category's winners when its own run
  out, and never the same game twice. They are real GameDB games, so their covers load
  on the results, runoff and tie-break posts like a live round, and every start
  nominates the same titles. The reply lists every nomination in panel order.
- `/vote-sandbox remind which:` posts the five-day or one-day nomination reminder.
- `/vote-sandbox open` opens voting and posts the panels.
- `/vote-sandbox seed gotm: nr-gotm:` casts simulated votes for an outcome: clear
  winner, two-way tie, three-way tie, or no votes. While a runoff is open it seeds the
  runoff instead, over the tied games only. Reseeding replaces earlier simulated votes
  on that ballot; members' own votes are kept and count on top.
- `/vote-sandbox close` closes voting, posts the results, and either opens a runoff for
  the tied categories or decides the round. Run while a runoff is open, it closes the
  runoff, posts its results, and either decides the round or prompts the admins with the
  tie-break.
- `/vote-sandbox event kind:` fires any single event by hand without changing the
  round, to check that a stale event is skipped rather than posted.
- `/vote-sandbox deliver` retries events that failed to post.
- `/vote-sandbox status` shows the phase, every tally (revealed, for checking), the
  runoff and its tally, pending ties, winners and queued events.
- `/vote-sandbox end` ends the sandbox and deletes its row.

Every step replies with what it delivered and the sandbox status. Each delivered event
links every message it posted (panels and results in announcements, reminders in the
nomination channels, tie prompts and summaries in the admin channel), so a link takes you
straight to the post. Breaking a tie on the sandbox's tie prompt updates the prompt in place, announces the
picked winner in announcements (with the TEST MODE banner, as live picks are announced),
and sends the admin who picked a private reply linking the announcement and the delivery
report.

## Walkthrough checklist

Run these in order in the test guild, as an admin who also has the test guild's
Members role (the panels enforce it as the live ones do). Each line names what to look
for.

1. `/vote-sandbox start`: status shows phase nominating and four games per category.
2. `/vote-sandbox remind which:5d`: the reminder posts in both nomination channels,
   counting down five days. Repeat with `1d`.
3. `/vote-sandbox open`: one panel per category in announcements, each with the
   sandbox banner.
4. On a panel, pick a game: the ephemeral reply confirms the vote. Pick it again: the
   vote is taken back. Pick three games with the default cap of 2: the third reply
   warns that the oldest vote was removed. Press My Votes and check the list.
5. Press Results: the tally is hidden while voting is open, with a vote count.
6. `/vote-sandbox event kind:nomination_reminder_5d`: reported as skipped, nothing
   posts (nominations are closed).
7. `/vote-sandbox seed gotm:winner nr-gotm:two-way-tie`, then `/vote-sandbox close`:
   results post with the TEST MODE banner, GOTM names a winner, and NR-GOTM announces a
   tie that a runoff will decide. An NR-GOTM runoff panel follows in announcements,
   listing only the two tied games. No tie prompt appears in the admin channel.
8. Press Results on the voting panel: the full tally now shows. On the voting panel, pick
   a game: refused, pointing you to the runoff panel.
9. On the runoff panel, pick a tied game, then the other: the second vote replaces the
   first (the runoff cap is one). Press My Votes, then Results: your runoff vote is
   listed, and the runoff tally is hidden until the runoff closes. Pick that game once
   more to take the vote back, so it does not tip the next step.
10. `/vote-sandbox seed nr-gotm:winner`, then `/vote-sandbox close`: the runoff results
    post, naming the NR-GOTM winner, and the "Sandbox Round 999 decided" summary posts in
    the admin channel. A "Round 1000 Vote" scheduled event appears in the test guild.
11. `/vote-sandbox start`, `open`, `seed gotm:three-way-tie nr-gotm:three-way-tie`,
    `close`, then `seed gotm:two-way-tie nr-gotm:no-votes` and `close` again: the runoff
    results say GOTM tied again and NR-GOTM got no votes, and the tie prompt appears in
    the admin channel headed "runoff did not break the tie". GOTM offers the two runoff
    leaders, NR-GOTM all three games.
12. Restart the bot, then pick two games for GOTM (joint winners): the round stays
    undecided until NR-GOTM is picked too. Pick NR-GOTM: the round decides. Pick on the
    prompt again: refused as `no_tie`.
13. `/vote-sandbox start`, `open`, `seed gotm:no-votes nr-gotm:no-votes`, `close`: both
    categories report no winner and the round decides with no tie prompt.
14. `/vote-sandbox start gotm-nominations:30 nr-gotm-nominations:0`, `open`: the GOTM
    panel has two selects; no NR-GOTM panel posts.
15. `/vote-sandbox start gotm-nominations:1 nr-gotm-nominations:1`, `open`, then
    `seed gotm:two-way-tie`: refused, one game cannot tie.
16. `/vote-sandbox start source-round:<a past round>`, `open`: the panels list that
    round's real nominations, and voting on them changes nothing in the API.
17. Vote on a panel from an earlier sandbox: refused as belonging to an ended sandbox.
18. `/vote-sandbox end`: the current panels now refuse votes too.
