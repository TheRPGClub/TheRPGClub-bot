#!/usr/bin/env bash
# Vendor a tagged snapshot of the global skills repository into .claude/att-docs
# and record the pin in .claude/att-docs.lock.
# usage: scripts/overmind-sync.sh [<tag>]
# The tag defaults to the one in the lock file. The pruned copy is committed with the lock.
# The repository comes from the lock file, or from ATT_DOCS_REPO on the first run.
# tree= in the lock is the upstream tag's tree; the copy is pruned, so the two differ.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
LOCK=.claude/att-docs.lock
PREFIX=.claude/att-docs
# Only the plugins this repository extends. The rest of the tag stays out of the copy.
PATHS=(plugins/general plugins/voice/skills)

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

if [ -n "$(git status --porcelain -- "$PREFIX")" ]; then
  echo "uncommitted changes under $PREFIX; commit or discard them first" >&2
  exit 1
fi

PINNED_TAG="$(sed -n 's/^tag=//p' "$LOCK" 2>/dev/null || true)"
PINNED_COMMIT="$(sed -n 's/^commit=//p' "$LOCK" 2>/dev/null || true)"

git fetch --quiet --no-tags "https://github.com/$REPO.git" "refs/tags/$TAG"
COMMIT="$(git rev-parse 'FETCH_HEAD^{commit}')"
TREE="$(git rev-parse 'FETCH_HEAD^{tree}')"
if [ "$TAG" = "$PINNED_TAG" ] && [ -n "$PINNED_COMMIT" ] && [ "$COMMIT" != "$PINNED_COMMIT" ]; then
  echo "tag $TAG now points at $COMMIT, not the pinned $PINNED_COMMIT" >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
git archive FETCH_HEAD -- "${PATHS[@]}" | tar -x -C "$STAGE"
rm -rf "$PREFIX"
mkdir -p "$PREFIX"
cp -a "$STAGE"/. "$PREFIX"/

printf 'repo=%s\ntag=%s\ncommit=%s\ntree=%s\npaths=%s\n' \
  "$REPO" "$TAG" "$COMMIT" "$TREE" "${PATHS[*]}" > "$LOCK"
git add -- "$LOCK" "$PREFIX"
echo "vendored $REPO $TAG ($COMMIT) into $PREFIX"
