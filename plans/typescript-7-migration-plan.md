# TypeScript 7.0 Migration Plan

All findings below were verified empirically against this repo using GA `typescript@7.0.2`,
not inferred from release notes.

## Headline

TypeScript 7.0 is a drop-in win for **compiling** this repo, and a hard blocker for
**tooling**. The migration is additive (run TS7 alongside TS5), not a version bump.

Measured on this repo (264 files):

- `tsc --noEmit` on TS 5.9.3: **8.36s**
- `tsc --noEmit` on TS 7.0.2: **0.86s** (9.7x faster)
- Type-check is clean under TS 7.0.2. Zero new errors.
- Emit succeeds, including all 640 legacy decorators. 261 of 262 output files are
  byte-identical to TS 5.9.3 output.

## Finding 1: `typescript@7` has no programmatic API

TS 7.0.2 is GA and ships as the `typescript` package. Its `lib/` directory contains only
`getExePath.js`, `tsc.js`, `version.cjs`. There is no `typescript.js`. `require("typescript")`
no longer gives you `ts.createProgram`. The `tsc` bin is a shim that launches a Go binary.

Consequences, both verified:

- `typescript-eslint@8.61.1` declares peer `typescript: ">=4.8.4 <6.1.0"`. Installing TS7
  fails peer resolution, and forcing it crashes ESLint with
  `TypeError: Cannot read properties of undefined (reading 'Cjs')`.
  Their tracking issue (#12518) is **closed as not planned**.
- `ts-node` loads the TypeScript JS API at runtime. Every dev, watch, test, and script
  entry point in `package.json` goes through `ts-node/esm`. All of them break.

Microsoft's own guidance is to run TS7 side-by-side with the TS6 JS line. A compat package
`@typescript/typescript6@6.0.2` exists (bin `tsc6`) that re-exports the old API. The stable
TS7 API is expected in 7.1.

## Finding 2: a real TS7 emit bug in this repo (`/hltb` breaks silently)

This is the only behavioral difference across all 262 emitted files, and it is a genuine
compiler bug, not a config issue.

Trigger: a **decorated class** that has a **method whose name equals the class name**.

`src/commands/hltb.command.ts` is the only file in the repo that matches:

```ts
@Discord()
export class hltb {
  @Slash({ description: "How Long to Beat™ Search" })
  async hltb(...) { ... }
}
```

TS 5.9.3 emits the method as `hltb`. TS 7.0.2 renames the method to `hltb_1` but leaves
`__decorate` targeting the original key:

```js
let hltb = hltb_1 = class hltb {
    async hltb_1(title, privateFlag, interaction) { ... }   // renamed
};
__decorate([ Slash({...}), ... ], hltb.prototype, "hltb", null);   // still "hltb"
```

Runtime effect, reduced to a minimal repro and confirmed by executing the output:
`hltb.prototype.hltb` is `undefined`; the method lives at `hltb.prototype.hltb_1`.

discordx wires the handler with:

```js
applicationCommand.decorate(target.constructor, key, target[key]);
```

so `target["hltb"]` is `undefined` and `/hltb` registers with a **null executor**. The build
stays green, type-check stays green, and the command fails only when a user invokes it.

### Fixing it

Rename the method. But note discordx resolves the command name as `options.name ?? key`,
so renaming the method alone silently renames the slash command from `/hltb` to whatever the
new method name is. The rename must pin the name explicitly:

```ts
@Discord()
export class hltb {
  @Slash({ name: "hltb", description: "How Long to Beat™ Search" })
  async execute(...) { ... }
}
```

This is correct under TS 5.9.3 as well, so it can ship on its own, ahead of any TS7 work.

### Lint rule and test (per CLAUDE.md)

- **Custom lint rule: yes, and this is the real guard.** Forbid a decorated class from having a
  method whose name equals the class name. It is a narrow AST check, it is source-level and
  therefore compiler-independent, it catches the entire bug class, and nothing else in the repo
  currently violates it. Add to `eslint-rules/` and register in `eslint.config.ts`.
- **Unit test: yes, but mind what it actually guards.** A smoke test asserting that every
  registered `@Slash` command in `MetadataStorage` has a defined executor is worth having for
  null-executor regressions generally. It will **not** catch this particular bug if run the way
  `npm test` runs today, because `ts-node/esm` transpiles with the TypeScript 5.x pipeline,
  which emits the method correctly. The bug exists only in TS7-emitted output. To guard against
  this regression the test must run against TS7-built JS: compile with `typescript7`, then run
  `node --test` against `build/`. Otherwise it is false assurance.

## Strategy: side-by-side, verified

Do not replace `typescript`. Add TS7 under an npm alias and invoke it by path.

```json
"devDependencies": {
  "typescript": "^5.9.3",
  "typescript7": "npm:typescript@7.0.2"
}
```

Verified with a real install performed **alongside `typescript-eslint@8.61.1` and `eslint@9.37.0`**,
which is the condition that matters, since that peer range (`<6.1.0`) is exactly what rejects TS7
in the main slot:

- `npm install` exits 0. No `ERESOLVE`. npm keys the peer check off the alias slot, not the
  aliased package's internal name, so `typescript7` is invisible to typescript-eslint's peer range.
- `npm ci` from the resulting lockfile also exits 0, and resolves the correct
  `@typescript/typescript-linux-x64` platform binary. This is the step Docker runs.
- `node_modules/.bin/tsc` still resolves to 5.9.3, so ts-node and typescript-eslint are untouched.
- `require("typescript").createProgram` is still a function.
- No bin clobbering, but the aliased package also declares a `tsc` bin, so always invoke it by
  explicit path: `node node_modules/typescript7/bin/tsc`.

Adding the alias regenerates `package-lock.json`. Commit the regenerated lockfile in the same
change, because Docker's `npm ci` hard-fails when the lockfile is out of sync with `package.json`.

## Phases

### Phase 0: fix `/hltb` (ship first, independent of TS7)

1. Rename the method to `execute`, add `name: "hltb"` to `@Slash`.
2. Add the custom lint rule.
3. Add the slash-executor smoke test.

Zero risk under the current compiler. This is a latent correctness fix that happens to also
unblock TS7.

### Phase 1: fast type-checking (low risk, immediate payoff)

1. Add the `typescript7` alias dependency.
2. Point `compile` at it: `"compile": "node node_modules/typescript7/bin/tsc --noEmit"`.
3. Leave `build`, `dev`, `watch`, `test`, `lint` exactly as they are.
4. In CI, run both type-checks for a bake period and require both to pass.

Payoff: the command developers run most often drops from 8.4s to 0.9s. Nothing in the runtime
or lint path changes.

### Phase 2: switch emit / Docker (gated on Phase 0)

1. Flip `"build"` to `node node_modules/typescript7/bin/tsc`.
2. Acceptance gate: emit both compilers to scratch dirs and require a **zero-file diff**.
   Today that diff is exactly one file, `hltb.command.js`, and Phase 0 removes it.
3. Docker: the builder stage already runs `npm ci` inside the image, so the correct
   platform binary resolves there. TS7 ships per-platform binaries as `optionalDependencies`
   (`@typescript/typescript-linux-x64` and friends). Do not copy `node_modules` from the host.
   If you ever build multi-arch, confirm the lockfile carries the arm64 optional dep.
4. Smoke test: bot boots, `/hltb` responds.

### Phase 3: full cutover (blocked, do not attempt now)

Blocked on TS 7.1 shipping the stable programmatic API **and** typescript-eslint supporting it.
Only then can `typescript` itself move to 7.x and the alias be dropped. The fallback, if you
want to move sooner, is aliasing `typescript` to `@typescript/typescript6` for the tooling and
letting TS7 own `tsc`. Revisit when 7.1 lands.

## Adjacent cleanups, explicitly NOT part of TS7

Listing these so they do not get conflated with the migration:

- **TS7 does not replace ts-node.** The native compiler has no runtime loader or REPL. Dev,
  watch, test, and the `scripts/` entry points all stay on ts-node.
- **Node's native type stripping is not an escape hatch.** It is erasure-only, and the 640
  legacy decorators in this repo need a real transform, not erasure. (This machine's Node build
  also reports `ERR_NO_TYPESCRIPT` outright.) Verify before relying on it.
- `ts-node/esm` is invoked via the deprecated `--loader` flag. Migrating to `--import` with
  `module.register`, or moving to `tsx`, is a separate task.
- `@types/node` is `^20` while the dev machine runs Node v22.22. Bump to `^22`.
- `engines.node` claims `>=16`, which is not true for discord.js 14.26 plus `module: Node16`.
  Raise it to `>=20`.

## One concern already closed

`tsconfig.json` sets `allowJs: true`, and the bulk of TS7's documented intentional breaking
changes are in JavaScript and JSDoc semantics. No separate audit is needed: a clean type-check
plus a zero-diff emit across all 262 files already dominates that concern, since any JS or JSDoc
breakage would have surfaced as either a type error or an output difference. Neither appeared.

## Per-phase verification checklist

- Type-check clean under both compilers.
- Emit diff between compilers is empty.
- `npm run lint` clean.
- Bot boots; `/hltb` responds correctly.
- Docker image builds on the target architecture.

## Optional follow-up

File the emit bug upstream at `microsoft/typescript-go`. A minimal repro is:

```ts
function ClassDeco(): any { return () => {}; }
function Deco(): any { return () => {}; }

@ClassDeco()
export class foo {
  @Deco()
  async foo(x: number) { return x; }
}
```

With `experimentalDecorators: true`, TS 7.0.2 emits `async foo_1(x)` while `__decorate`
targets `"foo"`, so `foo.prototype.foo` is `undefined`.
