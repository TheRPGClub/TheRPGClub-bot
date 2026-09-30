#!/usr/bin/env bash
# Deploys the conductor as a release directory next to the ones before it, and restarts
# its systemd user service on the new one. Used by .github/workflows/conductor-deploy.yml
# on the self-hosted runner, and by hand to roll back. See docs/conductor.md.
#
#   deploy.sh current           print the commit the live release was built from, if any
#   deploy.sh deploy <sha>      build the checked-out tree at <sha> and switch to it
#   deploy.sh rollback [<sha>]  switch back to the previous release, or to <sha>'s
#   deploy.sh list              show the releases kept on disk
#
# A failed build never touches the live release. A new release that does not log its
# ready line in time is switched back to the one it replaced before the script fails.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT="${CONDUCTOR_DEPLOY_ROOT:-${HOME}/.local/share/rpgclub-conductor}"
RELEASES="${ROOT}/releases"
CURRENT="${ROOT}/current"
PREVIOUS_FILE="${ROOT}/previous"
# Matches scripts/preview/collect-logs.sh, which reads the same unit's journal.
UNIT="${CONDUCTOR_UNIT:-rpgclub-conductor}"
NPM="${CONDUCTOR_NPM:-/usr/bin/npm}"
STATE_PATH="${CONDUCTOR_STATE_PATH:-${HOME}/.config/rpgclub-conductor/state.json}"
READY_TIMEOUT_SECONDS="${CONDUCTOR_READY_TIMEOUT_SECONDS:-120}"
# How long a restart waits for a tester to finish a run. Past it the restart goes ahead:
# the run resumes from its state file, so a late restart only costs a short pause.
IDLE_TIMEOUT_SECONDS="${CONDUCTOR_IDLE_TIMEOUT_SECONDS:-1800}"
IDLE_POLL_SECONDS=30
KEEP_RELEASES=5

# The runner's service has no login session; systemctl --user needs the user's bus.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

die() {
  echo "conductor-deploy: $*" >&2
  exit 1
}

log() {
  echo "conductor-deploy: $*" >&2
}

is_commit() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]]
}

current_revision() {
  [[ -f "${CURRENT}/REVISION" ]] || return 0
  tr -d '[:space:]' < "${CURRENT}/REVISION"
  echo
}

# Points `current` at a release in one rename, so the service never sees a missing link.
switch_to() {
  local target="$1" link="${ROOT}/current.next"
  ln -sfn "${target}" "${link}"
  mv -T "${link}" "${CURRENT}"
}

# Prints "running" when the saved run is still waiting on the tester.
run_status() {
  [[ -f "${STATE_PATH}" ]] || return 0
  node -e '
    try {
      const run = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      process.stdout.write(run && typeof run.status === "string" ? run.status : "");
    } catch {}
  ' "${STATE_PATH}"
}

wait_for_idle() {
  local waited=0
  while [[ "$(run_status)" == "running" ]]; do
    if (( waited >= IDLE_TIMEOUT_SECONDS )); then
      log "a run is still in progress after ${waited}s; restarting anyway, it resumes"
      return 0
    fi
    (( waited == 0 )) && log "a run is in progress; waiting up to ${IDLE_TIMEOUT_SECONDS}s"
    sleep "${IDLE_POLL_SECONDS}"
    waited=$(( waited + IDLE_POLL_SECONDS ))
  done
}

# Restarts the service and waits for the ready line naming <sha>, logged after the
# restart. Fails when the service stops or the line never comes.
restart_and_wait() {
  local sha="$1" since waited=0
  since="$(date '+%Y-%m-%d %H:%M:%S')"
  systemctl --user restart "${UNIT}"
  while (( waited < READY_TIMEOUT_SECONDS )); do
    sleep 2
    waited=$(( waited + 2 ))
    if journalctl --user -u "${UNIT}" --since "${since}" -o cat --no-pager 2>/dev/null |
      grep -F "[conductor] ready as " | grep -Fq " at ${sha}"; then
      log "${UNIT} is ready at ${sha}"
      return 0
    fi
    if systemctl --user is-failed --quiet "${UNIT}"; then
      log "${UNIT} failed to start"
      break
    fi
  done
  journalctl --user -u "${UNIT}" --since "${since}" -o cat --no-pager -n 40 >&2 || true
  return 1
}

# Builds <sha> from the checked-out tree into its own release directory.
build_release() {
  local sha="$1" dir="${RELEASES}/$1" tmp="${RELEASES}/$1.tmp" live
  [[ -f "${dir}/REVISION" ]] && { log "release ${sha} already built"; return 0; }
  rm -rf "${tmp}"
  mkdir -p "${tmp}"
  git -C "${REPO_ROOT}" archive --format=tar "${sha}" | tar -x -C "${tmp}"
  live="$(readlink -f "${CURRENT}" 2>/dev/null || true)"
  if [[ -n "${live}" && -d "${live}/node_modules" ]] &&
    cmp -s "${live}/package-lock.json" "${tmp}/package-lock.json"; then
    log "lockfile unchanged; reusing the live release's node_modules"
    cp -al "${live}/node_modules" "${tmp}/node_modules"
  else
    log "installing dependencies"
    (cd "${tmp}" && "${NPM}" ci --no-audit --no-fund)
  fi
  log "type-checking"
  (cd "${tmp}" && ./node_modules/.bin/tsc --noEmit)
  printf '%s\n' "${sha}" > "${tmp}/REVISION"
  mv -T "${tmp}" "${dir}"
}

# Built releases, newest first.
release_dirs() {
  ls -1dt "${RELEASES}"/*/ 2>/dev/null | sed 's:/$::' | grep -v '\.tmp$' || true
}

prune_releases() {
  local live previous dir
  live="$(readlink -f "${CURRENT}" 2>/dev/null || true)"
  previous="$(cat "${PREVIOUS_FILE}" 2>/dev/null || true)"
  # Anything past the newest KEEP_RELEASES goes, except the two in use.
  while read -r dir; do
    [[ -n "${dir}" && "${dir}" != "${live}" && "${dir}" != "${previous}" ]] || continue
    log "removing old release $(basename "${dir}")"
    rm -rf "${dir}"
  done < <(release_dirs | tail -n "+$(( KEEP_RELEASES + 1 ))")
  rm -rf "${RELEASES}"/*.tmp
}

# Switches to <dir>, restarts, and on failure switches back to <fallback> if given.
activate() {
  local dir="$1" sha="$2" fallback="$3"
  wait_for_idle
  switch_to "${dir}"
  if restart_and_wait "${sha}"; then
    if [[ -n "${fallback}" && "${fallback}" != "${dir}" ]]; then
      printf '%s\n' "${fallback}" > "${PREVIOUS_FILE}"
    fi
    return 0
  fi
  if [[ -n "${fallback}" && "${fallback}" != "${dir}" ]]; then
    log "switching back to $(basename "${fallback}")"
    switch_to "${fallback}"
    restart_and_wait "$(basename "${fallback}")" ||
      log "the previous release did not come back either; check ${UNIT}"
  fi
  die "${sha} did not become ready within ${READY_TIMEOUT_SECONDS}s"
}

cmd_deploy() {
  local sha="${1:-}" live
  is_commit "${sha}" || die "not a full commit sha: '${sha}'"
  [[ "$(git -C "${REPO_ROOT}" rev-parse HEAD)" == "${sha}" ]] ||
    die "the checkout is not at ${sha}"
  mkdir -p "${RELEASES}"
  build_release "${sha}"
  live="$(readlink -f "${CURRENT}" 2>/dev/null || true)"
  if [[ "${live}" == "${RELEASES}/${sha}" ]] &&
    systemctl --user is-active --quiet "${UNIT}"; then
    log "${sha} is already live"
    return 0
  fi
  activate "${RELEASES}/${sha}" "${sha}" "${live}"
  prune_releases
}

cmd_rollback() {
  local target live sha
  live="$(readlink -f "${CURRENT}" 2>/dev/null || true)"
  if [[ -n "${1:-}" ]]; then
    is_commit "$1" || die "not a full commit sha: '$1'"
    target="${RELEASES}/$1"
  else
    target="$(cat "${PREVIOUS_FILE}" 2>/dev/null || true)"
    [[ -n "${target}" ]] || die "no previous release is recorded"
  fi
  [[ -f "${target}/REVISION" ]] || die "no built release at ${target}"
  sha="$(tr -d '[:space:]' < "${target}/REVISION")"
  activate "${target}" "${sha}" "${live}"
}

cmd_list() {
  local live dir
  live="$(readlink -f "${CURRENT}" 2>/dev/null || true)"
  for dir in $(release_dirs); do
    printf '%s %s\n' "$([[ "${dir}" == "${live}" ]] && echo '*' || echo ' ')" \
      "$(basename "${dir}")"
  done
}

case "${1:-}" in
  current) current_revision ;;
  deploy) cmd_deploy "${2:-}" ;;
  rollback) cmd_rollback "${2:-}" ;;
  list) cmd_list ;;
  *) die "usage: deploy.sh current | deploy <sha> | rollback [<sha>] | list" ;;
esac
