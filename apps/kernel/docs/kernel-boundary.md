# Oscorpex Kernel — Boundary Documentation

This document defines the architectural boundaries between the core packages, the kernel application, the console frontend, and compatibility shells.

## Layers

### 1. packages/core (`@oscorpex/core`)
**Responsibility:** Domain types, contracts, and shared utilities.
**What belongs here:**
- Provider interfaces (`ProviderAdapter`, `ProviderExecutionInput`, `ProviderExecutionResult`)
- Replay types (`ReplaySnapshot`, `ReplayStore` contract)
- Task graph types (`TaskGraph`, `GraphNode`, `GraphEdge`)
- Shared utility types and helpers

**What does NOT belong here:**
- HTTP route definitions
- Database queries
- Business logic
- Framework-specific code (Hono, React, etc.)

### 2. packages/* (other workspace packages)
**Responsibility:** Specialized reusable modules.
| Package | Scope |
|---------|-------|
| `@oscorpex/event-schema` | Event type definitions |
| `@oscorpex/memory-kit` | Agent memory utilities |
| `@oscorpex/observability-sdk` | Observability contracts |
| `@oscorpex/policy-kit` | Policy enforcement rules |
| `@oscorpex/provider-sdk` | CLI adapter contracts |
| `@oscorpex/task-graph` | DAG data structures |
| `@oscorpex/verification-kit` | Output verification |

### 3. apps/kernel (Kernel Application)
**Responsibility:** Runtime execution, API surface, data persistence.
**What belongs here:**
- Boot orchestration (`boot.ts`, `boot-phases/`)
- Hono route definitions (`routes/`)
- Database repositories and helpers (`db/`)
- Execution engine (`execution-engine.ts`)
- Pipeline engine (`pipeline-engine.ts`)
- Task engine (`task-engine.ts`)
- Provider registry and adapters (`kernel/provider-registry.ts`, `adapters/`)
- Replay store implementation (`replay-store.ts`)
- Event bus and composition wiring (`event-bus.ts`, `composition/`)

**What does NOT belong here:**
- UI components
- VoltAgent integration (removed)
- Console-specific logic

### 4. apps/console (Frontend)
**Responsibility:** React 19 + Vite user interface.
**What belongs here:**
- Pages, components, hooks
- API client modules (`lib/studio-api/`)
- Tailwind styles
- Routing and state management

**What does NOT belong here:**
- Database access
- Business logic that should live in the kernel
- Provider execution

### 5. adapters/ (Workspace-level adapters)
**Responsibility:** External tool integrations (stubs for now).
**Current state:**
- `provider-claude-code/` — stub
- `provider-codex/` — stub
- `provider-cursor/` — stub

**Migration plan:** Move real adapter implementations from `apps/kernel/src/studio/adapters/` into these packages once the contract surface stabilizes.

## Responsibility Matrix

| Concern | Owner | Location |
|---------|-------|----------|
| Provider execution | Kernel | `apps/kernel/src/studio/kernel/provider-registry.ts` |
| Replay / restore | Kernel | `apps/kernel/src/studio/replay-store.ts` |
| Verification | Kernel + `verification-kit` | `apps/kernel/src/studio/verification/` + `packages/verification-kit` |
| Policy enforcement | Kernel + `policy-kit` | `apps/kernel/src/studio/policy-engine.ts` + `packages/policy-kit` |
| Cost tracking | Kernel | `apps/kernel/src/studio/cost-tracker.ts` |
| Event schema | `event-schema` package | `packages/event-schema` |
| Route composition | Kernel | `apps/kernel/src/studio/routes/` |
| UI / Console | Console app | `apps/console/src/` |
| Plugin / Webhook | Kernel | `apps/kernel/src/studio/plugin-registry.ts`, `webhook-sender.ts` |

## Compatibility Shells

Some surfaces are archived rather than deleted to preserve backward compatibility:
- `observability/memory.ts` — Returns `410 Gone` with `archived: true`

New compatibility shells should be explicitly marked and documented. Removal target: next major release.

## Decision Rule for New Modules

When adding a new module, ask:
1. Is it a domain type used across apps? → `packages/core`
2. Is it a specialized reusable library? → `packages/<name>`
3. Is it runtime execution logic? → `apps/kernel`
4. Is it a UI component or page? → `apps/console`
5. Is it an external adapter? → `adapters/<name>`
