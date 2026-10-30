#!/usr/bin/env bash
# Headless single-provider Oscorpex runner. Run from the Oscorpex repository root.
set -euo pipefail
PROMPT_FILE="${1:?prompt file required}"
WORKDIR="${2:?workdir required}"
MODEL="${3:?model required}"
PROVIDER="${OSCORPEX_BENCH_PROVIDER:-codex}"
OUT="${OSCORPEX_BENCH_OUTPUT:-/output}"
mkdir -p "$OUT"
printf '1\n' > "$OUT/agent-exit-code"
: > "$OUT/events.jsonl"
: > "$OUT/agent-stderr.log"
if [[ ! -f "$PROMPT_FILE" || ! -d "$WORKDIR" ]]; then
  echo "Prompt file or workdir missing" >&2
  exit 2
fi
# No model fallback: this runner invokes exactly one registered adapter.
set +e
pnpm --filter @oscorpex/kernel exec tsx src/benchmark/runner.ts "$PROMPT_FILE" "$WORKDIR" "$MODEL" "$PROVIDER" "$OUT" 2>"$OUT/agent-stderr.log"
status=$?
set -e
printf '%s\n' "$status" > "$OUT/agent-exit-code"
exit "$status"
