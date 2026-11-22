#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"
: "${RUNTIME_DIR:?RUNTIME_DIR must point to the omgithub runtime}"
PORT="${PORT:-3000}"
export PORT

# This project is a dependency-free static site. Compile the WASM engine only
# when its source is newer than the checked-in static artifact.
needs_build=false
if [[ ! -s minicraft.wasm ]]; then
  needs_build=true
elif /usr/bin/time -p bash -c 'find engine/src engine/Cargo.toml -type f -newer minicraft.wasm -print -quit | grep -q .' ; then
  needs_build=true
fi
if [[ "$needs_build" == true ]]; then
  /usr/bin/time -p bash build.sh
fi

for asset in index.html game.js styles.css minicraft.wasm; do
  /usr/bin/time -p test -s "$asset"
done

export OPENCODE_WEB_DIR="${OPENCODE_WEB_DIR:-/home/runner/work/_temp/omgithub-web}"
/usr/bin/time -p mkdir -p "$OPENCODE_WEB_DIR"
/usr/bin/time -p node -e 'const fs=require("node:fs"); const path=require("node:path"); const project=process.cwd(); const directory=project; fs.writeFileSync(path.join(process.env.OPENCODE_WEB_DIR,"deployment-output.json"), JSON.stringify({project,directory}));'

# The static server runs in the foreground so the controller can manage its lifecycle.
/usr/bin/time -p node "$RUNTIME_DIR/scripts/default-start.mjs"
