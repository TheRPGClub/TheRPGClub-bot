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

# The Preview logs run whose title carries the request tag $1.
find_run() {
  gh run list --workflow "${WORKFLOW}" --event workflow_dispatch --limit 20 \
    --json databaseId,displayTitle \
    --jq "[.[] | select(.displayTitle | endswith(\" $1\"))] | first | .databaseId // empty"
}

cmd_fetch() {
  local lines="${1:-500}" request run_id="" waited=0 state status conclusion workdir
  [[ "${lines}" =~ ^[0-9]+$ ]] || die "lines must be a number"
  gpg --batch --list-secret-keys "${KEY_UID}" >/dev/null 2>&1 ||
    die "no private key in ${GNUPGHOME}; run: $0 init"

  request="$(date -u +%Y%m%dT%H%M%SZ)-$$-${RANDOM}"
  gh workflow run "${WORKFLOW}" --ref main -f lines="${lines}" -f request="${request}" \
    >/dev/null
  while [[ -z "${run_id}" ]]; do
    (( waited < TIMEOUT_SECONDS )) || die "the workflow run did not appear"
    sleep "${POLL_SECONDS}"
    waited=$(( waited + POLL_SECONDS ))
    run_id="$(find_run "${request}")" || die "could not list workflow runs"
  done

  while :; do
    state="$(gh run view "${run_id}" --json status,conclusion \
      --jq '"\(.status) \(.conclusion)"')" || die "could not read run ${run_id}"
    read -r status conclusion <<< "${state}"
    [[ "${status}" == "completed" ]] && break
    (( waited < TIMEOUT_SECONDS )) || die "run ${run_id} did not finish in time"
    sleep "${POLL_SECONDS}"
    waited=$(( waited + POLL_SECONDS ))
  done
  case "${conclusion}" in
    success) ;;
    skipped) die "run ${run_id} was skipped: PREVIEW_LOGS_PUBLIC_KEY is unset; run: $0 init" ;;
    *) die "run ${run_id} ended ${conclusion}: gh run view ${run_id} --log-failed" ;;
  esac

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
