# MY-VOLTAGENT-APP — Master Roadmap v3.0

> **Vizyon**: Production-ready AI Dev Platform — Gerçekten çalışan AI takım platformu
>
> **Mevcut**: v2.1 (58K+ satır kod, 37 sayfa, 20+ DB tablosu, 165 test)
> **Hedef**: v3.0 — Fully Functional + Deployable + Multi-user

---

## Bağımlılık Grafiği

```
M1 (Execution) ──────────┬──────────► M4 (GitHub)
      │                   │                │
      ▼                   ▼                ▼
M2 (RAG/Hafıza)    M3 (Otomasyon)    M5 (Production)
      │                   │                │
      └───────────────────┴────────────────┘
                          │
                          ▼
                    M6 (Launch)
```

---

## M1: Canlı Execution — "Agent'lar gerçekten kod yazıp test eder"

**Bağımlılık**: Yok (mevcut altyapı üzerine)
**Mevcut**: execution-engine.ts, agent-tools.ts, container-manager.ts, pipeline-engine.ts

### M1.1: Execution Engine v2
- Tool-calling ile gerçek dosya yazma
- Agent → AI SDK → code generation → file write
- Context window: proje dosyalarını agent'a ver
- Sandbox: Docker container içinde çalıştır

### M1.2: Pipeline Gerçek Akış
- Plan → approve → assign → execute → review
- Her agent kendi dosyalarını üretsin
- Review agent diff'leri kontrol etsin
- QA agent test yazıp çalıştırsın

### M1.3: Model Fallback Chain
- fallbackOrder DB'de var, execution'a entegre
- Model başarısız → sıradaki modele geç
- Token/cost tracking per model

**Çıktı**: Agent "src/auth.ts oluştur" deyince gerçekten dosya yazılır, test edilir, review yapılır.

---

## M2: Akıllı Hafıza — "Agent'lar projeyi anlasın"

**Bağımlılık**: M1 (execution context için)
**Mevcut**: RAG UI + DB tabloları (rag_knowledge_bases, rag_documents, rag_queries)

### M2.1: Vector DB Entegrasyonu
- ChromaDB veya Qdrant (local, self-hosted)
- Embedding pipeline: upload → chunk → embed
- OpenAI text-embedding-3-small / local model

### M2.2: Codebase Indexing
- Proje dosyalarını otomatik index'le
- Her commit'te incremental re-index
- Agent soru sorduğunda: similarity search

### M2.3: Agent Context Builder
- Her agent çalışmadan önce: RAG → relevant dosyalar → system prompt'a inject
- Prompt versioning + A/B test entegrasyonu
- Token budget management (context window limit)

**Çıktı**: "auth.ts'deki login fonksiyonunu düzelt" → agent otomatik ilgili dosyaları bulur + context alır.

---

## M3: Otomasyon — "Platform kendi kendine hareket etsin"

**Bağımlılık**: M1 (trigger → execution bağlantısı)
**Mevcut**: triggers + trigger_logs + alert_rules + alert_history + webhooks DB tabloları + UI

### M3.1: Trigger Worker
- node-cron: schedule tipi triggerlar
- Webhook listener: incoming HTTP → action
- Event bus hookları: event tipi triggerlar
- Condition evaluator: metrik eşik kontrolü

### M3.2: Alert Monitor
- Background job: her 30s metrik kontrol
- error_rate, latency, token_budget hesapla
- Eşik aşımında → alert_history'ye yaz
- Cooldown: aynı alert spam engeli

### M3.3: Notification Engine
- webhook-sender.ts → gerçek HTTP POST
- Slack integration (incoming webhook)
- Email (Resend/SendGrid)
- Browser push notification (mevcut altyapı var)

**Çıktı**: "Her gece saat 3'te test suite çalıştır, hata oranı >%5 olursa Slack'e bildir."

---

## M4: GitHub Entegrasyonu — "Dış dünyayla bağlantı"

**Bağımlılık**: M1 (kod üretimi) + M3 (webhook)
**Mevcut**: simple-git (local), git-manager.ts

### M4.1: GitHub OAuth + Repo Sync
- GitHub App veya OAuth token
- Remote repo clone → local workspace
- Push/pull sync

### M4.2: PR Automation
- Agent kodu yazınca → branch oluştur → push
- Otomatik PR aç (title, description, diff)
- Review agent → PR comment yaz
- CI check status → pipeline'a feedback

### M4.3: Issue ↔ Task Sync
- GitHub issue → otomatik task oluştur
- Task complete → issue close
- Label/milestone mapping

**Çıktı**: PM "login sayfası yap" der → agent yazar → PR açılır → review olur → merge.

---

## M5: Production — "Gerçek kullanıcılar kullanabilsin"

**Bağımlılık**: M1-M4 (feature-complete platform)

### M5.1: Auth & Multi-tenant
- Clerk veya Lucia auth
- Organization / workspace kavramı
- Role-based access: admin, developer, viewer
- API key management

### M5.2: Deployment Stack
- Docker Compose (backend + frontend + DB)
- PostgreSQL migration (SQLite → PG)
- Redis (session, queue, cache)
- Nginx reverse proxy + SSL
- CI/CD: GitHub Actions

### M5.3: Security & Performance
- Rate limiting (per user, per org)
- Input sanitization audit
- CORS proper config
- WebSocket auth
- DB query optimization + indexing

**Çıktı**: platform.example.com'da canlı, birden fazla takım kullanabiliyor.

---

## M6: Polish & Launch — "Pazar hazır ürün"

### M6.1: Billing & Usage
- Stripe entegrasyonu
- Plan tiers: Free / Pro / Enterprise
- Token usage billing
- Usage dashboard

### M6.2: Public API + SDK
- REST API docs (OpenAPI/Swagger)
- TypeScript SDK: @voltagent/sdk
- Webhook events (outgoing)
- CLI tool: voltagent init / deploy / status

### M6.3: Docs & Marketing
- Docusaurus / Mintlify docs site
- Landing page
- Demo video / interactive playground
- Open source strategy (core OSS + cloud pro)

---

## Scope Özeti

| Milestone | Yeni Modül | Yeni Tablo | Yeni Sayfa/UI | Zorluk |
|-----------|-----------|------------|---------------|--------|
| M1: Execution | 3 | 0 | 2 | Yüksek |
| M2: RAG | 2 | 1 | 1 | Yüksek |
| M3: Otomasyon | 3 | 1 | 2 | Orta |
| M4: GitHub | 2 | 2 | 3 | Orta |
| M5: Production | 4 | 4 | 4 | Yüksek |
| M6: Launch | 3 | 3 | 3 | Orta |
| **Toplam** | **17** | **11** | **15** | — |

---

## Backlog (Mevcut Eksikler — M1 öncesi temizlik)

- [ ] Frontend: cost estimate display (plan approve öncesi)
- [ ] Frontend: approval UI in Kanban (waiting_approval status)
- [ ] Frontend: webhook settings in ProjectSettings
- [ ] Frontend: model fallback config in ProvidersPage
- [ ] Frontend: git revert button in DiffViewer
- [ ] Backend: webhook-sender.ts (DB tablosu var, sender logic yok)
- [ ] Backend: model fallback chain execution (fallbackOrder stored, not used)
- [ ] Test: ProjectSettings.test.tsx 2 pre-existing failure
- [ ] Migration wizard: "Upgrade to v2 team structure" for existing projects
