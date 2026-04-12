# Oscorpex — Mermaid Mimari Diyagramlari

## 1. Genel Sistem Mimarisi

```mermaid
graph TB
    subgraph Browser["Browser (localhost:5173)"]
        UI[React 19 + Vite 8 + Tailwind]
    end

    subgraph Frontend["Frontend (console/)"]
        Home[StudioHomePage]
        Project[ProjectPage]
        PMChat[PMChat]
        Plan[PlanPreview]
        Agents[AgentGrid + OrgChart]
        Kanban[KanbanBoard]
        Pipeline[PipelineDashboard]
        Files[FileExplorer]
        Preview[LivePreview]
        Runtime[RuntimePanel]
        Terminal[AgentTerminal]
        Events[EventFeed]
        Messages[MessageCenter]
        API_Explorer[ApiExplorer]
        Settings[ProjectSettings]
        Providers[ProvidersPage]

        Home --> Project
        Project --> PMChat
        Project --> Plan
        Project --> Agents
        Project --> Kanban
        Project --> Pipeline
        Project --> Files
        Project --> Preview
        Project --> Runtime
        Project --> Terminal
        Project --> Events
        Project --> Messages
        Project --> API_Explorer
        Project --> Settings
        Project --> Providers
    end

    subgraph Backend["Backend - Hono (localhost:3141)"]
        Routes[routes.ts - 100+ endpoint]
        Middleware[policy-middleware.ts]

        subgraph BusinessLogic["Is Mantigi"]
            ExecEngine[execution-engine.ts]
            PipelineEngine[pipeline-engine.ts]
            TaskEngine[task-engine.ts]
        end

        subgraph Security["Guvenlik Katmani"]
            CapResolver[capability-resolver.ts]
            SecretVault[secret-vault.ts]
            CmdPolicy[command-policy.ts]
        end

        subgraph AgentSystem["Ajan Sistemi"]
            PMAgent[pm-agent.ts]
            AgentRuntime[agent-runtime.ts]
            AgentMsg[agent-messaging.ts]
            AgentFiles[agent-files.ts]
            AgentLogs[agent-log-store.ts]
        end

        subgraph Infra["Altyapi"]
            DB_Module[db.ts - 17 tablo]
            EventBus[event-bus.ts]
            GitMgr[git-manager.ts]
            Webhook[webhook-sender.ts]
            AIFactory[ai-provider-factory.ts]
            WS[ws-manager.ts]
            MemBridge[memory-bridge.ts]
        end

        subgraph RuntimeSys["Runtime Sistemi"]
            Analyzer[runtime-analyzer.ts]
            Provisioner[db-provisioner.ts]
            AppRunner[app-runner.ts]
        end

        subgraph CLI["CLI Katmani"]
            Adapter[cli-adapter.ts]
            CLIRuntime[cli-runtime.ts]
            GitHub[github-integration.ts]
        end

        Routes --> Middleware
        Middleware --> BusinessLogic
        ExecEngine --> Adapter
        Adapter --> CLIRuntime
        ExecEngine --> Security
        PipelineEngine --> GitHub
        TaskEngine --> DB_Module
        ExecEngine --> EventBus
    end

    subgraph Database["PostgreSQL (localhost:5432)"]
        PG[(17 Tablo)]
    end

    subgraph External["Dis Servisler"]
        Claude[Claude CLI]
        GitHubAPI[GitHub API]
        Webhooks[Webhook Endpoints]
    end

    UI --> Frontend
    Frontend -->|REST + SSE + WS| Routes
    DB_Module --> PG
    CLIRuntime --> Claude
    GitHub --> GitHubAPI
    Webhook --> Webhooks
```

---

## 2. Yurutme Akisi (Execution Flow)

```mermaid
flowchart TD
    A[Kullanici PM Chat'e mesaj yazar] --> B[PM Agent plan olusturur]
    B --> C{Plan onaylandi mi?}
    C -->|Hayir| B
    C -->|Evet| D[Execution Engine baslatilir]
    D --> E[Pipeline Engine DAG stage'leri olusturur]
    E --> F[Stage 1: PM + Architect]

    F --> G[Stage 2: Frontend + Backend Dev]
    G --> H[CLI Adapter secilir]
    H --> I[Claude CLI ile gorev yurutulur]
    I --> J[Token usage kaydedilir]
    I --> K[Dosya degisiklikleri commit edilir]

    G --> L[Stage 3: QA + Reviewer]
    L --> M{Review sonucu?}
    M -->|Approved| N[Stage 4: DevOps]
    M -->|Rejected| O[Revision Loop]
    O --> G

    N --> P[Pipeline tamamlandi]
    P --> Q{Auto PR aktif mi?}
    Q -->|Evet| R[GitHub PR olusturulur]
    Q -->|Hayir| S[Bitis]
    R --> S

    style A fill:#e1f5fe
    style S fill:#c8e6c9
    style O fill:#fff3e0
    style R fill:#f3e5f5
```

---

## 3. Ajan Hiyerarsisi (Org Chart)

```mermaid
graph TD
    PM[Product Owner<br/>pm]
    SM[Scrum Master<br/>scrum-master]
    DL[Design Lead<br/>design-lead]
    ARCH[Architect<br/>architect]
    FE[Frontend Dev<br/>frontend-dev]
    BE[Backend Dev<br/>backend-dev]
    CODER[Coder<br/>coder]
    DEVOPS[DevOps<br/>devops]
    FQA[Frontend QA<br/>frontend-qa]
    BQA[Backend QA<br/>backend-qa]
    FR[Frontend Reviewer<br/>frontend-reviewer]
    BR[Backend Reviewer<br/>backend-reviewer]
    SR[Security Reviewer<br/>security-reviewer]
    DW[Docs Writer<br/>docs-writer]

    PM --> SM
    PM --> DL
    SM --> ARCH
    SM --> FE
    SM --> BE
    SM --> CODER
    SM --> DEVOPS
    FE --> FQA
    BE --> BQA
    FQA --> FR
    BQA --> BR
    FR --> SR
    BR --> SR
    SR --> DW

    style PM fill:#ff9800,color:#fff
    style SM fill:#2196f3,color:#fff
    style DL fill:#9c27b0,color:#fff
    style ARCH fill:#607d8b,color:#fff
    style FE fill:#4caf50,color:#fff
    style BE fill:#4caf50,color:#fff
    style CODER fill:#4caf50,color:#fff
    style DEVOPS fill:#795548,color:#fff
    style FQA fill:#ff5722,color:#fff
    style BQA fill:#ff5722,color:#fff
    style FR fill:#3f51b5,color:#fff
    style BR fill:#3f51b5,color:#fff
    style SR fill:#f44336,color:#fff
    style DW fill:#009688,color:#fff
```

---

## 4. DAG Pipeline Akisi

```mermaid
flowchart LR
    subgraph S1["Stage 1"]
        PM_T[PM Gorevleri]
        ARCH_T[Architect Gorevleri]
    end

    subgraph S2["Stage 2"]
        FE_T[Frontend Gorevleri]
        BE_T[Backend Gorevleri]
        CODER_T[Coder Gorevleri]
    end

    subgraph S3["Stage 3"]
        QA_T[QA Test Gorevleri]
        REV_T[Review Gorevleri]
    end

    subgraph S4["Stage 4"]
        DEVOPS_T[DevOps Deploy]
        DOCS_T[Docs Yazimi]
    end

    S1 --> S2
    S2 --> S3
    S3 -->|approved| S4
    S3 -->|rejected| S2

    style S1 fill:#e3f2fd
    style S2 fill:#e8f5e9
    style S3 fill:#fff3e0
    style S4 fill:#f3e5f5
```

---

## 5. Guvenlik Katmani

```mermaid
flowchart TD
    REQ[API Request] --> BG{budgetGuard}
    BG -->|Budget asimi| R403[403 Forbidden]
    BG -->|OK| CG[capabilityGuard]
    CG --> EE[Execution Engine]

    EE --> RESOLVE[resolveAllowedTools]
    RESOLVE --> DB_CAP[(agent_capabilities)]
    RESOLVE --> ROLE_DEFAULT[Rol Varsayilanlari]

    EE --> POLICY[buildPolicyPromptSection]
    POLICY --> PROMPT[Prompt'a enjekte]

    EE --> VAULT[secret-vault.ts]
    VAULT --> ENCRYPT[AES-256-GCM]
    ENCRYPT --> DB_PROV[(ai_providers.api_key)]

    EE --> CLI_EXEC[CLI Calistirma<br/>kisitli tool seti ile]

    subgraph RolAraclari["Rol -> Izinli Araclar"]
        DEV_TOOLS["dev: Read, Edit, Write, Bash, Glob, Grep"]
        REV_TOOLS["reviewer: Read, Glob, Grep"]
        QA_TOOLS["qa: Read, Bash, Glob, Grep"]
        OBS_TOOLS["observer: Read, Glob, Grep"]
        DOC_TOOLS["docs: Read, Edit, Write, Glob, Grep"]
    end

    ROLE_DEFAULT --> RolAraclari

    style R403 fill:#f44336,color:#fff
    style ENCRYPT fill:#ff9800,color:#fff
    style CLI_EXEC fill:#4caf50,color:#fff
```

---

## 6. Veritabani Iliskileri (ER Diyagrami)

```mermaid
erDiagram
    projects ||--o{ project_plans : "has"
    projects ||--o{ project_agents : "has"
    projects ||--o{ events : "has"
    projects ||--o{ chat_messages : "has"
    projects ||--o{ pipeline_runs : "has"
    projects ||--o{ project_settings : "has"
    projects ||--o{ token_usage : "has"

    project_plans ||--o{ phases : "contains"
    phases ||--o{ tasks : "contains"

    project_agents ||--o{ agent_dependencies : "from"
    project_agents ||--o{ agent_dependencies : "to"
    project_agents ||--o{ agent_capabilities : "has"
    project_agents ||--o{ agent_messages : "sends"
    project_agents ||--o{ agent_runs : "executes"

    agent_configs ||--o{ project_agents : "source"

    projects {
        string id PK
        string name
        string status
        string tech_stack
        string repo_path
    }

    project_plans {
        string id PK
        string project_id FK
        int version
        string status
    }

    phases {
        string id PK
        string plan_id FK
        string name
        int order
        string status
    }

    tasks {
        string id PK
        string phase_id FK
        string title
        string status
        string assigned_agent
        string complexity
        string review_status
        string approval_status
    }

    project_agents {
        string id PK
        string project_id FK
        string role
        string model
        string cli_tool
        string reports_to
        int pipeline_order
    }

    agent_capabilities {
        string id PK
        string agent_id FK
        string scope_type
        string pattern
        string permission
    }

    token_usage {
        string id PK
        string project_id FK
        string task_id
        string agent_id
        string model
        int input_tokens
        int output_tokens
        float cost_usd
        int cache_creation_tokens
        int cache_read_tokens
    }

    ai_providers {
        string id PK
        string type
        string api_key
        string model
        int fallback_order
    }

    pipeline_runs {
        string id PK
        string project_id FK
        string status
        int current_stage
        string stages_json
    }
```

---

## 7. Runtime Sistemi

```mermaid
flowchart TD
    START[Uygulama Baslatma Istegi] --> RA[Runtime Analyzer]

    RA --> SCAN[Proje Dizini Tarama]
    SCAN --> FW[Framework Tespit<br/>15+ framework]
    SCAN --> PORT[Port Tespit<br/>.env -> source -> default]
    SCAN --> DB_DET[DB Tespit<br/>docker-compose parse]

    RA --> CONFIG[.studio.json olustur]
    CONFIG --> PROV{DB gerekli mi?}

    PROV -->|Evet| DBP[DB Provisioner]
    DBP --> DOCKER[Docker Container Baslat]
    DOCKER --> PORT_CHECK{Port musait mi?}
    PORT_CHECK -->|Hayir| PORT_INC[Port artir<br/>5432 -> 5433]
    PORT_INC --> PORT_CHECK
    PORT_CHECK -->|Evet| HEALTH[Health Check]

    PROV -->|Hayir| AR[App Runner]
    HEALTH --> AR

    AR --> S1{.studio.json var mi?}
    S1 -->|Evet| RUN1[Config'e gore baslat]
    S1 -->|Hayir| S2{Runtime analiz?}
    S2 -->|Evet| RUN2[Otomatik komut belirle]
    S2 -->|Hayir| S3{docker-compose.yml?}
    S3 -->|Evet| RUN3[Docker Compose baslat]
    S3 -->|Hayir| FAIL[Hata: Baslatma yapisi bulunamadi]

    RUN1 --> VERIFY[postStartHealthCheck]
    RUN2 --> VERIFY
    RUN3 --> VERIFY

    style START fill:#e1f5fe
    style VERIFY fill:#c8e6c9
    style FAIL fill:#ffcdd2
```

---

## 8. Veri Akisi

```mermaid
sequenceDiagram
    actor User as Kullanici
    participant Chat as PM Chat
    participant DB as PostgreSQL
    participant Exec as Execution Engine
    participant Pipe as Pipeline Engine
    participant CLI as Claude CLI
    participant GH as GitHub

    User->>Chat: Proje talimatini yazar
    Chat->>DB: chat_messages INSERT
    Chat->>Exec: Plan olustur
    Exec->>DB: project_plans + phases + tasks INSERT

    User->>Exec: Plan onayla
    Exec->>Pipe: Pipeline baslat
    Pipe->>DB: pipeline_runs INSERT

    loop Her Stage
        Pipe->>Exec: Stage gorevlerini dagit
        Exec->>DB: tasks.status = assigned

        par Paralel Gorevler
            Exec->>CLI: executeWithCLI(prompt, tools)
            CLI-->>Exec: result + token usage
            Exec->>DB: agent_runs INSERT
            Exec->>DB: token_usage INSERT
            Exec->>DB: tasks.status = completed
            Exec->>DB: events INSERT (task:completed)
        end

        alt Review gerekli
            Exec->>CLI: Review task calistir
            CLI-->>Exec: review sonucu

            alt Rejected
                Exec->>DB: tasks.review_status = rejected
                Exec->>Exec: Revision loop
            else Approved
                Exec->>DB: tasks.review_status = approved
            end
        end
    end

    Pipe->>DB: pipeline_runs.status = completed
    Pipe->>DB: events INSERT (pipeline:completed)

    opt Auto PR aktif
        Pipe->>GH: createPR()
        GH-->>Pipe: PR URL
        Pipe->>DB: events INSERT (git:pr-created)
    end
```

---

## 9. Multi-CLI Adapter Pattern

```mermaid
classDiagram
    class CLIAdapter {
        <<interface>>
        +name: string
        +isAvailable() Promise~boolean~
        +execute(opts: CLIAdapterOptions) Promise~CLIExecutionResult~
    }

    class ClaudeAdapter {
        +name: "claude-code"
        +isAvailable() Promise~boolean~
        +execute(opts) Promise~CLIExecutionResult~
    }

    class CodexAdapter {
        +name: "codex"
        +isAvailable() Promise~boolean~
        +execute(opts) Promise~CLIExecutionResult~
    }

    class AiderAdapter {
        +name: "aider"
        +isAvailable() Promise~boolean~
        +execute(opts) Promise~CLIExecutionResult~
    }

    class CLIAdapterOptions {
        +prompt: string
        +workDir: string
        +allowedTools: string[]
        +systemPrompt: string
        +model: string
        +taskTimeout: number
    }

    class CLIExecutionResult {
        +output: string
        +exitCode: number
        +filesCreated: string[]
        +filesModified: string[]
        +inputTokens: number
        +outputTokens: number
        +cacheCreationTokens: number
        +cacheReadTokens: number
    }

    CLIAdapter <|.. ClaudeAdapter
    CLIAdapter <|.. CodexAdapter
    CLIAdapter <|.. AiderAdapter
    ClaudeAdapter ..> CLIAdapterOptions
    ClaudeAdapter ..> CLIExecutionResult
```

---

## 10. Teknoloji Yigini

```mermaid
block-beta
    columns 3

    block:frontend["Frontend"]:3
        React["React 19"]
        Vite["Vite 8"]
        Tailwind["Tailwind 4"]
        XTerm["xterm.js 6"]
        ReactFlow["React Flow"]
    end

    block:backend["Backend"]:3
        Node["Node.js"]
        Hono["Hono"]
        TSX["tsx"]
    end

    block:data["Veri Katmani"]:3
        PG["PostgreSQL"]
        SimpleGit["simple-git"]
        Octokit["@octokit/rest"]
    end

    block:ai["AI Katmani"]:3
        ClaudeCLI["Claude CLI"]
        CLIAdapt["CLI Adapter"]
        TokenTrack["Token Tracking"]
    end

    block:security["Guvenlik"]:3
        AES["AES-256-GCM"]
        RBAC["Role-Based Access"]
        BudgetG["Budget Guard"]
    end

    block:test["Test"]:3
        Vitest["Vitest"]
        Tests["374+ test"]
    end
```
