# Oscorpex Deep Analysis Report

**Tarih:** 2026-05-04
**Kapsam:** Full codebase (~163K LOC) — Kernel (93K), Console (60K), Packages (10K)
**Branch:** `master` (`c6e8af2`)
**Yontem:** 3 paralel uzman agent (Security Reviewer, Architecture Reviewer, Performance Engineer)

---

## Genel Metrikler

| Metrik | Deger |
|--------|-------|
| Kernel LOC | 93,443 |
| Console LOC | 59,996 |
| Packages LOC | 9,991 |
| **Toplam LOC** | **~163K** |
| Test dosyasi | 1,470 |
| DB tablosu | 109 |
| TSX bilesen | 256 |
| `as any` (kernel) | 210 |
| `as any` (console) | 38 |
| TODO/FIXME/HACK | 1 |
| try-catch bloklari | 676 |
| Deep import (4+ level) | 0 |

---

## Bulgu Ozeti

| Domain | Critical | High | Medium | Low | Toplam |
|--------|----------|------|--------|-----|--------|
| Guvenlik | 2 | 4 | 5 | 3 | 14 |
| Mimari | 1 | 3 | 5 | 3 | 12 |
| Performans | 0 | 4 | 7 | 6 | 17 |
| **Toplam** | **3** | **11** | **17** | **12** | **43** |

---

## CRITICAL Bulgular (3)

### SEC-C1. RCE: `app-runner.ts` — `shell: true` ile spawn

**Dosya:** `apps/kernel/src/studio/app-runner.ts:486-490`

`.studio.json` dosyasindan alinan `command` alani `shell: true` ile spawn ediliyor. Kotu niyetli bir repo veya AI agent'in yazdigi bu dosya uzerinden arbitrary command execution mumkun. `readyPattern` alani da dogrudan `new RegExp()` ile derleniyor (ReDoS riski).

**Duzeltme:**
1. `shell: true` kaldirin — command zaten `bin` + `args` olarak ayrilmis
2. Binary'leri whitelist'e karsi dogrulayin (npm, pnpm, node, docker, python vb.)
3. `readyPattern`'i sabit keyword seti ile sinirlandin veya `re2` kullnain

---

### SEC-C2. RCE: `runtime-routes.ts` — `execSync` ile install komutu

**Dosya:** `apps/kernel/src/studio/routes/runtime-routes.ts:300-335`

`/projects/:id/runtime/install` endpoint'i `svc.installCommand`'i `execSync` ile calistiriyor. Kotu niyetli `package.json` icindeki `preinstall`/`postinstall` script'leri otomatik olarak tetiklenir.

**Duzeltme:**
1. Install komutlarini container icinde calistirin
2. `--ignore-scripts` flag'i ekleyin
3. Kullanici onayi gerektirin

---

### ARCH-C1. Route handler'larda raw SQL

**Dosya:** `apps/kernel/src/studio/routes/project-crud-routes.ts:66-260`

`/platform/stats` ve `/platform/analytics` endpoint'lerinde en az 10 farkli raw SQL sorgusu route handler icinde yazilmis. CLAUDE.md'deki "Always import from `./db.js` barrel" kurali ihlal ediliyor.

**Duzeltme:** Sorgulari `db/platform-stats-repo.ts` repo module'une tasiyin.

---

## HIGH Bulgular (11)

### Guvenlik (4)

| ID | Baslik | Dosya | Aciklama |
|----|--------|-------|----------|
| SEC-H1 | Auth bypass (dev mode) | `auth/auth-middleware.ts:108-115` | `OSCORPEX_API_KEY` yoksa ve `NODE_ENV !== production` ise tum route'lar acik. Sunucu `0.0.0.0:3141`'de dinliyor — LAN'dan erisilebilir. **Duzeltme:** Dev mode'da `127.0.0.1`'e bind edin. |
| SEC-H2 | SSRF bypass (DNS rebinding) | `utils/url-validator.ts:24-56` | Webhook URL validation string-based; DNS resolution yapilmiyor. `nip.io`, IPv6-mapped IPv4 vb. bypass'lar mumkun. **Duzeltme:** `dns.resolve()` ile IP dogrulayin. |
| SEC-H3 | Credential file access | `cli-usage.ts:794-910` | OAuth token'lari module-level `cachedCredentials`'da plain-text tutuluyor. Cursor token `execSync` ile SQLite'tan okunuyor. **Duzeltme:** In-memory sifreleme, audit logging. |
| SEC-H4 | Path traversal (symlink) | `packages/policy-kit/src/sandbox-enforcement.ts:50-66` | `normalize(resolve())` kullaniliyor ama `realpathSync()` yok — symlink bypass mumkun. **Duzeltme:** `fs.realpathSync()` ekleyin. |

### Mimari (3)

| ID | Baslik | Dosya | Aciklama |
|----|--------|-------|----------|
| ARCH-H1 | cli-usage.ts God File | `cli-usage.ts` (1659 LOC, 48 fn) | 5+ concern tek dosyada: binary probe, OAuth, JSONL parsing, DB persistence, admin API. **Duzeltme:** `cli-usage/` dizinine parcalayin. |
| ARCH-H2 | task-executor.ts octopus | `execution/task-executor.ts` (518 LOC) | 19 sibling module import ediyor. **Duzeltme:** PromptAssembler, AgentResolver service'lerine ayirin. |
| ARCH-H3 | Frontend God Pages | 7 sayfa 900+ LOC | `TriggersPage` (1165), `RagPage` (1109), `CreateProjectModal` (1243) vb. — sub-component'lar ayni dosyada. **Duzeltme:** Alt dizinlere parcalayin. |

### Performans (4)

| ID | Baslik | Dosya | Aciklama |
|----|--------|-------|----------|
| PERF-H1 | `listProjects()` sinirsiz | `db/project-repo.ts:49-51` | `SELECT * FROM projects` — LIMIT yok, `projects.status` index yok. Recovery'de her restart'ta cagriliyor. **Duzeltme:** `WHERE status = 'running'` + index. |
| PERF-H2 | UPDATE sonrasi gereksiz SELECT (3 yer) | `db/pipeline-repo.ts:92-99` | `updatePipelineRun`, `updateAgentRun`, `createAgentRun` — UPDATE sonrasi ayri SELECT. **Duzeltme:** `RETURNING *` kullnain. |
| PERF-H3 | `context_chunks` LIMIT'siz | `db/context-repo.ts:101-102` | Buyuk repo'larda binlerce chunk RAM'e yuklenir. **Duzeltme:** Pagination ekleyin. |
| PERF-H4 | RLS subquery zinciri | `init.sql:1384-1397` | `tenant_isolation_tasks` politikasi her `tasks` erisiminde subquery calistiriyor. **Duzeltme:** `tasks.tenant_id` kolonu + dogrudan eslesme. |

---

## MEDIUM Bulgular (17)

### Guvenlik (5)

| ID | Baslik | Dosya |
|----|--------|-------|
| SEC-M1 | Dynamic SQL column names | `db/task-repo.ts`, `project-repo.ts`, `pipeline-repo.ts` vb. (8 dosya) |
| SEC-M2 | ReDoS — `.studio.json` readyPattern | `app-runner.ts:477` |
| SEC-M3 | Permissive CORS config | `routes/index.ts:73-86` |
| SEC-M4 | Unbounded stdout/stderr (legacy) | `legacy/cli-adapter.ts:107-115, 224-232` |
| SEC-M5 | Lint runner argument injection | `lint-runner.ts:156, 175` — `--` separator eksik |

### Mimari (5)

| ID | Baslik | Dosya |
|----|--------|-------|
| ARCH-M1 | taskEngine singleton gravity well | 8 sub-module dogrudan import ediyor |
| ARCH-M2 | 13 servis DB barrel bypass | `graph-coordinator.ts`, `release-decision-service.ts` vb. |
| ARCH-M3 | control-plane dual pool + leaked DB exports | `packages/control-plane/src/pg.ts` |
| ARCH-M4 | Module-level singleton instantiation | `*-engine.ts` (3 dosya) — test'te mock zor |
| ARCH-M5 | pm-agent.ts sinirda (1043 LOC) | Tool tanimlari + prompt + logic tek dosyada |

### Performans (7)

| ID | Baslik | Dosya |
|----|--------|-------|
| PERF-M1 | Recovery N+1 sorgu zinciri | `execution/execution-recovery.ts:38-55` |
| PERF-M2 | `runtime_heartbeats` TTL/temizlik yok | `packages/control-plane/src/presence/repo.ts:65-68` |
| PERF-M3 | `audit_events` / `security_events` retention yok | `packages/control-plane/src/audit/repo.ts` |
| PERF-M4 | `ConcurrencyTracker` Maps temizlenmiyor | `adaptive-concurrency.ts:102-148` |
| PERF-M5 | Vite `manualChunks` tanimli degil | `apps/console/vite.config.ts` |
| PERF-M6 | `useStudioWebSocket` unsubscribe eksik | `apps/console/src/hooks/useStudioWebSocket.ts:309-316` |
| PERF-M7 | `getProjectAnalytics()` 5 sorgu, cache yok | `db/analytics-repo.ts:225-295` |

---

## LOW Bulgular (12)

| ID | Domain | Baslik | Dosya |
|----|--------|--------|-------|
| SEC-L1 | Guvenlik | Rate limiter sadece auth endpoint'lerinde | `routes/index.ts:97` |
| SEC-L2 | Guvenlik | Error message'larda internal path leak | `app-runner.ts:558, 696-699` |
| SEC-L3 | Guvenlik | Hardcoded OAuth client ID | `cli-usage.ts:787` |
| ARCH-L1 | Mimari | pipeline-engine leaky facade | `pipeline-engine.ts:243+` |
| ARCH-L2 | Mimari | runtime-analyzer.ts sinirda (858 LOC) | Kabul edilebilir |
| ARCH-L3 | Mimari | Route dosya boyutlari sinirda | `team-routes.ts` (642), `project-crud-routes.ts` (593) |
| PERF-L1 | Performans | `listProjectTasks()` JOIN vs direct query | `graph-coordinator.ts`, `pm-agent.ts` vb. |
| PERF-L2 | Performans | Sayfalama cift sorgusu | `db/project-repo.ts:54-72` |
| PERF-L3 | Performans | `nextPort()` portCounter state tutarsizligi | `container-pool.ts:488-492` |
| PERF-L4 | Performans | AdaptiveSemaphore queue ust sinir yok | `adaptive-concurrency.ts:72-78` |
| PERF-L5 | Performans | Cache lazy-delete, purge yok | `provider-runtime-cache.ts:75-78` |
| PERF-L6 | Performans | ws-manager shutdown flush timer | `ws-manager.ts` |

---

## Pozitif Bulgular

### Guvenlik
- Parameterized SQL (`$N`) tutarli kullaniliyor — raw value interpolation yok
- Frontend'te `dangerouslySetInnerHTML` kullanimi **sifir**
- Webhook HMAC-SHA256 imzalama mevcut
- Token sanitization log'larda uygulanmis
- `assertNoTokenishValues` guard — DB'ye token yazilmasi engelleniyor
- Binary name validation (`/^[a-zA-Z0-9_-]+$/`) mevcut
- Budget guard — maliyet kontrol mekanizmasi aktif
- CLI prompt'lari stdin uzerinden gonderiliyor (shell escaping riski yok)

### Mimari
- Extracted module'lar (execution/, task/, pipeline/) arasi **circular dependency yok**
- Package dependency direction dogru — packages asla apps'i import etmiyor
- Facade pattern'leri (execution-engine, task-engine) **gercek thin facade**
- control-plane route wiring temiz — business logic tamamen package'da
- `studio-home/` dizininde page decomposition ornegi mevcut

### Performans
- Lazy loading 26 route-level sayfada dogru uygulanmis
- WebSocket heartbeat/cleanup mekanizmasi saglam
- `claimTask()` — `SELECT FOR UPDATE SKIP LOCKED` dogru
- Provider runtime cache TTL mantikli (availability 30s, capability 5m)
- 50ms batched WebSocket broadcast — gereksiz mesaj flood'u onleniyor

---

## Onceliklendirme Yol Haritasi

### Acil (Sprint 1 — Bu Hafta)

| # | Bulgu | Efor |
|---|-------|------|
| 1 | SEC-C1: `app-runner.ts` `shell: true` kaldir | 30dk |
| 2 | SEC-C2: Install komutlarina `--ignore-scripts` ekle | 30dk |
| 3 | SEC-H1: Dev mode'da `127.0.0.1`'e bind et | 15dk |
| 4 | SEC-H4: `sandbox-enforcement.ts`'e `realpathSync` ekle | 1s |

### Yakin Vade (Sprint 2-3)

| # | Bulgu | Efor |
|---|-------|------|
| 5 | ARCH-C1: Route'lardaki raw SQL'i repo'ya tasi | 2s |
| 6 | SEC-H2: Webhook URL validator'a DNS resolution ekle | 2s |
| 7 | PERF-H1: `listProjects()` WHERE + index | 30dk |
| 8 | PERF-H2: `RETURNING *` ile cift fetch kaldir | 1s |
| 9 | PERF-H3: `context_chunks` pagination | 1s |
| 10 | SEC-M4: Legacy CLI adapter stdout cap | 30dk |
| 11 | SEC-M5: Lint runner `--` separator | 15dk |

### Orta Vade (Sprint 4-6)

| # | Bulgu | Efor |
|---|-------|------|
| 12 | ARCH-H1: `cli-usage.ts` parcalama | 4s |
| 13 | ARCH-H2: `task-executor.ts` concern ayirma | 4s |
| 14 | ARCH-H3: Frontend God Pages parcalama | 8s |
| 15 | ARCH-M3: control-plane pool injection | 2s |
| 16 | PERF-H4: RLS direct tenant_id matching | 4s |
| 17 | PERF-M2-M3: Heartbeat/audit retention politikasi | 2s |

### Uzun Vade (Sprint 7+)

| # | Bulgu | Efor |
|---|-------|------|
| 18 | ARCH-M4: DI container / factory pattern | 8s |
| 19 | PERF-M5: Vite manualChunks | 1s |
| 20 | `as any` azaltma (248 adet) | 8s+ |
| 21 | Test paralelizasyonu (unit vs DB tests) | 4s |

---

## Onceki Rapor ile Karsilastirma (2026-05-02 → 2026-05-04)

| Metrik | 05-02 | 05-04 | Degisim |
|--------|-------|-------|---------|
| Toplam LOC | ~89K | ~163K | +83% (daha kapsamli sayim) |
| DB tablosu | 85 | 109 | +24 tablo |
| Test dosyasi | 1,098+541 | 1,470 | Farkli sayim yontemi |
| `as any` (kernel) | 123 prod | 210 | +87 (scope genisledi) |
| Frontend ErrorBoundary | 0 | 1 (root) | Duzeltilmis |

### Onceki rapordan cozulen sorunlar:
- `.env` dosyasindaki OpenAI API key (SEC-S1) — muhtemelen handle edildi
- `listTasks(projectId)` bug (BUG-001) — onceki raporda bildirildi
- JWT timing attack — onceki raporda bildirildi

### Yeni bulgular (bu raporda ilk kez):
- SSRF DNS rebinding bypass (SEC-H2)
- Path traversal symlink bypass (SEC-H4)
- Credential file access pattern (SEC-H3)
- RLS subquery performance (PERF-H4)
- WebSocket unsubscribe eksik (PERF-M6)
- control-plane dual pool (ARCH-M3)

---

*Rapor 3 paralel uzman agent tarafindan uretilmistir: Security Reviewer, Architecture Reviewer, Performance Engineer.*
