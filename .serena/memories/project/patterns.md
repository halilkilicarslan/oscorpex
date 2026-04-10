# Patterns & Gotchas

## Hono
- Routes at /api/studio, mounted via `app.route('/api/studio', studioRoutes)`
- CRITICAL: Static routes (/team/org) BEFORE dynamic routes (/team/:agentId)
- Wildcard `c.req.param('*')` unreliable with mount prefix — use raw URL parsing instead

## pnpm
- Always pnpm add (never npm install)

## better-sqlite3
- Synchronous API, getDb() lazy init
- Additive migrations via PRAGMA table_info + ALTER TABLE
- CREATE TABLE IF NOT EXISTS for new tables (idempotent)

## CLI-Only Execution
- All AI runs through Claude CLI (`executeWithCLI` / `streamWithCLI`)
- No `generateText`/`streamText` in routes or execution-engine
- `emitTransient` for terminal streaming

## Agent Output Persistence
- 3-tier fallback: in-memory buffer → .log file → DB task output.logs
- `persistAgentLog()` called on task complete/fail in execution-engine
- `loadAgentLog()` for reading back after restart

## Runtime System
- Port detection: .env PORT → source code `.listen(N)` → FRAMEWORK_DEFAULT_PORTS
- DB provisioning: `findAvailablePort()` auto-increments on conflict
- `postStartHealthCheck()`: fetch localhost:PORT after start, any HTTP response = alive
- `.studio.json` auto-generated after first successful start
- Preview proxy: strips X-Frame-Options, CSP, COOP, CORP headers
- API-only apps: root `/` returns 404 → proxy serves styled HTML info page

## Preview / iframe
- Direct URL blocked by helmet X-Frame-Options: SAMEORIGIN
- Solution: reverse proxy at `/projects/:id/app/proxy/*`
- Vite proxies `/api/studio` → localhost:3141
- iframe src uses proxy path, external link uses direct URL

## Pipeline
- DAG-based with agent_dependencies table
- pipeline_runs table persists state (survives restart via hydration)
- Review loop: Reviewer → assigned dev → Reviewer

## Agent Colors
PM=#f59e0b, Designer=#f472b6, Architect=#3b82f6, Frontend=#ec4899,
Backend=#22c55e, Coder=#06b6d4, QA=#a855f7, Reviewer=#ef4444, DevOps=#0ea5e9

## User Preferences
- Always respond in Turkish
- Use pnpm, never npm
- Don't push unless explicitly asked
- Don't edit AI-generated code in .voltagent/repos/
- Dark theme: bg-[#0a0a0a], cards #111111, borders #262626, accent #22c55e
