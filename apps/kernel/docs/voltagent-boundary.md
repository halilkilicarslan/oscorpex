# VoltAgent Integration Boundary

## Overview

Oscorpex kernel is **VoltAgent-agnostic by default**. VoltAgent integration is:
- **Optional** at runtime (`OSCORPEX_MODE=voltagent` required)
- **Optional** at package level (`optionalDependencies`)
- **Isolated** in a separate entrypoint (`entry-voltagent.ts`)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Kernel Mode (Default)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  boot.ts    │  │  Hono API   │  │  Execution Engine   │  │
│  │  (entry)    │  │  (routes)   │  │  (kernel-first)     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                                                              │
│  No VoltAgent code loaded. No VoltAgent deps required.      │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ conditional dynamic import
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  VoltAgent Mode (Optional)                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  entry-voltagent.ts                                   │  │
│  │  - dynamic imports @voltagent/*                       │  │
│  │  - loads VoltAgent agents/workflows                   │  │
│  │  - mounts studio API on same Hono app                 │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  Only loaded when OSCORPEX_MODE=voltagent                   │
└─────────────────────────────────────────────────────────────┘
```

## Dependency Surface

### Kernel Package (`apps/kernel/package.json`)

```json
{
  "dependencies": {
    // Core deps — no VoltAgent
    "@oscorpex/core": "workspace:*",
    "hono": "^4.12.11",
    "pg": "^8.20.0"
  },
  "optionalDependencies": {
    // VoltAgent — only installed if needed
    "@voltagent/core": "^2.6.14",
    "@voltagent/libsql": "^2.1.2"
  }
}
```

### Build Behavior

- `pnpm install` without optional deps → kernel builds without VoltAgent
- `pnpm install` with optional deps → VoltAgent available, but not loaded unless `OSCORPEX_MODE=voltagent`
- Kernel-only Docker image can exclude optional deps entirely

## Runtime Gate

```typescript
// entry-voltagent.ts
if (process.env.OSCORPEX_MODE === "voltagent") {
  bootVoltAgentMode();
} else {
  // skip — kernel runs standalone
}
```

## Migration Path

### Future: Separate Package (P2-1 long-term)

For complete isolation, VoltAgent integration can be extracted to:
- `apps/voltagent-bridge/` — separate app boundary
- `packages/voltagent-adapter/` — shared package

This would remove `@voltagent/*` from kernel package entirely.

## Verification

```bash
# Kernel-only boot (no VoltAgent)
pnpm dev

# VoltAgent mode boot
OSCORPEX_MODE=voltagent pnpm dev
```

## Summary

| Concern | Status |
|---------|--------|
| Runtime isolation | ✅ Conditional dynamic imports |
| Package isolation | ✅ `optionalDependencies` |
| Entry separation | ✅ Separate `entry-voltagent.ts` |
| Build independence | ✅ Kernel builds without VoltAgent |
| Full package split | 🔄 Future: separate app/package |