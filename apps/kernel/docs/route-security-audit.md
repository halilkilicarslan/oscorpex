# Oscorpex Kernel — Route Security Audit

This document provides a security-oriented inventory of the kernel API surface.

## Auth Model

The kernel uses a **layered auth** approach:

1. **Bearer token** (`OSCORPEX_API_KEY`) — opt-in, global API key
2. **Tenant-aware auth** (`OSCORPEX_AUTH_ENABLED=true`) — JWT/session based
3. **Budget guard** — execution route middleware (spending limit enforcement)

### Auth Middleware Behavior
- SSE/EventSource endpoints are **skipped** (browser cannot set headers)
- `/api/auth/*` is always auth-free (register/login)
- Tenant auth is opt-in via env var

---

## Route Categories

### Core — Project, Task, Agent Management
| Route | Auth Required | Tenant Sensitive | Notes |
|-------|--------------|------------------|-------|
| `GET /projects` | Yes (if enabled) | Yes | Lists tenant-scoped projects |
| `POST /projects` | Yes (if enabled) | Yes | Creates project for tenant |
| `GET /projects/:id` | Yes (if enabled) | Yes | Project details |
| `GET /tasks` | Yes (if enabled) | Yes | Task listing |
| `POST /tasks` | Yes (if enabled) | Yes | Task creation |
| `GET /agents` | Yes (if enabled) | No | Global agent configs |
| `GET /agents/presets` | No | No | Public preset list |

### Execution — Pipeline, Runtime, Provider, Sandbox
| Route | Auth Required | Tenant Sensitive | Notes |
|-------|--------------|------------------|-------|
| `POST /projects/:id/execute` | Yes | Yes | **Budget guard applied** |
| `POST /projects/:id/pipeline/start` | Yes | Yes | **Budget guard applied** |
| `POST /projects/:id/agents/:agentId/exec` | Yes | Yes | **Budget guard applied** |
| `GET /pipeline/:id/status` | Yes | Yes | Pipeline state |
| `POST /providers/:id/cancel` | Yes | Yes | Provider cancellation |
| `POST /sandbox/:id/run` | Yes | Yes | Sandbox execution |

### Replay / Restore
| Route | Auth Required | Tenant Sensitive | Notes |
|-------|--------------|------------------|-------|
| `GET /replay/runs/:runId/snapshots` | Yes | Yes | List checkpoints |
| `GET /replay/runs/:runId/inspect` | Yes | Yes | Inspect latest snapshot |
| `POST /replay/runs/:runId/restore` | Yes | Yes | **High-risk: restore** |
| `GET /replay/snapshots/:snapshotId` | Yes | Yes | Single snapshot |

> **Restore Authorization:** Restore operations mutate project state. They should be restricted to project owners or admin roles. Currently protected by general auth middleware only.

### Observability — Analytics, Cost, Telemetry
| Route | Auth Required | Tenant Sensitive | Notes |
|-------|--------------|------------------|-------|
| `GET /analytics/*` | Yes | Yes | Tenant-scoped analytics |
| `GET /cost/*` | Yes | Yes | Cost tracking |
| `GET /notifications` | Yes | Yes | User notifications |
| `GET /telemetry/*` | Yes | Yes | Only mounted when `OSCORPEX_TRACE_ENABLED=true` |

### Archived Surface
| Route | Auth Required | Notes |
|-------|--------------|-------|
| `GET /memory/*` | Yes | **410 Gone** — VoltAgent archived |

---

## SSE / Stream Endpoints

These endpoints skip header-based auth (browser EventSource limitation):

| Endpoint | Auth Fallback | Notes |
|----------|--------------|-------|
| `/projects/:id/stream` | `?token=` query param | Task output streaming |
| `/notifications/stream` | `?token=` query param | Real-time notifications |

---

## High-Risk Operations

The following operations should have additional authorization checks:

1. **Replay restore** (`POST /replay/runs/:runId/restore`)
   - Mutates project tasks and pipeline state
   - Dry-run by default (`dryRun=true`)
   - Should require project-owner role for `dryRun=false`

2. **Provider management** (`POST /providers/:id/configure`)
   - Changes execution backend
   - Should require admin role

3. **Budget override**
   - No dedicated endpoint yet, but budget guard middleware enforces limits
   - Admin override should be logged

4. **Sandbox execution** (`POST /sandbox/:id/run`)
   - Runs arbitrary code
   - Should require elevated permissions

---

## Security Gaps & Recommendations

| Gap | Risk | Recommendation |
|-----|------|----------------|
| Restore without role check | Medium | Add project-owner check before `dryRun=false` restore |
| No rate limiting on auth | Low | Add rate limiting to `/auth/*` endpoints |
| SSE token in query param | Low-Medium | Use short-lived signed tokens for SSE |
| No audit log for restore | Medium | Log all restore attempts with actor metadata |
| Sandbox execution unbounded | High | Add sandbox timeout, size limits, and audit logging |
