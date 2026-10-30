# Oscorpex × harness-benchmark integration

Status: design / not yet executable. No benchmark scores have been measured.

Upstream: https://github.com/tufantunc/harness-benchmark

## Verified upstream contract
- `harnesses/<name>/manifest.yaml` and `adapter.sh`
- Adapter arguments: `$1` prompt file, `$2` workdir, `$3` model flag.
- Output directory: `/output`, including `events.jsonl`, `agent-stderr.log`, `agent-exit-code`.
- Isolated Docker execution; Python 34 + JavaScript 49 tasks; 3 repetitions by default.
- The benchmark default model is GLM 5.2 via ZAI; keep model, task, isolation and budget identical across harnesses.

## Verified Oscorpex execution boundary
`apps/kernel/src/studio/execution/provider-execution-service.ts` exports `ProviderExecutionService.execute(input)` and `isProvidersExhausted`.
Input includes projectId, taskId, agentId, agentName, repoPath, prompt, agentConfig, model, cliTool, allowedTools, timeoutMs.
Result includes token counts, USD cost, duration, files changed, provider, and model.
The service dynamically loads ProviderRegistry, performs provider resolution/fallback, and requires ProviderTelemetryCollector.

## Integration requirements
1. Create a headless, non-interactive Oscorpex runner invoked by the benchmark adapter.
2. Initialize the provider registry and telemetry without the web console.
3. Map the benchmark's OpenAI-compatible model endpoint and credentials to a compatible Oscorpex provider. Do not claim GLM 5.2 support until tested.
4. Execute in the benchmark-provided WORKDIR, preserving exercise files and avoiding writes outside that directory.
5. Disable provider fallback, dynamic model routing, and cross-task memory for the fair single-harness comparison; measure full orchestration separately.
6. Write machine-readable events and reliable exit code on both success and failure; report actual usage rather than fabricated zero values.
7. Verify how upstream parses metrics before selecting `metric_format` (do not label Oscorpex events as OpenCode events without compatibility).
8. Validate adapter with a smoke task, then full 83-task suite and three repetitions. Capture git commit SHA, model endpoint/version, container image digest, costs and per-task test results.

## Risks
- ProviderExecutionService returns provider execution success, which is NOT equivalent to passing the exercise tests. Upstream test suite is the success oracle.
- Benchmark harness isolation may conflict with Oscorpex workspace isolation and database dependencies.
- CLI-provider wrappers may not support the benchmark's OpenAI-compatible model endpoint.
- A full 12-agent project pipeline is not directly comparable with a single-agent coding harness without defining a separate evaluation track.

## Status
- [x] Create `benchmark-integration` branch from master.
- [x] Inspect upstream README and sample OpenCode/Pi manifests and adapters.
- [x] Inspect Oscorpex ProviderExecutionService API.
- [ ] Implement executable runner and upstream adapter.
- [ ] Run smoke tests and full benchmark.
- [ ] Publish measured results.
