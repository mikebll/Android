#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"
: "${RUNTIME_DIR:?RUNTIME_DIR must point to the omgithub runtime}"
: "${CAPTURE_URL:?Set CAPTURE_URL to the exact preview URL}"
: "${CAPTURE_DIR:?Set CAPTURE_DIR to the evidence output directory}"

# Capture the fully rendered title screen without auto-clicking its animated
# control; this keeps the evidence deterministic on desktop and mobile.
export CAPTURE_READY_SELECTOR="${CAPTURE_READY_SELECTOR:-#start-screen:not(.hidden)}"
export CAPTURE_AUTO_START="${CAPTURE_AUTO_START:-false}"
export CAPTURE_STRICT="${CAPTURE_STRICT:-1}"
/usr/bin/time -p node "$RUNTIME_DIR/scripts/default-capture.mjs"
