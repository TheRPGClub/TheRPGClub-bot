#!/usr/bin/env bash
# Refresh .claude/skills/api-reference/SKILL.md from the live OpenAPI spec.
# Requires: gh CLI (authenticated), python3, PyYAML
#
# Usage (from repo root):
#   bash .claude/skills/api-reference/refresh.sh

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
SPEC_TMP="$(mktemp /tmp/rpgclub_swagger_XXXXXX.yaml)"
trap 'rm -f "$SPEC_TMP"' EXIT

echo "Fetching swagger/v1/swagger.yaml from TheRPGClub/TheRPGClub..."
gh api repos/TheRPGClub/TheRPGClub/contents/swagger/v1/swagger.yaml \
  --jq '.content' | base64 -d > "$SPEC_TMP"

echo "Generating SKILL.md..."
python3 "$SKILL_DIR/generate.py" "$SPEC_TMP" "$SKILL_DIR/SKILL.md"

echo "Done. Review the diff with: git diff .claude/skills/api-reference/SKILL.md"
