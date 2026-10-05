#!/usr/bin/env bash
set -euo pipefail
: "${DESKTOP_SSH_HOST:?}" "${DESKTOP_SSH_USER:?}"
: "${DESKTOP_SSH_KEY:?}" "${DESKTOP_SSH_KNOWN_HOSTS:?}"
[[ "$DESKTOP_SSH_HOST" =~ ^[a-zA-Z0-9.-]+$ ]]
[[ "$DESKTOP_SSH_USER" =~ ^[a-zA-Z0-9_-]+$ ]]
umask 077
key=$(mktemp)
hosts=$(mktemp)
trap 'rm -f "$key" "$hosts"' EXIT
printf '%s\n' "$DESKTOP_SSH_KEY" > "$key"
printf '%s\n' "$DESKTOP_SSH_KNOWN_HOSTS" > "$hosts"
remote="$DESKTOP_SSH_USER@$DESKTOP_SSH_HOST"
options=(-i "$key" -o "UserKnownHostsFile=$hosts" -o StrictHostKeyChecking=yes)
tar -czf - -C distribution . | ssh "${options[@]}" "$remote" publish-desktop-release
