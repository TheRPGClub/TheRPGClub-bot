# /admin nominations test plan

A pass over `/admin delete-gotm-noms` and `/admin delete-nr-gotm-noms`: the deletion
panel, its nomination menu, the required-reason modal, and the stale-menu reply. It is
one of four `/admin` plans; the others are `admin-help.md`, `admin-voting.md`, and
`admin-rounds.md`.

It never deletes another member's nomination. Step 1 records your own NR-GOTM
nomination for Tetris, and step 3 deletes that same nomination through the admin panel,
so the round ends as it started. The nomination and its deletion are also announced in
the test guild's NR-GOTM nominations channel. The GOTM panel is only opened, never used.
Steps 2 and 4 to 6 are safe to repeat; run steps 1 and 3 again together only.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Run it as a member with the Administrator permission in the test guild (the guild owner
works). Nominations must be open for the upcoming round, at least one GOTM nomination
must exist for it, and you must not already have an NR-GOTM nomination for it (step 1
would replace it, and step 3 would delete it). Nobody else should have nominated Tetris
for NR-GOTM.

## Testing

### Step 1: Record your own NR-GOTM nomination
```
/nominate type:NR-GOTM title:Tetris reason:Conductor test nomination
```
Expected: pick the title from autocomplete. An ephemeral reply,
"Recorded your NR-GOTM nomination for Round", naming "Tetris", and not: "replaced".
Ephemeral: yes

### Step 2: Open the NR-GOTM deletion panel
```
/admin delete-nr-gotm-noms
```
Expected: an ephemeral panel, "NR-GOTM Nominations - Round", listing the nominations,
with a menu, Choose a nomination to delete, that holds option: "Tetris".
Ephemeral: yes

### Step 3: Delete your nomination with a reason
```
click "Tetris" in "Choose a nomination to delete",
enter "Conductor test cleanup" in "Deletion reason", submit
```
Expected: the menu opens the Delete nomination modal. After submit, an ephemeral reply
that you "deleted" the nomination "Tetris" for "NR-GOTM Round", with
"Reason: Conductor test cleanup" and the updated list. The same notice posts in the test
guild's NR-GOTM nominations channel.
Ephemeral: yes

### Step 4: Pick the deleted nomination from the old panel
```
select "Tetris" in "Choose a nomination to delete" on the step 2 panel
```
Expected: an ephemeral reply, "That nomination no longer exists. Run the command again."
No modal opens. If Discord still shows Tetris chosen, pick it again after reopening the
menu.
Ephemeral: yes

### Step 5: Reopen the NR-GOTM deletion panel
```
/admin delete-nr-gotm-noms
```
Expected: either the panel without Tetris, or, if Tetris was the only NR-GOTM
nomination, "No NR-GOTM nominations found for Round". Either way, not: "Tetris".
Ephemeral: yes

### Step 6: Open the GOTM deletion panel
```
/admin delete-gotm-noms
```
Expected: an ephemeral panel, "GOTM Nominations - Round", listing the nominations with a
menu, Choose a nomination to delete, and not: "No GOTM nominations found". Do not pick
anything from it.
Ephemeral: yes
