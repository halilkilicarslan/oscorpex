# Session: 2026-04-10 — Runtime System + Preview Fix

## Başlangıç Sorunları
1. Pipeline status endpoint 500 hatası → `listPhases`, `listTasks`, `Task` type import eksik
2. Agent terminal logları restart sonrası kayboluyordu → in-memory buffer kaybı
3. `run-app` pipeline task'ı fail oluyordu → Docker Compose deniyordu, env var'lar eksikti
4. Preview iframe "refused to connect" hatası → helmet X-Frame-Options engeli

## Implement Edilen Sistemler

### 1. Runtime Analyzer (`src/studio/runtime-analyzer.ts`) — YENİ
- 15+ framework desteği (Node.js, Python, Java, Go, Ruby, Rust)
- `.env.example` parsing — sensitive field detection, categorization
- DB detection: docker-compose.yml + env var pattern'ları
- Monorepo subdirectory scanning
- **Port detection** (bu oturumda düzeltildi): .env → source `.listen(N)` → framework defaults

### 2. DB Provisioner (`src/studio/db-provisioner.ts`) — YENİ
- Docker container lifecycle: PostgreSQL, MySQL, MongoDB, Redis
- Health check loop (20 attempts, 1s interval)
- **Port conflict auto-resolve** (bu oturumda eklendi): `isPortInUse()` + `findAvailablePort()`
- `buildEnvVars()` helper — DRY refactor

### 3. Agent Log Store (`src/studio/agent-log-store.ts`) — YENİ
- `.voltagent/logs/{projectId}/{agentId}.log` dosya tabanlı persistence
- execution-engine.ts'de task complete/fail'de otomatik kayıt

### 4. App Runner Refactor (`src/studio/app-runner.ts`)
- 3-strategy fallback: `.studio.json` → runtime analysis + DB provision → Docker Compose
- **Post-start health check** (bu oturumda eklendi): `postStartHealthCheck()` HTTP verify
- Ready pattern sonrası 2s gecikme + crash detection

### 5. Preview Proxy (`src/studio/routes.ts`)
- `/projects/:id/app/proxy/*` reverse proxy endpoint
- X-Frame-Options, CSP, COOP, CORP header'ları strip
- API-only uygulamalar: root 404 → styled "API Running" bilgi sayfası
- Path extraction: Hono wildcard unreliable → raw URL parsing

### 6. Runtime Panel UI (`console/src/pages/studio/RuntimePanel.tsx`) — YENİ
- Services (framework display, dep install, start)
- Databases (Docker/Local/Cloud provisioning)
- Environment Variables (categorized editor, sensitivity masking)
- Status summary

### 7. LivePreview Refactor (`console/src/pages/studio/LivePreview.tsx`)
- App not running → RuntimePanel göster
- App running → iframe (proxy URL) + optional RuntimePanel side panel (340px)
- Toolbar: device sizes, service selector, refresh, external link, fullscreen, settings

## Keşfedilen Sorunlar & Çözümler
| Sorun | Kök Neden | Çözüm |
|-------|-----------|-------|
| Pipeline 500 | Missing imports | `listPhases`, `listTasks`, `Task` import eklendi |
| iframe "refused to connect" | helmet X-Frame-Options: SAMEORIGIN | Reverse proxy, header strip |
| Express port 4100 vs 3000 | runtime-analyzer hardcoded 4100 | `detectPort()` — .env/source/default |
| Port 5432 conflict | Local PG + Docker PG same port | `findAvailablePort()` auto-increment |
| startApp false positive | Timeout "assuming started" | `postStartHealthCheck()` HTTP verify |
| `require()` in ESM | runtime-analyzer used require('node:fs') | Static import `writeFileSync` |

## Gelecek Planı
- **API Explorer**: Swagger-benzeri UI — route discovery (OpenAPI/source parse), interaktif request/response test, collection persistence
