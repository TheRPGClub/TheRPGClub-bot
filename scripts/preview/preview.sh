#!/usr/bin/env bash
# Controls the single per-PR preview container. Used by .github/workflows/pr-preview.yml
# on the self-hosted runner, and by hand to list or kill previews. See docs/pr-preview.md.
#
#   preview.sh deploy <pr> <sha>   build the checked-out tree and replace the preview
#   preview.sh teardown <pr>       remove the preview only if it belongs to <pr>
#   preview.sh current-pr          print the PR the running preview belongs to, if any
#   preview.sh list                show preview containers
#   preview.sh kill                remove the preview whatever PR it belongs to
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.preview.yml"
export PREVIEW_ENV_FILE="${PREVIEW_ENV_FILE:-${HOME}/.config/rpgclub-preview/preview.env}"
READY_TIMEOUT_SECONDS="${PREVIEW_READY_TIMEOUT_SECONDS:-180}"
READY_LINE="Startup sequence completed."
LABEL_FILTER="label=rpgclub.preview=true"

die() {
  echo "preview: $*" >&2
  exit 1
}

# Prints "<id> <pr>" for each preview container, running or not.
preview_containers() {
  docker ps -a --filter "${LABEL_FILTER}" \
    --format '{{.ID}} {{.Label "rpgclub.preview.pr"}}'
}

env_value() {
  local line
  line="$(grep -E "^[[:space:]]*$1=" "${PREVIEW_ENV_FILE}" | tail -n 1 || true)"
  line="${line#*=}"
  # The file may come from the Windows production .env: drop CRLF and either quote style.
  line="${line%$'\r'}"
  line="${line#[\"\']}"
  line="${line%[\"\']}"
  printf '%s' "${line}"
}

# Discord tokens start with the base64 of the bot's user ID.
token_user_id() {
  local part="${1%%.*}"
  while (( ${#part} % 4 != 0 )); do part="${part}="; done
  printf '%s' "${part}" | base64 -d 2>/dev/null || true
}

# Refuses to start anything that could act as the production bot or outside test mode.
check_env_file() {
  [[ -f "${PREVIEW_ENV_FILE}" ]] || die "env file not found: ${PREVIEW_ENV_FILE}"
  [[ -n "$(env_value TEST_GUILD_ID)" ]] || die "TEST_GUILD_ID is empty in the preview env file"
  local token
  token="$(env_value BOT_TOKEN)"
  [[ -n "${token}" ]] || die "BOT_TOKEN is empty in the preview env file"
  [[ -n "${PRODUCTION_BOT_USER_ID:-}" ]] ||
    die "PRODUCTION_BOT_USER_ID is not set in the runner environment"
  [[ "$(token_user_id "${token}")" != "${PRODUCTION_BOT_USER_ID}" ]] ||
    die "BOT_TOKEN in the preview env file belongs to the production bot"
}

# Removes every preview container, or only those owned by PR $1 when given. Prints the
# owning PR of each one removed. Fails if one cannot be removed and still exists.
remove_previews() {
  local only_pr="${1:-}" id owner
  while read -r id owner; do
    [[ -n "${id}" ]] || continue
    [[ -z "${only_pr}" || "${owner}" == "${only_pr}" ]] || continue
    echo "preview: removing ${id} (PR ${owner:-unknown})" >&2
    if ! docker rm -f "${id}" >/dev/null; then
      # Another run (a deploy replacing it) may have removed it since the listing.
      docker inspect "${id}" >/dev/null 2>&1 && die "could not remove ${id}"
      echo "preview: ${id} was already gone" >&2
      continue
    fi
    echo "${owner}"
  done < <(preview_containers)
}

wait_until_ready() {
  local id="$1" waited=0 logs
  while (( waited < READY_TIMEOUT_SECONDS )); do
    # Captured first: grep -q exiting early would fail the pipe under pipefail.
    logs="$(docker logs "${id}" 2>&1 || true)"
    if [[ "${logs}" == *"${READY_LINE}"* ]]; then
      echo "preview: ready after ${waited}s"
      return 0
    fi
    if [[ "$(docker inspect -f '{{.State.Status}}' "${id}" 2>/dev/null)" == "exited" ]]; then
      break
    fi
    sleep 5
    waited=$(( waited + 5 ))
  done
  echo "preview: not ready after ${waited}s, last log lines:" >&2
  docker logs --tail 40 "${id}" >&2 2>&1 || true
  return 1
}

write_output() {
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo "$1" >> "${GITHUB_OUTPUT}"; fi
}

cmd_deploy() {
  local pr="${1:?pr number required}" sha="${2:?sha required}" owner removed id
  check_env_file

  # Build before touching the running preview, so a broken branch leaves it up.
  export PREVIEW_PR="${pr}" PREVIEW_SHA="${sha}"
  docker compose -f "${COMPOSE_FILE}" build pr-preview

  # One preview at a time: whatever is running goes, whichever PR owns it.
  removed="$(remove_previews)"
  for owner in ${removed}; do
    if [[ "${owner}" != "${pr}" ]]; then write_output "replaced_pr=${owner}"; fi
  done

  docker compose -f "${COMPOSE_FILE}" up -d --force-recreate pr-preview
  docker image prune -f --filter "label=rpgclub.preview=true" >/dev/null || true

  id="$(docker ps -a --filter "${LABEL_FILTER}" --filter "label=rpgclub.preview.pr=${pr}" \
    --format '{{.ID}}' | head -n 1)"
  [[ -n "${id}" ]] || die "container did not start"
  write_output "container=${id}"
  wait_until_ready "${id}"
}

cmd_teardown() {
  local pr="${1:?pr number required}" removed
  removed="$(remove_previews "${pr}")"
  if [[ -n "${removed}" ]]; then
    write_output "removed=1"
  else
    echo "preview: no preview running for PR ${pr}"
    write_output "removed=0"
  fi
}

cmd_current_pr() {
  preview_containers | awk 'NF == 2 { print $2; exit }'
}

cmd_list() {
  docker ps -a --filter "${LABEL_FILTER}" --format \
    'table {{.ID}}\t{{.Label "rpgclub.preview.pr"}}\t{{.Label "rpgclub.preview.sha"}}\t{{.Status}}'
}

cmd_kill() {
  remove_previews >/dev/null
}

case "${1:-}" in
  deploy) shift; cmd_deploy "$@" ;;
  teardown) shift; cmd_teardown "$@" ;;
  current-pr) cmd_current_pr ;;
  list) cmd_list ;;
  kill) cmd_kill ;;
  *) die "usage: preview.sh deploy <pr> <sha> | teardown <pr> | current-pr | list | kill" ;;
esac
