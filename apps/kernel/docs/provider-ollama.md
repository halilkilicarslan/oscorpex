# Provider: Ollama (Local)

## Overview

The Ollama adapter integrates locally-hosted LLMs into the Oscorpex provider registry. It communicates with the Ollama HTTP API (default `http://localhost:11434`) instead of spawning a CLI binary.

## Prerequisites

- [Ollama](https://ollama.com) installed and running
- At least one model pulled (e.g., `ollama pull llama3.2`)
- Ollama server accessible from the kernel process

## Configuration

| Environment Variable | Default | Description |
|----------------------|---------|-------------|
| `OLLAMA_HOST` | `http://localhost:11434` | Base URL of the Ollama server |
| `OLLAMA_MODEL` | `llama3.2` | Default model to use |

## Supported Models

These models are commonly used with Ollama. The actual availability depends on what you have pulled locally.

| Model | Use case |
|-------|----------|
| `llama3.2` | General purpose, fast |
| `codellama` | Code generation |
| `mistral` | General purpose, high quality |
| `phi4` | Lightweight, fast |

## Capabilities

| Capability | Supported | Notes |
|------------|-----------|-------|
| Tool restriction | No | Not supported by Ollama API |
| Streaming | No | Adapter uses non-streaming mode for simplicity |
| Resume | No | Session resume is not supported |
| Cancel | Yes | Cancelled via AbortController at registry level |
| Structured output | No | Ollama JSON mode is not enabled by default |
| Sandbox hinting | No | Not supported |

## Usage

```typescript
import { OllamaAdapter } from "@oscorpex/provider-ollama";

const adapter = new OllamaAdapter();
const result = await adapter.execute({
  runId: "run-1",
  taskId: "task-1",
  provider: "ollama",
  repoPath: "/path/to/repo",
  prompt: "Implement a user authentication system",
  systemPrompt: "You are a senior backend engineer",
  timeoutMs: 300_000,
  model: "codellama",
});
```

## Cost Model

Ollama is a **local provider** — there is no per-token billing. All executions report:

- `usage.billedCostUsd: 0`
- `usage.inputTokens` and `usage.outputTokens` are populated from Ollama's `prompt_eval_count` and `eval_count` fields for observability only.

## Error Handling

- `ProviderUnavailableError` — Ollama server not reachable
- `ProviderTimeoutError` — Execution exceeded timeout
- `ProviderExecutionError` — HTTP error (e.g., 404 model not found, 500 server error)

## Registry Integration

The adapter is auto-registered in `ProviderRegistry.registerDefaultProviders()` with:
- ID: `ollama`
- Default model: `llama3.2`

Because Ollama is optional (local-only), the registry catches registration errors gracefully. If Ollama is not running, the adapter is still registered but will report `unavailable` during execution.

## Limitations

- Requires Ollama server to be running before the kernel starts
- No native tool support — all tools are advisory (prompt-level)
- No streaming — responses are buffered
- Model must be pulled locally before use
- Performance depends on local hardware (CPU/GPU)

## Local Setup

```bash
# Install Ollama
brew install ollama

# Start server
ollama serve

# Pull a model
ollama pull llama3.2

# Verify
ollama list
```
