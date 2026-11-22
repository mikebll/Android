#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
rustup target add wasm32-unknown-unknown >/dev/null 2>&1 || true
cargo build --manifest-path engine/Cargo.toml --target wasm32-unknown-unknown --release
cp engine/target/wasm32-unknown-unknown/release/minicraft.wasm minicraft.wasm
echo "Built minicraft.wasm ($(du -h minicraft.wasm | cut -f1))"
