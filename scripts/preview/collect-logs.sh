#!/usr/bin/env bash
# Prints recent logs of the preview container and the conductor to stdout. Run on the
# self-hosted runner by .github/workflows/preview-logs.yml, which encrypts the output
# before it leaves the machine. Never run it where its output lands in a public log.
#
#   collect-logs.sh <lines>
set -uo pipefail

LINES="${1:-500}"
[[ "${LINES}" =~ ^[0-9]+$ ]] || { echo "collect-logs: lines must be a number" >&2; exit 1; }
CONDUCTOR_UNIT="${CONDUCTOR_UNIT:-rpgclub-conductor}"
LABEL_FILTER="label=rpgclub.preview=true"

section() {
  printf '\n===== %s =====\n' "$1"
}

section "collected $(date -u +%Y-%m-%dT%H:%M:%SZ) on $(hostname)"

section "preview containers"
docker ps -a --filter "${LABEL_FILTER}" --format \
  'table {{.ID}}\t{{.Label "rpgclub.preview.pr"}}\t{{.Label "rpgclub.preview.sha"}}\t{{.Status}}'

while read -r id; do
  [[ -n "${id}" ]] || continue
  section "preview container ${id}: last ${LINES} lines"
  docker logs --timestamps --tail "${LINES}" "${id}" 2>&1
done < <(docker ps -a --filter "${LABEL_FILTER}" --format '{{.ID}}')

section "conductor (${CONDUCTOR_UNIT}): last ${LINES} lines"
journalctl --user --unit "${CONDUCTOR_UNIT}" --lines "${LINES}" --no-pager 2>&1 ||
  echo "journalctl could not read the ${CONDUCTOR_UNIT} user unit"
