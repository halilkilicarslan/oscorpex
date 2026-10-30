#!/usr/bin/env bash
# macOS Apple Silicon local benchmark prerequisites. No provider calls.
set -euo pipefail
echo "Oscorpex benchmark — macOS preflight"
[[ "$(uname -s)" == "Darwin" ]] || { echo "Run on macOS"; exit 1; }
echo "Architecture: $(uname -m)"
for bin in git docker node pnpm python3; do
  if command -v "$bin" >/dev/null 2>&1; then echo "OK $bin"; else echo "MISSING $bin"; fi
done
if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    echo "OK Docker daemon"
    docker version --format 'Docker server: {{.Server.Version}}'
  else echo "MISSING Docker daemon: start Docker Desktop"; fi
fi
if command -v node >/dev/null 2>&1; then node --version; fi
if command -v pnpm >/dev/null 2>&1; then pnpm --version; fi
echo "Benchmark requires an authenticated provider CLI and upstream metric parser integration."
echo "Do not run the full benchmark until a single-task smoke test passes."
