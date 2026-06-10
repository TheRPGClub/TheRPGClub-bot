Move docs/plan/shared-utilities-standardization-pass-5.md to
docs/work-completed/shared-utilities-standardization-pass-5.md.

Then run a fresh codebase scan and create
docs/plan/shared-utilities-standardization-pass-6.md.

## Context for the scan

Passes 1-5 shipped the following; do NOT re-propose these:
- Pass 1: replyIfNotOwner, safeDeferUpdateOrBail, deferWithShowInChat,
  SHOW_IN_CHAT_DESCRIPTION, isPositiveInt/requirePositiveInt, BotPresenceHistory,
  row mapper extraction
- Pass 2: colors.ts (6 constants), getModalField, isInteractionSettled/canSafeReply,
  DelayUtils.ts (sleep, AUDIT_STEP_DELAY_MS), pagination.ts, roles.ts, LogUtils.ts,
  channel constant fixes
- Pass 3: colors.ts expansion (6 more), DateFormatUtils.ts, ACCESS_DENIED_* constants,
  textLimits.ts initial, isAdmin/isModerator unification, parseCustomIdSegments,
  parsePageNumber, isValidPlaytimeHours
- Pass 4: slice(0,100) sweep (DISCORD_SELECT_LABEL_MAX), DISCORD_AUTOCOMPLETE_DESC_MAX,
  DISCORD_EMBED_FIELD_VALUE_MAX, truncateWithEllipsis, customId.split migration
  (top files), role name constants, giveaway/todo constant alignment, safeIgnore
  (top-density files)
- Pass 5: logError wrapper in LogUtils.ts, safeIgnore complete sweep, chunk<T> in
  ArrayUtils.ts, buildSelectOptions in uiComponents.ts, safeUserFetch/safeMemberFetch,
  buildTextInputRow, userMention/channelMention adoption, buildActionButton factory,
  truncateWithEllipsis remaining sites, NO_RESULTS_MESSAGE/GAME_NOT_FOUND_MESSAGE etc.,
  public-first visibility default (private boolean param), buildPageFooterText,
  assertCustomIdSegments/logUnexpectedCustomId, formatLocalNumber/formatMonthYear,
  PaginationUtils nav button row factories

## Scan instructions

Run each of these greps and use the results to populate pass 6 work items.
Exclude node_modules, build, and package-lock.json from all searches.

1.  grep -rn "\.catch(() => {})" src/ -- safeIgnore residue
2.  grep -rn "\.split(\":\")" src/ --include="*.ts" | grep -v CustomIdUtils -- split residue
3.  grep -rn "new EmbedBuilder" src/ -- count; note files with 3+ instances for embed builder factory analysis
4.  grep -rn "console\.error\|console\.warn" src/ | grep -v "LogUtils\|DiscordConsoleLogger" -- unstructured log residue
5.  grep -rn "\.slice(0, 25)" src/ -- DISCORD_SELECT_OPTIONS_MAX residue
6.  grep -rn "\.slice(0, 50)\b" src/ -- query truncation residue (MAX_QUERY_LENGTH)
7.  grep -rn "\.slice(0, 256)\b" src/ -- DISCORD_EMBED_TITLE_MAX residue
8.  grep -rn "\.slice(0, 80)\b" src/ -- DISCORD_BUTTON_LABEL_MAX residue
9.  grep -rn "ephemeralFlag\|buildComponentsV2Flags" src/ -- check for remaining visibility-pattern inconsistencies
10. grep -rn "interaction\.user\.id !== \|interaction\.user\.id ===" src/ -- owner check residue
11. grep -rn "new ButtonBuilder" src/ | grep -v buildActionButton -- ButtonBuilder chains not using factory
12. grep -rn "toLocaleString\|toLocaleDateString" src/ -- formatting residue
13. grep -rn "isAdmin\|isModerator" src/ --include="*.ts" -- verify single import path is being used everywhere
14. grep -rn "buildPrevNextButtons\|buildNavRow\|buildNavigationRow" src/ -- pagination factory coverage check
15. grep -rln "new StringSelectMenuOptionBuilder\|new SelectMenuOptionBuilder" src/ -- buildSelectOptions migration residue

## Pass 6 document structure

Order work items by ROI (lines eliminated / files touched). Each item must include:
- Problem (with representative file:line examples from the grep results)
- Solution (with concrete code)
- Key files to update
- Verification grep

## GitHub issues

After writing the pass 6 document, create one GitHub issue per work item using:
  gh --repo mfagerstrom/RPGClub_GameDB issue create \
    --title "refactor: <short description>" \
    --body "<item problem + solution summary, 3-5 sentences max>" \
    --label "refactor"

Record each created issue number next to its work item in the document
(e.g., append "(issue #NNN)" to the work item heading). Create all issues
before committing the document so the numbers are baked in.

## Pass 7 prompt section

At the bottom of the pass 6 document, add an H2 section:

### Prompt for Pass 7

> Move docs/plan/shared-utilities-standardization-pass-6.md to
> docs/work-completed/shared-utilities-standardization-pass-6.md.
>
> Then run a fresh codebase scan. Context: passes 1-6 shipped [summarize pass 6 items
> here once they are known]. Do NOT re-propose those items. Scan for new duplication
> and standardization gaps using the same grep strategy used in the pass 6 prompt.
> Order by ROI. Create docs/plan/shared-utilities-standardization-pass-7.md following
> the same document structure as all prior passes. Create one GitHub issue per work
> item using: gh --repo mfagerstrom/RPGClub_GameDB issue create --title "refactor:
> <short description>" --body "<problem + solution, 3-5 sentences>" --label "refactor"
> Record each issue number next to its work item heading in the document.

(Fill in the bracketed summary once the pass 6 items are decided; leave a placeholder
if generating the document before the pass is complete.)

## Constraints

- No behavior changes in pass 6 -- pure extraction, centralization, consistency.
- Lines must stay under 100 characters.
- Run npx tsc --noEmit and npm run lint after drafting to confirm no paths are broken
  before committing. Do not open a PR -- just commit the two doc changes to this branch
  or a new branch and show me the file contents when done.
