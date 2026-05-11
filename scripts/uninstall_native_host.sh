#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="nvimview"

case "$(uname -s)" in
  Darwin)
    TARGET="${HOME}/Library/Application Support/Mozilla/NativeMessagingHosts/${HOST_NAME}.json"
    RUNNER="${HOME}/Library/Application Support/NvimView/native-host/${HOST_NAME}"
    ;;
  Linux)
    TARGET="${HOME}/.mozilla/native-messaging-hosts/${HOST_NAME}.json"
    RUNNER="${HOME}/.local/share/nvimview/native-host/${HOST_NAME}"
    ;;
  *)
    echo "Unsupported platform for native host uninstaller." >&2
    exit 1
    ;;
esac

if [[ -e "${TARGET}" ]]; then
  rm -- "${TARGET}"
  echo "Removed ${TARGET}"
else
  echo "No native host manifest found at ${TARGET}"
fi

if [[ -e "${RUNNER}" ]]; then
  rm -- "${RUNNER}"
  echo "Removed ${RUNNER}"
else
  echo "No native host runner found at ${RUNNER}"
fi
