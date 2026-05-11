### Playnite-Style Shared Collage Engine for `/now-playing` and Vote Images

#### Summary
Implement a new shared collage composer in this repo based on the CoverCollageMaker addon algorithm, then route `/now-playing` and existing vote/nominations image paths through it.  
Selected direction:
- Feature scope: core grid only (no title text)
- Scope boundary: shared new service
- Header size recommendation: `1600x900` (16:9) for Discord-friendly message media while reducing payload vs `1920x1080`

#### Implementation Changes
- Add a new shared collage service that ports the addon’s core flow:
  - Validate inputs and column count.
  - Sort covers by mode/order (for v1 keep deterministic existing behavior and expose sorting flags in params).
  - Compute rows from item count and columns.
  - Use fixed final-size mode by default (`1600x900`) with configurable padding and spacing.
  - Compute cell width/height from available canvas area.
  - Resize each cover with aspect-ratio-preserving `contain` behavior and center inside each cell.
  - Draw transparent background (PNG output) and composite all cells.
- Keep existing vote-specific call sites stable by adapting them to new service defaults that preserve their current ordering behavior.
- Replace `/now-playing` composite call to use the new shared service instead of current `composeVoteImage` internals.
- Preserve current attachment behavior and filenames at call sites unless conflicts appear in tests.

#### Public API / Interface Changes
- Introduce a new service contract (or evolve `composeVoteImage` behind a compatibility wrapper) with explicit collage options, for example:
  - `covers`
  - `columns`
  - `finalWidth` / `finalHeight` (default `1600x900`)
  - `padding`, `horizontalSpacing`, `verticalSpacing`
  - `sortMode` (`original|name|path|random`) and `sortOrder` (`asc|desc`) with defaults aligned to current usage
- Keep existing command-level call signatures working by mapping legacy params (`roundNumber`, `voteType`, `sortByTitle`) to the new options until full migration is complete.

#### Test Plan
- Unit tests for grid math and dimension calculation:
  - row/column resolution for 1..N covers
  - cell size calculation with spacing/padding
  - final output dimensions exactly match configured fixed size
- Unit tests for ordering:
  - original order, name asc/desc, random mode (non-deterministic bounded checks)
- Image composition behavior tests:
  - mixed aspect ratios remain contained and centered
  - transparent background preserved
  - no crash on minimal and maximal supported cover counts
- Integration checks on existing flows:
  - `/now-playing list` still returns media gallery with composite attachment
  - `/generate-vote-image` still produces valid image and expected attachment
  - nomination list vote image generation remains functional
- Regression guard:
  - keep old composer path behind a temporary feature flag during migration, then remove after verification.

#### Assumptions and Defaults
- “GameDB covers” means existing `game.imageData` blobs already used in current paths.
- v1 does not port text rendering, font controls, or clipboard/export UI from addon.
- Recommended default header size is `1600x900` (16:9): good visual density for Discord component media, smaller payload than `1920x1080`, and simpler fixed-size rendering.
- If later needed, add per-call selectable sizing modes (`byFinalSize`, `byCellWidth`, `byCellHeight`) as phase 2.

#### Key References
- Addon collage engine:
  - https://github.com/darklinkpower/PlayniteExtensionsCollection/blob/master/source/Generic/CoverCollageMaker/Application/CollageGenerator.cs
  - https://github.com/darklinkpower/PlayniteExtensionsCollection/blob/master/source/Generic/CoverCollageMaker/Domain/ValueObjects/CollageParameters.cs
  - https://github.com/darklinkpower/PlayniteExtensionsCollection/blob/master/source/Generic/CoverCollageMaker/CoverCollageMaker.cs
- Current repo integration points:
  - [now-playing.command.ts](C:\code\RPGClubBotTs\src\commands\now-playing.command.ts:3007)
  - [voteImageComposer.ts](C:\code\RPGClubBotTs\src\services\voteImageComposer.ts:1)
  - [generate-vote-image.command.ts](C:\code\RPGClubBotTs\src\commands\generate-vote-image.command.ts:161)
  - [NominationListComponents.ts](C:\code\RPGClubBotTs\src\functions\NominationListComponents.ts:269)
- Discord message constraints:
  - https://docs.discord.com/developers/resources/message
