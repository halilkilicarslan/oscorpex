# Beta-1: Feature Flag Matrix

**Version**: Beta-1.0
**Date**: 2026-05-14
**Status**: Operational

---

## 1. Purpose

This document is the canonical reference for every feature flag that governs
Beta-1 behaviour. Each flag is listed with its Beta-1 default, its intended
production default, its enforcement mechanism, and any dependencies.

An operator MUST set these flags explicitly before starting the kernel in beta
mode. Do not rely on runtime defaults alone — set every value in `.env.beta`.

---

## 2. Flag Matrix

| Feature | Environment Variable | Beta-1 Default | Production Default | Notes |
|---------|---------------------|---------------|-------------------|-------|
| API authentication | `OSCORPEX_API_KEY` | Required | Required | JWT Bearer; no anonymous access in any environment |
| Development auth bypass | `OSCORPEX_DEV_NO_AUTH` | `false` | `false` | Must remain `false` in beta and production; `true` only on local dev |
| Terminal exec endpoint | `OSCORPEX_ENABLE_TERMINAL_EXEC` | `false` | `false` | `/terminal/exec` disabled; RCE surface closed |
| MCP read tools | *(always on)* | enabled | enabled | Controlled by capability grants; no env flag needed |
| MCP write tools | `OSCORPEX_ENABLE_MCP_WRITE_TOOLS` | `false` | `false` | Write tools (file mutation, shell exec) disabled in beta-1 |
| MCP write in production | `OSCORPEX_ALLOW_MCP_WRITE_IN_PROD` | `false` | `false` | Separate guard; both flags must be `true` to unlock write tools in prod |
| Gateway subsystem | `OSCORPEX_ENABLE_GATEWAY` | `true` | `false` | Enabled in beta for validation; gated behind auth + rate limits |
| Hermes subsystem | `OSCORPEX_ENABLE_HERMES` | `true` | `false` | Enabled in beta; read-only, session budget enforced |
| Scheduler subsystem | `OSCORPEX_ENABLE_SCHEDULER` | `true` | `false` | Background task scheduler; enabled for pipeline execution testing |
| Container runtime | `OSCORPEX_ENABLE_CONTAINER_RUNTIME` | `false` | `false` | Docker-based sandbox disabled; container pool not provisioned |
| Docker socket (production) | `OSCORPEX_ALLOW_DOCKER_SOCKET_IN_PROD` | `false` | `false` | Must remain `false`; Docker socket is a P0 RCE vector |
| Adaptive concurrency | `OSCORPEX_PERF_FEATURES` includes `adaptiveConcurrency` | enabled | enabled | Concurrency auto-tuning; safe in beta |
| Retry policy | `OSCORPEX_PERF_FEATURES` includes `retryPolicy` | enabled | enabled | Classification-aware retries; safe in beta |
| Timeout policy | `OSCORPEX_PERF_FEATURES` includes `timeoutPolicy` | enabled | enabled | Provider × complexity resolution; safe in beta |
| Preflight warmup | `OSCORPEX_PREFLIGHT_ENABLED` | `true` | `true` | Cold-start health checks; required in beta |
| Budget guard | *(always on)* | enforced | enforced | Cost circuit breaker; cannot be disabled |
| Prompt injection detection | *(always on)* | enforced | enforced | 23-regex governance; cannot be disabled |
| Approval gates | *(always on)* | enforced | enforced | Agent writes require human approval; cannot be bypassed |
| RLS enforcement | *(always on via DB)* | enforced | enforced | PostgreSQL FORCE ROW LEVEL SECURITY; cannot be disabled at app level |

---

## 3. Beta-1 `.env` Template

Copy this block into `.env.beta` before deployment. Fill in all secrets from
the secure vault — do not use placeholder values in any live environment.

```dotenv
# === Authentication ===
OSCORPEX_API_KEY=<generate-with-create-api-key-script>
JWT_SECRET=<minimum-32-char-random-string-from-vault>
OSCORPEX_DEV_NO_AUTH=false

# === Feature Flags ===
OSCORPEX_ENABLE_TERMINAL_EXEC=false
OSCORPEX_ENABLE_MCP_WRITE_TOOLS=false
OSCORPEX_ALLOW_MCP_WRITE_IN_PROD=false
OSCORPEX_ENABLE_GATEWAY=true
OSCORPEX_ENABLE_HERMES=true
OSCORPEX_ENABLE_SCHEDULER=true
OSCORPEX_ENABLE_CONTAINER_RUNTIME=false
OSCORPEX_ALLOW_DOCKER_SOCKET_IN_PROD=false
OSCORPEX_PREFLIGHT_ENABLED=true

# === Performance ===
OSCORPEX_PERF_FEATURES=adaptiveConcurrency,retryPolicy,timeoutPolicy,taskScheduler,modelRouter
OSCORPEX_MAX_CONCURRENT_TASKS=3
OSCORPEX_MAX_AUTO_RETRIES=3
OSCORPEX_BASE_BACKOFF_MS=5000

# === Timeouts ===
OSCORPEX_TIMEOUT_S=1800000
OSCORPEX_TIMEOUT_M=1800000
OSCORPEX_TIMEOUT_L=2700000
OSCORPEX_TIMEOUT_XL=3600000

# === Database ===
DATABASE_URL=postgresql://oscorpex:<password>@<host>:5432/oscorpex
DB_POOL_MIN=2
DB_POOL_MAX=10

# === Ports ===
PORT=3141
HOST=127.0.0.1

# === Logging ===
LOG_LEVEL=info
NODE_ENV=production
```

---

## 4. Flag Verification Procedure

Run these checks after deployment before allowing any tenant to connect:

```bash
# 1. Verify OSCORPEX_DEV_NO_AUTH is false
curl -s http://localhost:3141/api/studio/projects | jq '.error'
# Expected: "Unauthorized" or "Missing token" — NOT a project list

# 2. Verify terminal exec is disabled
curl -s -X POST http://localhost:3141/api/studio/terminal/exec \
  -H "Content-Type: application/json" \
  -d '{"command":"id"}' | jq '.error'
# Expected: 404 or "feature disabled"

# 3. Verify MCP write tools are disabled
curl -s http://localhost:3141/api/studio/mcp/capabilities \
  -H "Authorization: Bearer <ADMIN_TOKEN>" | jq '.write_tools_enabled'
# Expected: false

# 4. Verify Docker socket not mounted
docker inspect oscorpex-kernel 2>/dev/null | jq '.[0].HostConfig.Binds'
# Expected: null or array not containing "docker.sock"
```

---

## 5. Flag Change Protocol

Changing any flag in a live beta environment requires:

1. Written approval from the on-call lead and one additional engineer
2. Entry in the change log (date, flag, old value, new value, approver)
3. Notification posted to `#oscorpex-beta-1` Slack before the change
4. Monitoring review 30 minutes after the change
5. Rollback plan documented before the change is applied

**Flags that can NEVER be changed without a P0 incident review**:
- `OSCORPEX_DEV_NO_AUTH` — setting to `true` disables all authentication
- `OSCORPEX_ALLOW_DOCKER_SOCKET_IN_PROD` — setting to `true` enables RCE surface
- `OSCORPEX_ALLOW_MCP_WRITE_IN_PROD` — setting to `true` enables unreviewed writes

---

## 6. Flag Dependency Graph

```
OSCORPEX_ENABLE_MCP_WRITE_TOOLS
  └── also requires OSCORPEX_ALLOW_MCP_WRITE_IN_PROD=true (in prod)
  └── also requires approval gate to be active (always on)

OSCORPEX_ENABLE_CONTAINER_RUNTIME
  └── also requires OSCORPEX_ALLOW_DOCKER_SOCKET_IN_PROD=true
  └── also requires Docker pool images to be provisioned

OSCORPEX_ENABLE_HERMES
  └── rate limit: 20/min (enforced by rate-limiter middleware)
  └── session budget: 50 tool calls per session (enforced by hermes-session.ts)

OSCORPEX_ENABLE_GATEWAY
  └── rate limit: 60/min (enforced by rate-limiter middleware)
  └── read-only mode: write operations rejected at gateway layer
```
