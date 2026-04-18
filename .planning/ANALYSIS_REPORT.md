# Oscorpex Platform — Kapsamli Analiz Raporu

> Tarih: 2026-04-19 | Kapsam: 5 Domain, 499 Backend + 433 Frontend Test | Commit: `f64e13a`

---

## Ozet Skorlar

| Domain | CRITICAL | HIGH | MEDIUM | LOW | Toplam |
|--------|----------|------|--------|-----|--------|
| Backend Quality | 2 | 6 | 9 | 7 | 24 |
| Security | 2 | 6 | 10 | 5 | 23 |
| Architecture | 2 | 8 | 6 | 4 | 20 |
| Frontend Quality | 5 | 7 | 10 | 6 | 28 |
| Performance & DB | 3 | 9 | 6 | 2 | 20 |
| **TOPLAM** | **14** | **36** | **41** | **24** | **115** |

---

## CRITICAL Bulgular (14)

### SEC-C1 — Gercek OpenAI API Key `.env` Dosyasinda
- **Dosya:** `.env`
- **Etki:** Secret sizmasi. `.env` git'e eklenmemis ama diskte acik duruyor.
- **Cozum:** `.env.example` kullan, gercek key'leri vault/secret manager'a tasi.

### SEC-C2 — Sifir Authentication: Tum 16 API Route Korumasiz
- **Dosya:** `src/studio/routes/*.ts` (tum router dosyalari)
- **Etki:** Herhangi biri API'ye erisebilir — veri okuma, silme, task calistirma.
- **Cozum:** Hono middleware ile JWT/session-based auth ekle. En az `Authorization: Bearer` header kontrolu.

### ARCH-C1 — Tek Proses CLI Spawn, Concurrency Limiti Yok
- **Dosya:** `src/studio/execution-engine.ts:192-206`
- **Etki:** 10 paralel task = 10 esanli Claude CLI sureci. Bellek/CPU tuketimi + rate limit.
- **Cozum:** Semaphore pattern ile `MAX_CONCURRENT_TASKS` (varsayilan 3) limiti ekle.

### ARCH-C2 — In-Memory Event Bus, Proses Restart'ta Kayip
- **Dosya:** `src/studio/event-bus.ts`
- **Etki:** Proses cokerse event'ler kaybolur, subscriber'lar kopuk kalir.
- **Cozum:** PostgreSQL LISTEN/NOTIFY veya Redis Pub/Sub ile dayanikli event transport.

### PERF-C1 — N+1 Firtinasi: `getAgentAnalytics` (108 DB Turu)
- **Dosya:** `src/studio/db/analytics-repo.ts:289-444`
- **Etki:** 12 ajan x 9 sorgu = 108 DB round-trip. 200-400ms salt DB suresi.
- **Cozum:** Tek CTE sorgusu ile tum agent metriklerini tek seferde cek.

### PERF-C2 — N+1: `listPhases` Icinde Her Phase Icin `listTasks`
- **Dosya:** `src/studio/db/project-repo.ts:155-163`
- **Etki:** Her pipeline dongusu, her task tamamlanmasinda tetikleniyor.
- **Cozum:** `LEFT JOIN tasks ON phase_id` ile tek sorgu, uygulama katmaninda grupla.

### PERF-C3 — Sinirsiz Paralel CLI Surec (= ARCH-C1)
- Ayni bulgu, performans perspektifinden.

### BQ-C1 — Stale "delete" Keyword in APPROVAL_KEYWORDS
- **Dosya:** `src/studio/pm-agent.ts`
- **Etki:** "Create delete button" gibi normal task'lar false-positive `waiting_approval` alabilir.
- **Not:** MEMORY.md'de "fix edildi" notu var — dogrulama gerekli.

### BQ-C2 — `null as any` Type Bypass
- **Dosya:** Backend kodunda cesitli yerler
- **Etki:** Runtime NullPointerException riskleri TypeScript tarafindan yakalanamaz.

### FE-C1 — TaskCard: React.memo Yok, Her Render'da Agent Lookup
- **Dosya:** `console/src/pages/studio/TaskCard.tsx:140-159`
- **Etki:** 100 task x 12 agent = 1200 obje karsilastirmasi her 5 saniyede.
- **Cozum:** `React.memo(TaskCard)` + `useMemo` ile agent lookup cache'le.

### FE-C2 — KanbanBoard: subTaskMap ve grouped `useMemo` Olmadan
- **Dosya:** `console/src/pages/studio/KanbanBoard.tsx:312-332`
- **Etki:** 5 saniyelik polling'de her state guncellemesinde pahali hesaplama tekrari.
- **Cozum:** Her iki hesaplamayi `useMemo([tasks])` ile sar.

### FE-C3 — ProjectPage: God Component (509 satir, 12 useState, 6 useEffect)
- **Dosya:** `console/src/pages/studio/ProjectPage.tsx:96-122`
- **Cozum:** Custom hook'lara ayir: `usePlannerSettings`, `useUnreadCount`, `useAppRunner`.

### FE-C4 — ProjectSettings: 2104 Satir, 8+ Farkli Ozellik Bolumu
- **Dosya:** `console/src/pages/studio/ProjectSettings.tsx`
- **Cozum:** Her bolumu bagimsiz bilesen/hook'a cikart (WebhookSection, PolicySection, vb).

### FE-C5 — StudioHomePage: 1497 Satir + `catch (err: any)`
- **Dosya:** `console/src/pages/studio/StudioHomePage.tsx:1065,1233`
- **Cozum:** TeamArchitect, proje olusturma, template secimi ayri bilesen/hook'lara ayir.

---

## HIGH Bulgular (36)

### Backend Quality (6)
| ID | Bulgu | Dosya |
|----|-------|-------|
| BQ-H1 | `_executeTaskInner` 290+ satir god function | `execution-engine.ts` |
| BQ-H2 | `recoverStuckTasks` N+1 sorgu pattern | `execution-engine.ts` |
| BQ-H3 | 133 DB sorgusunda `any` tipi | `src/studio/db/*.ts` |
| BQ-H4 | EventType union 15+ eksik tip | `event-bus.ts` |
| BQ-H5 | Task PATCH route'unda validasyon yok | `task-routes.ts` |
| BQ-H6 | `project-routes.ts` 1232 satir god file | `routes/project-routes.ts` |

### Security (6)
| ID | Bulgu | Dosya |
|----|-------|-------|
| SEC-H1 | Command injection: `execSync` + string interpolation | `diff-capture.ts`, `app-runner.ts` |
| SEC-H2 | Path traversal: git-file-routes GET/PUT | `git-file-routes.ts` |
| SEC-H3 | Hostname-based vault key fallback | `cli-usage.ts` |
| SEC-H4 | Webhook secret HTTP header'da gonderiliyor | `routes/*.ts` |
| SEC-H5 | `bypassPermissions` CLI flag | `cli-adapter.ts` |
| SEC-H6 | WS auth yok, CORS yapilandi yok | `event-bus.ts`, server config |

### Architecture (8)
| ID | Bulgu | Dosya |
|----|-------|-------|
| ARCH-H1 | TEXT dates (TIMESTAMPTZ olmali) | `scripts/init.sql` |
| ARCH-H2 | Kritik DB index'leri eksik | `scripts/init.sql` |
| ARCH-H3 | Multi-write op'larda transaction yok | `task-engine.ts` |
| ARCH-H4 | Pipeline state in-memory Map | `pipeline-engine.ts` |
| ARCH-H5 | `tasks` tablosunda `project_id` kolonu yok | `scripts/init.sql` |
| ARCH-H6 | Pagination yok (list endpoint'leri) | `db/*.ts`, `routes/*.ts` |
| ARCH-H7 | Fire-and-forget error swallowing | `execution-engine.ts` |
| ARCH-H8 | `appendTaskLogs` read-modify-write race | `task-repo.ts:249-262` |

### Frontend Quality (7)
| ID | Bulgu | Dosya |
|----|-------|-------|
| FE-H1 | React.memo hicbir bilesende kullanilmiyor | Tum `pages/studio/` |
| FE-H2 | Modal focus management ve Escape yok | `TaskDetailModal`, `KanbanBoard`, `SprintBoard` |
| FE-H3 | BacklogBoard/SprintBoard tip duplikasyonu + API bypass | `BacklogBoard.tsx`, `SprintBoard.tsx` |
| FE-H4 | PlannerChatContext stale closure riski | `PlannerChatContext.tsx:110-134` |
| FE-H5 | ProjectPage her 10s'de agent refetch (N+1 HTTP) | `ProjectPage.tsx:140-157` |
| FE-H6 | AgentDashboard Promise.all kirilgan (9 paralel cagri) | `AgentDashboard.tsx:361-386` |
| FE-H7 | EventFeed lokal StudioEvent tipi cakismasi | `EventFeed.tsx:33-38` |

### Performance (9)
| ID | Bulgu | Dosya |
|----|-------|-------|
| PERF-H1 | `getProjectAnalytics` ardisik DB cagrilari | `analytics-repo.ts:188-287` |
| PERF-H2 | `updateTask` sonrasi gereksiz `getTask` re-fetch | `task-repo.ts:182-183` |
| PERF-H3 | `listTokenUsage` LIMIT yok | `analytics-repo.ts:163-182` |
| PERF-H4 | 8 kritik DB index eksik | `scripts/init.sql` |
| PERF-H5 | TEXT timestamp cast overhead | `scripts/init.sql` |
| PERF-H6 | EventBus handlers Map bos Set temizleme yok | `event-bus.ts` |
| PERF-H7 | SSE stream cleanup garanti degil | `event-bus.ts:134-156` |
| PERF-H8 | KanbanBoard 5s polling (WS yerine) | `KanbanBoard.tsx:218-221` |
| PERF-H9 | Unread count: 12 ajan x 10s = 72 HTTP/dk | `ProjectPage.tsx:140-157` |

---

## MEDIUM Bulgular (41) — Ozet

| Domain | Adet | Ornek Konular |
|--------|------|---------------|
| Backend Quality | 9 | 92 `as any`, 239 console.log, env variable validation eksik |
| Security | 10 | Env leak to containers, prompt injection riski, no rate limit |
| Architecture | 6 | Singleton coupling, event bus single point of failure |
| Frontend | 10 | Inline style 231 kullanim, format fonksiyonu duplikasyonu, stale WS subscription |
| Performance | 6 | Bundle lazy loading eksik, list virtualization yok, connection pool pressure |

---

## LOW Bulgular (24) — Ozet

| Domain | Adet | Ornek Konular |
|--------|------|---------------|
| Backend Quality | 7 | Console.log temizligi, magic number'lar |
| Security | 5 | Cookie httpOnly eksik, CSP header yok |
| Architecture | 4 | Monorepo workspace yapilanmasi, test coverage tool |
| Frontend | 6 | aria-label eksikligi, StatCard duplikasyonu, setTimeout cleanup |
| Performance | 2 | Vite chunk stratejisi, TSConfig strict mode |

---

## Oncelikli Aksiyon Yol Haritasi

### Faz 1 — Hizli Kazanimlar (1-2 Gun)
1. **DB Index'leri ekle** — `init.sql`'e 8 index, sifir kod degisikligi
2. **`updateTask` RETURNING*** — Her task lifecycle adiminda 2x DB roundtrip tasarrufu
3. **EventBus bos Set temizleme** — 3 satir degisiklik
4. **KanbanBoard polling 5s → 15s** — Sunucu yuku azaltma
5. **`getActivityTimeline` Promise.all** — 3 sirali sorguyu paralele cevir

### Faz 2 — Guvenlik Temeli (3-5 Gun)
6. **Hono auth middleware** — JWT/Bearer token ile tum route'lari koru
7. **Command injection fix** — `execSync` string interpolation → parameterized exec
8. **Path traversal fix** — `git-file-routes` path normalization + whitelist
9. **CORS yapilandirmasi** — Origin whitelist
10. **`.env` temizligi** — Secret'lari vault'a tasi

### Faz 3 — N+1 Eliminasyonu (3-5 Gun)
11. **`getAgentAnalytics` CTE** — 108 DB turu → 1 sorgu
12. **`listPhases` JOIN** — N+1 → tek sorgu
13. **`getProjectIdForTask` cache** — Task'a `projectId` ekle veya LRU cache
14. **Unread count batch endpoint** — 12 HTTP/10s → 1 HTTP/10s
15. **`budget/status` bulk query** — N sorgu → 1 GROUP BY

### Faz 4 — Frontend Refactor (5-7 Gun)
16. **React.memo** — TaskCard, AgentRow, StageCard
17. **useMemo** — KanbanBoard grouped/subTaskMap, ProjectPage visibleTabs
18. **God component parcalama** — ProjectSettings → 5 bolum, StudioHomePage → 3 bolum
19. **Modal a11y** — Focus trap, Escape, aria-modal
20. **Lazy loading** — `React.lazy` ile xterm, xyflow, agir bilesenler

### Faz 5 — Mimari Iyilestirmeler (7-14 Gun)
21. **Concurrency limiter** — Semaphore ile MAX_CONCURRENT_TASKS
22. **TEXT → TIMESTAMPTZ migration** — Tarih kolonlarini donustur
23. **tasks.project_id kolonu** — JOIN zincirini ortadan kaldir
24. **Dayanikli event transport** — PostgreSQL LISTEN/NOTIFY veya Redis Pub/Sub
25. **API pagination** — Tum list endpoint'lerine LIMIT/OFFSET

---

## Pozitif Notlar

- **Context layer** iyi decouple edilmis (context-store, context-sandbox, context-session, context-analytics)
- **recoverStuckTasks** robust: `_dispatchingTasks` + `_activeControllers` ile orphaned detection
- **db.js barrel export** temiz — tum route'lar tek import noktasi kullaniyor
- **Test coverage saglam**: 499 backend + 433 frontend = 932 test
- **Rate limit detection** mevcut: CLI stdout'ta quota pattern algiliyor
- **Review loop** dogru calisiyor: reject → revision → re-execute
- **E2E pipeline** dogrulanmis: 14/14 task done, 0 failed (Todo App)

---

*Rapor 5 paralel analiz agent'i tarafindan uretildi. Her domain icin detayli transcript'ler `/private/tmp/claude-501/` altinda mevcuttur.*
