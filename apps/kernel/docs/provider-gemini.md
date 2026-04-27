# Provider: Google Gemini

## Overview

The Gemini adapter integrates Google Gemini models into the Oscorpex provider registry. It spawns a `gemini` CLI binary that accepts prompts via stdin and returns JSON or plain text via stdout.

## Prerequisites

- A `gemini` CLI binary accessible in `$PATH` (or configure via `GEMINI_CLI_PATH`)
- The binary must support:
  - `--model <model>` flag
  - `--max-tokens <n>` flag
  - `--temperature <n>` flag
  - Prompt via stdin
  - JSON output to stdout (optional but recommended)

## Configuration

| Environment Variable | Default | Description |
|----------------------|---------|-------------|
| `GEMINI_CLI_PATH` | `gemini` | Path to the Gemini CLI binary |

## Supported Models

| Model | Cost (input / output per 1M tokens) |
|-------|-------------------------------------|
| `gemini-1.5-pro` | $1.25 / $5.00 |
| `gemini-1.5-flash` | $0.075 / $0.30 |
| `gemini-2.0-flash` | $0.10 / $0.40 |

Default model: `gemini-1.5-flash`

## Capabilities

| Capability | Supported | Notes |
|------------|-----------|-------|
| Tool restriction | No | Gemini does not honor tool restriction at the adapter level. A governance preamble is injected instead. |
| Streaming | Yes | Adapter supports streaming mode. |
| Resume | No | Session resume is not supported. |
| Cancel | Yes | Cancelled via AbortController at registry level. |
| Structured output | Yes | JSON output is parsed and normalized. |
| Sandbox hinting | No | Not supported. |

## Usage

```typescript
import { GeminiAdapter } from "@oscorpex/provider-gemini";

const adapter = new GeminiAdapter();
const result = await adapter.execute({
  runId: "run-1",
  taskId: "task-1",
  provider: "gemini",
  repoPath: "/path/to/repo",
  prompt: "Implement a user authentication system",
  systemPrompt: "You are a senior backend engineer",
  timeoutMs: 300_000,
  model: "gemini-1.5-pro",
});
```

## Error Handling

- `ProviderUnavailableError` — CLI binary not found
- `ProviderTimeoutError` — Execution exceeded timeout
- `ProviderExecutionError` — Non-zero exit code or spawn failure

## Tool Governance

Because Gemini does not natively support tool restriction, the adapter injects a governance preamble into the prompt when `allowedTools` is specified. If the requested tool set is not the full set, the model is instructed to stop and report limitations rather than using forbidden tools.

## Registry Integration

The adapter is auto-registered in `ProviderRegistry.registerDefaultProviders()` with:
- ID: `gemini`
- Default model: `gemini-1.5-flash`

## Limitations

- Requires a CLI wrapper around the Gemini API (no official CLI exists)
- Tool restriction is advisory (prompt-level) rather than enforced
- Sandbox hinting is not supported
