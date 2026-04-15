# Oscorpex v3.x Roadmap — Kapsamlı Plan

> Kaynak: `/Users/iamhk/.claude/plans/jolly-prancing-tome.md` (plan modundan kaydedilmiştir).
> v3.0-v3.9 platformu `db2427e` ile landed edildi (stub seviyesinde); şu an her milestone için stabilizasyon (gerçek implementasyon + test + UI bağlama) yapılıyor.

## Context

Oscorpex v2.7, tek seferlik plan-execute modeli ile çalışıyor: Planner otomatik plan üretir, pipeline execute eder, biter. Ancak gerçek yazılım geliştirme sürekli bir döngü — bug'lar çıkar, yeni feature'lar istenir, güvenlik bulguları oluşur. Ayrıca planner interaktif değil (soru sormadan plan yapıyor) ve task'lar genellikle büyük (L/XL), bu da AI çıktısının kalitesini düşürüyor.

Bu plan, Oscorpex'i tek seferlik araçtan **yaşayan bir yazılım geliştirme platformuna** dönüştürüyor.

---

## Stabilizasyon Durumu (2026-04-15)

| Milestone | Stub (db2427e) | Stabilizasyon |
|-----------|----------------|---------------|
| v3.0 B1 — Interaktif Planner | ✓ | ✓ `b3b282a` — askuser-json + intake UI |
| v3.0 B2 — AI Decomposer | ✓ (regex) | ✓ `0a763d0` — Scrum Master LLM + heuristic fallback |
| v3.0 B3 — Sub-task UI rollup | ✓ | ☐ planlandı |
| v3.1 Edge Types | ✓ | ☐ |
| v3.2 Work Items | ✓ | ☐ |
| v3.3 Incremental Planning | ✓ | ☐ |
| v3.4 Context + Routing + Memory | ✓ | ☐ |
| v3.5 Lifecycle | ✓ | ☐ |
| v3.6 Ceremonies | ✓ | ☐ |
| v3.7 Governance | ✓ | ☐ |
| v3.8 Human Interaction | ✓ | ☐ |
| v3.9 Sprints + Plugins | ✓ | ☐ |

---

## v3.0 — Interaktif Planner + Micro-Task Decomposition

**Tema:** Planner interaktif soru-cevap ile gereksinim toplar, PM+SM işbirliği ile micro-task'lara böler.

### 1. Interaktif Planner (PM Agent) — ✓ B1 landed

**Akış:** Analiz → Soru → Plan

- PM agent önce codebase'i analiz eder (dosya yapısı, tech stack, mevcut kod)
- Eksik bilgileri tespit eder, kullanıcıya **kapsamlı** sorular sorar (az soru değil, tüm boyutları kapsar)
- Sorular: fonksiyonel gereksinimler, non-functional (performans, güvenlik), öncelik sırası, kabul kriterleri, kapsam dışı kalanlar
- Kullanıcı cevapladıktan sonra plan oluşturur
- Cevaplanmamış sorular varsa tekrar sorar (iteratif)

**Mevcut Implementasyon (B1, commit `b3b282a`):**
- `askuser-json` fenced block pattern (plan-json / team-json gibi)
- `intake_questions` tablosu (pending/answered/skipped lifecycle)
- `[Intake Q&A]` bloğu planner system prompt'una enjekte edilir
- PMChat'te kategori bazlı (scope/functional/nonfunctional/priority/technical) soru kartları
- Chip seçimi + serbest metin + skip butonu

**Değişen dosyalar:**
- `scripts/init.sql` (yeni tablo `intake_questions`)
- `src/studio/types.ts` (IntakeQuestion, IntakeQuestionStatus, IntakeQuestionCategory)
- `src/studio/db/intake-repo.ts` (yeni CRUD)
- `src/studio/db/index.ts` (re-export)
- `src/studio/db/helpers.ts` (`rowToIntakeQuestion`)
- `src/studio/pm-agent.ts` (Structured Intake section eklendi)
- `src/studio/routes/project-routes.ts` (chat'te Q&A parse + 3 REST endpoint)
- `console/src/lib/studio-api.ts` (types + 3 API fn)
- `console/src/pages/studio/PMChat.tsx` (IntakeQuestionCard component)

### 2. Micro-Task Decomposition (PM + Scrum Master) — ✓ B2 landed

**Akış:** PM plan üretir → SM her task'i micro-task'lara böler → Execution başlar

- **PM (Planner):** Feature-level task'lar üretir ("Auth sistemi kur", "Dashboard ekle")
- **Scrum Master:** Her task'i analiz eder, codebase'e bakarak dosya/fonksiyon bazında micro-task'lara böler
- Her micro-task: 1 dosya veya 1 mantıksal birim (1 fonksiyon, 1 component, 1 endpoint, 1 test dosyası)
- Complexity dağılımı: %70 S, %25 M, %5 L, %0 XL

**Mevcut Implementasyon (B2, commit `0a763d0`):**
- `getAIModelWithFallback` + `generateObject` (ai@6 + Zod) ile structured output
- Scrum Master system prompt: hard rules (≤3 files, S/M only, 2-8 tasks, plausible paths, rationale, TR/EN mirroring)
- Codebase context (`listProjectFiles` + `gatherCodebaseContext` → file tree + target sizes)
- Heuristic fallback (regex-based) korundu — AI unavailable/unusable durumunda
- 15 unit test (`src/studio/__tests__/task-decomposer.test.ts`)

### 3. Sub-task UI rollup (B3 — planlandı)

**Yapılacak:**
- `console/src/pages/studio/KanbanBoard.tsx` — Parent task kartları genişletilebilir
- `console/src/pages/studio/TaskDetailModal.tsx` — Sub-task listesi + `targetFiles`
- `console/src/lib/studio-api.ts` — `getSubTasks()`, `decomposeTask()` fn'leri (backend zaten var)

---

## v3.1 — Yeni Edge Tipleri

**Tema:** Zengin dependency grafi — escalation, conditional routing, fallback stratejileri.

### Yeni Edge Tipleri (mevcut 4 + 8 yeni = 12)

| Tip | Bloklar mı? | DAG etkisi | Açıklama |
|-----|-------------|------------|----------|
| `escalation` | Hayır | Yok | Task N kez fail → üst agent'a yönlendir |
| `pair` | Evet | Aynı wave | İki agent aynı task'ta paralel çalışır |
| `conditional` | Evet | Koşullu | Koşul sağlanırsa aktif (örn: security-sensitive) |
| `fallback` | Hayır | Yok | Birincil fail → alternatif agent |
| `notification` | Hayır | Yok | Non-blocking bilgilendirme |
| `handoff` | Evet | Workflow gibi | Formal devir, dokümantasyon zorunlu |
| `approval` | Evet | Tek task | Tek task için onay (gate tüm phase'i bloklar) |
| `mentoring` | Hayır | Yok | Danışma, non-blocking feedback |

**Dosyalar:**
- `src/studio/types.ts` — `DependencyType` union + `AgentDependencyMetadata`
- `scripts/init.sql` — `agent_dependencies.metadata` kolonu
- `src/studio/pipeline-engine.ts` — `buildDAGWaves()` güncellemeleri
- `src/studio/task-engine.ts` — Edge-type handler'lar (escalation, fallback, notification, handoff)
- `src/studio/execution-engine.ts` — Conditional evaluation, pair execution
- `console/src/pages/studio/TeamBuilder.tsx`, `TeamBuilderPage.tsx`, `TeamTemplatePreview.tsx` — picker + metadata formu

---

## v3.2 — Backlog & Work Items

**Tema:** Herhangi bir agent veya kullanıcı work item oluşturabilir, planner bunları task'a çevirir.

**Dosyalar:**
- `scripts/init.sql` — `work_items` tablosu (type, priority, severity, status, source, source_agent_id, source_task_id, planned_task_id, sprint_id)
- `src/studio/db/work-item-repo.ts` — CRUD
- `src/studio/routes/work-item-routes.ts` — REST API
- `src/studio/pm-agent.ts` — `convertWorkItemToPlan(itemIds)` tool
- `src/studio/task-engine.ts` — Review rejection → bug, Task failure → defect otomatik work item
- `console/src/pages/studio/BacklogBoard.tsx` — Kanban (Open|Planned|In Progress|Done)
- `console/src/pages/studio/ProjectPage.tsx` — Yeni "Backlog" tab

---

## v3.3 — Incremental Planning & Re-planning

**Tema:** Çalışan plana yeni phase/task ekle, bitmemiş işleri yeniden organize et.

**Dosyalar:**
- `src/studio/pm-agent.ts` — `addPhaseToPlan`, `addTaskToPhase`, `replanUnfinishedTasks` tool'ları
- `src/studio/task-engine.ts` — `insertTask(phaseId, taskData)`
- `src/studio/pipeline-engine.ts` — `refreshPipeline(projectId)` (completed stage'leri koru)
- `src/studio/db/task-repo.ts` — `getUnfinishedTasks()`, `moveTaskToPhase()`
- `console/src/pages/studio/PMChat.tsx` — "Re-plan remaining work" butonu
- `console/src/pages/studio/KanbanBoard.tsx` — Phase başına "Add Task" butonu

---

## v3.4 — Context Assembly, Model Routing & Memory Architecture

**Tema:** Token maliyetini %60-80 düşür, kaliteyi koru, akıllı model yönlendirme.

> Bu milestone `.planning/architecture/TOKEN_QUALITY_MEMORY_ARCHITECTURE_PLAN.md` planını içerir.

### 1. Context Assembly Layer (Context Packet)

Mevcut dağınık prompt oluşturma yerine tek bir `Context Packet` katmanı:
- `system core` + `agent profile summary` + `project working summary`
- `active phase/task summary` + `recent conversation window (son 4-6 tur)`
- `compressed RAG` + `acceptance criteria`
- **Kural:** Raw chat history prompt'a gitmeyecek, sadece summary + son N mesaj

**Dosyalar:**
- `src/studio/context-packet.ts` — `buildContextPacket(options)` (Planner, Team Architect, execution-engine ortak kullanır)
- `src/studio/routes/project-routes.ts` — Context assembly standardize
- `src/studio/execution-engine.ts` — `buildTaskPrompt()` context packet üzerinden

### 2. Memory Model (4 Katman)

| Katman | Amaç | Tablo |
|--------|------|-------|
| Raw Memory | Audit, observability | Mevcut (events, chat_messages) |
| Working Memory | Prompt'a giren kısa özet | `project_context_snapshots` |
| Project Facts | Kalıcı, düşük değişim | `memory_facts` |
| Semantic Memory | RAG/embedding retrieval | Mevcut (rag_*) |

**Dosyalar:**
- `scripts/init.sql` — `project_context_snapshots`, `conversation_compactions`, `memory_facts`, `model_routing_policies`
- `src/studio/memory-manager.ts` — Working memory snapshot writer + conversation compaction job
- `src/studio/db/memory-repo.ts` — CRUD

### 3. Model Routing Layer

| Görev tipi | Model tier |
|-----------|------------|
| Classification, intake cleanup, metadata | cheap (Haiku) |
| Planner first pass, standart task'lar | balanced (Sonnet) |
| Complex review, hard repair, high-risk | strong (Opus) |
| Retry after failure | same-tier delta → escalation |

**Dosyalar:**
- `src/studio/types.ts` — `ModelRoutingConfig` + `ModelRoutingPolicy`
- `src/studio/model-router.ts` — `resolveModel(task, context): { provider, model, effort }`
- `src/studio/execution-engine.ts` — Task dispatch öncesi model seçimi
- `src/studio/context-builder.ts` — `targetFiles` ile odaklı context

### 4. Compression & Caching

- Team summary, planner profile, project intake, architecture summary cache'lenir
- RAG: retrieve → summarize → inject (raw chunk değil)
- Review prompt'a sadece changed files + acceptance criteria
- Retry prompt'a sadece delta context (full context tekrar değil)
- Long logs → failure summary olarak verilir

### 5. Cost Intelligence

Yeni metrikler: prompt input tokens by block, compaction savings, cost per successful task, retry cost waste, memory hit rate, RAG usefulness rate

**Dosyalar:**
- `console/src/pages/studio/ProjectSettings.tsx` — Model routing policy UI
- `console/src/pages/studio/AgentDashboard.tsx` — Token block breakdown
- `console/src/lib/studio-api.ts` — Memory ve routing API

**Tahmini tasarruf:** %40-60

---

## v3.5 — Project Lifecycle & Post-Completion

**Tema:** Pipeline bittikten sonra ne olacak? Sürekli iyileştirme döngüsü.

**Dosyalar:**
- `src/studio/types.ts` — `ProjectStatus`: `+ "maintenance" | "archived"`
- `src/studio/lifecycle-manager.ts`:
  - Durumlar: planning → running → review → maintenance → archived
  - `triggerHotfix(projectId, desc)`
  - Post-completion hook'lar: security scan, tech debt analizi → otomatik work item
- `src/studio/pipeline-engine.ts` — `markCompleted()` sonrası lifecycle trigger
- `console/src/pages/studio/ProjectReport.tsx` — Özet rapor
- `console/src/pages/studio/ProjectPage.tsx` — Post-completion panel: View Report, Create Hotfix, Archive, Re-plan

---

## v3.6 — Agent Communication & Ceremonies

**Tema:** Agent-agent mesajlaşma, simüle Scrum seremoni.

**Dosyalar:**
- `src/studio/types.ts` — `MessageType`: `+ "standup" | "retrospective" | "conflict" | "help_request" | "pair_session" | "handoff_doc"`
- `src/studio/ceremony-engine.ts`:
  - `runStandup(projectId)`: Agent başına "ne yaptım, ne yapacağım, blocker" raporu
  - `runRetrospective(projectId)`: Pipeline sonrası dersler
- `src/studio/execution-engine.ts` — Task tamamlanınca downstream agent'lara notification
- `console/src/pages/studio/MessageCenter.tsx` — Thread'ler, filtreler
- `console/src/pages/studio/CeremonyPanel.tsx` — Standup board + retrospective

---

## v3.7 — Governance, Audit & Compliance

**Tema:** Policy engine, maliyet bütçeleri, tam audit trail.

**Dosyalar:**
- `src/studio/policy-engine.ts` — Konfigurasyon bazlı kurallar:
  - "src/auth/* dosyaları için 2 reviewer"
  - "L/XL task'lar onaysız çalışamaz"
  - "Task başına max $X"
- `src/studio/task-engine.ts` — `startTask()` öncesi policy enforcement
- `scripts/init.sql` — `events.actor` kolonu
- `console/src/pages/studio/ProjectSettings.tsx` — Rule builder UI
- `console/src/pages/studio/AgentDashboard.tsx` — Audit timeline + cost burn-down chart

---

## v3.8 — Human Interaction & Agent Chat

**Tema:** Spesifik agent ile sohbet, inline kod yorumu, stakeholder raporu.

**Dosyalar:**
- `src/studio/agent-chat.ts` — `chatWithAgent(projectId, agentId, message)`
- `src/studio/routes/project-routes.ts` — `POST /projects/:id/agents/:agentId/chat`
- `src/studio/report-generator.ts` — `generateStakeholderReport()`
- `console/src/pages/studio/AgentChat.tsx` — Agent-scoped chat UI
- `console/src/pages/studio/DiffViewer.tsx` — Satır bazlı yorum → work item veya agent mesajı

---

## v3.9 — Sprints & Plugin Architecture

**Tema:** Zaman sınırlı iterasyonlar ve genişletilebilirlik.

**Dosyalar:**
- `scripts/init.sql` — `sprints` tablosu + `work_items.sprint_id` FK
- `src/studio/sprint-manager.ts` — `createSprint()`, `startSprint()`, `completeSprint()`, burndown
- `src/studio/plugin-registry.ts` — Plugin interface: `onTaskComplete`, `onPipelineComplete`, `onWorkItemCreated`
- Webhook enhancement: Slack/Discord mesaj formatlama
- `console/src/pages/studio/SprintBoard.tsx` — Sprint planlama, burndown chart, velocity

---

## Milestone Bağımlılıkları

```
v3.0 (Interaktif Planner + Micro-Task) ──┐
                                          ├── v3.3 (Incremental Planning) ── v3.5 (Lifecycle)
v3.1 (Edge Types) ───────────────────────┤
                                          ├── v3.6 (Agent Comms)
v3.2 (Work Items) ───────────────────────┤
                                          ├── v3.9 (Sprints)
v3.4 (Context + Routing + Memory) ───────┤
                                          ├── v3.7 (Governance)
v3.8 (Human Interaction) — bağımsız, v3.0 sonrası başlanabilir
```

- **v3.0 temeldir**, her şey bunun üzerine kurulur
- v3.1 ve v3.2 paralel ilerleyebilir
- v3.4 bağımsız ama v3.0'dan sonra daha etkili (micro-task'ların targetFiles'i context için lazım)
- v3.3, v3.0 (sub-tasks) + v3.2 (work items) gerektirir
- v3.5, v3.2 + v3.3 gerektirir
- v3.7, v3.4 (routing policies, cost intelligence) gerektirir

### Referans Doküman
- `.planning/architecture/TOKEN_QUALITY_MEMORY_ARCHITECTURE_PLAN.md` — Token, Quality, Memory mimarisi (v3.4 için temel kaynak)

---

## Cross-Cutting Concerns

1. `src/studio/types.ts` — Her milestone buraya type ekler (ilk güncellenmeli)
2. `scripts/init.sql` — Her zaman `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` ile backward compat
3. `src/studio/db/index.ts` — Her yeni repo modülü burada register edilmeli
4. `src/studio/routes/index.ts` — Her yeni route burada register edilmeli
5. `console/src/lib/studio-api.ts` (2057 satır) — Bölünmesi düşünülecek (tasks-api, work-items-api, vb.)
6. `console/src/pages/studio/ProjectPage.tsx` — Yeni tab'lar burada eklenir

## Doğrulama

Her milestone sonrası:
1. `pnpm tsc --noEmit` — Backend + Frontend 0 hata
2. Mevcut testler geçmeli (task-engine, agent-dashboard, project-settings)
3. Yeni özellik için en az temel test'ler yazılmalı
4. Mevcut projeler (v2.7) etkilenmemeli — backward compat testi
5. UI'da yeni tab/component'ler görünür ve çalışmalı
