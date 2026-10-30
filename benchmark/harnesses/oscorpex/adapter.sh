#!/usr/bin/env bash
# Copy alongside manifest.yaml into harness-benchmark/harnesses/oscorpex.
set -euo pipefail
PROMPT_FILE="${1:?prompt file}"
WORKDIR="${2:?workdir}"
MODEL_FLAG="${3:-}"
: "${OSCORPEX_ROOT:?Set OSCORPEX_ROOT to the Oscorpex checkout}"
: "${MODEL_NAME:?Set MODEL_NAME to the benchmark model}"
export OSCORPEX_BENCH_OUTPUT=/output
# Model flags are not interpreted as shell code.
exec bash "$OSCORPEX_ROOT/scripts/benchmark-oscorpex.sh" "$PROMPT_FILE" "$WORKDIR" "$MODEL_NAME"
