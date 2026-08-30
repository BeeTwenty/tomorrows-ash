#!/usr/bin/env bash
#
# Tomorrow's Ash - one-command install (Linux and macOS).
#
#   ./install.sh                                   set up everything but client data
#   ./install.sh --client ~/WoW-3.3.5a             ...and extract client data too
#   ./install.sh --yes --skip-mmaps                unattended, defer the slow step
#
# All this does is find a usable Python and hand over to tools/ta.py, which is
# where the actual logic lives so that Windows and Linux run the same code.

set -euo pipefail
cd "$(dirname "$0")"

find_python() {
  for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1; then
      if "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' 2>/dev/null; then
        echo "$candidate"; return 0
      fi
    fi
  done
  return 1
}

if ! PYTHON=$(find_python); then
  echo "Python 3.8+ is required and was not found." >&2
  echo >&2
  if command -v apt-get >/dev/null 2>&1; then
    echo "  sudo apt-get install -y python3" >&2
  elif command -v dnf >/dev/null 2>&1; then
    echo "  sudo dnf install -y python3" >&2
  elif command -v brew >/dev/null 2>&1; then
    echo "  brew install python" >&2
  fi
  exit 1
fi

exec "$PYTHON" tools/ta.py install "$@"
