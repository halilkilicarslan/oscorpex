# Comprehensive Codebase Analysis Report — Oscorpex

## 1. Executive Summary

**Oscorpex**, AI destekli otonom yazılım geliştirme platformudur. Kullanıcı bir fikir tanımlar; 12 ajanlık (PM, Tech Lead, Frontend/Backend Dev, QA, Security, vb.) sanal Scrum takımı, DAG tabanlı bir pipeline içinde otonom olarak planlama, kodlama, review, test ve deploy işlemlerini gerçekleştirir.

**Mevcut Olgunluk Seviyesi:** Gelişmiş prototip / erken beta. Temel execution motoru çalışır durumda, fakat üretime alınmadan önce ciddi güvenlik, güvenilirlik ve operasyonel hazırlık eksiklikleri giderilmelidir.

**Genel Mühendislik Kalitesi:** Orta-üstü. Temel mimari (DAG pipeline, event-driven execution, claim-based concurrency) iyi tasarlanmış. Ancak kod kalitesi tutarsız: bazı modüller iyi ayrılmışken, bazı yerlerde `any` kullanımı, non-blocking hata yutma, güvenlik varsayılanlarının zayıflığı ve test coverage delikleri mevcut.

**Ana Riskler:**
1. Varsayılan olarak devre dışı olan kimlik doğrulama (herkes admin).
2. Hostname-türetmeli şifreleme anahtarı (secret vault).
3. Silent failure kültürü (budget, policy, sandbox hataları log'a düşer ama execution'ı durdurmaz).
4. HTTP rate limiting yok.
5. CLI command injection riski (AI çıktıları doğrudan shell'e gitmiyor ama CLI adapter'lar üzerinden çalışıyor).

**Ana Güçlü Yönler:**
- DAG tabanlı paralel execution (Kahn's algorithm).
- `SELECT FOR UPDATE SKIP LOCKED` ile dağıtık claim mekanizması.
- Olgun event-driven mimari (PG LISTEN/NOTIFY bridge).
- Task decomposation, review loop, auto-retry, fallback chain.
- Zengin frontend (React 19 + Tailwind 4).

**Üretime Hazır mı?** Hayır. Parçalı olarak üretime hazır değil. Özellikle auth, secret management, rate limiting ve input validation katmanları kritik eksiklikler içeriyor.

---

## 2. Bu Sistemin Ne Yaptığı

**İş Problemi:** Yazılım geliştirme sürecinin (planlama → kodlama → review → test → deploy) AI ajanları tarafından otonom olarak yapılması. İnsan sadece fikir verir, onaylar ve gözlemler.

**Temel Kullanıcı Yolculukları:**
1. **Proje Oluşturma:** Kullanıcı proje fikrini girer → PM ajanı intake soruları sorar → planlama yapar.
2. **Plan Onayı:** Kullanıcı AI'nın ürettiği fazları ve task'ları onaylar/reddeder.
3. **Otonom Execution:** Pipeline engine, DAG wave'lerini oluşturur; execution engine task'ları CLI adapter'lara (Claude Code, Cursor) gönderir.
4. **Review Döngüsü:** Kod task'ları review ajanına gider; 3 ret sonrası tech lead'e eskalasyon.
5. **İnsan-Onaylı Kontrol:** XL task'lar veya kritik keyword içerenler `waiting_approval` durumuna düşer.
6. **Canlı İzleme:** Frontend üzerinden Kanban board, terminal output, diff viewer, cost tracker.

**Temel Domain Varlıkları:** `Project`, `ProjectPlan`, `Phase`, `Task`, `ProjectAgent`, `AgentDependency`, `PipelineRun`, `Event`, `WorkItem`, `Sprint`.

**Eksik / Belirsiz İş Sınırları:**
- Multi-tenancy var ama RLS politikaları sadece `set_config` ile ayarlanıyor; gerçek RLS kuralları `init.sql`'de yok.
- Agent marketplace ve plugin SDK modülleri mevcut ama frontend'de yolları kısıtlı (YAGNI olarak bazıları yorumlanmış).

---

## 3. Mimari Genel Bakış

**Mimari Stil:** Modüler monolit. Tek Node.js process içinde Hono web sunucusu, VoltAgent framework'ü, event bus, execution engine ve pipeline engine koşuyor. Multi-process deployment için PG LISTEN/NOTIFY bridge var.

**Sınırlandırmalar:**
- **Frontend:** React 19 SPA (Vite), port 5173.
- **Backend:** Hono + VoltAgent, port 3141.
- **WebSocket:** Port 3142 (canlı event stream).
- **Database:** PostgreSQL 16 + pgvector.
- **AI Execution:** Harici CLI araçları (Claude Code, Cursor, Codex) veya lokal AI SDK fallback.
- **Containerization:** Dockerode ile container pool; compose üzerinden agent worker'lar.

**Veri Akışı:**
1. Kullanıcı → Frontend → `/api/studio/*` Hono routes.
2. Routes → DB repo modülleri (raw SQL via `pg`).
3. Execution Engine → CLI Adapter → AI Provider.
4. AI Provider çıktısı → Sandbox check → Git repo → Event Bus → Frontend (SSE/WS).

**Senkron / Asenkron:**
- API çağrıları senkron (HTTP request/response).
- Task execution asenkron (event-driven, fire-and-forget çok yerde).
- Event bus hem senkron subscriber hem asenkron PG notification gönderiyor.

**Mimari Güçlü Yönler:**
- DAG wave'ler ile paralel execution.
- Event sourcing (`events` tablosu).
- Provider fallback chain.
- Workspace izolasyonu.

**Mimari Zayıflıklar:**
- Tight coupling: `execution-engine.ts` ~1300 satır, 40+ import. Çok fazla sorumluluk.
- Hidden dependency: `executionEngine` ve `taskEngine` ve `pipelineEngine` birbirlerine doğrudan import ediyor, circular dependency riski.
- Separation of concerns ihlali: Route handler'lar içinde doğrudan business logic (örneğin `project-routes.ts` 1292 satır, planner CLI stream içeriyor).

---

## 4. Repository / Kod Organizasyonu

**Üst Seviye Düzen:**
```
oscorpex/
├── src/               # Backend
│   ├── studio/        # Ana motor (~180 dosya)
│   │   ├── db/        # 37 repo modülü
│   │   ├── routes/    # 30+ Hono sub-router
│   │   ├── auth/      # JWT, RBAC, tenant
│   │   ├── agent-runtime/ # Memory, strategy, protocol
│   │   └── __tests__/ # 60+ test
│   ├── agents/        # VoltAgent ajanları
│   ├── tools/         # Basit araçlar
│   └── workflows/     # Expense approval
├── console/           # React 19 + Vite frontend
├── scripts/init.sql   # Tek idempotent şema dosyası (1689 satır)
```

**Değerlendirme:**
- **Barrel exports** kullanımı iyi (`db/index.ts`, `studio-api/index.ts`).
- **Domain-driven** değil, **teknik-layer** organizasyonu hakim: `routes/`, `db/`, `auth/`.
- `src/studio/` içinde her şey çok büyümüş. 180 dosya tek klasör altında (routes ve db alt klasörlü olsa da).
- **Ölü klasör:** `src/workflows/` içinde tek expense approval workflow var; studio ile alakasız gibi duruyor (VoltAgent'in getirdiği boilerplate).
- **Yarım refactor işaretleri:** `tasks` tablosuna sürekli `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` eklenmiş; `init.sql` 1689 satır ve migration history'si yok. Bu "evrimleşen şema" kokusu.

---

## 5. Temel Execution Akışları

### A. Proje Başlatma → Execution
**Entry:** `POST /projects/:id/execute` → `project-routes.ts`
**Orchestration:** `executionEngine.startProjectExecution()`
**Flow:**
1. `taskEngine.beginExecution()` → ilk fazı `running` yapar, ready task'ları döner.
2. `executionEngine.executeTask()` → `claimTask()` (SELECT FOR UPDATE SKIP LOCKED).
3. Eğer L/XL → `task-decomposer.ts` ile alt task'lara böl.
4. Agent config çözülür, sandbox policy oluşturulur, workspace izole edilir.
5. `CLI adapter chain` (Claude Code → Cursor fallback) çalıştırılır.
6. Output → verification gate → test gate → `taskEngine.completeTask()`.
7. Complete → review task oluştur (varsa) → `dispatchReadyTasks()`.

**Bağımlılıklar:** `pg`, `dockerode`, `simple-git`, AI CLI binary'leri.

**Failure Points:**
- `claimTask` race condition'ı önlüyor ama `executeTask` içinde `this._dispatchingTasks` Set kullanımı yeterince robust değil (process crash'te kaybolur).
- `withTimeout` AbortController kullanıyor ama CLI process'e SIGTERM gönderimi adapter implementasyonuna bağlı.
- `recoverStuckTasks()` startup'ta çalışıyor ama aynı anda birden fazla worker başlarsa duplicate execution riski var.

### B. Pipeline İlerleme
**Entry:** `pipelineEngine.startPipeline()`
**Orchestration:** `taskEngine.onTaskCompleted()` callback'i → `pipelineEngine.advanceStage()`
**Flow:**
1. Task done → `notifyCompleted()` → `advanceStage()`.
2. Current stage'deki tüm task'lar `done` mı kontrolü.
3. `completeStage()` → git merge to main (best-effort).
4. `startStage()` → sonraki wave.

**Failure Points:**
- `advanceStage` DB'den her seferinde `JSON.parse(stagesJson)` yapıyor. O(n) maliyet.
- Git branch oluşturma/merge hataları `catch` ile yutuluyor; pipeline devam ediyor.

### C. Auth Akışı
**Entry:** `authMiddleware` (`routes/index.ts` üzerinde koşar)
**Flow:**
1. `OSCORPEX_API_KEY` env var check (legacy).
2. JWT Bearer verify.
3. DB-backed API key (`osx_`) verify.
4. Eğer hiçbiri yoksa `authType: "none"` ve `next()`.

**Kritik Bulgu:** `authMiddleware` satır 105: `if (!envApiKey) { c.set("authType", "none"); return next(); }`. Yani env key tanımlanmamışsa **tüm API açık**. Bu varsayılan olarak böyle çalışıyor.

---

## 6. Domain Model ve İş Mantığı Değerlendirmesi

**Temel Varlıklar:**
- `Project` → `ProjectPlan` → `Phase` → `Task` hiyerarşisi net.
- `ProjectAgent` ve `AgentDependency` ile DAG kuruluyor.

**Domain Sınırları:**
- Zayıf. `studio/` içinde routes, engine'ler, repo'lar, auth hepsi karışık.
- `task-engine.ts` ~1300 satır; hem state machine, hem budget check, hem approval logic, hem review loop, hem sub-task rollup.

**İş Kuralı Yerleşimi:**
- Çoğunlukla `task-engine.ts` ve `execution-engine.ts`'te, domain katmanı yok. Anemic domain model.
- Validation: Route seviyesinde neredeyse yok; engine seviyesinde parçalı.

**Tutarsızlık Riski:**
- Task status geçişleri `task-engine.ts`'te kontrol ediliyor (`assignTask`, `startTask`, `completeTask`), ancak `task-routes.ts`'te `PATCH /tasks/:taskId` body'yi doğrudan `updateTask()`'a paslıyor. Status geçiş validasyonu bypass edilebilir.

---

## 7. API / Arayüz Tasarım İncelemesi

**REST API:** Hono sub-router'lar altında `/api/studio/*`.

**Route Kalitesi:**
- Resource-based URL'ler genelde tutarlı (`/projects/:id/tasks`, `/projects/:id/pipeline/start`).
- Ancak `project-routes.ts` 1292 satır, 10+ farklı sorumluluk (CRUD, chat, SSE, plan, execution, intake).

**Handler/Controller/Service Ayrımı:**
- Yok. Route handler'lar doğrudan DB/repo çağrıyor, hatta `streamPlannerWithCLI` gibi ağır logic içeriyor.

**Input Validation:**
- `zod` paketi var ama çok az yerde kullanılıyor (`pm-agent.ts`'teki toolkit'te var).
- `c.req.json()` çoğu yerde `as { ... }` cast ile alınıyor; runtime validation yok.
- `PATCH /tasks/:taskId` body tamamen açık; herhangi bir alan güncellenebilir.

**Error Response:**
- Tutarsız. Bazı yerlerde `{ error: string }`, bazı yerlerde `{ error: string, message: string }`.
- Status kodlar genelde 400/404/500; ancak 401'ler sadece auth middleware'de.

**DTO/Schema Disiplini:**
- Yok. `any` kullanımı yaygın; `biome.json`'da `noExplicitAny` sadece `warn`.

---

## 8. Veri Katmanı İncelemesi

**Database Erişim:** Raw SQL via `pg` (node-postgres). ORM yok.

**Query Stili:**
- Parametreli query'ler (`$1`, `$2`) kullanılıyor; SQL injection riski düşük.
- Ancak `query<any>(...)` gibi tipler çok yaygın.

**Transaction Yönetimi:**
- `withTransaction()` helper'ı var (`pg.ts`).
- `mutatePipelineState()` kilitli transaction kullanıyor (`SELECT ... FOR UPDATE`).
- Ancak birçok işlem transaction dışında. Örneğin `taskEngine.completeTask()` içinde `updateTask` + `createTask` (review task) + `updateTask` (link) + eventBus.emit + `applyPostCompletionHooks` hepsi ayrı connection'larda koşuyor. Crash anında tutarsızlık riski.

**Migration Kalitesi:**
- Tek idempotent `init.sql`. `CREATE TABLE IF NOT EXISTS` ve `ADD COLUMN IF NOT EXISTS` ile çalışıyor.
- **Risk:** 1689 satırlık bu dosya bir "god migration". Rollback yok. Migration sırası yok. Ekip büyüdükçe yönetilmez.
- `db-bootstrap.ts` startup'ta bu dosyayı çalıştırıyor.

**Şema Tasarımı:**
- `TEXT PRIMARY KEY` UUID'ler için kullanılıyor; `randomUUID()` ile üretiliyor.
- `JSON` alanlar string olarak saklanıyor (`tech_stack`, `depends_on`, `output`, `payload`). PostgreSQL native `JSONB` kullanılmamış; indeksleme ve sorgulama verimsiz.
- `tasks.output` TEXT olarak JSON string; her task okunduğunda `JSON.parse`/`JSON.stringify` yapılıyor.

**N+1 Riskleri:**
- `getReadyTasks()` her task için bağımlılıklarını tek tek `getTask(depId)` ile çekiyor. Phase içinde 50 task varsa 50+ query.
- `execution-engine.ts` `recoverStuckTasks()` her proje için tüm fazları ve task'ları çekiyor; nested loop DB query.

**Race Condition:**
- `checkProjectBudget()` summary query çeker sonra karar verir; atomic değil. İki task aynı anda budget check'i geçebilir.
- `updateTask()` ve `releaseTaskClaim()` ayrı query'ler; arada crash olursa claim kilitli kalabilir (row-level timeout yok).

---

## 9. Güvenlik İncelemesi

| # | Bulgu | Önem | Kanıt |
|---|-------|------|-------|
| 1 | **Varsayılan açık API:** `authMiddleware` env key yoksa her isteği geçirir. | **KRİTİK** | `auth-middleware.ts:105-108` |
| 2 | **JWT secret fallback:** `OSCORPEX_JWT_SECRET` yoksa `"oscorpex-dev-secret-change-in-production"` | **KRİTİK** | `jwt.ts:9` |
| 3 | **Vault key fallback:** `OSCORPEX_VAULT_KEY` yoksa `hostname()` SHA-256'sı. Bilinen host = şifre çözülebilir. | **KRİTİK** | `secret-vault.ts:15-27` |
| 4 | **API Key brute-force:** DB-backed API key hash'lenmiş ama `/auth/login` ve register endpoint'lerinde rate limit yok. | **YÜKSEK** | `auth-routes.ts` |
| 5 | **No HTTP rate limiting:** `hono/rate-limit` veya benzeri middleware yok. | **YÜKSEK** | `routes/index.ts` |
| 6 | **Input validation eksikliği:** `PATCH /tasks/:taskId` body doğrudan DB'ye yazılıyor. `assignedAgent`, `status`, `output` manipüle edilebilir. | **YÜKSEK** | `task-routes.ts:71-87` |
| 7 | **SQL Injection düşük risk:** Parametreli query kullanılıyor ama `query<any>` ile raw SQL oluşturulan yerler var. | **ORTA** | `project-routes.ts`'te string concatenation ile dinamik SQL yok gibi; ancak `query<any>` gözden kaçıran hatalara açık. |
| 8 | **CORS origins env'den:** `OSCORPEX_CORS_ORIGINS` yoksa `localhost` izinli. Üretimde unutulursa sorun. | **ORTA** | `routes/index.ts:237-249` |
| 9 | **Tenant isolation zayıf:** `tenant_id` set ediliyor ama RLS policy `init.sql`'de yok. | **ORTA** | `init.sql` incelendi, `CREATE POLICY` yok. |
| 10 | **CLI execution injection:** AI çıktısı doğrudan shell'e gitmiyor ama `claude-code` CLI aracına prompt olarak gidiyor. Prompt injection riski AI seviyesinde. | **ORTA** | Mimari limitasyon. |
| 11 | **XSS:** Frontend output'ları `dangerouslySetInnerHTML` kullanıyor mu? Raporlama sırasında bu dosyalar incelenmedi; static analizde tespit edilemedi. | **BİLİNMEYEN** | Runtime validation gerekli. |
| 12 | **Audit logging:** Var (`logTenantActivity`) ama non-blocking; kaybolabilir. | **DÜŞÜK** | `auth-routes.ts` |

**Sonuç:** Güvenlik, "yerel geliştirme kolay olsun" mantığıyla tasarlanmış. Üretime çıkmadan önce env-based fallback'lerin kaldırılması, rate limiting eklenmesi ve input validation katmanı oluşturulması zorunlu.

---

## 10. Güvenilirlik, Hata Yönetimi ve Dayanıklılık

**Exception Handling:**
- "Non-blocking" hata yutma **sistemik bir kalıp**. `execution-engine.ts` içinde 15+ yerde `try/catch` ile `log.warn(...)` yapılıp devam ediliyor.
- Örnek: Sandbox init hatası (`log.warn("[execution-engine] Sandbox init failed (non-blocking):")`), policy violation check hatası, goal lookup hatası, constraint check hatası...
- **Risk:** Bütçe aşımı, sandbox ihlali, politik ihlal gibi kritik operasyonel hatalar sessizce log'a düşer; execution devam eder.

**Retry Davranışı:**
- AI provider rate limit → pipeline pause (iyi).
- Task failure → `MAX_AUTO_RETRIES = 2`; error context ile `_executeTaskInner` tekrar çağrılır.
- Provider exhausted → deferred retry (setTimeout). Ancak bu süreç Node process crash ederse kaybolur.

**Timeout:**
- Complexity-based timeout: S/M 30dk, L 45dk, XL 60dk.
- `AbortController` ile timeout implementasyonu doğru.
- %80 uyarı eşiği var.

**Circuit Breaker:**
- `providerState` ile yarım circuit breaker var (cooldown, failure count).
- Gerçek bir circuit breaker kütüphanesi yok.

**Graceful Degradation:**
- Docker yoksa lokal AI SDK fallback... aslında kodda CLI-only execution var (`if (!project.repoPath) throw new Error`). Fallback yok.
- `containerPool.initialize()` hata verirse log warning; sunucu yarım çalışır.

**Silent Failure Riski:** Çok yüksek. `recoverStuckTasks()` bile `.catch(err => log.error(...))` ile sarmalanmış; eğer bu fonksiyon bir task'ı yanlış kurtarırsa sessizce devam eder.

---

## 11. Performans ve Ölçeklenebilirlik İncelemesi

**Beklenen Darboğazlar:**

1. **Event Bus In-Memory Handler'lar:** Tek process'te çalışır. Multi-process için PG LISTEN/NOTIFY var ama subscription'lar process-local. Yatay ölçeklendirmede aynı event'in her process'te tekrar işlenmesi riski var (dedup TTL 5 saniye ama bu garanti değil).
2. **JSON.parse/stringify Aşırı Kullanımı:** `pipeline_runs.stages_json`, `tasks.output`, `events.payload` hepsi TEXT/JSON string. Her okuma/yazma da serileştirme maliyeti.
3. **N+1 Queries:** `getReadyTasks`, `recoverStuckTasks`, `getProgress` gibi fonksiyonlar fazla sayıda round-trip yapıyor.
4. **Semaphore = 3:** `MAX_CONCURRENT_TASKS` varsayılan 3. Bu sunucu seviyesinde değil, global process seviyesinde. Scale-out yapıldığında her instance 3 task koşar (belki isteniyordur ama explicit değil).
5. **DB Connection Pool:** `max: 20`. Yüksek concurrency'de yetmeyebilir; connection leak riski var mı incelenmeli.
6. **No Pagination:** `listProjects`, `listTasks` gibi endpoint'ler limit/offset destekliyor ama bazı internal query'lerde (örneğin event log) yok.
7. **Cache:** `pipeline-engine.ts`'te read-through cache var ama geri kalan sistemde neredeyse hiç cache yok. Her task başlatmada `getProjectSetting` çağrıları DB'ye gidiyor.

**Runtime Doğrulanması Gerekenler:**
- 1000+ task'lı projenin `getProgress()` süresi.
- `recoverStuckTasks()` startup süresi (tüm projeleri tarıyor).
- AI CLI adapter'ların memory/CPU kullanımı.

---

## 12. Test ve Kalite Değerlendirmesi

**Test Kurulumu:**
- Backend: Vitest, `fileParallelism: false` (çünkü shared PostgreSQL test DB).
- Frontend: Vitest + jsdom + Testing Library.
- Test setup: `scripts/init.sql` test DB'ye uygulanıyor.

**Coverage Sinyalleri:**
- 60+ backend test dosyası var. İyi kapsanan alanlar: `execution-engine`, `task-engine`, `pipeline-engine`, `sandbox`, `auth`, `tenant-isolation`.
- Frontend: 24 test dosyası. Component test'leri mevcut.

**Kalite:**
- Testler çoğunlukla happy path'i kapsıyor gibi görünüyor. Gerçek AI CLI çağrıları muhtemelen mock'lanıyordur.
- **Eksik:** E2E test yok (Playwright/Cypress yok). Pipeline tam execution test'i yok.
- **Risk:** Test DB tek ve shared. Paralel test koşulamıyor (`fileParallelism: false`). CI süresi uzayacaktır.
- **Flaky signal:** `beforeAll`/`afterAll` DB setup; test sırası önemli olabilir.

---

## 13. Sürdürülebilirlik ve Geliştirici Deneyimi

**Okunabilirlik:**
- Kod yoğunluğu yüksek. `execution-engine.ts` 1300 satır, `task-engine.ts` 1300 satır, `project-routes.ts` 1300 satır.
- Fonksiyon isimlendirmesi genelde iyi (`checkAndAdvancePhase`, `resolveTaskTimeoutMs`).
- Türkçe-İngilizce karışık yorumlar ve log mesajları var. Bu tutarsızlık zorlayıcı.

**Tutarlılık:**
- Biome kullanılıyor (tab indent, 120 char). Ancak `noExplicitAny` ve `noNonNullAssertion` sadece `warn`.
- TypeScript `any` cast'leri kritik yerlerde (`auth-routes.ts`, `auth-middleware.ts`).

**Dokümantasyon:**
- `CLAUDE.md` iyi bir agent rehberi. README muhtemelen var.
- Inline yorumlar iyi ama çok yerde yorum ile kod uyuşmuyor (örn: timeout değerleri yorumda 5dk/15dk, kodda 30dk/30dk).

**Lokal Setup:**
- `docker-compose up -d` ile çalışıyor.
- `pnpm dev` ile backend, `cd console && pnpm dev` ile frontend.
- `.env.example` var mı emin değilim; env değişkenleri kod içinde dağılmış.

---

## 14. Altyapı ve Deployment Hazırlığı

**Docker:**
- `docker-compose.yml` var: PostgreSQL + Backend + Console + optional agent pool + SonarQube.
- Backend Dockerfile incelenmedi ama compose'da port `3141` doğru.
- **Not:** `Dockerfile` port `4242` expose ediyormuş (subagent bulgusu); compose override ediyor ama standalone build yanlış signal.

**Health Check:**
- Backend: `http://localhost:3141/health` (compose'da tanımlı).
- Console: `wget localhost:80`.

**Secret Yönetimi:**
- Env var'lar kullanılıyor. `OSCORPEX_VAULT_KEY` ile AES-256-GCM.
- **Ancak:** Vault key fallback var (hostname-derived). Bu üretimde ciddi risk.

**Config Katmanı:**
- `project_settings` tablosu var (category/key/value). Bu iyi bir pattern.
- Ancak uygulama seviyesi config sadece env var'lardan okunuyor.

**Migration/Release Güvenliği:**
- `init.sql` idempotent. Ama sıralı migration yok. Eski bir DB'ye yeni `init.sql` uygulandığında `ADD COLUMN IF NOT EXISTS` çalışır ama yeni tablolar/constraint'lerin sıralı bağımlılığı olabilir.
- Rollback stratejisi yok.

---

## 15. Gözlemlenebilirlik ve Operasyonel Hazırlık

**Logging:**
- Pino kullanılıyor. Structured logging var.
- Log seviyeleri tutarsız: bazı yerlerde `console.warn`, bazı yerlerde `log.warn`.
- **Eksik:** Correlation ID (request-id) yok. Distributed trace yok.

**Metrikler:**
- `token_usage` tablosu detaylı.
- `agent_daily_stats` var.
- Prometheus/Metrics endpoint yok.

**Tracing:**
- `OSCORPEX_TRACE_ENABLED=true` ile telemetry route'ları mount ediliyor ama tracing middleware yorumlanmış (`tracing-middleware.js` import'u yorumda).
- VoltAgent observability (LibSQL tabanlı) var ama bu farklı bir veritabanı.

**Debugging:**
- Agent terminal output'u `agentRuntime` buffer'ında tutuluyor ve log'a persist ediliyor.
- Task diff'leri `task_diffs` tablosunda.
- **Ancak:** CLI adapter'ların stderr/stdout'u nasıl loglandığı belirsiz.

**Alertability:**
- Event bus üzerinden webhook ve notification gönderimi var.
- Metric-based alerting yok.

---

## 16. Teknik Borç Kaydı

| Borç | Neden Önemli | Etki | Aciliyet | Zorluk |
|------|-------------|------|----------|--------|
| **Mono-migration (init.sql)** | 1689 satırlık tek dosya, geri alınamaz | Şema evrimi yönetilemez | Yüksek | Orta |
| **Giant files** | 3 dosya ~4000 satır toplam; maintenance zor | Refactor riskli, onboarding yavaş | Yüksek | Orta |
| **Non-blocking error swallowing** | Operasyonel hatalar görünmez | Budget/security ihlali sessizce geçer | **KRİTİK** | Düşük |
| **any tip kullanımı** | Type safety kaybı | Runtime hataları | Orta | Düşük |
| **JSON string columns** | JSONB yerine TEXT; indeks/sorgu verimsiz | Performans | Orta | Orta |
| **Tight coupling engines** | Circular import riski, test edilemezlik | Unit test zorluğu | Orta | Yüksek |
| **No rate limiting** | DoS/Brute-force açık | Güvenlik | Yüksek | Düşük |
| **Open by default auth** | Her deployment potansiyel açık kapı | Güvenlik | **KRİTİK** | Düşük |
| **No input validation layer** | Invalid data DB'ye yazılır | Veri bütünlüğü | Yüksek | Orta |
| **In-memory state** | `_dispatchingTasks`, `_activeControllers` restart'ta kaybolur | Task duplicate/loss | Yüksek | Yüksek |

---

## 17. En Yüksek Riskli Konular

1. **Authentication disabled by default** — Üretimde unutulursa tam açık API.
2. **Secret vault fallback key** — Hostname biliniyorsa tüm şifreler çözülebilir.
3. **Silent operational failures** — Budget, policy, sandbox hataları execution'ı durdurmuyor.
4. **Task status PATCH bypass** — Route'dan doğrudan `updateTask` ile status manipülasyonu.
5. **Race condition in budget check** — Non-atomic cost summary read.
6. **No HTTP rate limiting** — Brute force / abuse açık.
7. **In-memory dispatch tracking** — Process crash/restart'te "running" task'lar yetim kalabilir veya duplicate çalışabilir.

---

## 18. En Yüksek Etkili İyileştirmeler

1. **Zorunlu auth + input validation middleware** — En yüksek güvenlik getirisi.
2. **Non-blocking error'ları blocking yapmak (kritik hatalar için)** — Execution'ı durduran hata türleri tanımlanmalı.
3. **Rate limiting middleware** (`hono-rate-limiter` veya benzeri).
4. **JSONB migration** — `tasks.output`, `events.payload`, `phases.depends_on` için.
5. **Route handler'ların inceltilmesi** — Service layer eklenmesi.
6. **Proper migration tool** (`node-pg-migrate` veya `drizzle-kit`) ile `init.sql`'in parçalanması.
7. **Event bus idempotency** — Yatay ölçeklendirme için event processing guarantee.

---

## 19. Önerilen Refactor / Remedyasyon Yol Haritası

### Faz 1: Güvenlik ve Güvenilirlik (1-2 hafta)
- [ ] `authMiddleware`'de `authType: "none"` kaldırılacak; env key yoksa 401.
- [ ] `secret-vault.ts`'te hostname fallback kaldırılacak; `OSCORPEX_VAULT_KEY` zorunlu, yoksa startup hatası.
- [ ] `jwt.ts`'te default secret kaldırılacak.
- [ ] Hono rate limiting middleware eklenecek.
- [ ] `PATCH /tasks/:taskId` body validation (Zod schema) eklenecek.
- [ ] Kritik non-blocking try/catch'ler (`budget`, `sandbox`, `policy`) review edilecek; `error` seviyesinde log + execution durdurma kararı verilecek.

### Faz 2: Mimari Temizlik (2-4 hafta)
- [ ] Service layer oluşturulacak (`services/task-service.ts`, `services/project-service.ts`). Route handler'lar max 50 satır.
- [ ] `execution-engine.ts` parçalanacak: `TaskDispatcher`, `CliExecutor`, `SandboxPreparer`, `OutputProcessor`.
- [ ] `task-engine.ts` parçalanacak: `TaskStateMachine`, `ApprovalManager`, `ReviewLoop`, `BudgetChecker`.
- [ ] `db/index.ts` barrel export'u korumakla birlikte, domain servisleri repo'ları doğrudan import etmeyecek.

### Faz 3: Veri ve Operasyon (2-4 hafta)
- [ ] Migration tool'a geçiş (`node-pg-migrate` veya `drizzle-kit`).
- [ ] `TEXT` JSON alanları `JSONB`'ye çevrilecek.
- [ ] `tasks` tablosuna `project_id` doğrudan eklenecek (şimdiki COALESCE/JOIN fallback'i kaldırılacak).
- [ ] Correlation ID middleware + structured logging eklenecek.
- [ ] Prometheus metrics endpoint eklenecek.

### Faz 4: Ölçeklenebilirlik (4-8 hafta)
- [ ] Redis/BullMQ ile persistent job queue (task execution).
- [ ] `getReadyTasks` ve `getProgress` için optimize edilmiş query'ler (CTE + single round-trip).
- [ ] Worker process ayrımı (API sunucusu vs task executor).

---

## 20. Rewrite vs Refactor Kararı

**Karar: Refactor edilmeli. Rewrite gerekli değil.**

**Neden refactor yeterli:**
- Temel DAG pipeline ve event-driven mimari sağlam.
- `SELECT FOR UPDATE SKIP LOCKED` claim mekanizması iyi düşünülmüş.
- Frontend oldukça zengin ve çalışır durumda.
- Test altyapısı mevcut.

**Korunması gereken:**
- `pipeline-engine.ts` DAG wave mantığı.
- `event-bus.ts` mimarisi (PG bridge ile).
- `pg.ts` transaction helper'ları.
- Frontend sayfa yapısı ve API client organizasyonu.

**Tamamen yeniden düşünülmesi gereken:**
- `execution-engine.ts` (çok fazla sorumluluk, yeni bir `TaskExecutionOrchestrator` servisi yazılmalı).
- `init.sql` migration stratejisi.
- Auth middleware varsayılanları.

**En az riskli modernizasyon yolu:**
1. Auth/security fix'leri hemen yap.
2. Service layer'ı yavaş yavaş route'ların altına inşa et.
3. Engine'leri fonksiyonel olarak parçala (fonksiyon extract, class decomposition).
4. Veritabanı migration tool'una geç.

---

## 21. Çalışma Zamanında Doğrulanması Gereken Bilinmeyenler

1. **AI CLI adapter'ların gerçek davranışı:** `claude-code` ve `cursor` CLI'ları sandbox'ta nasıl çalışıyor? Prompt injection ile zararlı kod üretme riski var mı?
2. **Frontend XSS:** `dangerouslySetInnerHTML` veya benzeri kullanım var mı? Agent output'ları HTML olarak mı render ediliyor?
3. **Memory leak:** `eventBus` handler'ları unsubscribe ediliyor mu? Uzun süreli SSE bağlantılarında memory profili nedir?
4. **Docker container pool:** `containerPool.initialize()` başarısız olursa ne oluyor? Gerçekten isolation sağlanıyor mu?
5. **Git branch merge:** Conflict durumunda `mergeBranch` fallback'i (`checkout main`) veri kaybına yol açıyor mu?
6. **DB connection leak:** `withTransaction` dışında client release her durumda garanti mi?
7. **WebSocket server scale:** `startWSServer()` tek instance mı? Multiple backend instance'da WS broadcast nasıl çalışıyor?
8. **Cost calculation doğruluğu:** `token_usage.cost_usd` hesaplaması AI provider'ların güncel fiyatlandırmasıyla doğru mu?

---

## A. Risk Matrisi

| Konu | Önem | Olasılık | Etki | Önerilen Aksiyon |
|------|------|----------|------|------------------|
| Auth varsayılan açık | Kritik | Yüksek | Çok Yüksek | Zorunlu auth, 401 dönüşü |
| Vault key fallback | Kritik | Orta | Çok Yüksek | Startup'ta env zorunluluğu |
| Silent failure (budget/sandbox) | Yüksek | Yüksek | Yüksek | Kritik hatalarda execution durdurma |
| No rate limiting | Yüksek | Yüksek | Yüksek | Middleware ekleme |
| Input validation eksikliği | Yüksek | Yüksek | Yüksek | Zod schema tüm route'lara |
| JWT default secret | Kritik | Düşük | Çok Yüksek | Startup hatası |
| Task status PATCH bypass | Yüksek | Orta | Yüksek | Status transition servisi |
| DB race (budget check) | Orta | Orta | Yüksek | Atomic check-and-set |
| JSON TEXT performans | Orta | Yüksek | Orta | JSONB migration |
| Mono-migration | Orta | Yüksek | Orta | Migration tool geçişi |

---

## B. En Önemli 10 Bulgu

1. **Authentication varsayılan olarak devre dışı** — Üretim deployment'ı = açık API.
2. **Secret Vault hostname-derived fallback** — Şifreleme anahtarı tahmin edilebilir.
3. **Non-blocking hata yutma kültürü** — Kritik operasyonel hatalar sessiz kalıyor.
4. **Giant files (3x1300 satır)** — Bakım ve test edilebilirlik felç.
5. **Rate limiting yok** — API abuse ve brute-force açık.
6. **Input validation yetersizliği** — `PATCH /tasks/:taskId` tam açık.
7. **JWT default secret** — `oscorpex-dev-secret-change-in-production`.
8. **init.sql tek dosya god migration** — Şema evrimi yönetilemez.
9. **JSON string columns** — Performans ve query verimsizliği.
10. **In-memory state (task dispatch tracking)** — Scale-out ve crash recovery riski.

---

## C. Hızlı Kazanımlar (1–7 gün)

1. **Auth middleware'i zorunlu hale getir:** `authType: "none"` kaldır. Env key yoksa 401.
2. **Secret vault startup check:** `OSCORPEX_VAULT_KEY` olmadan sunucu başlamıyor mu?
3. **JWT secret startup check:** Default secret kullanılıyorsa `process.exit(1)`.
4. **Rate limiting middleware:** `hono-rate-limiter` veya `express-rate-limit` benzeri ekle.
5. **Task PATCH validation:** Sadece izinli alanları güncelle (`status` transition servisi üzerinden).
6. **Critical non-blocking'leri blocking yap:** Budget exceeded, sandbox violation hard mode'da fail etsin.
7. **Biome `noExplicitAny`'i `error` yap** ve mevcut `any`'leri temizle (en azından auth ve route'lar).

---

## D. Orta Vadeli İyileştirmeler (2–6 hafta)

1. **Service layer oluştur:** `services/task-service.ts`, `services/project-service.ts`. Route'ları 50 satıra indir.
2. **Execution engine parçala:** `TaskDispatcher`, `CliRunner`, `SandboxManager`, `OutputVerifier`.
3. **JSONB migration:** `tasks.output`, `events.payload`, `pipeline_runs.stages_json`.
4. **Zod validation tüm route'lara:** Request body ve query parametreleri için.
5. **Migration tool:** `node-pg-migrate` veya `drizzle-kit` ile `init.sql`'i parçala.
6. **Correlation ID + structured logging:** Her request'e UUID ata, tüm log'lara ekle.
7. **DB query optimizasyon:** `getReadyTasks` ve `getProgress` için CTE'li single query.

---

## E. Stratejik İyileştirmeler (1–3 ay)

1. **Persistent job queue:** Redis/BullMQ ile task execution'ı API sunucusundan ayır.
2. **Worker/scheduler ayrımı:** Execution engine ayrı process'te çalışsın.
3. **Real RLS policies:** PostgreSQL Row Level Security ile multi-tenant izolasyon.
4. **Event bus idempotency + dead letter:** Yatay ölçeklendirme ve garantili processing.
5. **Frontend E2E testleri:** Playwright ile kritik kullanıcı yolculukları.
6. **API versioning:** `/api/v1/studio` gibi versiyonlama.
7. **Observability stack:** Prometheus metrics + OpenTelemetry tracing.

---

## F. Doğrulama Kontrol Listesi

- [ ] Auth devre dışıyken `/api/studio/projects` çağrısı 401 döndü mü?
- [ ] `OSCORPEX_VAULT_KEY` olmadan sunucu başlamıyor mu?
- [ ] Rate limit aşıldığında 429 dönüyor mu?
- [ ] `PATCH /tasks/:taskId` ile `status: "done"` doğrudan yazılamıyor mu?
- [ ] Budget aşıldığında yeni task'lar `blocked`/`failed` oluyor mu?
- [ ] `recoverStuckTasks()` startup'ta aynı task'ı duplicate etmiyor mu?
- [ ] AI provider exhausted durumunda deferred retry schedule ediliyor mu?
- [ ] SSE stream event'leri frontend'e anında ulaşıyor mu?
- [ ] Container pool Docker yoksa gracefully fail ediyor mu?
- [ ] `token_usage` maliyet hesaplaması gerçek fatura ile karşılaştırıldı mı?
- [ ] Frontend'de agent output HTML injection yapılabiliyor mu?
- [ ] Git merge conflict durumunda veri kaybı oluyor mu?
