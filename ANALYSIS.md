# Oscorpex v8.0 — Proje Analiz Raporu

> Tarih: 2026-04-21 | Branch: master (`82fd8e9`) | Analiz: Derinlemesine

---

## 1. Proje Genel Bakis

Oscorpex, kullanicinin bir fikir tanimlamasiyla 12 AI ajandan olusan bir Scrum takiminin yazilim uretmesini saglayan otonom gelistirme platformudur.

| Metrik | Deger |
|--------|-------|
| Backend LOC | 47,058 |
| Frontend LOC | 51,828 |
| **Toplam LOC** | **98,886** |
| Backend Test | 1,087 (5 skip) |
| Frontend Test | 541 |
| **Toplam Test** | **1,628** |
| Route Dosyasi | 32 |
| DB Repo Dosyasi | 38 |
| DB Tablo | 83 |
| Studio Sayfa | 49 |
| API Client Dosyasi | 25 |
| Event Type | 144 |
| Agent Runtime Modul | 7 |

---

## 2. Sistem Mimarisi

```mermaid
graph TB
    subgraph Client["Frontend — React 19 + Vite"]
        UI[49 Studio Sayfa]
        API[25 API Client Modulu]
        WS[WebSocket Hook]
        UI --> API
        UI --> WS
    end

    subgraph Server["Backend — Hono + Node.js"]
        Routes[32 Route Dosyasi]
        EE[Execution Engine]
        PE[Pipeline Engine]
        TE[Task Engine]
        PM[PM Agent]
        AR[Agent Runtime]
        Routes --> EE
        Routes --> PE
        Routes --> TE
        Routes --> PM
        EE --> AR
    end

    subgraph Data["PostgreSQL"]
        DB[(83 Tablo)]
        Repos[38 Repo Modulu]
        Repos --> DB
    end

    subgraph AI["AI Saglayicilar"]
        Claude[Claude CLI]
        Codex[Codex CLI]
        Cursor[Cursor]
    end

    API -->|HTTP /api/studio| Routes
    WS -->|WebSocket| Server
    EE -->|Spawn| AI
    TE --> Repos
    PE --> Repos
    EE --> Repos
```

---

## 3. Task Yasam Dongusu

Bir task'in olusturulmasindan tamamlanmasina kadar gectigi tum asamalar:

```mermaid
stateDiagram-v2
    [*] --> queued: Plan/Injection
    queued --> assigned: claimTask (SKIP LOCKED)
    assigned --> running: executeTask
    running --> done: completeTask
    running --> failed: Hata/Timeout
    running --> revision: Review Rejected

    failed --> queued: Auto-Retry (max 2)
    failed --> [*]: Terminal Failure

    revision --> queued: restartRevision
    queued --> blocked: Protocol Blocker
    blocked --> queued: Blocker Resolved
    queued --> waiting_approval: High Risk
    waiting_approval --> queued: Approved
    waiting_approval --> cancelled: Rejected

    done --> review: Review Dispatch
    review --> done: Approved
    review --> revision: Rejected

    done --> [*]
    cancelled --> [*]
```

---

## 4. Pipeline DAG Akisi

Pipeline Engine, Kahn algoritmasi ile fazlari wave'ler halinde calistirir:

```mermaid
flowchart LR
    subgraph Plan["PM Agent Plan Uretir"]
        P1[Faz 1: Altyapi]
        P2[Faz 2: Backend]
        P3[Faz 3: Frontend]
        P4[Faz 4: Test + Deploy]
    end

    subgraph Exec["Pipeline Engine"]
        Wave1[Wave 1: Bagimsiz Task'lar]
        Wave2[Wave 2: Bagimli Task'lar]
        Review[Review Gate]
        Verify[Verification Gate]
        Test[Test Gate]
    end

    subgraph Gates["Kontrol Noktalari"]
        Budget[Budget Guard]
        Sandbox[Sandbox Enforcement]
        Replan[Adaptive Replanner]
        Goal[Goal Validation]
    end

    P1 --> Wave1
    Wave1 --> Wave2
    Wave2 --> Verify
    Verify --> Test
    Test --> Review
    Review -->|Approved| P2
    Review -->|Rejected| Wave2

    Wave2 -.-> Budget
    Wave2 -.-> Sandbox
    P2 -.-> Replan
    Test -.-> Goal
```

---

## 5. Agentic Runtime Katmani

Her task calistirilirken ajan runtime'i su adimlari izler:

```mermaid
sequenceDiagram
    participant EE as Execution Engine
    participant Session as Agent Session
    participant Strategy as Strategy Selector
    participant Memory as Behavioral Memory
    participant Protocol as Inter-Agent Protocol
    participant CLI as CLI Adapter
    participant Verify as Verification

    EE->>Session: initSession()
    Session->>Strategy: selectStrategy(role, task)
    Strategy-->>Session: scaffold_then_refine (0.85 confidence)
    Session->>Memory: loadBehavioralContext()
    Memory-->>Session: 3 episode + 2 failure lesson
    Session->>Protocol: loadProtocolContext()
    Protocol-->>Session: hasBlockers=false

    EE->>CLI: execute(prompt + strategy + memory)
    Note over CLI: Claude/Codex/Cursor
    CLI-->>EE: filesCreated, filesModified

    EE->>Session: recordStep(action_executed)
    EE->>Session: recordStep(result_inspected)
    EE->>Verify: verifyTaskOutput()
    EE->>Session: recordStep(decision_made)
    Verify-->>EE: allPassed=true

    EE->>Session: completeSession()
    Session->>Memory: recordEpisode(success)
    Session->>Strategy: updateStrategyPattern()
```

---

## 6. Sandbox ve Izolasyon Modeli

```mermaid
flowchart TB
    subgraph Policy["Sandbox Policy Resolution"]
        TP[resolveTaskPolicy]
        TP --> Mode{Enforcement Mode?}
    end

    Mode -->|hard| PreGate[Pre-Execution Gate]
    Mode -->|soft| Warn[Log Warning]
    Mode -->|off| Skip[Bypass]

    PreGate --> ToolCheck{Denied Tools?}
    ToolCheck -->|Yes| Fail[SandboxViolationError]
    ToolCheck -->|No| Workspace

    subgraph Workspace["resolveWorkspace()"]
        WS{Isolation Level?}
        WS -->|none| Local[Source Repo Direct]
        WS -->|workspace| Isolated[File-Copy tmpdir]
        WS -->|container| Docker[Container Pool]
    end

    Workspace --> CLI[CLI Execution]
    CLI --> PostCheck[Post-Execution Checks]
    PostCheck --> PathCheck[Path Traversal Check]
    PostCheck --> SizeCheck[Output Size Check]

    Isolated --> WriteBack[writeBack - declared files only]
    Docker --> WriteBack
    WriteBack --> Source[Source Repo]
```

---

## 7. Dosya Buyukluk Analizi

En buyuk 10 dosya (karmasiklik riski):

| Dosya | LOC | Risk |
|-------|-----|------|
| execution-engine.ts | 1,944 | Yuksek — ana orkestrasyon |
| cli-usage.ts | 1,657 | Orta — OAuth/quota probe |
| task-engine.ts | 1,293 | Yuksek — task lifecycle |
| routes/project-routes.ts | 1,290 | Orta — REST endpoint yiginmasi |
| pipeline-engine.ts | 1,097 | Yuksek — DAG orkestrasyon |
| pm-agent.ts | 1,048 | Orta — AI planlama |
| app-runner.ts | 969 | Dusuk — uygulama baslatma |
| types.ts | 888 | Dusuk — tip tanimlari |
| runtime-analyzer.ts | 856 | Dusuk — framework detection |
| cli-runtime.ts | 762 | Orta — CLI process spawn |

---

## 8. Kod Kalitesi Metrikleri

| Metrik | Deger | Degerlendirme |
|--------|-------|---------------|
| `as any` kullanimi | 95 | Orta — cogu DB row mapping |
| `console.warn` (production) | 109 | Kabul edilebilir — non-blocking hata izleme |
| TODO/FIXME/HACK | 1 | Cok iyi |
| SQL Injection riski | 0 | Temiz — tum sorgular $1 parametrik |
| TypeCheck | Temiz | Hata yok |
| Biome Lint | Yapilandirilmis | Tab, 120 char |
| Test Coverage | 1,628 test | Guclu |

---

## 9. Guvenlik Degerlendirmesi

```mermaid
flowchart LR
    subgraph Good["Guvenli"]
        SQL[Parametrik SQL ✓]
        RLS[Row-Level Security ✓]
        Sandbox[Sandbox Enforcement ✓]
        Budget[Cost Circuit Breaker ✓]
        Path[Path Traversal Check ✓]
        Claim[SKIP LOCKED Dispatch ✓]
    end

    subgraph Watch["Izlenmeli"]
        Any[95 as any cast]
        Catch[Silent catch blocks]
        Net[Network Policy - container only]
        Auth[Auth opt-in mode]
    end
```

| Alan | Durum | Detay |
|------|-------|-------|
| SQL Injection | Guvenli | Tum sorgular parametrik ($1, $2...) |
| XSS | Guvenli | React DOM escaping |
| Task Dispatch Race | Guvenli | SELECT FOR UPDATE SKIP LOCKED |
| Path Traversal | Guvenli | isSafeRelativePath + writeBack filter |
| Budget Overflow | Guvenli | enforceBudgetGuard auto-pause |
| Provider Exhaustion | Guvenli | Graceful deferred mode |
| Tenant Isolation | Guvenli | RLS 14+ tablo |
| Network Isolation | Kismi | Container mode'da var, host mode'da yok |
| Auth | Opsiyonel | OSCORPEX_AUTH_ENABLED env ile |

---

## 10. Veritabani Semalari — Temel Tablolar

```mermaid
erDiagram
    projects ||--o{ project_plans : has
    project_plans ||--o{ phases : contains
    phases ||--o{ tasks : contains
    projects ||--o{ project_agents : has
    tasks ||--o{ events : generates
    tasks ||--o{ agent_episodes : records
    projects ||--o{ task_proposals : receives
    projects ||--o{ graph_mutations : tracks
    projects ||--o{ replan_events : triggers
    projects ||--o{ execution_goals : defines

    projects {
        text id PK
        text name
        text status
        text repo_path
        text tenant_id
    }
    tasks {
        text id PK
        text phase_id FK
        text title
        text status
        text assigned_agent
        text complexity
        text risk_level
        text review_task_id
        int retry_count
    }
    agent_episodes {
        text id PK
        text agent_id
        text strategy
        text outcome
        float quality_score
    }
    task_proposals {
        text id PK
        text status
        text created_task_id
        text phase_id
    }
```

---

## 11. Multi-Provider Execution

```mermaid
flowchart TB
    EE[Execution Engine] --> Chain{Adapter Chain}

    Chain --> C1[Claude Code — Primary]
    Chain --> C2[Codex — Fallback 1]
    Chain --> C3[Cursor — Fallback 2]

    C1 -->|Success| Done[Task Complete]
    C1 -->|Rate Limit| Cool1[Cooldown]
    Cool1 --> C2
    C2 -->|Success| Done
    C2 -->|Failure| C3
    C3 -->|Success| Done
    C3 -->|All Exhausted| Defer[Deferred + Retry Timer]

    subgraph Provider["Provider State Manager"]
        PS[markSuccess / markRateLimited / markFailure]
        PS --> Available{isAvailable?}
        PS --> Recovery[getEarliestRecoveryMs]
    end

    C1 -.-> PS
    C2 -.-> PS
    C3 -.-> PS
```

---

## 12. Cross-Project Learning Dongusu

```mermaid
flowchart LR
    Task[Task Tamamlandi] --> Episode[recordEpisode]
    Episode --> Count{>=5 yeni episode?}
    Count -->|Hayir| Stop[Bekle]
    Count -->|Evet| Extract[extractPatternsFromEpisodes]
    Extract --> Pattern[Learning Pattern]
    Pattern --> Promote{>=10 sample + >=70% basari?}
    Promote -->|Evet| Global[Global Pattern]
    Promote -->|Hayir| Local[Tenant-Local]

    Global --> Strategy[selectStrategy — 0.8x confidence]
    Local --> Strategy
    Strategy --> NextTask[Sonraki Task]
```

---

## 13. Iyilestirme Onerileri

### Yuksek Oncelik
| # | Oneri | Etki |
|---|-------|------|
| 1 | **execution-engine.ts bolunmeli** (1,944 LOC) | Orkestrasyon, retry, review, proposal isleme ayri dosyalara |
| 2 | **`as any` azaltma** (95 adet) | Tip guvenligi — ozellikle DB row mapping icin generic helper |
| 3 | **Structured logging** | console.warn yerine pino/winston — severity, correlation ID |

### Orta Oncelik
| # | Oneri | Etki |
|---|-------|------|
| 4 | project-routes.ts bolunmeli (1,290 LOC) | Execution, pipeline, git, settings ayri route dosyalari |
| 5 | Container pool execution-engine entegrasyonu | resolveWorkspace container branch'i gercek Docker kullansin |
| 6 | Frontend test coverage artirmali | 541 test var ama 49 sayfa icin daha fazla integration test |

### Dusuk Oncelik
| # | Oneri | Etki |
|---|-------|------|
| 7 | cli-usage.ts basitlestirme | 1,657 LOC OAuth probe — kullanilmayan provider'lar cikarilabilir |
| 8 | Event type gruplama | 144 event type tek union'da — namespace'e bolunebilir |
| 9 | OpenAPI spec olusturma | 32 route dosyasi icin swagger/scalar dokumantasyonu |

---

## 14. Sonuc

Oscorpex, **~99K LOC** ve **1,628 test** ile olgun bir AI gelistirme platformudur. v8.0 ile agentic yetenekler (strateji secimi, episodik hafiza, cross-project ogrenme), guvenlik katmani (sandbox enforcement, budget guard, RLS) ve operasyonel kontrol (adaptive replanner, pipeline gate) production-ready seviyeye ulasmistir.

**Guclu Yanlar**: Parametrik SQL, claim-based dispatch, multi-provider fallback, 6 asamali task lifecycle, comprehensive test suite.

**Gelisim Alanlari**: Buyuk dosya bolumleme (execution-engine, project-routes), structured logging, container isolation tam entegrasyonu.
