# Phase 01: VoltAgent Dependency Map

**Gathered:** 2025-04-22
**Status:** Complete

---

## Import Sites

| # | File | Import | Usage | Category |
|---|------|--------|-------|----------|
| 1 | `src/index.ts` | `{ Agent, Memory, VoltAgent, VoltAgentObservability, VoltOpsClient }` from `@voltagent/core` | Core boot: new Agent(), new Memory(), new VoltAgent({...}), new VoltAgentObservability({...}) | **Critical** — system won't start without |
| 2 | `src/index.ts` | `{ LibSQLMemoryAdapter, LibSQLObservabilityAdapter }` from `@voltagent/libsql` | Memory/Observability storage adapters | **Critical** — VoltAgent boot dependency |
| 3 | `src/index.ts` | `{ createPinoLogger }` from `@voltagent/logger` | Logger instance | **Critical** — VoltAgent boot dependency |
| 4 | `src/index.ts` | `{ honoServer }` from `@voltagent/server-hono` | HTTP server mounting (studio routes, auth routes) | **Critical** — serves the entire API |
| 5 | `src/agents/assistant.ts` | `{ Agent }` from `@voltagent/core` | Demo agent definition | **Removable** — sample agent, not execution engine |
| 6 | `src/agents/researcher.ts` | `{ Agent }` and type `Memory` from `@voltagent/core` | Demo agent definition | **Removable** — sample agent |
| 7 | `src/agents/code-assistant.ts` | `{ Agent }` (via `./agents` barrel) | Code assistant agent | **Removable** — demo agent |
| 8 | `src/agents/translator.ts` | `{ Agent }` (via `./agents` barrel) | Translator agent | **Removable** — demo agent |
| 9 | `src/agents/summarizer.ts` | `{ Agent }` (via `./agents` barrel) | Summarizer agent | **Removable** — demo agent |
| 10 | `src/tools/calculator.ts` | `{ createTool }` from `@voltagent/core` | Demo tool definition | **Removable** — sample tool |
| 11 | `src/tools/datetime.ts` | `{ createTool }` from `@voltagent/core` | Demo tool definition | **Removable** — sample tool |
| 12 | `src/tools/weather.ts` | `{ createTool }` from `@voltagent/core` | Demo tool definition | **Removable** — sample tool |
| 13 | `src/tools/web-search.ts` | `{ createTool }` from `@voltagent/core` | Demo tool definition | **Removable** — sample tool |
| 14 | `src/workflows/index.ts` | `{ Agent, createWorkflowChain }` from `@voltagent/core` | Demo workflow definition | **Removable** — sample workflow |
| 15 | `src/studio/memory-bridge.ts` | *(no direct VoltAgent import)* | Writes to VoltAgent memory tables (`voltagent_memory_conversations`, `voltagent_memory_messages`) | **Bridge** — uses VoltAgent's DB schema but not its API |
| 16 | `src/studio/cli-runtime.ts` | *(no VoltAgent import)* | Uses VoltAgent's LibSQL for observability (line 602+) | **Bridge** — observation data stored in VoltAgent tables |

**Total: 16 import sites** (14 direct imports, 2 indirect DB dependencies)

---

## Categorization

### Critical Path (system won't boot without)

| # | Import | Purpose | Extraction Strategy |
|---|--------|---------|---------------------|
| 1 | `VoltAgent` class (index.ts) | Main app bootstrap | Wrap behind `OscorpexKernel` — VoltAgent becomes optional integration |
| 2 | `Memory` + `LibSQLMemoryAdapter` (index.ts) | Persistent memory store | Replace with `@oscorpex/memory-kit` context compiler |
| 3 | `VoltAgentObservability` + `LibSQLObservabilityAdapter` (index.ts) | Runtime observability | Replace with `@oscorpex/observability-sdk` |
| 4 | `VoltOpsClient` (index.ts) | Cloud observability telemetry | Make optional — only if VOLTAGENT_PUBLIC_KEY set |
| 5 | `honoServer` (index.ts) | HTTP server | Keep Hono but remove VoltAgent wrapper — direct `new Hono()` |

### Bridge (system works but loses feature)

| # | Import | Purpose | Extraction Strategy |
|---|--------|---------|---------------------|
| 6 | `memory-bridge.ts` (VolAgent memory tables) | Writes PM chat + agent outputs to VoltAgent memory tables | Replace with `@oscorpex/event-schema` events + own persistence |
| 7 | `cli-runtime.ts` (VoltAgent observability) | Stores CLI execution traces in VoltAgent observability tables | Replace with `@oscorpex/observability-sdk` spans |

### Removable (sample/demo code)

| # | Import | Purpose | Extraction Strategy |
|---|--------|---------|---------------------|
| 8-14 | Agent, createTool, createWorkflowChain (agents/, tools/, workflows/) | Demo agents, tools, workflows | Remove or isolate in `apps/demo/` package |

---

## VoltAgent Memory Tables

The `memory-bridge.ts` writes directly to these VoltAgent-managed tables:

| Table | Usage | Migration Strategy |
|-------|-------|--------------------|
| `voltagent_memory_conversations` | Project conversation tracking | Replace with own `oscorpex_conversations` table |
| `voltagent_memory_messages` | Chat message storage | Replace with `chat_messages` table (already exists in init.sql) |

---

## Extraction Order

1. **Phase 1 (now)**: Document all dependencies (this file)
2. **Phase 10**: Create `OscorpexKernel` boot entry that replaces `new VoltAgent({...})` with direct Hono setup
3. **Phase 11**: Make VoltAgent optional — add `VOLTAGENT_ENABLED` env flag, keep as integration when enabled
4. **Final**: Remove VoltAgent completely, keep Hono as the HTTP framework

---

*Phase: 01-prep-inventory*
*Inventory gathered: 2025-04-22*