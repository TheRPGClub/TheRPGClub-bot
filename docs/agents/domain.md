# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **The club glossary and ADRs in TheRPGClub-api.** This repo has none of its own; the club's domain language and system-wide decisions live there. Read them from a sibling api checkout when one exists, otherwise from GitHub:
  - `gh api repos/TheRPGClub/TheRPGClub-api/contents/GLOSSARY.md -H "Accept: application/vnd.github.raw"`
  - `gh api repos/TheRPGClub/TheRPGClub-api/contents/docs/adr --jq '.[].name'`, then fetch the relevant ADR the same way.
- **`GLOSSARY.md`** at the repo root, if one appears.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.

If one of the repo-root files in this list doesn't exist, **proceed silently** (the api glossary always exists). Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

This repo is single-context. If it ever grows its own glossary, it goes at the root:

```
/
├── GLOSSARY.md
├── docs/adr/
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
