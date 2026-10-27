# Staging Environment Definition

Version: 1.0 — 2026-05-14
Scope: Oscorpex RC1 Staging Environment

---

## Purpose

The staging environment is a full-fidelity replica of production used for:
- Soak testing of Hermes, Gateway, and Scheduler subsystems
- Regression testing prior to production releases
- Security review and penetration testing
- Backup/restore drills
- Rollback procedure validation

Staging contains **no real user data**. All test data is synthetic and seeded by scripts.

---

## Docker Compose Configuration

The staging environment runs via Docker Compose with the following services:

```yaml
# docker-compose.staging.yml (reference topology)
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: oscorpex
      POSTGRES_PASSWORD: oscorpex_staging
      POSTGRES_DB: oscorpex_staging
    volumes:
      - postgres_staging_data:/var/lib/postgresql/data
      - ./apps/kernel/scripts/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    networks:
      - staging_internal
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "oscorpex", "-d", "oscorpex_staging"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build:
      context: .
      dockerfile: apps/kernel/Dockerfile
    environment:
      - NODE_ENV=staging
      - DATABASE_URL=postgresql://oscorpex:oscorpex_staging@postgres:5432/oscorpex_staging
      - OSCORPEX_DEV_NO_AUTH=true          # Staging only — NEVER in production
      - OSCORPEX_ENABLE_HERMES=true        # Soak testing
      - OSCORPEX_ENABLE_GATEWAY=true       # Soak testing
      - OSCORPEX_ENABLE_SCHEDULER=true     # Soak testing
      - OSCORPEX_HERMES_SESSION_BUDGET=50  # Conservative for staging
      - OSCORPEX_ENABLE_MCP_WRITE_TOOLS=false
      - OSCORPEX_ENABLE_TERMINAL_EXEC=false
    ports:
      - "3141:3141"
      - "3142:3142"   # WebSocket
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - staging_internal
      - staging_external
    # Docker socket is NOT mounted
    volumes: []

  console:
    build:
      context: .
      dockerfile: apps/console/Dockerfile
    environment:
      - VITE_PROXY_TARGET=http://backend:3141
    ports:
      - "5161:5161"
    depends_on:
      - backend
    networks:
      - staging_external

networks:
  staging_internal:
    internal: true      # Postgres not reachable from host
  staging_external:
    driver: bridge

volumes:
  postgres_staging_data:
```

---

## Database

- **Schema**: Applied from `apps/kernel/scripts/init.sql` (idempotent, `CREATE TABLE IF NOT EXISTS`)
- **Data**: Synthetic only — seeded via `scripts/seed-staging-data.sh`
- **Isolation**: Staging database is a separate PostgreSQL instance; no connection to production DB
- **RLS**: All Row-Level Security policies active (identical to production)
- **FORCE RLS**: Applied on all multi-tenant tables

---

## Environment Variables

| Variable | Staging Value | Production Value | Notes |
|---|---|---|---|
| `NODE_ENV` | `staging` | `production` | |
| `OSCORPEX_DEV_NO_AUTH` | `true` | **must be unset/false** | Staging only — bypass for test automation |
| `OSCORPEX_ENABLE_HERMES` | `true` | opt-in | Soak testing active in staging |
| `OSCORPEX_ENABLE_GATEWAY` | `true` | opt-in | Soak testing active in staging |
| `OSCORPEX_ENABLE_SCHEDULER` | `true` | opt-in | Soak testing active in staging |
| `OSCORPEX_HERMES_SESSION_BUDGET` | `50` | `<=50` | Conservative limit |
| `OSCORPEX_ENABLE_MCP_WRITE_TOOLS` | `false` | `false` | |
| `OSCORPEX_ENABLE_TERMINAL_EXEC` | `false` | `false` | |
| `DATABASE_URL` | staging DSN | production DSN | Separate instances |

---

## P0-P13 Protections Active in Staging

All security protections are fully active in staging to validate they do not break functionality:

| Protection | Status in Staging |
|---|---|
| P0: RCE vectors closed | Active |
| P0: Auth hardening (when auth enabled) | Active |
| P0: RLS + FORCE ROW LEVEL SECURITY | Active |
| P1: Docker socket removed | Active (not mounted) |
| P1: Rate limiting | Active |
| P2: Tool policy enforcement | Active |
| P2: Env sanitization | Active |
| P3: Checkpoint service | Active |
| P4: MCP read-only stable | Active |
| P5: MCP read-only validation | Active |
| P6: Write tools approval-gated | Active |
| P7: Coverage thresholds | Validated in CI before staging deploy |
| P8: Sandbox hardening | Active |
| P9: Git commit controlled | Active |
| P10: Scheduler read-only | Active |
| P11: Gateway read-only | Active |
| P12: Hermes read-only | Active |
| P13: Red-team tests | Run against staging |

---

## Monitoring Endpoints

The following endpoints must be accessible in staging for health and observability:

| Endpoint | Purpose |
|---|---|
| `GET /health` | DB connectivity + process health |
| `GET /telemetry/performance/baseline` | Performance metrics baseline |
| `GET /mcp/metrics` | MCP operation counters |

---

## Network Isolation

- Staging backend and console are on a **separate network** from production
- Postgres is on an **internal-only** Docker network (not reachable from host directly)
- No DNS or routing overlap between staging and production
- Outbound internet access from staging containers is restricted to package registries and LLM APIs

---

## Synthetic Test Data

Staging is populated with synthetic data only:

- No real user credentials
- No real project code or personal information
- Test users follow the pattern `test-user-{uuid}@oscorpex.internal`
- Test projects use clearly synthetic names (e.g., `smoke-test-project-{uuid}`)
- All synthetic data is idempotently seeded; re-runs are safe

---

## Promotion Gate

Code is promoted from CI to staging only when:

1. `pnpm typecheck` passes (zero errors)
2. All P0-P13 test suites pass in CI (no `continue-on-error`)
3. `scripts/run-full-regression.sh` exits 0
4. `scripts/production-preflight.sh` passes (staging mode)
5. Docker images build successfully

---

## Differences from Production

| Aspect | Staging | Production |
|---|---|---|
| `OSCORPEX_DEV_NO_AUTH` | `true` (test automation) | `false` / unset |
| Real user data | None | Yes |
| Hermes/Gateway/Scheduler | Enabled for soak | Opt-in |
| TLS termination | Optional (internal use) | Required |
| Secret manager | Not required | Required |
| Backup schedule | Manual (drill only) | Automated daily |
