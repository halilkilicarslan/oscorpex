# Oscorpex Deep Analysis Report
**Tarih:** 2026-05-14 | **Versiyon:** v8.2 Post-Audit | **Branch:** master

---

## Proje Metrikleri

| Metrik | Deger |
|--------|-------|
| Toplam LOC | ~175K (kernel 100K, console 64K, packages 11K) |
| Dosya Sayisi | 1087 TS + 430 TSX = 1517 |
| Test Dosyasi | 246 (2462 test case) |
| DB Tablolari | 113 tablo, 2491 satir SQL |
| Route Dosyalari | 46 dosya, 214 endpoint |
| Paketler | 9 shared package + 5 adapter |
| `as any` | 187 (kernel 151, console 36) |
| TODO/FIXME | 11 (sadece kernel) |
| Mimari Olgunluk | 7.5/10 |

---

## Bulgu Ozeti

| Seviye | Guvenlik | Mimari | Performans | Kalite | Frontend | DB | TOPLAM |
|--------|----------|--------|------------|--------|----------|----|--------|
| CRITICAL | 3 | 1 | 1 | 2 | 2 | 1 | **10** |
| HIGH | 8 | 4 | 2 | 3 | 5 | 3 | **25** |
| MEDIUM | 6 | 8 | 8 | 4 | 8 | 7 | **41** |
| LOW | 3 | 6 | 4 | 3 | 3 | 3 | **22** |
| **TOPLAM** | **20** | **19** | **15** | **12** | **18** | **14** | **98** |

---

## CRITICAL Bulgular (10)

### SEC-C1: Terminal Route Command Injection
- **Dosya:** `routes/terminal-routes.ts:38-81`
- **Sorun:** `POST /projects/:id/terminal/exec` kullanicidan gelen `command` string'ini dogrudan `execSync()` ile calistiriyor. Blacklist yaklasimi yetersiz — Unicode, base64, variable expansion ile bypass edilebilir.
- **Fix:** Blacklist'i kaldir, whitelist yaklasimina gec. `execFile()` kullan. Endpoint'i admin role'une sinirla.

### SEC-C2: Task Description'dan Komut Calistirma
- **Dosya:** `task-runners.ts:55-76, 211-280`
- **Sorun:** `extractCliCommands()` gorev aciklamalarindaki backtick bloklarindan komut cikarip `execSync()` ile calistiriyor. LLM prompt injection ile keyfi kod calistirmaya acik.
- **Fix:** Gorev aciklamalarindan cikan komutlari dogrudan calistirma. Onceden tanimlanmis komut beyaz listesi kullan. Kullaniciya onay icin sun.

### SEC-C3: Container configureContainer Shell Injection
- **Dosya:** `container-pool.ts:370-387`
- **Sorun:** `Cmd: ["sh", "-c", ...]` ile heredoc icine `agentId`, `agentName` gommesi, shell karakter kacirma riski.
- **Fix:** Shell kullanmaktan kacin. `tee` ile stdin uzerinden icerik aktar.

### ARCH-C1: Event Bus Handler Exception Yutma
- **Dosya:** `event-bus.ts:111-113, 126, 159, 169`
- **Sorun:** `try { handler(event); } catch { /* ignore */ }` — event handler hatalari tamamen yutulmus. `advanceStage` gibi kritik handler'lar sessizce basarisiz olabilir, pipeline ilerlemesi durur.
- **Fix:** `log.warn({ err, eventType }, "event handler failed")` ekle.

### PERF-C1: dispatchAfterTaskSettled Zincirleme N Seri DB Round-Trip
- **Dosya:** `execution/dispatch-coordinator.ts:193-207`
- **Sorun:** Her gorev tamamlanmasinda 20+ seri DB sorgusu: `getProject → getPipelineRun → getLatestPlan → listPhases → dispatchReadyTasks * N`. 10 aktif phase'de 50ms'te 20+ sorgu.
- **Fix:** `getRunningProjectPhases()` konsolide sorgusunu kullan. Phase dispatch'leri `Promise.allSettled` ile paralellestir.

### QUAL-C1: execution/, pipeline/, task/ Dizinlerinde SIFIR Test
- **Dosya:** `execution/` (17 dosya), `pipeline/` (10 dosya), `task/` (8 dosya)
- **Sorun:** Projenin en kritik is mantigi (task execution, pipeline state machine, approval flow) icin dogrudan unit test yok. Yalnizca facade uzerinden e2e testler var.
- **Fix:** Oncelikle `task-executor.ts`, `dispatch-coordinator.ts`, `stage-advance-service.ts`, `approval-service.ts` icin testler yaz.

### QUAL-C2: Console Sayfalarinda SIFIR Test
- **Dosya:** `apps/console/src/pages/` (223 sayfa)
- **Sorun:** 223 sayfa dosyasindan hicbiri icin birim test yok. Mevcut 33 test dosyasi yalnizca birkac bilesen kapsiyor.
- **Fix:** Ana sayfalar icin smoke testleri baslat (ProjectPage, StudioHome, AgentDashboard).

### FE-C1: TypeScript Strict Mode Kapali
- **Dosya:** `apps/console/tsconfig.app.json`
- **Sorun:** `"strict": true` ayari yok. `strictNullChecks`, `noImplicitAny` kapali. `useState<any>` gibi tip kacaklari yakalanmiyor.
- **Fix:** `"strict": true` ekle, ortaya cikan hatalari kademeli olarak duzelt.

### FE-C2: useState Anti-Pattern (Double-Trigger Guard)
- **Dosya:** `CreateProjectModal.tsx:270-271`
- **Sorun:** `const triggered = useState(false)[0]` — bu pattern cift tetiklemeyi engelleyemez. `useState` render'lar arasinda state'i korur ama setter cagrilmadan deger degismez.
- **Fix:** `useRef(false)` kullan.

### DB-C1: proposal-repo.ts INSERT'te tenant_id Eksik (RLS Bypass)
- **Dosya:** `db/proposal-repo.ts:116-129`
- **Sorun:** `INSERT INTO tasks` sorgusunda `tenant_id` yok. RLS policy'sinde `tenant_id IS NULL` kosuluyla bu gorev tum tenant'lara gorunur hale geliyor.
- **Fix:** `tenant_id` sutununu INSERT'e ekle: `(SELECT tenant_id FROM projects WHERE id = $project_id)`.

---

## HIGH Bulgular (25)

### Guvenlik (8)

| ID | Dosya | Sorun |
|----|-------|-------|
| SEC-H1 | `routes/integration-routes.ts:160-191` | Webhook URL SSRF — `resolveAndValidateUrl()` olusturma sirasinda cagirilmiyor, DNS rebinding riski |
| SEC-H2 | `secret-vault.ts:15-25` | Vault key `hostname()` den turetiliyor — tahmin edilebilir. Production'da `OSCORPEX_VAULT_KEY` zorunlu olmali |
| SEC-H3 | `auth/jwt.ts:9-15` | JWT sirri production-disi ortamda sabit string `"oscorpex-dev-secret..."`. Kriptografik rastgele gecici anahtar kullanilmali |
| SEC-H4 | `routes/project-crud-routes.ts:238-244` | PATCH /projects/:id mass assignment — tum body `updateProject`'e aktariliyor. `status`, `repoPath` keyfi degistirilebilir |
| SEC-H5 | `git-manager.ts:426-430` | `readDoc()` path traversal — `../../etc/passwd` ile proje disindaki dosyalar okunabilir |
| SEC-H6 | `git-manager.ts:196-209` | Git diff `ref` parametresi dogrulanmiyor — `--output=/tmp/evil` gibi arguman enjeksiyonu mumkun |
| SEC-H7 | `routes/auth-routes.ts:42-100` | Sifre guclulugu dogrulanmiyor, rate limiting yok |
| SEC-H8 | `auth/tenant-context.ts:29-31` | Tenant izolasyonu varsayilan olarak kapali (`OSCORPEX_AUTH_ENABLED=false`) |

### Mimari (4)

| ID | Dosya | Sorun |
|----|-------|-------|
| ARCH-H1 | `db/index.ts` | 45 repo'yu tek barrel export — God Object. Domain-scoped sub-barrel'lara ayrilmali |
| ARCH-H2 | - | Transaction boundary eksikligi: 45 repo, yuzlerce write op, yalnizca 15 `withTransaction` kullanimi |
| ARCH-H3 | `pipeline-engine.ts:141-155` | Pipeline state cache/DB race condition: `mutatePipelineState()` sonrasi `setCacheEntry()` ayri adim, crash'te tutarsizlik |
| ARCH-H4 | `project-templates.ts:195` | Dairesel bagimlilik: `project-templates → routes/index → project-routes → project-crud-routes → project-templates` |

### Performans (2)

| ID | Dosya | Sorun |
|----|-------|-------|
| PERF-H1 | `task/task-progress-service.ts:27,55,61` | Ayni phase icin `listTasks()` ayni path'te 2-3 kez cagriliyor |
| PERF-H2 | `db/project-repo.ts:161-167` | `getLatestPlan()` cift sorgu: once plan row, sonra `getPlan → listPhases` tekrar |

### Kalite (3)

| ID | Dosya | Sorun |
|----|-------|-------|
| QUAL-H1 | 40+ route dosyasi | 240+ tekrarlanan try-catch-log-return kaliplari. `withErrorHandler()` middleware olusturulmali |
| QUAL-H2 | `routes/telemetry-routes.ts:188,217,302` | `executionEngine() as any` ile private alanlara erisim — encapsulation ihlali |
| QUAL-H3 | 45 dosya | 225 sessiz catch blogu `catch {}`. En az `log.debug()` eklenmeli |

### Frontend (5)

| ID | Dosya | Sorun |
|----|-------|-------|
| FE-H1 | `main.tsx` routing | Eski monolitik `TriggersPage/RagPage/PromptsPage` rotalaniyor, decompose versiyonlar kullanilmiyor |
| FE-H2 | 14 dosya | `window.alert()` kullanimi — `ApiErrorAlert`/`ApiErrorToast` mevcut ama kullanilmiyor |
| FE-H3 | 153 yer | `focus:outline-none` klavye erisimi kiriyor — `focus-visible:ring-2` ekle |
| FE-H4 | Tum 279 TSX | `React.memo` hic kullanilmiyor — pure leaf componentler her parent render'da yeniden hesaplaniyor |
| FE-H5 | - | React 19 concurrent ozellikleri kullanilmiyor (useTransition, useOptimistic, useDeferredValue) |

### Veritabani (3)

| ID | Dosya | Sorun |
|----|-------|-------|
| DB-H1 | `pg.ts` | `getPool()` sorgularinda tenant context set edilmiyor. Auth kapali modda RLS bypass |
| DB-H2 | `init.sql` | `tasks.output`, `policy_snapshot`, `depends_on` TEXT ama JSON veri — JSONB olmali |
| DB-H3 | `db/task-repo.ts:37-54` | `createTask` basina 2 ek N+1 sorgu (phase + project lookup). 20 gorevde 40 ek sorgu |

---

## MEDIUM Bulgular (41) — Ozet

### Guvenlik (6)
- ILIKE pattern escape eksik (marketplace-repo, template-repo)
- Webhook URL senkron dogrulama eksik (integration-routes)
- Auth backward compat mode kapali guvenlik (auth-middleware)
- `createFile` realpath kontrolu eksik (git-manager)
- E-posta format dogrulamasi yok (auth-routes)
- Container network izolasyonu zayif (container-pool)

### Mimari (8)
- task-executor.ts 47 import — octopus coupling (middleware chain pattern gerekli)
- pm-agent-tools.ts (840 LOC) decompose edilmeli
- team-routes.ts (642 LOC) parcalanmali
- Cift approval service isim catismasi
- Control-plane sema smoke test eksik
- 6 orphaned tablo (voltagent_*, quality_signals, review_results)
- WebSocket connection limit yok (ws-manager)
- Frontend sayfa dizin yapisi flat — domain-based restructure

### Performans (8)
- adaptive-replanner listProjectTasks + listPhases ortusme
- Eksik kompozit index: tasks(phase_id, status), tasks(project_id, status), tasks(status, claimed_by)
- Analytics totals korele subquery pattern
- listEvents 1000 satir bellek cekimi
- purgeExpired() hic cagirilmiyor (provider-runtime-cache memory leak)
- DB pool minConnections:2, acquireTimeout:5s dusuk
- createTask her gorev icin 2 ek lookup
- Fazlara seri await yerine parallel dispatch

### Kalite (4)
- Structured logging yalnizca %16 (203 template literal + 166 string concat vs 74 structured)
- YAGNI route importlari hala yuklu (4 dosya, 480 LOC olu kod)
- document-indexer.ts 7 `catch (err: any)` — typed error handling gerekli
- SELECT * 125 yerde — performans kritik pathlarda kolon secimi

### Frontend (8)
- TanStack Query / SWR yok — her sayfada manuel useState+useEffect+fetch
- useInfiniteList hatalari sessizce yutuyor
- PlannerChatContext her render'da referans degisiyor
- Suspense boundary'ler yetersiz, route-level error boundary yok
- CreateProjectModal 1243 LOC tek bilesen
- @xyflow/react bundle chunk'a eklenmemis
- index-as-key anti-pattern 13 yerde
- vite.config.ts absolute path hard-coded

### Veritabani (7)
- 12 tenant-scoped tablo RLS kapsami disinda
- idx_tasks_claimable, idx_tasks_waiting_approval, idx_tasks_unfinished partial index eksik
- reclaimStaleQueuedClaimsForProject gereksiz subquery (project_id zaten var)
- getProjectAgentsBySkill tum agent'lari bellege cekiyor
- Backfill UPDATE'ler transaction disinda
- chat_messages.created_at ve 20+ sutun hala TEXT
- acquireTimeoutMs: 5000 dusuk, statement_timeout yok

---

## LOW Bulgular (22) — Kategorize Ozet

- **Guvenlik (3):** Git branch dogrulama, API key silme sahiplik kontrolu, number coercion
- **Mimari (6):** Engine singleton reset yok, timer leak (61 timer), package test coverage %5, adapter integration test yok, init.sql eski policy tanimlari, execution/ import sayisi yuksek
- **Performans (4):** process.env her cagri parse, WS URL her reconnect'te hesaplaniyor, analytics getProject guard, TypeScript incremental kapali
- **Kalite (3):** StatCard cift versiyon, notification-service TODO (tenantId:null), route export stili tutarsiz
- **Frontend (3):** useLocalStorage hook eksik, placeholder color contrast dusuk, getByText test overuse
- **DB (3):** TEXT PK (UUID yerine), BOOLEAN yerine INTEGER (eski tablolar), updated_at trigger eksik

---

## Olumlu Gozlemler

Sistemi tam olarak degerlendirmek icin guclu yanlari da kaydetmek onemlidir:

1. **SQL Parametrelendirmesi tutarli** — Tum repo dosyalarinda `$1, $2` yer tutuculari. String interpolation ile SQL injection yok.
2. **Engine facade pattern** — TaskEngine, PipelineEngine, ExecutionEngine iyi tasarlanmis, factory boot dogru siralanmis.
3. **Package boundary'ler temiz** — Star topology, cross-package cycle yok. Control-plane gercekten bagimsiz.
4. **DB claim mekanizmasi** — `SELECT FOR UPDATE SKIP LOCKED` dogru concurrent dispatch sagliyor.
5. **Sandbox yonetimi** — `realpath()` ile symlink cozumleme, tool enforcement, risk-based sertlestirme mevcut.
6. **RBAC sistemi** — Kapsamli route izin matrisi, varsayilan-reddet yaklasimi.
7. **Sifre yonetimi** — `scrypt` + rastgele tuz + `timingSafeEqual`.
8. **Index stratejisi kapsamli** — 211 index, partial index'ler dahil.
9. **Lazy loading frontend'te yaygin** — `lazy()` ile route code-splitting dogru.
10. **ModalOverlay A11Y** — `aria-modal`, focus-trap, ESC kapatma ornek nitelikte.
11. **Boot phase initialization** — Engine factory pattern, onceki audit sprint etkisi goruluyor.
12. **Adaptive scheduling** — Concurrency, retry, timeout, cooldown, preflight — production-grade.

---

## Yol Haritasi Onerisi

Bulguler oncelik ve etki/efor oranina gore 5 milestone'a ayrilmistir.

### M1: Kritik Guvenlik & Veri Butunlugu (1-2 hafta)

| # | Bulgu | Etki | Efor |
|---|-------|------|------|
| 1 | SEC-C1: Terminal route whitelist + execFile | RCE onleme | 4 saat |
| 2 | SEC-C2: Task description komut calistirma engelle | RCE onleme | 4 saat |
| 3 | SEC-C3: Container shell injection fix | RCE onleme | 2 saat |
| 4 | DB-C1: proposal-repo tenant_id ekle | Veri izolasyonu | 1 saat |
| 5 | ARCH-C1: Event bus handler loglama | Pipeline durma riski | 1 saat |
| 6 | SEC-H1: Webhook SSRF dns validation | SSRF | 2 saat |
| 7 | SEC-H2: Secret vault key zorunlu | Credential guvenligi | 2 saat |
| 8 | SEC-H3: JWT secret rastgele fallback | Auth bypass | 1 saat |
| 9 | SEC-H4: PATCH mass assignment whitelist | Yetki yukseltme | 1 saat |
| 10 | SEC-H5+H6: readDoc + git diff param validation | Path traversal | 2 saat |
| 11 | DB-H1: Pool query tenant context enforcement | Veri izolasyonu | 4 saat |
| **Toplam** | | | **~24 saat** |

### M2: Performans & DB Optimizasyonu (1-2 hafta)

| # | Bulgu | Etki | Efor |
|---|-------|------|------|
| 1 | PERF-C1: dispatch zincirleme sorgu → konsolide + parallel | %80 sorgu azalma | 6 saat |
| 2 | PERF-H1+H2: listTasks paylasimi + getLatestPlan tek sorgu | Her task completion hizlaniyor | 4 saat |
| 3 | DB-H3: createTask N+1 → projectId/tenantId zorunlu param | Plan olusturma hizlaniyor | 3 saat |
| 4 | DB-H2: TEXT JSON → JSONB migration (tasks.output, depends_on) | Tip guvenligi + perf | 4 saat |
| 5 | MEDIUM indeksler: 5 eksik partial/composite index ekle | Sorgu performansi | 2 saat |
| 6 | ARCH-H2: Transaction boundary audit (task completion, pipeline advance) | Veri tutarliligi | 6 saat |
| 7 | ARCH-H3: Pipeline state cache atomik guncelleme | Race condition fix | 4 saat |
| 8 | BE: purgeExpired() periyodik cagri + pool tuning | Memory leak + stability | 2 saat |
| **Toplam** | | | **~31 saat** |

### M3: Frontend Modernizasyon (2-3 hafta)

| # | Bulgu | Etki | Efor |
|---|-------|------|------|
| 1 | FE-C1: TypeScript strict mode ac | Tip guvenligi | 3 gun |
| 2 | FE-C2: useState → useRef fix | Bug fix | 30 dk |
| 3 | FE-H1: Router eski monolitleri → decompose versiyonlara yonlendir | Olu kod temizligi | 2 saat |
| 4 | FE-H2: 14x alert() → ApiErrorToast | UX tutarliligi | 3 saat |
| 5 | FE-H3: focus:outline-none → focus-visible:ring | Erisebilirlik | 4 saat |
| 6 | TanStack Query entegrasyonu | Cache, dedup, stale-while-revalidate | 5 gun |
| 7 | React.memo pure leaf componentlere ekle | Render performansi | 1 gun |
| 8 | useTransition search/filter state'lere ekle | Non-blocking UI | 1 gun |
| 9 | Route-level error boundary ekle | UX resilience | 4 saat |
| 10 | vite.config.ts: absolute path fix + chunk optimizasyonu | CI/CD + bundle size | 2 saat |
| **Toplam** | | | **~13 gun** |

### M4: Kod Kalitesi & Test Coverage (2-3 hafta)

| # | Bulgu | Etki | Efor |
|---|-------|------|------|
| 1 | execution/ unit testleri (task-executor, dispatch-coordinator, provider-exec) | Kritik path coverage | 5 gun |
| 2 | pipeline/ unit testleri (stage-advance, completion, build) | Pipeline coverage | 3 gun |
| 3 | task/ unit testleri (approval, review-loop, lifecycle) | Task coverage | 3 gun |
| 4 | Console ana sayfa smoke testleri | Frontend coverage | 3 gun |
| 5 | QUAL-H1: Route error handler middleware olustur | ~1000 satir azalma | 1 gun |
| 6 | QUAL-H3: Sessiz catch blokarina loglama ekle (225 yer) | Debug kolayligi | 2 gun |
| 7 | Structured logging migration (%16 → %80) | Log arama/alarm | 3 gun |
| 8 | Vitest coverage threshold ekle | CI gate | 2 saat |
| 9 | Mock factory fonksiyonlari (createMockTask, createMockProject) | Test kalitesi | 1 gun |
| **Toplam** | | | **~21 gun** |

### M5: Mimari Iyilestirme (3-4 hafta)

| # | Bulgu | Etki | Efor |
|---|-------|------|------|
| 1 | ARCH-H1: DB barrel → domain-scoped sub-barrel | Coupling azalma | 2 gun |
| 2 | ARCH-H4: Dairesel bagimlilik coz (project-templates) | Runtime stability | 2 saat |
| 3 | task-executor.ts middleware chain decompose | Testability + maintainability | 3 gun |
| 4 | pm-agent-tools.ts parcala (plan-builder, cost-estimator, tool-defs) | Cohesion | 1 gun |
| 5 | CreateProjectModal.tsx decompose (wizard steps, team-recommendation) | Frontend maintainability | 1 gun |
| 6 | Orphaned 6 tablo temizle | Schema clarity | 2 saat |
| 7 | Cift approval service yeniden adlandir | Developer experience | 1 saat |
| 8 | YAGNI route importlari kaldir (4 dosya, 480 LOC) | Bundle size | 1 saat |
| 9 | Frontend sayfa dizin restructure (domain-based folders) | Navigation | 2 gun |
| 10 | RLS kapsamina 12 tablo daha ekle | Tenant guvenligi | 1 gun |
| 11 | WebSocket connection limit | DoS koruması | 4 saat |
| **Toplam** | | | **~12 gun** |

---

## Milestone Ozet Tablosu

| Milestone | Odak | Tahmini Sure | Bulgu Sayisi |
|-----------|------|-------------|-------------|
| M1 | Kritik Guvenlik & Veri Butunlugu | 1-2 hafta | 11 (3C + 8H) |
| M2 | Performans & DB Optimizasyonu | 1-2 hafta | 8 (1C + 2H + 5M) |
| M3 | Frontend Modernizasyon | 2-3 hafta | 10 (2C + 5H + 3M) |
| M4 | Kod Kalitesi & Test Coverage | 2-3 hafta | 9 (2C + 3H + 4M) |
| M5 | Mimari Iyilestirme | 3-4 hafta | 11 (4H + 7M) |

**Toplam tahmini:** 10-14 hafta (M1-M2 paralel calistirilabilir)

---

## Hizli Kazanimlar (Quick Wins — 1 gun icinde)

Bu maddeler minimum eforla maksimum etki saglar:

1. **Event bus loglama** (ARCH-C1) — 1 saat, pipeline durma riskini onler
2. **proposal-repo tenant_id** (DB-C1) — 1 saat, RLS bypass kapatir
3. **useState → useRef** (FE-C2) — 30 dk, bug fix
4. **JWT secret rastgele fallback** (SEC-H3) — 1 saat, auth guvenligi
5. **YAGNI import temizligi** (4 dosya) — 1 saat, olu kod
6. **Router eski → decompose** (FE-H1) — 2 saat, olu kod
7. **vite.config.ts absolute path** — 30 dk, CI/CD fix
8. **purgeExpired() interval** — 30 dk, memory leak
9. **Vitest coverage threshold** — 30 dk, CI gate

---

*Rapor 6 paralel uzman agent tarafindan uretilmistir: Security Auditor, Architecture Reviewer, Performance Engineer, Code Quality Reviewer, React Specialist, PostgreSQL Pro.*
