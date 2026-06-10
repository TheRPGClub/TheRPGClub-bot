#!/usr/bin/env bash
# smoke.sh — verify the bot codebase without needing Discord or Oracle credentials
# Usage: bash .claude/skills/run-rpgclubbot/smoke.sh [--invoke <module-snippet>]
#
# With no args: runs type-check, lint, and full test suite.
# With --invoke: runs a one-liner eval through ts-node for quick module probing.
#
# Examples:
#   bash .claude/skills/run-rpgclubbot/smoke.sh
#   bash .claude/skills/run-rpgclubbot/smoke.sh --invoke \
#     "import { buildTextContainer } from './src/functions/ComponentsV2Utils.js'; console.log(buildTextContainer('hi').toJSON());"

set -euo pipefail
cd "$(dirname "$0")/../../.."

NODE_OPTS="--no-warnings=ExperimentalWarning --loader ts-node/esm/transpile-only"

if [[ "${1:-}" == "--invoke" ]]; then
  shift
  exec node $NODE_OPTS -e "$*"
fi

echo "=== type-check ==="
npx tsc --noEmit
echo "OK"

echo ""
echo "=== lint ==="
npx eslint
echo "OK"

echo ""
echo "=== tests ==="
node $NODE_OPTS --test src/tests/*.test.ts 2>&1 | tee /tmp/rpgclubbot-test-results.txt
grep -E "^# (tests|pass|fail)" /tmp/rpgclubbot-test-results.txt
