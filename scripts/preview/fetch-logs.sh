#!/usr/bin/env bash
# Reads the preview container's and the conductor's logs from the desktop runner, from
# any machine with `gh` and the private key. See docs/pr-preview.md, "Reading preview logs".
#
#   fetch-logs.sh init          make the key pair here and publish its public half
#   fetch-logs.sh [lines]       run the Preview logs workflow and print the decrypted logs
set -euo pipefail

export GNUPGHOME="${PREVIEW_LOGS_GNUPGHOME:-${HOME}/.config/rpgclub-preview-logs/gnupg}"
KEY_UID="RPGClub preview logs"
WORKFLOW="preview-logs.yml"
POLL_SECONDS=5
TIMEOUT_SECONDS=300

die() {
  echo "fetch-logs: $*" >&2
  exit 1
}

cmd_init() {
  mkdir -p "${GNUPGHOME}"
  chmod 700 "${GNUPGHOME}"
  if ! gpg --batch --list-secret-keys "${KEY_UID}" >/dev/null 2>&1; then
    # No passphrase: the key's only guard is this directory's permissions, so logs can
    # be decrypted unattended. It can read preview logs and nothing else.
    gpg --batch --passphrase '' --quick-gen-key "${KEY_UID}" future-default default never
  fi
  gpg --batch --armor --export "${KEY_UID}" | gh variable set PREVIEW_LOGS_PUBLIC_KEY
  echo "fetch-logs: published the public key as the PREVIEW_LOGS_PUBLIC_KEY variable" >&2
}

# The newest Preview logs run created at or after $1 (ISO 8601).
find_run() {
  gh run list --workflow "${WORKFLOW}" --event workflow_dispatch --limit 5 \
    --json databaseId,createdAt \
    --jq "[.[] | select(.createdAt >= \"$1\")] | first | .databaseId // empty"
}

cmd_fetch() {
  local lines="${1:-500}" started run_id="" waited=0 status conclusion workdir
  [[ "${lines}" =~ ^[0-9]+$ ]] || die "lines must be a number"
  gpg --batch --list-secret-keys "${KEY_UID}" >/dev/null 2>&1 ||
    die "no private key in ${GNUPGHOME}; run: $0 init"

  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  gh workflow run "${WORKFLOW}" --ref main -f lines="${lines}" >/dev/null
  while [[ -z "${run_id}" ]]; do
    (( waited < TIMEOUT_SECONDS )) || die "the workflow run did not appear"
    sleep "${POLL_SECONDS}"
    waited=$(( waited + POLL_SECONDS ))
    run_id="$(find_run "${started}")"
  done

  while :; do
    read -r status conclusion < <(gh run view "${run_id}" --json status,conclusion \
      --jq '"\(.status) \(.conclusion)"')
    [[ "${status}" == "completed" ]] && break
    (( waited < TIMEOUT_SECONDS )) || die "run ${run_id} did not finish in time"
    sleep "${POLL_SECONDS}"
    waited=$(( waited + POLL_SECONDS ))
  done
  [[ "${conclusion}" == "success" ]] ||
    die "run ${run_id} ended ${conclusion}: gh run view ${run_id} --log-failed"

  workdir="$(mktemp -d)"
  trap 'rm -rf "${workdir}"' EXIT
  gh run download "${run_id}" --name preview-logs --dir "${workdir}"
  gpg --batch --quiet --decrypt "${workdir}/preview-logs.gpg"
}

case "${1:-}" in
  init) cmd_init ;;
  ""|[0-9]*) cmd_fetch "${1:-}" ;;
  *) die "usage: fetch-logs.sh init | fetch-logs.sh [lines]" ;;
esac
