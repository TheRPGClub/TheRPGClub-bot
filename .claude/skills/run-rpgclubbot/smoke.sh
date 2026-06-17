#!/usr/bin/env bash
# smoke.sh — verify the bot codebase without needing Discord or Oracle credentials
# Usage: bash .claude/skills/run-rpgclubbot/smoke.sh [tsc|lint|tests|--invoke <module-snippet>]
#
# With no args: runs type-check, then lint, then tests (one stage at a time).
# With a stage name: runs only that stage.
# With --invoke: runs a one-liner eval through ts-node for quick module probing.
#
# Examples:
#   bash .claude/skills/run-rpgclubbot/smoke.sh
#   bash .claude/skills/run-rpgclubbot/smoke.sh tsc
#   bash .claude/skills/run-rpgclubbot/smoke.sh lint
#   bash .claude/skills/run-rpgclubbot/smoke.sh tests
#   bash .claude/skills/run-rpgclubbot/smoke.sh --invoke \
#     "import { buildTextContainer } from './src/functions/ComponentsV2Utils.js'; console.log(buildTextContainer('hi').toJSON());"

set -euo pipefail
cd "$(dirname "$0")/../../.."

NODE_OPTS="--no-warnings=ExperimentalWarning --loader ts-node/esm/transpile-only"

if [[ "${1:-}" == "--invoke" ]]; then
  shift
  exec node $NODE_OPTS -e "$*"
fi

STAGE="${1:-all}"

run_tsc() {
  echo "=== type-check ==="
  npx tsc --noEmit
  echo "OK"
}

run_lint() {
  echo "=== lint ==="
  npx eslint
  echo "OK"
}

run_tests() {
  echo "=== tests ==="
  node $NODE_OPTS --test --test-concurrency=5 src/tests/*.test.ts 2>&1 | tee /tmp/rpgclubbot-test-results.txt
  grep -E "^# (tests|pass|fail)" /tmp/rpgclubbot-test-results.txt
}

case "$STAGE" in
  tsc)   run_tsc ;;
  lint)  run_lint ;;
  tests) run_tests ;;
  all)
    run_tsc
    echo ""
    run_lint
    echo ""
    run_tests
    ;;
  *)
    echo "Usage: $0 [tsc|lint|tests]" >&2
    exit 1
    ;;
esac
