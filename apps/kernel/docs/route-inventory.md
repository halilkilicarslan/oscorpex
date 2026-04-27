# Oscorpex — Route Inventory

Complete inventory of HTTP API endpoints exposed by the kernel.

## Legend

| Symbol | Meaning |
|--------|---------|
| 🔓 | Public (no auth) |
| 🔐 | Auth required (API key or tenant auth) |
| 👤 | Tenant-scoped |
| 💰 | Budget guard applied |
| ⚠️ | High-risk operation |

---

## Health

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/health` | 🔓 | Returns `{ status: "ok", mode: "kernel" }` |

---

## Authentication

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/studio/auth/register` | 🔓 | User registration |
| POST | `/api/studio/auth/login` | 🔓 | User login |
| POST | `/api/studio/auth/refresh` | 🔓 | Token refresh |

---

## Core — Projects

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/studio/projects` | 🔐👤 | List tenant projects |
| POST | `/api/studio/projects` | 🔐👤 | Create project |
| GET | `/api/studio/projects/:id` | 🔐👤 | Project details |
| PUT | `/api/studio/projects/:id` | 🔐👤 | Update project |
| DELETE | `/api/studio/projects/:id` | 🔐👤 | Delete project |

---

## Core — Tasks

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/studio/tasks` | 🔐👤 | List tasks |
| POST | `/api/studio/tasks` | 🔐👤 | Create task |
| GET | `/api/studio/tasks/:id` | 🔐👤 | Task details |
| PUT | `/api/studio/tasks/:id` | 🔐👤 | Update task |

---

## Core — Agents

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/studio/agents` | 🔐 | List agent configs |
| GET | `/api/studio/agents/presets` | 🔓 | Public preset list |
| GET | `/api/studio/agents/:id` | 🔐 | Agent details |

---

## Execution — Pipeline & Runtime

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/studio/projects/:id/pipeline/start` | 🔐👤💰 | Start pipeline |
| GET | `/api/studio/pipeline/:id/status` | 🔐👤 | Pipeline status |
| POST | `/api/studio/projects/:id/execute` | 🔐👤💰 | Execute task |
| POST | `/api/studio/projects/:id/agents/:agentId/exec` | 🔐👤💰 | Execute agent |

---

## Execution — Providers

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/studio/providers` | 🔐 | List providers |
| POST | `/api/studio/providers/:id/cancel` | 🔐👤 | Cancel execution |
| GET | `/api/studio/providers/:id/health` | 🔐 | Provider health |

---

## Replay (High-Value Capability)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/studio/replay/runs/:runId/snapshots` | 🔐👤 | List checkpoints |
| GET | `/api/studio/replay/runs/:runId/inspect` | 🔐👤 | Inspect latest snapshot |
| GET | `/api/studio/replay/snapshots/:snapshotId` | 🔐👤 | Single snapshot |
| POST | `/api/studio/replay/runs/:runId/restore` | 🔐👤⚠️ | **Restore** (dryRun=true default) |

> ⚠️ **Restore Authorization**: `dryRun=false` requires `admin` or `owner` role.

---

## Observability

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/studio/analytics/*` | 🔐👤 | Tenant analytics |
| GET | `/api/studio/cost/*` | 🔐👤 | Cost tracking |
| GET | `/api/studio/notifications` | 🔐👤 | User notifications |
| GET | `/api/studio/telemetry/*` | 🔐 | Only when `OSCORPEX_TRACE_ENABLED=true` |

---

## Archived Surface

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/observability/memory/*` | 🔐 | **410 Gone** — VoltAgent archived |

---

## SSE / Stream Endpoints

| Method | Path | Auth Fallback | Notes |
|--------|------|---------------|-------|
| GET | `/api/studio/projects/:id/stream` | `?token=` query param | Task output streaming |
| GET | `/api/studio/notifications/stream` | `?token=` query param | Real-time notifications |

---

## WebSocket

| Protocol | Endpoint | Auth |
|----------|----------|------|
| WS | `ws://localhost:3142/api/studio/ws` | `?token=` query param |

> WebSocket messages include `correlationId` when provided via query param.

---

## Total Count

- **Public endpoints**: 4
- **Auth-required endpoints**: 35+
- **Tenant-scoped endpoints**: 28+
- **Budget-guarded endpoints**: 3
- **High-risk endpoints**: 1 (replay restore)
- **Archived endpoints**: 6 (memory API)
