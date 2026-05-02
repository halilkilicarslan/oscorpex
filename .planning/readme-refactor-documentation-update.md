# README Refactor Documentation Update

Repository: `halilkilicarslan/oscorpex`  
Branch: `master`  
Baseline commit: `85b3e34 Complete execution refactor batch`

## Goal

Inspect README drift after the execution refactor and update `README.md` so it reflects the current architecture.

This is documentation-only. Do not change source code, tests, migrations, package versions, or feature behavior.

## Instructions

Run this from the repository root:

```bash
set -e

echo "== Sync =="
git checkout master
git pull origin master
git status --short

echo ""
echo "== Current commit =="
git log -1 --oneline

echo ""
echo "== README sections likely outdated =="
rg -n "Architecture|execution-engine|task-engine|pipeline-engine|cli-adapter|model-router|Testing|Tech Stack|AI Execution|Claude CLI|ProviderRegistry|provider|Refactor Status" README.md || true

echo ""
echo "== Actual post-refactor execution files =="
find apps/kernel/src/studio/execution -maxdepth 1 -type f | sort

echo ""
echo "== Actual task/pipeline/provider extraction files =="
find apps/kernel/src/studio -maxdepth 3 -type f \
  \( -path "*/task/*" -o -path "*/pipeline/*" -o -path "*/providers/*" \) | sort

echo ""
echo "== Check legacy normal execution references =="
rg "executeWithCLI|isClaudeCliAvailable|resolveFilePaths" apps/kernel/src || true

echo ""
echo "== Check legacy adapter fallback references =="
rg "legacyCliAdapter|getAdapter\\(|getAdapterChain\\(" apps/kernel/src || true

echo ""
echo "== Prepare README update =="
python3 - <<'PY'
from pathlib import Path

path = Path("README.md")
text = path.read_text()

old_testing = """### Testing

```bash
# Backend tests
pnpm test

# Frontend tests
cd console && pnpm test:run

# Typecheck
pnpm typecheck
cd console && pnpm tsc -b
```"""

new_testing = """### Testing

```bash
# Full typecheck
pnpm typecheck

# Kernel tests
pnpm --filter @oscorpex/kernel test

# Task graph package tests
pnpm --filter @oscorpex/task-graph test

# Provider SDK tests
pnpm --filter @oscorpex/provider-sdk test

# Frontend tests
pnpm --filter @oscorpex/console test:run
```"""

old_arch_start = text.index("## Architecture")
old_arch_end = text.index("## Database")

new_arch = """## Architecture

Oscorpex uses a monorepo architecture with a backend kernel, React console, shared packages, and provider adapters.

Normal task execution now flows through the post-refactor execution boundary:

```txt
ExecutionEngine facade
  → TaskDispatcher
  → TaskExecutor
  → ProviderExecutionService
  → ProviderRegistry
  → ProviderAdapter
```

The legacy `cli-runtime.ts` compatibility path remains for streaming, proposal processing, tests, and explicit legacy entry points. It is not the normal task execution path.

```txt
apps/kernel/src/studio/
  execution-engine.ts          # Thin facade wiring execution submodules

  execution/
    index.ts                   # Execution module barrel
    task-executor.ts           # Single-task execution lifecycle
    provider-execution-service.ts # Provider execution normalization and fallback handling
    dispatch-coordinator.ts    # Ready-task dispatch coordination
    execution-recovery.ts      # Startup recovery and running-task cancellation
    execution-watchdog.ts      # Self-healing dispatch watchdog
    queue-wait.ts              # Queue-wait metric calculation
    task-timeout.ts            # Timeout helper and TaskTimeoutError

  task/
    approval-service.ts        # Approval lifecycle helpers
    zero-file-guard.ts         # Zero-file output validation
    review-loop-service.ts     # Review/revision loop coordination
    task-completion-effects.ts # Non-blocking completion side effects
    subtask-rollup-service.ts  # Parent/subtask completion rollup

  pipeline/
    pipeline-state-service.ts  # Pipeline state loading/persistence helpers
    stage-advance-service.ts   # Stage transition coordination
    replan-gate.ts             # Pending replan gate
    vcs-phase-hooks.ts         # Branch/merge/PR side effects

  providers/
    provider-model-catalog.ts  # Provider/model catalog constants
    provider-routing-service.ts # Provider/model routing helpers

  kernel/
    provider-registry.ts       # ProviderRegistry and native adapter registration
    index.ts                   # OscorpexKernel facade

  agent-runtime/               # Agentic core: memory, strategy, session, protocol, constraints
  routes/                      # Hono route modules
  db/                          # Repository modules
```

```txt
apps/console/src/
  pages/studio/                # Studio pages
  components/                  # Shared UI components
  lib/studio-api/              # Modular API client files
  hooks/                       # WebSocket, notifications, collaboration
```

```txt
packages/
  core/                        # Shared domain types, contracts, errors, utilities
  control-plane/               # Operator governance layer
  event-schema/                # Event type definitions
  memory-kit/                  # Agent memory utilities
  observability-sdk/           # Observability SDK
  policy-kit/                  # Policy enforcement
  provider-sdk/                # Provider adapter contracts and CLI runner utilities
  task-graph/                  # DAG scheduling utilities
  verification-kit/            # Output verification utilities
```

```txt
adapters/
  provider-claude/             # Claude Code provider adapter
  provider-codex/              # Codex provider adapter
  provider-cursor/             # Cursor provider adapter
  provider-gemini/             # Gemini provider adapter
  provider-ollama/             # Ollama provider adapter
```

## Refactor Status

Execution refactor accepted at commit `85b3e34 Complete execution refactor batch`.

Validated locally with:

```bash
pnpm typecheck
pnpm --filter @oscorpex/kernel test
pnpm --filter @oscorpex/task-graph test
pnpm --filter @oscorpex/provider-sdk test
```

Known non-blocking technical debt:

- legacy `cli-runtime.ts` remains for compatibility, streaming, proposal processing, and test paths
- `legacyCliAdapter` references remain, but fallback is disabled by default
- unsafe casts remain and are tracked as a separate cleanup backlog

"""

text = text[:old_arch_start] + new_arch + text[old_arch_end:]

if old_testing in text:
    text = text.replace(old_testing, new_testing)
else:
    print("WARNING: Testing section did not match exact old block; update manually if needed.")

text = text.replace(
    "| AI Execution | Claude CLI, Codex CLI, Cursor, Google Gemini, Ollama (multi-provider) |",
    "| AI Execution | ProviderRegistry + ProviderAdapter boundary for Claude Code, Codex, Cursor, Google Gemini, and Ollama |",
)

text = text.replace(
    "- Claude CLI (for AI agent execution)",
    "- At least one configured provider CLI/API runtime: Claude Code, Codex, Cursor, Gemini, or Ollama",
)

path.write_text(text)
PY

echo ""
echo "== README diff =="
git diff -- README.md

echo ""
echo "== Validation =="
pnpm typecheck
pnpm --filter @oscorpex/kernel test

echo ""
echo "== Final status =="
git status --short

echo ""
echo "If the diff is correct, commit with:"
echo "git add README.md && git commit -m \"docs(readme): reflect post-refactor execution architecture\" && git push origin master"
```

## Acceptance Criteria

- `README.md` no longer describes `execution-engine.ts` as the place that directly performs CLI execution.
- `README.md` documents the post-refactor execution flow:
  `ExecutionEngine → TaskDispatcher → TaskExecutor → ProviderExecutionService → ProviderRegistry → ProviderAdapter`
- `README.md` documents `execution/`, `task/`, `pipeline/`, and `providers/` extraction modules.
- Testing commands are updated to root-level pnpm workspace commands.
- Legacy `cli-runtime.ts` is documented as compatibility/streaming/test path only.
- `pnpm typecheck` passes.
- `pnpm --filter @oscorpex/kernel test` passes.
- Worktree is clean after commit and push.

## Report Back

```md
# README Update Result

## Commit
- SHA:

## Validation
- pnpm typecheck:
- pnpm --filter @oscorpex/kernel test:

## Changed
- ...

## Notes
- ...
```
