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

## CRITICAL: await all taskEngine calls
- `taskEngine.assignTask()`, `startTask()`, `completeTask()`, `failTask()` are ALL async
- MUST use `await` — without it, race conditions cause "status: queued" errors
- This was a pervasive bug across execution-engine.ts (fixed in v2.3)

## Agent Output Persistence
- 3-tier fallback: in-memory buffer → .log file → DB task output.logs
- `persistAgentLog()` called on task complete/fail in execution-engine
- `loadAgentLog()` for reading back after restart

## Review Loop
- `completeTask()` → finds reviewer via `findReviewerForTask()` → creates review task → `notifyCompleted()` triggers dispatch
- Review task placed in SAME stage as original task (not reviewer's stage)
- Rejection → `submitReview(approved=false)` → task goes to 'revision' → auto-restart via `restartRevision()` + `executeTask()`
- Review task title pattern: `"Code Review: {originalTitle}"`
- Max revision cycles: 3 (then escalation to tech-lead)

## Pipeline Stage Assignment
- Normal tasks: matched to stage by assignedAgent → wave agent match
- Review tasks: matched to stage by dependsOn[0] → same stage as original task
- Reviewer agent injected into target stage's agent list
- Pipeline status API (routes.ts) does relocation for persisted state compatibility
- Empty pending stages with 0 tasks are hidden in frontend

## Startup Recovery (execution-engine.ts recoverStuckTasks)
1. Reset running/assigned tasks → queued
2. Restart revision tasks via restartRevision() + executeTask()
3. Dispatch orphaned queued tasks in running/completed phases

## Runtime System
- Port detection: .env PORT → source code `.listen(N)` → FRAMEWORK_DEFAULT_PORTS
- DB provisioning: `findAvailablePort()` auto-increments on conflict
- `postStartHealthCheck()`: fetch localhost:PORT after start, any HTTP response = alive
- `.studio.json` auto-generated after first successful start (only running services)
- Preview proxy: strips X-Frame-Options, CSP, COOP, CORP headers

## Preview / iframe
- iframe uses DIRECT URL (http://localhost:PORT) — NOT proxy
- Proxy breaks ES module imports in inline `<script type="module">` (import resolves against page origin, not `<base>`)
- Proxy still used for: API-only detection (fetch), `<base>` tag injection in HTML
- `switchPreviewService()` backend endpoint changes which service the proxy routes to
- CRITICAL: Set `API_TARGET` for Vite proxy target, NEVER `VITE_API_URL` (bypasses proxy → CORS)
- Port conflicts: `isPortInUse()` via `lsof -ti:PORT`, `resolvePort()` auto-increment
- autoDetect/analyzeProject: ALWAYS scan root dir even when subdirs found (monorepo root may have backend)
- Vite proxies `/api/studio` → localhost:3141

## Task Modal
- `task.error` field used for both real errors AND review feedback
- Display logic: revision/review status → orange "Review Geri Bildirimi"; failed → red "Hata"

## Agent Colors
PM=#f59e0b, Designer=#f472b6, Architect=#3b82f6, Frontend=#ec4899,
Backend=#22c55e, Coder=#06b6d4, QA=#a855f7, Reviewer=#ef4444, DevOps=#0ea5e9

## User Preferences
- Always respond in Turkish
- Use pnpm, never npm
- Don't push unless explicitly asked
- Don't edit AI-generated code in .voltagent/repos/
- Dark theme: bg-[#0a0a0a], cards #111111, borders #262626, accent #22c55e
