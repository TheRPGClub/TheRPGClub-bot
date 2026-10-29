#!/usr/bin/env bash
# Vendor a tagged snapshot of the global skills repository into .claude/att-docs
# and record the pin in .claude/att-docs.lock.
# usage: scripts/overmind-sync.sh [<tag>]
# The tag defaults to the one in the lock file. The vendored tree is gitignored, so each
# checkout runs this once; only the lock file is committed.
# The repository comes from the lock file, or from ATT_DOCS_REPO on the first run.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
LOCK=.claude/att-docs.lock
PREFIX=.claude/att-docs

TAG="${1:-}"
if [ -z "$TAG" ] && [ -f "$LOCK" ]; then
  TAG="$(sed -n 's/^tag=//p' "$LOCK")"
fi
if [ -z "$TAG" ]; then
  echo "usage: overmind-sync.sh [<tag>]" >&2
  exit 1
fi

REPO="${ATT_DOCS_REPO:-}"
if [ -z "$REPO" ] && [ -f "$LOCK" ]; then
  REPO="$(sed -n 's/^repo=//p' "$LOCK")"
fi
if [ -z "$REPO" ]; then
  echo "no repository: set ATT_DOCS_REPO=<owner>/<name> or add repo= to $LOCK" >&2
  exit 1
fi

git fetch --quiet --no-tags "https://github.com/$REPO.git" "refs/tags/$TAG"
COMMIT="$(git rev-parse 'FETCH_HEAD^{commit}')"
TREE="$(git rev-parse 'FETCH_HEAD^{tree}')"

rm -rf "$PREFIX"
mkdir -p "$PREFIX"
git archive FETCH_HEAD | tar -x -C "$PREFIX"

printf 'repo=%s\ntag=%s\ncommit=%s\ntree=%s\n' "$REPO" "$TAG" "$COMMIT" "$TREE" > "$LOCK"
git add -- "$LOCK"
echo "vendored $REPO $TAG ($COMMIT) into $PREFIX"
