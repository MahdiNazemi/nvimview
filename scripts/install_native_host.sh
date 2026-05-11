#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="nvimview"
EXTENSION_ID="nvimview@nazemi.dev"
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${ROOT_DIR}/.venv/bin/python"

"${ROOT_DIR}/scripts/bootstrap_native_host.sh"

case "$(uname -s)" in
  Darwin)
    TARGET_DIR="${HOME}/Library/Application Support/Mozilla/NativeMessagingHosts"
    RUNNER_DIR="${HOME}/Library/Application Support/NvimView/native-host"
    ;;
  Linux)
    TARGET_DIR="${HOME}/.mozilla/native-messaging-hosts"
    RUNNER_DIR="${HOME}/.local/share/nvimview/native-host"
    ;;
  *)
    echo "Unsupported platform for native host installer." >&2
    exit 1
    ;;
esac

mkdir -p "${TARGET_DIR}"
mkdir -p "${RUNNER_DIR}"
RUNNER="${RUNNER_DIR}/${HOST_NAME}"
cat >"${RUNNER}" <<SH
#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:\${PATH:-}"

exec "${PYTHON}" "${ROOT_DIR}/native_host/nvimview.py"
SH
chmod 755 "${RUNNER}"

cat >"${TARGET_DIR}/${HOST_NAME}.json" <<JSON
{
  "name": "${HOST_NAME}",
  "description": "Native host for NvimView",
  "path": "${RUNNER}",
  "type": "stdio",
  "allowed_extensions": ["${EXTENSION_ID}"]
}
JSON

echo "Installed ${TARGET_DIR}/${HOST_NAME}.json"
echo "Installed ${RUNNER}"
