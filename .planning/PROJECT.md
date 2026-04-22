# Oscorpex — Project Context

## Overview

Oscorpex is an AI-powered software development platform where users describe an idea, and a 12-agent Scrum team builds it autonomously through a DAG pipeline. The system dispatches tasks to AI agents (Claude Code, Codex, Cursor) for execution, manages the lifecycle through state machines, and provides real-time observability via WebSocket.

## Current Architecture

### Backend (`src/`)
- **Entry point**: `src/index.ts` — VoltAgent app with Hono server, mounted at `/api/studio`
- **Core engine**: `src/studio/` — 100+ files, ~30k lines of TypeScript
- **Database**: PostgreSQL with idempotent schema (`scripts/init.sql`)
- **Build**: tsdown, Biome linter, Vitest
- **Runtime**: Node.js 20+, ESM with `.js` import extensions

### Frontend (`console/`)
- React 19 + Vite + Tailwind 4 + React Router
- 36+ pages (ProjectPage, KanbanBoard, AgentDashboard, etc.)
- Modular API client (`console/src/lib/studio-api/`)

### Key Modules (by line count)
| Module | Lines | Role |
|--------|-------|------|
| cli-usage.ts | 1659 | CLI usage tracking |
| execution-engine.ts | 1306 | Task dispatch & execution |
| task-engine.ts | 1296 | Task lifecycle state machine |
| pipeline-engine.ts | 1100 | DAG orchestrator, Kahn's algorithm |
| pm-agent.ts | 1050 | PM agent for requirements |
| app-runner.ts | 971 | Run generated apps |
| types.ts | 888 | Domain type definitions |

### External Dependencies
- **VoltAgent**: @voltagent/core (memory, observability, server)
- **AI SDK**: @ai-sdk/anthropic, @ai-sdk/openai, @ai-sdk/google
- **Hono**: HTTP server framework
- **PostgreSQL**: State persistence
- **Docker**: Container isolation

## Strategic Direction

Oscorpex is evolving from a VoltAgent-dependent prototype into an **AI-native software delivery control plane**. The core value will shift from generic agent orchestration to:

1. Multi-provider CLI orchestration (Claude, Codex, Cursor, Gemini, etc.)
2. DAG-based task graph execution with verification gates
3. Governance, approval, and policy enforcement
4. Replayability and cost control
5. Context-optimized memory management
6. Operator observability and intervention

## Key Problem

The current codebase has three structural problems:
1. **Split-brain core**: VoltAgent handles memory/observability while studio/ handles all product logic
2. **Scattered core behavior**: Execution, pipeline, task, event, verification, budget logic spread across 6+ files
3. **VoltAgent strategic debt**: Useful for bootstrapping, now limits architecture evolution

## Constraints
- Never edit files under `.voltagent/repos/`
- Use `pnpm` exclusively
- Tab indentation, 120 char line width (biome.json)
- Backend uses `.js` extension in imports (ESM resolution)
- UUID generation: `randomUUID()` from `node:crypto`
- Reserved ports: 5173 (Vite), 4242 (preview), 3142 (WebSocket)

---
*Last updated: 2025-04-22*