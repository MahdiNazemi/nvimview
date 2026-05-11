#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${ROOT_DIR}/.venv/bin/python"

# Firefox launched from the macOS GUI may not inherit the user's shell PATH.
# Keep Neovim and common plugin helper commands discoverable for child processes.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

if [[ ! -x "${PYTHON}" ]]; then
  echo "Native host virtual environment is missing. Run scripts/bootstrap_native_host.sh." >&2
  exit 70
fi

exec "${PYTHON}" "${ROOT_DIR}/native_host/nvimview.py"
