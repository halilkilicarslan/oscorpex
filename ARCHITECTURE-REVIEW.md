# Oscorpex Mimari Analiz Raporu — SOLID & Architecture Review

**Tarih:** 2026-05-02
**Kapsam:** Kernel (85K LOC), Console (37K LOC), Packages (7 modül)
**Analiz Derinliği:** Deep — sembolik analiz + dependency graph + pattern detection

---

## Özet Skor Tablosu

| Kriter | Skor | Açıklama |
|--------|------|----------|
| **S — Single Responsibility** | 5/10 | God object'ler ve LOC yoğunluğu yüksek |
| **O — Open/Closed** | 7/10 | Plugin registry iyi, ama engine'ler extension'a kapalı |
| **L — Liskov Substitution** | 8/10 | Interface'ler tutarlı, provider-sdk iyi tasarlanmış |
| **I — Interface Segregation** | 4/10 | types.ts monolitleri ciddi ihlal |
| **D — Dependency Inversion** | 4/10 | Concrete singleton'lar, doğrudan DB erişimi yaygın |
| **Circular Dependencies** | 3/10 | 5 aktif circular dependency |
| **Cohesion** | 6/10 | Modül sınırları var ama sızdırma çok |
| **Genel Mimari** | 5.5/10 | İyi temeller, ciddi teknik borç |

---

## 1. KRİTİK — Circular Dependencies (Severity: HIGH)

### Bulgular
```
execution-engine ↔ execution-gates
execution-engine ↔ prompt-builder
execution-engine ↔ proposal-processor
execution-engine ↔ review-dispatcher
execution-engine ↔ index (barrel)
```

### Sorun
`execution-engine.ts`'den 4 modül çıkarılmış (v8.1 audit), ancak çıkarılan modüller **hâlâ parent'a geri import yapıyor**. Bu "extract & reference back" anti-pattern'i gerçek bir decomposition değil, sadece dosya bölme.

### Etki
- Runtime'da circular import resolution sorunları (ESM'de `undefined` riski)
- Modüller bağımsız test edilemez
- Refactoring sırasında cascade kırılma

### Çözüm Önerisi
```
Strateji: Mediator + Interface Extraction

1. execution-engine'den kullanılan tipleri → execution-types.ts'ye çıkar
2. Shared interface'leri tanımla (IExecutionContext, ITaskRunner)
3. Extracted modüller sadece interface'lere bağımlı olsun
4. execution-engine modülleri composition ile birleştirsin

Bağımlılık yönü:
  execution-gates → execution-types (interface only)
  prompt-builder → execution-types (interface only)
  proposal-processor → execution-types (interface only)
  review-dispatcher → execution-types (interface only)
  execution-engine → execution-gates, prompt-builder, ... (concrete)
```

---

## 2. KRİTİK — Single Responsibility İhlalleri (Severity: HIGH)

### 2.1 ExecutionEngine — God Object (1646 LOC, 11 method)

| Method | Sorumluluk |
|--------|-----------|
| `startProjectExecution` | Proje başlatma |
| `dispatchReadyTasks` | Task dispatch + watchdog |
| `executeTask` | Task execution orchestration |
| `_executeTaskInner` | CLI çağrısı + token recording |
| `_startTaskForExecution` | Task claim + session init |
| `executeSpecialTask` | Özel task türleri |
| `cancelRunningTasks` | İptal yönetimi |
| `recoverStuckTasks` | Recovery |
| `runDispatchWatchdog` | Watchdog timer |
| `getExecutionStatus` | Status query |
| `getRunningProjectPhases` | Phase query |

**İhlal:** Dispatch, execution, recovery, monitoring, querying — 5 farklı concern tek class'ta.

### 2.2 TaskEngine — 27 Method Monolith (1364 LOC)

Lifecycle (`assignTask`, `startTask`, `completeTask`, `failTask`), review (`submitReview`, `findReviewerForTask`), approval (`approveTask`, `rejectTask`), budget (`checkProjectBudget`), progress (`getProgress`, `isPhaseComplete`) — hepsi tek class.

### 2.3 PipelineEngine — 20+ Method (947 LOC)

DAG orchestration, git branch management (`createPhaseBranch`, `mergePhaseBranchToMain`), PR creation (`tryCreatePR`), status query — karışık sorumluluklar.

### 2.4 Frontend Page Monolitleri

| Dosya | LOC | Sorun |
|-------|-----|-------|
| `PromptsPage.tsx` | 1166 | UI + state + API + filtering tek dosya |
| `TriggersPage.tsx` | 1165 | Aynı pattern |
| `RagPage.tsx` | 1118 | Aynı pattern |
| `FeedbacksPage.tsx` | 1118 | Aynı pattern |
| `TracesPage.tsx` | 1107 | Aynı pattern |
| `CreateProjectModal.tsx` | 1088 | Modal içinde tüm wizard logic |

**914 `useState`/`useReducer`/`useContext` çağrısı** — state logic component'lerin içine gömülmüş.

### Çözüm Önerisi
```
Backend:
- ExecutionEngine → ExecutionDispatcher + TaskExecutor + RecoveryManager
- TaskEngine → TaskLifecycle + TaskReview + TaskApproval + TaskProgress
- PipelineEngine → PipelineOrchestrator + GitBranchManager + PipelineQuery

Frontend:
- Custom hook extraction: usePromptsData, useTableFiltering, usePagination
- Container/Presentational ayrımı
- Her page max 300-400 LOC hedefi
```

---

## 3. KRİTİK — Dependency Inversion İhlali (Severity: HIGH)

### 3.1 Doğrudan `pg.js` Erişimi (19 dosya!)

`db/` repo katmanı varken **19 dosya** doğrudan `pg.js`'den `execute`, `query`, `queryOne` import ediyor:

```
agent-messaging.ts, agent-runtime.ts, cli-usage.ts, context-analytics.ts,
context-builder.ts, context-store.ts, db-bootstrap.ts, db-pool-metrics.ts,
document-indexer.ts, execution-engine.ts, job-queue.ts, pm-agent.ts,
provider-state.ts, replay-store.ts, sonar-runner.ts, sprint-manager.ts,
task-decomposer.ts, task-engine.ts, vector-store.ts
```

**İhlal:** High-level modüller (execution-engine, task-engine, pm-agent) doğrudan low-level DB driver'a bağımlı. Repository pattern bypass ediliyor.

### 3.2 Singleton Anti-Pattern

```typescript
export const executionEngine = new ExecutionEngine();  // execution-engine.ts:1609
export const taskEngine = new TaskEngine();             // task-engine.ts:1364
export const pipelineEngine = new PipelineEngine();     // pipeline-engine.ts:944
```

- Constructor injection yok — hardcoded dependency
- Test'te mock'lamak için module-level patching gerekiyor
- Engine'ler arası bağımlılık import-time'da resolve ediliyor

### Çözüm Önerisi
```
1. Repository pattern'i zorunlu kıl — pg.js'ye doğrudan erişimi lint rule ile engelle
2. Dependency injection container (lightweight):
   - createKernel({ executionEngine, taskEngine, pipelineEngine })
   - Her engine constructor'da dependency'lerini alsın
3. Interface-based injection:
   - ITaskEngine, IExecutionEngine, IPipelineEngine
   - Test'te mock implementation verilebilir
```

---

## 4. YÜKSEK — Interface Segregation İhlali (Severity: HIGH)

### 4.1 `types.ts` Monolitleri

| Dosya | Interface + Type sayısı |
|-------|------------------------|
| Kernel `types.ts` | **95 export** (49 interface + 43 type alias + 3 misc) |
| Console `types.ts` | **119 export** |

Tek bir `types.ts` dosyasında **her şey** tanımlı: `Task`, `Project`, `Agent`, `Pipeline`, `Sprint`, `Phase`, `Context`, `Memory`, `Policy`, `Cost`, `Token`, `Git`, `Container`, `Chat`...

**İhlal:** Bir modül sadece `Task` tipine ihtiyaç duysa bile 95 tipin hepsini import ediyor. 51 dosya `./types.js`'yi import ediyor.

### 4.2 Çözüm Önerisi
```
Domain-based type splitting:
  types/task.ts      — Task, TaskStatus, TaskType, TaskOutput, TaskProposal
  types/agent.ts     — AgentConfig, AgentSession, AgentEpisode, AgentRole
  types/pipeline.ts  — PipelineState, PipelineStage, PipelineRun
  types/project.ts   — Project, ProjectPlan, Phase, Sprint
  types/context.ts   — ContextChunk, ContextSource, ContextSearchResult
  types/index.ts     — Barrel re-export (backward compat)
```

---

## 5. ORTA — Open/Closed Prensibi (Severity: MEDIUM)

### 5.1 Engine Extension Mekanizması Yok

- `ExecutionEngine` yeni bir task türü eklemek için class'ın kendisini değiştirmeyi gerektiriyor (`executeSpecialTask` switch/if)
- `PipelineEngine.advanceStage` yeni stage logic'i için doğrudan method modifikasyonu
- `TaskEngine.completeTask` yeni completion behavior için class değişikliği

**Pozitif:** `plugin-registry.ts` ve `composition/` pattern'i iyi. Event bus ile extension mümkün.

### 5.2 Çözüm Önerisi
```
Strategy pattern:
- ITaskExecutionStrategy { canHandle(task): boolean; execute(task): Promise<Result> }
- ExecutionEngine.registerStrategy(strategy)
- Yeni task türleri strateji olarak eklenir, engine değişmez
```

---

## 6. ORTA — Event Bus Typing & Sprawl (Severity: MEDIUM)

- **354 event emit/on çağrısı** — event-driven architecture iyi, ama:
  - Event type'lar `types.ts` monolitinde
  - Event handler registration dağınık (composition/ iyi başlangıç ama tamamlanmamış)
  - Event payload validation yok (runtime type safety eksik)

---

## 7. ORTA — Frontend Mimari Sorunları (Severity: MEDIUM)

### 7.1 State Management Dağınıklığı
- Sadece 2 context: `AuthContext` ve `PlannerChatContext`
- Gerisi: 914 `useState` çağrısı page/component içinde
- Global state yönetimi yok (zustand, jotai, vb.)
- Server state management yok (tanstack-query eksik — polling ile çözülmüş)

### 7.2 API Layer Tipe Duplikasyonu
- Kernel `types.ts`: 95 export
- Console `types.ts`: 119 export
- **Tip senkronizasyonu manuel** — API değiştiğinde iki yeri güncellemek gerekiyor
- `@oscorpex/core` paketi var ama sadece 4 import ile kullanılıyor

### 7.3 Çözüm Önerisi
```
1. @oscorpex/core'u shared types için single source of truth yap
2. API response type'ları otomatik üret (openapi-typescript veya zod + zodios)
3. tanstack-query ile server state management
4. zustand veya jotai ile client state (global)
```

---

## 8. DÜŞÜK — Type Safety (Severity: LOW-MEDIUM)

- **204 `as any`** kullanımı (203'ü studio/ içinde)
- Çoğu DB row → domain object mapping'de
- `db/helpers.ts` (390 LOC) generic helper ile çözülebilir

---

## 9. DÜŞÜK — Monorepo Package Boundaries (Severity: LOW)

### Pozitifler
- 7 package iyi ayrılmış (provider-sdk, policy-kit, event-schema, vb.)
- `workspace:*` protocol tutarlı kullanılıyor
- `control-plane` extraction başarılı

### Sorunlar
- Package'lar kernel tarafından az kullanılıyor (toplam 40 import)
- `memory-kit` sadece 1 import
- `task-graph` sadece 2 import (buildDAGWaves)
- Package API yüzeyleri küçük — gerçek business logic hâlâ kernel monoliti içinde

---

## Öncelikli Aksiyon Planı

### P0 — Hemen (Mimari Risk)
| # | Aksiyon | Etki | Efor |
|---|---------|------|------|
| 1 | Circular dependency'leri kır (interface extraction) | Stability | M |
| 2 | `pg.js` doğrudan erişimini kaldır → repo pattern | Maintainability | L |
| 3 | `types.ts` domain-based split | ISP compliance | M |

### P1 — Kısa Vade (Teknik Borç)
| # | Aksiyon | Etki | Efor |
|---|---------|------|------|
| 4 | ExecutionEngine decomposition (3 class) | SRP | L |
| 5 | TaskEngine decomposition (4 concern) | SRP | L |
| 6 | Frontend page extraction (<400 LOC) | Maintainability | M |
| 7 | DI container (lightweight) | Testability | M |

### P2 — Orta Vade (Kalite)
| # | Aksiyon | Etki | Efor |
|---|---------|------|------|
| 8 | Shared types via @oscorpex/core | DRY, type safety | M |
| 9 | tanstack-query + server state | Frontend perf | L |
| 10 | `as any` reduction (204→0) | Type safety | M |
| 11 | Strategy pattern for task execution | OCP | M |

**Efor:** S = 1-2 saat, M = 4-8 saat, L = 1-2 gün

---

## Mimari Diyagram — Mevcut Sorunlar

```
┌─────────────────────────────────────────────────────┐
│                   KERNEL MONOLITH                     │
│                                                       │
│  ┌──────────────┐  circular  ┌──────────────────┐    │
│  │ execution-   │◄──────────►│ execution-gates  │    │
│  │ engine       │◄──────────►│ prompt-builder   │    │
│  │ (1646 LOC)   │◄──────────►│ proposal-proc.   │    │
│  │ GOD OBJECT   │◄──────────►│ review-dispatch. │    │
│  └──────┬───────┘            └──────────────────┘    │
│         │ direct pg.js                                │
│  ┌──────┴───────┐                                    │
│  │ task-engine   │──── direct pg.js ──┐              │
│  │ (1364 LOC)   │                     │              │
│  └──────────────┘                     ▼              │
│  ┌──────────────┐            ┌──────────────┐        │
│  │ pipeline-eng │            │   pg.js      │        │
│  │ (947 LOC)    │            │ (19 direct   │        │
│  └──────────────┘            │  importers!) │        │
│                              └──────────────┘        │
│  ┌──────────────────────────────────────────┐        │
│  │ types.ts (821 LOC, 95 exports)           │        │
│  │ MONOLITH — 51 files import this          │        │
│  └──────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│                   CONSOLE                             │
│  ┌───────────────────────────────────────┐           │
│  │ 5 pages >1000 LOC each               │           │
│  │ 914 useState calls (no global state)  │           │
│  │ types.ts: 119 exports (manual sync)   │           │
│  └───────────────────────────────────────┘           │
└─────────────────────────────────────────────────────┘
```

---

## Sonuç

Oscorpex'in **temelleri sağlam**: event-driven architecture, repo pattern (kısmen), plugin registry, composition root, structured logging. v8.1 audit ile graph safety, sandbox hardening ve modül extraction'lar iyi adımlar.

Ancak **3 kritik mimari sorun** acil müdahale gerektiriyor:
1. **Circular dependencies** — ESM runtime riski
2. **DIP ihlali** — 19 dosya repo katmanını bypass ediyor
3. **ISP ihlali** — 95+119 export'lu monolitik type dosyaları

Bu sorunlar çözülmeden codebase büyüdükçe refactoring maliyeti üstel artacak.
