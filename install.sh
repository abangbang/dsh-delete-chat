#!/usr/bin/env bash
# install.sh — mount dsh-delete-chat into a DSH profile.
#
# Thin wrapper: the installer is Node, so Windows, macOS and Linux run the same
# implementation (scripts/install.mjs). Nothing here parses YAML.
#
#   ./install.sh                       # ~/.dsh/profiles/desktop
#   ./install.sh --profile <dir>       # another profile
#   ./install.sh --uninstall
#   ./install.sh --dry-run
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required (>=20). Install Node, then re-run this script." >&2
  exit 1
fi

exec node "$here/scripts/install.mjs" "$@"
