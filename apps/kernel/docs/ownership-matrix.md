# Oscorpex — Ownership Matrix

Quick reference for "who owns what" in the codebase.

## By Concern

| Concern | Primary Owner | Files / Packages | Backup |
|---------|--------------|------------------|--------|
| **Boot orchestration** | Kernel | `apps/kernel/src/boot.ts`, `boot-phases/` | — |
| **Route composition** | Kernel | `apps/kernel/src/studio/routes/` | — |
| **Provider execution** | Kernel | `apps/kernel/src/studio/kernel/provider-registry.ts` | `packages/provider-sdk` |
| **Provider adapters** | Kernel (moving to adapters/) | `apps/kernel/src/studio/adapters/` → `adapters/provider-*/` | — |
| **Replay / restore** | Kernel | `apps/kernel/src/studio/replay-store.ts` | — |
| **Task engine** | Kernel | `apps/kernel/src/studio/task-engine.ts` | — |
| **Pipeline engine** | Kernel | `apps/kernel/src/studio/pipeline-engine.ts` | — |
| **Execution engine** | Kernel | `apps/kernel/src/studio/execution-engine.ts` | — |
| **Policy enforcement** | Kernel + PolicyKit | `apps/kernel/src/studio/policy-engine.ts` + `packages/policy-kit` | — |
| **Verification** | Kernel + VerificationKit | `apps/kernel/src/studio/verification/` + `packages/verification-kit` | — |
| **Cost tracking** | Kernel | `apps/kernel/src/studio/cost-tracker.ts` | — |
| **Event bus** | Kernel | `apps/kernel/src/studio/event-bus.ts` | `packages/event-schema` |
| **Database** | Kernel | `apps/kernel/src/studio/db/`, `pg.ts` | — |
| **WebSocket** | Kernel | `apps/kernel/src/studio/ws-server.ts`, `ws-manager.ts` | — |
| **Plugin / Webhook** | Kernel | `apps/kernel/src/studio/plugin-registry.ts`, `webhook-sender.ts` | — |
| **Auth / Tenant** | Kernel | `apps/kernel/src/studio/auth/` | — |
| **Sandbox** | Kernel | `apps/kernel/src/studio/sandbox-manager.ts` | — |
| **Console UI** | Console | `apps/console/src/` | — |
| **API client** | Console | `apps/console/src/lib/studio-api/` | — |
| **Domain types** | Core | `packages/core/` | — |
| **Event schema** | EventSchema | `packages/event-schema/` | — |
| **Provider SDK** | ProviderSDK | `packages/provider-sdk/` | — |

## By File Pattern

| Pattern | Owner |
|---------|-------|
| `apps/kernel/src/boot*.ts` | Boot |
| `apps/kernel/src/boot-phases/*.ts` | Boot |
| `apps/kernel/src/studio/routes/*.ts` | Routes |
| `apps/kernel/src/studio/kernel/*.ts` | Provider Registry |
| `apps/kernel/src/studio/adapters/*.ts` | Adapters (moving out) |
| `apps/kernel/src/studio/replay-store.ts` | Replay |
| `apps/kernel/src/studio/*-engine.ts` | Engines |
| `apps/kernel/src/studio/db/*.ts` | Database |
| `apps/kernel/src/studio/*-manager.ts` | Managers |
| `apps/console/src/pages/**/*.tsx` | Console |
| `apps/console/src/lib/studio-api/*.ts` | Console API |
| `packages/core/src/**/*.ts` | Core |
| `packages/*/src/**/*.ts` | Respective package |
| `adapters/*/src/**/*.ts` | Adapter packages |

## Escalation Path

1. **Bug in provider execution** → Kernel owner → Adapter extraction team
2. **Bug in replay restore** → Kernel owner → Security audit team
3. **Bug in console UI** → Console owner → API contract team
4. **Bug in domain types** → Core owner → All consumers notified
