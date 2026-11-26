<!--
Title: `type(scope)!: description`, e.g. `feat(bot): add the /patch-notes command`.
type is feat, fix, perf, refactor, chore, docs, test or ci; the (scope) and the !
are optional. feat bumps the minor version, fix and perf the patch version, and
! (or a line starting `BREAKING CHANGE:` below) the major version. See CLAUDE.md.
-->

## Summary

-

Patch note: <!-- one sentence in members' words, or leave empty -->

<!--
Patch note (optional): one line in members' words for the next Patch, e.g.
`Patch note: /patch-notes now shows any past Patch by its number.` Write it after the
label or on the next line. Leave it empty when members won't notice the change.
-->

## Testing

<!--
Each step must follow the exact shape below so the automated conductor can parse it.
Format reference: .github/pull-request-testing-format.md

### Step N: <short label>
```
<command or action, exactly as typed in Discord>
```
Expected: <what a human should see, with the exact text to check in double quotes,
optionally scoped: title: "..." button: "..." option: "..." field: "..." not: "...">
Ephemeral: yes | no

Quote at least one exact string per step, and give real option values, not placeholders.

Delete this whole section if the change is not testable in Discord (docs, CI, tooling).
A section that does not follow the shape is treated as unparseable and falls back to
manual testing, which is safe but slower.
-->

## Checklist

- [ ] Type-check passes (`npx tsc --noEmit`)
- [ ] Lint passes (`npm run lint`)
- [ ] Tests pass (`npm test`)

<!-- One `Closes #X` per line. Comma-separated closes on one line are not picked up. -->
Closes #
