# Oscorpex — Patterns & Gotchas

## Hono
- Routes at /api/studio, mounted via `app.route('/api/studio', studioRoutes)`
- CRITICAL: Static routes (/team/org) BEFORE dynamic routes (/team/:agentId)
- Wildcard `c.req.param('*')` unreliable with mount prefix — use raw URL parsing instead
- Routes modular: src/studio/routes/ (11 sub-files). Mount via Hono `route('/')`. `routes.ts` shim re-exports.

## Database
- PostgreSQL via `pg` library, `getPool()` from `src/studio/pg.ts`
- 16+ tables; `token_usage` has `cache_creation_tokens`, `cache_read_tokens`
- DB modular: `src/studio/db/` (15 repos). `db.ts` shim re-exports. Add new CRUD to matching repo.

## pnpm
- Always pnpm add (never npm install)

## CLI-Only Execution
- All AI runs through Claude CLI (`executeWithCLI` / `streamWithCLI`)
- No `generateText`/`streamText` in routes or execution-engine
- `emitTransient` for terminal streaming
- Token usage including cache tokens recorded via `recordTokenUsage()` after each CLI call

## Prompt Budget (v2.6)
- `src/studio/prompt-budget.ts` — `enforcePromptBudget(prompt, ctx)` measures chars, truncates at 400k, emits `prompt:size` event
- `capText(text, maxChars)` for individual field caps (e.g., `task.description` → 10k chars)
- `estimateTokens(chars)` ≈ chars/4
- `buildTaskPrompt` caps `task.description` early, wraps final prompt with `enforcePromptBudget`
- Event type `prompt:size` added to `EventType` union — shows up in analytics

## Context Injection Layers
- Inside `buildTaskPrompt`:
  - `contextFiles` capped at 50 (from completed tasks' filesCreated/Modified)
  - `completedTasks.slice(-10)` (latest 10 summaries)
  - RAG via `buildRAGContext()` — max 5 chunks, 4000 tokens
  - `task.error.slice(0, 1000)` for self-healing
  - `task.description` capped via `safeDescription` (10k chars)
- Agent messages NOT injected into prompts (messaging is standalone)

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
- Pipeline status API does relocation for persisted state compatibility
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

## Testing
- `vi.mock('node:child_process')` factory required for ESM (vi.spyOn fails on exports)
- DB tests use `describe.skipIf(!dbReady)` gate — `SELECT 1 FROM chat_messages LIMIT 0` check
- Frontend mocks: always mock ALL imports from `../lib/studio-api` used by component (e.g. fetchProjectCosts)

## User Preferences
- Always respond in Turkish
- Use pnpm, never npm
- Don't push unless explicitly asked
- Don't edit AI-generated code in .voltagent/repos/
- Dark theme: bg-[#0a0a0a], cards #111111, borders #262626, accent #22c55e
