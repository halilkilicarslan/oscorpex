# Codebase Stack

Generated on 2026-04-12 from direct repository inspection and local command runs.

## Summary

Oscorpex is a TypeScript monorepo-like repository with two primary applications:

- `src/`: Node.js backend built on Hono and VoltAgent.
- `console/`: React + Vite frontend for the studio and observability console.

The backend is an AI orchestration server that plans and runs multi-agent software tasks. The frontend is a dense operations UI for project planning, execution, preview, logs, traces, files, and team management.

## Core Technologies

### Backend

- Language: TypeScript (ESM)
- Runtime: Node.js 20.19+
- HTTP server: Hono via `@voltagent/server-hono`
- AI framework: `@voltagent/core`
- Agent execution:
  - Primary task execution path: Claude CLI subprocesses in `src/studio/cli-runtime.ts`
  - Configurable provider path: AI SDK (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`)
- Build: `tsdown`
- Dev runner: `tsx watch`
- Formatting/linting: Biome
- Tests: Vitest

### Frontend

- Language: TypeScript + TSX
- UI framework: React 19
- Bundler/dev server: Vite 8
- Routing: `react-router-dom` 7
- Styling: Tailwind CSS 4
- Testing: Vitest + Testing Library + jsdom
- Linting: ESLint + React Hooks plugin + React Refresh plugin
- Visualization/UI libs:
  - `@xyflow/react`
  - `@xterm/xterm`
  - `lucide-react`
  - `react-markdown`

## Data and Persistence

The repository currently uses a hybrid persistence model:

- PostgreSQL + pgvector for studio application data
- LibSQL/SQLite files under `.voltagent/` for VoltAgent memory and observability
- File-based agent logs in the studio subsystem

Observed schema footprint from `scripts/init.sql`:

- 38 `CREATE TABLE` statements
- pgvector extension enabled

## Packaging and Ops

- Package manager: pnpm
- Containerization: Docker + Docker Compose
- Optional services:
  - PostgreSQL (`pgvector/pgvector:pg16`)
  - SonarQube
  - Pre-warmed coder-agent containers

## Scale Indicators

- Source files under `src/` + `console/src/`: 135
- Approximate source size: 57,702 lines
- Studio API route declarations in `src/studio/routes.ts`: 132

## Version/Documentation Drift

The documented stack is directionally correct but not fully current:

- `README.md` says React 18; `console/package.json` is React 19
- `ARCHITECTURE.md` still describes VoltAgent/LibSQL on port 4242, while current runtime uses Oscorpex/Hono on port 3141 with PostgreSQL

