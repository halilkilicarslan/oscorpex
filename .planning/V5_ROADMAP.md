# Oscorpex v5 Roadmap — Platform Maturity

> Tarih: 2026-04-19 | Onceki: v4.1 (DiffViewer, HeatMap, RAG Observability) + Analysis Phases 1-5
> Durum: Backend 499/499, Frontend 433/433, typecheck 0 hata

---

## Genel Bakis

9 ozellik, 6 milestone, tahmini ~12 hafta. Her milestone bagimsiz deliverable uretir.

### Milestone Ozeti

| # | Milestone | Hafta | Oncelik | Risk |
|---|-----------|-------|---------|------|
| M1 | Real-time Polling Elimination | 1 | YUKSEK | Dusuk |
| M2 | Frontend Pagination + Analytics Charts | 1.5 | YUKSEK | Dusuk |
| M3 | Durable Events (LISTEN/NOTIFY) | 1 | ORTA | Dusuk |
| M4 | Multi-Provider Execution + Fallback | 2 | ORTA | Orta |
| M5 | Plugin SDK v1 | 2 | ORTA | Orta |
| M6 | Multi-Tenant + RBAC | 5 | DUSUK | Yuksek |

**Dependency graph:**
```
M1 (polling elim) ──┐
                     ├──→ M3 (LISTEN/NOTIFY) ──→ M6 (multi-tenant)
M2 (pagination)  ──┘                          ↗
                                             /
M4 (multi-provider) ──→ M5 (plugin SDK) ──┘
```

---

## M1 — Real-time Polling Elimination

**Hedef:** 10 polling dongusunu WebSocket event'lerine bagla. WS altyapisi zaten var (`ws-manager.ts`, `useStudioWebSocket` hook). Sadece frontend tuketimi eksik.

### Mevcut Durum
- WS sunucusu port 3142'de calisiyor (ws-manager.ts, 303 satir)
- `useStudioWebSocket` hook reconnect + heartbeat ile production-ready
- `EventFeed.tsx` zaten WS primary / SSE fallback pattern kullaniyor
- 10 bilesen 3s-30s aralikla polling yapiyor

### Polling Bilesenler (oncelik sirasina gore)

| Bilesen | Interval | WS Event Trigger |
|---------|----------|------------------|
| PipelineDashboard | 3s | `task:completed`, `task:failed`, `phase:completed`, `pipeline:completed` |
| AgentCard | 3s | `agent:output`, `task:completed`, `task:started` |
| AgentTerminal | 3s | `agent:output` (zaten SSE var, WS'e tasi) |
| AgentGrid | 5s | `task:assigned`, `task:completed`, `agent:started`, `agent:stopped` |
| ProjectPage (app status) | 5s | `execution:started`, yeni event: `app:status_changed` |
| MessageCenter | 5s | Yeni event: `message:created` |
| ProjectPage (unread) | 10s | `message:created` (ayni event, farkli handler) |
| KanbanBoard | 15s | `task:completed`, `task:failed`, `task:started`, `task:assigned` |
| AgentCard (scores) | 15s | `task:completed` (score degisimini tetikler) |
| AgentDashboard | 30s | `task:completed`, `pipeline:completed` |

### Uygulama Plani

**Faz 1.1 — `useWsEventRefresh` hook (yeni)**
```typescript
// WS event geldiginde state invalidation trigger'i
function useWsEventRefresh(projectId: string, eventTypes: string[], callback: () => void)
```
- `useStudioWebSocket`'ten gelen mesajlari filtreler
- Debounce (500ms) ile callback cagirir — ayni anda 5 task:completed gelirse tek refresh
- Fallback: WS baglantisi yoksa polling'e geri don (mevcut interval'ler korunur)

**Faz 1.2 — Yuksek frekansi bilesenler (3s polling → WS)**
- `PipelineDashboard`: task/phase/pipeline event'lerinde `loadPipelineData()` tetikle
- `AgentCard`: agent:output event'inde terminal append, task event'lerinde reload
- `AgentTerminal`: SSE'den WS'e gecis (agent:output event tipi zaten broadcast ediliyor)

**Faz 1.3 — Orta frekansi bilesenler (5-15s polling → WS)**
- `KanbanBoard`, `AgentGrid`, `MessageCenter`, `ProjectPage`
- `MessageCenter` icin backend'e `message:created` event tipi eklenmeli (agent-messaging.ts)

**Faz 1.4 — Dusuk frekansi bilesenler (30s → WS)**
- `AgentDashboard`: task:completed event'inde metrics refresh

### Dosya Degisiklikleri
- **Yeni:** `console/src/hooks/useWsEventRefresh.ts` (~60 LOC)
- **Degisecek:** 10 bilesen dosyasi (useEffect polling → useWsEventRefresh)
- **Backend:** `src/studio/agent-messaging.ts` — `message:created` event emit
- **Backend:** `src/studio/types.ts` — `message:created` EventType'a ekle

### Test Stratejisi
- Her bilesen icin: WS event mock → state update dogrulamasi
- Fallback testi: WS disconnect → polling'e geri donus
- Tahmini: ~20 yeni test

### Cikti
- 10 polling dongusunden 0'a (veya fallback-only)
- Ortalama latency: 3-30s → <500ms
- Network istekleri: ~%80 azalma

---

## M2 — Frontend Pagination + Analytics Charts

**Hedef:** Backend pagination'i frontend'e bagla + eksik analytics chart'lari ekle.

### Mevcut Durum
- Backend 5 endpoint pagination destekliyor (limit/offset + X-Total-Count)
- Frontend hicbir pagination parametresi kullanmiyor — 50+ kayit sessizce kesiliyor
- Analytics endpoint'leri zengin ama chart UI'lar primitif (el yapimi SVG/CSS)

### Faz 2.1 — Pagination Altyapisi

**`fetchPaginated<T>()` helper** (base.ts):
```typescript
interface PaginatedResult<T> { data: T[]; total: number; }
async function fetchPaginated<T>(url: string, limit: number, offset: number): Promise<PaginatedResult<T>>
// X-Total-Count header okunur, { data, total } doner
```

**API dosyalari guncelleme:**
- `projects.ts`: `fetchProjects(limit?, offset?)` → `fetchProjectsPaginated(limit, offset)`
- `tasks.ts`: `fetchTasks(projectId, limit?, offset?)`
- `messaging.ts`: `fetchProjectMessages(projectId, ..., limit?, offset?)`
- `work-items.ts`: `fetchWorkItems(projectId, ..., limit?, offset?)`

### Faz 2.2 — Pagination UI Bilesenler

**Secim A — StudioHomePage: Sayfali navigasyon**
- `Pagination` bileşeni (prev/next + sayfa gostergesi)
- 50 proje/sayfa, X-Total-Count'tan toplam sayfa hesapla

**Secim B — KanbanBoard, MessageCenter, BacklogBoard: Load More**
- `useInfiniteList` hook: state'e append, "Load more" butonu
- `IntersectionObserver` ile otomatik yukle (istege bagli)

### Faz 2.3 — Analytics Charts (Recharts)

**Bagimlilk:** `pnpm add recharts` (console/ altina)

**Chart 1: Cost Trend** (AgentDashboard veya ProjectReport)
- Veri: `GET /costs/history` → gunluk gruplama
- Bileşen: `CostTrendChart` — Recharts `LineChart` (x: tarih, y: USD)

**Chart 2: Velocity Trend** (SprintBoard)
- Veri: Sprint listesinden velocity dizisi
- Bilesen: `VelocityTrendChart` — Recharts `BarChart`

**Chart 3: Agent Timeline** (AgentDashboard)
- Veri: `GET /analytics/agents/:id/timeline` (zaten var)
- Bilesen: `AgentTimelineChart` — Recharts `AreaChart` (tokens, cost, tasks/gun)

**Chart 4: Complexity Distribution** (ProjectReport)
- Veri: `GET /platform/analytics` → `complexityDistribution`
- Bilesen: `ComplexityPieChart` — Recharts `PieChart`

### Dosya Degisiklikleri
- **Yeni:** `console/src/hooks/useInfiniteList.ts` (~80 LOC)
- **Yeni:** `console/src/components/Pagination.tsx` (~60 LOC)
- **Yeni:** 4 chart bileseni (~400 LOC toplam)
- **Degisecek:** `base.ts`, 4 API dosyasi, 4 sayfa bileseni
- **Bagimlilk:** `recharts` paketi

### Test Stratejisi
- Pagination: mock API → sayfa navigasyonu + load more dogrulamasi
- Chart: snapshot/render testi (Recharts SVG ciktisi)
- Tahmini: ~25 yeni test

---

## M3 — Durable Events (PostgreSQL LISTEN/NOTIFY)

**Hedef:** Event broadcasting'i in-memory'den PostgreSQL LISTEN/NOTIFY'a tasi. Task dispatch hala in-memory kalir (pg-boss icin M7'ye ertelendi).

### Neden LISTEN/NOTIFY (pg-boss degil)?
- Yeni bagimlilk yok (mevcut pg paketi yeterli)
- 2-3 dosya, ~200 LOC degisiklik
- `emitTransient()` (agent:output) dokunulmaz — yuksek frekansi terminal streaming icin in-memory gerekli
- `notifyCompleted()` callback zinciri degismez — en riskli kisim ertelenmis olur
- Gelecekte pg-boss'a gecis icin temel hazirlanmis olur

### 8KB Payload Limiti Cozumu
- `pg_notify` icinde sadece `{ eventId, projectId, type }` gonder (~100 byte)
- Subscriber event detayini `events` tablosundan fetch eder (zaten persist ediliyor)

### Uygulama Plani

**Faz 3.1 — LISTEN/NOTIFY bridge** (event-bus.ts)
```typescript
// emit() icinde mevcut insertEvent() sonrasi:
await pgExecute(`SELECT pg_notify('oscorpex_events', $1)`, [
  JSON.stringify({ id: event.id, projectId, type })
]);
```
- Dedicated PG connection (pool'dan ayri) ile `LISTEN oscorpex_events`
- Parse → mevcut `onProject` / `on` handler'larini tetikle

**Faz 3.2 — SSE endpoint refactor** (project-routes.ts)
- Mevcut: `eventBus.onProject()` ile in-memory subscribe
- Yeni: PG LISTEN channel'dan event alip SSE stream'e yaz
- Fallback: PG connection kopusunda in-memory'ye geri don

**Faz 3.3 — Webhook + Plugin notification**
- `routes/index.ts` global type subscriber'larini PG LISTEN handler'ina tasi
- Her event tipi icin ayri channel (opsiyonel): `oscorpex_task`, `oscorpex_pipeline`

### Dosya Degisiklikleri
- **Degisecek:** `event-bus.ts` (emit + dedicated listener), `routes/project-routes.ts` (SSE), `routes/index.ts` (webhook/plugin bridge)
- **Yeni:** `src/studio/pg-listener.ts` (~100 LOC) — dedicated LISTEN connection manager

### Riskler
- Dedicated PG connection pool'dan ayri yonetilmeli (reconnect logic)
- 8KB payload limiti → sadece event ID notify et, detay fetch et
- `emitTransient` in-memory kalir — WS broadcast'i etkilemez

### Test Stratejisi
- Integration test: emit → LISTEN → handler tetikleme
- Reconnect test: PG connection drop → otomatik yeniden baglanti
- Tahmini: ~10 yeni test

---

## M4 — Multi-Provider Execution + Fallback Chain

**Hedef:** Claude + Codex + Cursor ayni projede, adapter-level fallback, provider-aware model routing.

### Mevcut Durum
- `ClaudeAdapter`: Tam calisir
- `CodexAdapter`: Stub (`isAvailable()` → false, `execute()` → throw)
- `CursorAdapter`: Calisabilir ama `totalCostUsd: 0` doner
- `model-router.ts` her zaman `provider: "anthropic"` doner — Cursor/Codex icin anlamsiz
- Rate limit tespiti proje bazli, adapter bazli degil
- Tum task execution sequential (Semaphore ile sinirli)

### Uygulama Plani

**Faz 4.1 — CodexAdapter gercek implementasyon**
- `codex` CLI binary tespiti ve versiyon kontrolu
- `execute()`: `spawn("codex", [...])` ile tam implementasyon
- Cost tracking: Codex API usage parse

**Faz 4.2 — Provider-aware model routing**
```typescript
// model-router.ts
interface ResolvedModel {
  provider: "anthropic" | "openai" | "cursor";
  model: string;        // provider-native model adi
  cliTool: AgentCliTool; // hangi adapter kullanilacak
}
```
- `resolveModel()` artik `agent.cliTool`'a gore provider-native model adi doner
- Cursor icin: `cursor-small`, `cursor-large` gibi mapping
- Codex icin: `gpt-4o`, `o3-mini` gibi mapping

**Faz 4.3 — Adapter fallback chain**
```typescript
// cli-adapter.ts
function getAdapterChain(primary: AgentCliTool, fallbacks?: AgentCliTool[]): CLIAdapter[]
// Ornek: ["claude-code", "cursor"] → ClaudeAdapter yoksa CursorAdapter dene
```
- `execution-engine.ts`: `getAdapter()` → `getAdapterChain()`
- Task execution: ilk adapter basarisiz → sonraki adapter dene
- Rate limit → ayni adapter'i atla, sonrakine gec (adapter bazli cooldown)

**Faz 4.4 — Per-provider rate limit state**
```typescript
interface ProviderState {
  adapter: AgentCliTool;
  rateLimited: boolean;
  cooldownUntil: Date | null;
  consecutiveFailures: number;
}
```
- `execution-engine.ts`: provider bazli cooldown tracking
- Rate limit tespit edilince sadece o provider pause, diger provider'lar devam
- UI: ProviderStatusPanel (hangi provider aktif, hangisi cooldown'da)

**Faz 4.5 — Per-adapter cost tracking**
- `CursorAdapter`: cursor usage API'den gercek maliyet cek
- `CodexAdapter`: OpenAI usage response'undan token/cost parse et
- `token_usage` tablosu: `provider` kolonu ekle (mevcut: model bilgisi var)

### Dosya Degisiklikleri
- **Degisecek:** `cli-adapter.ts`, `model-router.ts`, `execution-engine.ts`, `types.ts`
- **Yeni:** `src/studio/provider-state.ts` (~150 LOC)
- **Frontend:** `ProviderStatusPanel` bileseni, `ProjectSettings` provider config
- **DB:** `token_usage` tablosuna `provider TEXT` kolonu

### Riskler
- Codex CLI henuz stabil olmayabilir — availability probe onemli
- Farkli provider'larin farkli prompt formatlari (system prompt uyumu)
- Analytics: "kim ne calistirdi" bilgisi karisabilir — task'a `actual_provider` field ekle
- Test: Her adapter icin ayri mock chain

### Test Stratejisi
- Adapter fallback: Claude fail → Cursor fallback dogrulamasi
- Rate limit isolation: Claude rate limited → Cursor devam
- Cost tracking: Her adapter'dan dogru cost parse
- Tahmini: ~30 yeni test

---

## M5 — Plugin SDK v1

**Hedef:** Mevcut 4-hook stub sistemi → manifest-driven, timeout-protected, observable plugin platformu.

### Mevcut Durum
- `plugin-registry.ts`: In-memory Map, 4 hook (onTaskComplete, onPipelineComplete, onWorkItemCreated, onPhaseComplete)
- Sandbox yok, config yok, DB persistence yok, timeout yok
- 27 event type'tan sadece 4'u plugin'e iletiliyor
- `registerPlugin()` dogrudan kod ile cagirilir, runtime ekleme yok

### Uygulama Plani

**Faz 5.1 — Plugin manifest + DB persistence**
```typescript
interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  hooks: string[];           // ["task:completed", "pipeline:completed", ...]
  permissions: string[];     // ["read:tasks", "write:work_items", ...]
  config?: Record<string, { type: string; default?: any; description: string }>;
}
```
- `registered_plugins` tablosu: name, version, enabled, config_json, manifest_json, loaded_at
- `POST /api/studio/plugins` — manifest yukle + dogrula + DB kayit
- `DELETE /api/studio/plugins/:name` — kaldir
- `GET /api/studio/plugins` — liste
- `PATCH /api/studio/plugins/:name` — enable/disable + config guncelle

**Faz 5.2 — Hook kapsama genisletme (4 → 31 event)**
- `routes/index.ts` event-bus bridge'inde tum EventType'lari plugin'e ilet
- Plugin manifest'indeki `hooks` dizisine gore filtreleme
- Her plugin sadece subscribe oldugu event'leri alir

**Faz 5.3 — Curated Plugin API surface**
```typescript
interface PluginContext {
  projectId: string;
  event: StudioEvent;
  api: {
    getProject(id: string): Promise<Project>;
    getTasks(projectId: string): Promise<Task[]>;
    createWorkItem(data: CreateWorkItemInput): Promise<WorkItem>;
    sendMessage(agentId: string, content: string): Promise<void>;
    getProjectSettings(projectId: string, category: string): Promise<Record<string, string>>;
  };
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
  config: Record<string, any>; // plugin'in kendi config'i
}
```
- Plugin handler'lari dogrudan ic modulleri import etmek yerine bu context uzerinden calisir
- Permission kontrolu: `api.createWorkItem()` cagirildiginda `write:work_items` permission kontrol edilir

**Faz 5.4 — Timeout + error isolation**
```typescript
async function invokePluginHook(plugin: Plugin, hook: string, ctx: PluginContext): Promise<void> {
  const timeout = plugin.manifest.timeout ?? 5000;
  await Promise.race([
    plugin.handler(ctx),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Plugin timeout")), timeout))
  ]);
}
```
- Per-hook timeout (varsayilan 5s, manifest ile override)
- Hata izolasyonu: bir plugin hata atarsa digerlerini etkilemez (mevcut)
- Execution log: `plugin_executions` tablosu (plugin_name, hook, duration_ms, error, created_at)

**Faz 5.5 — Built-in ornekler + Admin UI**
- `plugins/slack-notifier.ts` — Slack webhook ile task/pipeline bildirimi
- `plugins/github-issue-sync.ts` — Work item → GitHub issue senkronizasyonu
- Frontend: `PluginManager` sayfasi (liste, enable/disable, config, execution log)

### Dosya Degisiklikleri
- **Degisecek:** `plugin-registry.ts` (buyuk refactor), `routes/index.ts` (bridge genisletme), `types.ts`
- **Yeni:** `src/studio/plugin-context.ts` (~200 LOC), `src/studio/routes/plugin-routes.ts` (~150 LOC), `src/studio/db/plugin-repo.ts` (~100 LOC)
- **Yeni:** `plugins/slack-notifier.ts`, `plugins/github-issue-sync.ts` (~200 LOC toplam)
- **Frontend:** `PluginManager.tsx` sayfasi (~300 LOC)
- **DB:** `registered_plugins` + `plugin_executions` tablolari

### Riskler
- Tam sandboxing (vm/worker_threads) v1'de YOK — guvenilir plugin'ler icin yeterli
- Plugin'lerin dogrudan DB'ye erisimi engellenmiyor (sadece API surface ile sinirlandirilir)
- Permission enforcement eksik olursa data leak riski

### Test Stratejisi
- Plugin register/unregister lifecycle
- Hook filtering (sadece subscribe olunan event'ler)
- Timeout enforcement
- Permission kontrolu
- Execution logging
- Tahmini: ~25 yeni test

---

## M6 — Multi-Tenant + RBAC

**Hedef:** Tek kullanici → coklu organizasyon, kullanici rolleri, proje izolasyonu.

### Mevcut Durum
- Tek API key (OSCORPEX_API_KEY) — opt-in, tum kullanicilar ayni key
- SSE auth bypass (EventSource custom header gonderemiyor)
- `projects` tablosunda owner_id/tenant_id yok — herkes her seyi goruyor
- 9 tablo dogrudan tenant scoping gerektiriyor, ~28 tablo project_id uzerinden dolayli

### Uygulama Plani (4 faz, ~5 hafta)

**Faz 6.1 — Kullanici Kimligi (kirilma noktasi yok)**

Yeni tablolar:
```sql
CREATE TABLE tenants (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan TEXT DEFAULT 'free',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE user_roles (
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','developer','viewer','billing')),
  PRIMARY KEY (user_id, tenant_id)
);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  scopes TEXT[] DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

- `projects` tablosuna: `owner_id TEXT REFERENCES users(id)`, `tenant_id TEXT REFERENCES tenants(id)` (nullable, backfill edilmez)
- Auth middleware: Bearer token → `api_keys` tablosundan dogrula
- Mevcut `OSCORPEX_API_KEY` → "system admin" kullanici olarak migrate
- Login/register endpoint'leri: `POST /auth/register`, `POST /auth/login` (JWT token)

**Faz 6.2 — Row-Level Security**
- `projects` tablosuna `tenant_id NOT NULL` constraint (Faz 6.1 backfill sonrasi)
- Hono middleware: `c.set("tenantId", ...)`, `c.set("userId", ...)`
- Tum `GET /projects` sorgularina `WHERE tenant_id = $currentTenantId`
- 9 global tablo (ai_providers, agent_configs, team_templates, vb.) icin tenant scoping
- SSE endpoint: URL'ye `?token=` query param eklenerek auth sorunu cozulur

**Faz 6.3 — RBAC Enforcement**

Roller ve permission'lar:
```
owner:     projects:*, agents:*, pipeline:*, settings:*, billing:*, plugins:*, webhooks:*
admin:     projects:crud, agents:configure, pipeline:start/pause, settings:write
developer: projects:read, tasks:update, tasks:approve, pipeline:start
viewer:    projects:read, tasks:read, billing:read (salt-okunur)
billing:   billing:read, costs:read (sadece maliyet raporlari)
```

- `requirePermission(permission)` middleware: `c.get("userRole")` → permission check
- Route bazinda guard: `router.get("/projects", requirePermission("projects:read"), handler)`
- Admin panel: kullanici yonetimi, rol atama, API key yonetimi

**Faz 6.4 — Tenant Isolation Hardening**
- PostgreSQL Row Level Security (RLS) policies
- `SET app.current_tenant_id` pg.ts'de connection basina
- SSE/WS: tenant-scoped event stream (project event'i sadece tenant uyesine)
- API key scope sistemi: per-tenant, per-project API keys

### Dosya Degisiklikleri (kapsamli)
- **DB:** `scripts/init.sql` — 4 yeni tablo, 9+ ALTER TABLE
- **Yeni:** `src/studio/auth/` dizini — `auth-routes.ts`, `auth-middleware.ts`, `jwt.ts`, `rbac.ts` (~600 LOC)
- **Yeni:** `src/studio/db/tenant-repo.ts`, `user-repo.ts`, `api-key-repo.ts` (~300 LOC)
- **Degisecek:** `routes/index.ts` (auth middleware), tum 12 route dosyasi (tenant filter)
- **Degisecek:** `pg.ts` (RLS context set)
- **Frontend:** Login/Register sayfalari, tenant selector, kullanici yonetimi (~1000 LOC)
- **Frontend:** `base.ts` — JWT token yonetimi (localStorage/cookie)

### Riskler (YUKSEK)
1. **SSE auth bypass**: EventSource + token query param → token URL'de gorunur (HTTPS zorunlu)
2. **Backfill**: Mevcut projeler "default tenant"a atanmali
3. **Test coverage**: 499 backend testi tenant context beklemiyor — buyuk test refactor
4. **Breaking change**: Mevcut API key mekanizmasi degisir
5. **Session yonetimi**: JWT expiry, refresh token, logout

### Test Stratejisi
- Tenant izolasyonu: User A, User B'nin projelerini goremez
- RBAC: viewer rolundeki kullanici proje silemez
- API key scoping: sinirli scope'lu key ile yetkisiz islem reddedilir
- SSE auth: token'siz SSE baglantisi reddedilir
- Tahmini: ~60 yeni test + ~100 mevcut test refactor

---

## Ertelenen Ozellikler (v6 Adayi)

### pg-boss Worker Queue
- Semaphore → pg-boss ile tam durable task dispatch
- `notifyCompleted` callback zinciri → pg-boss job
- Tahmini: 6-8 dosya, ~800 LOC, tum testleri etkiler
- **Neden ertelendi:** LISTEN/NOTIFY (M3) event broadcasting'i cozer; task dispatch durable'ligi ikincil oncelik

### Plugin Sandboxing (v2)
- `worker_threads` veya `isolated-vm` ile gercek izolasyon
- Plugin'lerin `process.exit()` cagirmasini engelle
- **Neden ertelendi:** v1'de curated API surface + timeout yeterli; sandbox karmasik

### Horizontal Scaling
- Birden fazla backend instance + load balancer
- Sticky sessions (WS) veya shared state (Redis)
- **Neden ertelendi:** Tek instance 12 agent + 3 concurrent task icin yeterli

---

## Uygulama Sirasi ve Takvim

```
Hafta 1:    M1 (Polling Elimination)
Hafta 2-3:  M2 (Pagination + Charts)
Hafta 4:    M3 (LISTEN/NOTIFY)
Hafta 5-6:  M4 (Multi-Provider)
Hafta 7-8:  M5 (Plugin SDK)
Hafta 9-13: M6 (Multi-Tenant + RBAC)
```

Her milestone sonunda:
- Typecheck + test pass
- Commit + push
- MEMORY.md + Serena memory guncelleme

---

## Basari Metrikleri

| Metrik | Simdiki | M1 Sonrasi | M2 Sonrasi | Tum M Sonrasi |
|--------|---------|------------|------------|---------------|
| Polling istekleri/dk | ~120 | ~5 (fallback) | ~5 | ~0 |
| Maks kayit gosterimi | 50 (hard limit) | 50 | Sinirsiz (paginated) | Sinirsiz |
| Event durability | In-memory | In-memory | In-memory | PG-backed |
| Provider fallback | Yok | Yok | Yok | Otomatik chain |
| Plugin hook sayisi | 4 | 4 | 4 | 31 |
| Kullanici izolasyonu | Yok | Yok | Yok | Tam RBAC |
| Backend testler | 499 | ~519 | ~544 | ~700+ |
| Frontend testler | 433 | ~453 | ~478 | ~540+ |
