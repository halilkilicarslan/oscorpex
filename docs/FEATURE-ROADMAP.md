# AI Dev Studio — Feature Roadmap Raporu

**Tarih:** 2026-04-08
**Hazırlayan:** AI Dev Studio Ekibi
**Durum:** Onay Bekliyor

---

## 1. Mevcut Durum

AI Dev Studio şu an aşağıdaki temel özelliklere sahip:

- PM Agent ile doğal dil üzerinden proje planlama
- Çoklu AI agent takımı (architect, frontend, backend, qa, reviewer, devops)
- Pipeline bazlı otomatik execution (phase → task → agent)
- Docker container veya local AI SDK ile task execution
- Integration test ve Run App pipeline stage'leri
- Git yönetimi (branch, commit, merge)
- Agent arası mesajlaşma sistemi
- WebSocket ile real-time event stream
- Dashboard analytics (agent performans, task istatistikleri)
- Çoklu AI provider desteği (OpenAI, Anthropic, Google, Ollama)
- UI üzerinden proje yönetimi, kanban board, pipeline view

### Bilinen Sorunlar

- AI agent'ların ürettiği kod kalitesi tutarsız — agent'lar birbirinin yazdığı koddan habersiz
- Token/maliyet takibi yok — ne kadar harcandığı bilinmiyor
- Statik analiz yok — üretilen kodun kalitesi objektif ölçülemiyor
- Agent hata yaptığında feedback loop yok — aynı hatayı tekrarlayabiliyor
- Sadece yeni proje oluşturulabiliyor — var olan projeye feature eklenemiyor
- **Proje docs dosyaları boş kalıyor** — Proje oluşturulunca `docs/` altında 7 dosya scaffold ediliyor (PROJECT.md, ARCHITECTURE.md, CODING_STANDARDS.md, API_CONTRACT.md, CHANGELOG.md, DECISIONS.md, PLAN.md) ancak sadece PLAN.md PM agent tarafından dolduruluyor, diğer 6 dosya "TBD" olarak kalıyor. Agent'lar bu dosyaları hiç güncellemiyorlar.

---

## 2. Planlanan Özellikler

### 2.1 Token & Maliyet Takibi

| Özellik | Açıklama | Öncelik |
|---------|----------|---------|
| Agent bazlı token kullanımı | Her task'ta input/output token sayısı, model bilgisi ve maliyet ($) kaydı | Yüksek |
| Proje bazlı toplam maliyet | Dashboard'da "bu proje şu ana kadar $X harcadı" gösterimi | Yüksek |
| Maliyet tahmini | Plan onaylanmadan önce "bu plan tahmini $X tutacak" uyarısı | Orta |
| Budget limiti | Proje veya agent bazında token/maliyet limiti, aşılınca execution durdurma | Orta |
| Model routing | Basit task'lar için ucuz model (haiku), karmaşık task'lar için güçlü model (opus) otomatik seçim | Düşük |
| Cost anomaly detection | "Bu task normalden 10x fazla token harcadı" uyarısı | Düşük |

### 2.2 Code Quality & Static Analysis

| Özellik | Açıklama | Öncelik |
|---------|----------|---------|
| SonarQube entegrasyonu | Her phase/task bitiminde otomatik scan, quality gate pass/fail | Yüksek |
| ESLint/Prettier enforcement | Agent'ın yazdığı koda otomatik linting uygulanması | Yüksek |
| Code coverage tracking | Agent'ın yazdığı testlerin coverage oranı, eşik altında uyarı | Orta |
| Technical debt skoru | SonarQube'dan gelen debt metriğini dashboard'da gösterme | Orta |
| Security scan (OWASP) | Code generation sonrası otomatik vulnerability tarama | Orta |
| Dependency audit | Agent'ın eklediği paketlerin güvenlik kontrolü | Düşük |

### 2.3 Agent Intelligence & Kalite

| Özellik | Açıklama | Öncelik |
|---------|----------|---------|
| Code context sharing | Bir agent yazınca diğer agent'lar o dosyaları görsün, tutarlı kod üretsin | Yüksek |
| Self-healing (error-fix loop) | Build/test fail olunca error mesajını prompt'a ekleyip agent'a tekrar gönderme | Yüksek |
| Review loop | Coder yazdı → reviewer inceledi → feedback → coder düzeltti (otomatik döngü) | Yüksek |
| Agent memory (RAG) | Bir projede yaptığı hatayı hatırlayıp sonraki projede tekrarlamaması | Orta |
| Pair programming mode | İki agent aynı dosya üzerinde tartışarak çalışması | Düşük |
| Agent specialization | Deneyim bazlı skill scoring — "bu agent React 19'da çok iyi" | Düşük |

### 2.4 Kullanıcı Deneyimi & UI

| Özellik | Açıklama | Öncelik |
|---------|----------|---------|
| Live terminal stream | Agent'ın çalışma çıktısını real-time WebSocket ile UI'da gösterme | Yüksek |
| Diff viewer | Agent'ın yaptığı değişiklikleri git diff olarak gösterme, onay isteme | Yüksek |
| Embedded live preview | Studio içinde iframe ile çalışan uygulamayı önizleme | Orta |
| Visual pipeline editor | Drag & drop ile phase/task sıralaması, bağımlılık çizgileri | Orta |
| Doğal dil ile yönetim | "Backend agent'ı durdur", "phase 2'yi atla" gibi chat komutları | Düşük |
| Execution replay | Pipeline'ı adım adım geri sarıp ne olduğunu izleme | Düşük |

### 2.5 Testing Derinliği

| Özellik | Açıklama | Öncelik |
|---------|----------|---------|
| E2E test generation | Playwright ile otomatik E2E test yazdırma | Orta |
| Visual regression | Screenshot karşılaştırma, UI değişikliklerini yakalama | Düşük |
| Load testing | Basit smoke test — "API 100 request'e dayanıyor mu?" | Düşük |
| Contract testing | Backend API değişince frontend'in kırılıp kırılmadığını kontrol | Düşük |

### 2.6 DevOps & Infrastructure

| Özellik | Açıklama | Öncelik |
|---------|----------|---------|
| One-click deploy | Biten projeyi Vercel/Railway'e tek tıkla deploy | Orta |
| Docker image build | Proje bitince production-ready Docker image oluşturma | Orta |
| CI/CD entegrasyonu | GitHub Actions ile pipeline tetikleme | Düşük |
| Environment management | Dev/staging/prod ortam yönetimi | Düşük |
| Secret management | API key'leri güvenli saklama, agent'lara inject etme | Düşük |

### 2.7 Otomatik Dokümantasyon

Proje oluşturulunca `docs/` altında 7 dosya scaffold ediliyor ama sadece PLAN.md dolduruluyor.
Diğer 6 dosya pipeline execution sırasında ilgili agent'lar tarafından otomatik doldurulmalı.

| Dosya | Dolduracak Agent | Tetiklenme Zamanı | Öncelik |
|-------|-----------------|-------------------|---------|
| PROJECT.md | PM Agent | Plan onaylandığında — proje özeti, gereksinimler, tech stack, hedefler | Yüksek |
| ARCHITECTURE.md | Architect Agent | Foundation phase'i tamamlandığında — klasör yapısı, bileşen diyagramı, veri akışı | Yüksek |
| API_CONTRACT.md | Backend Agent | Backend API task'ları tamamlandığında — endpoint listesi, request/response örnekleri | Yüksek |
| CODING_STANDARDS.md | Reviewer Agent | İlk review task'ı tamamlandığında — kullanılan linter kuralları, naming convention, dosya yapısı | Orta |
| CHANGELOG.md | Otomatik (her phase bitiminde) | Her phase tamamlandığında — yapılan değişikliklerin özeti, tarih, agent bilgisi | Orta |
| DECISIONS.md | Architect + PM Agent | Önemli teknik kararlar verildiğinde — tarih, karar, gerekçe, karar veren agent | Orta |
| PLAN.md | PM Agent | Zaten çalışıyor (mevcut) | - |

**Ek öneriler:**
| Özellik | Açıklama | Öncelik |
|---------|----------|---------|
| README.md auto-generation | Proje bitiminde otomatik README oluşturma (kurulum, kullanım, API docs) | Yüksek |
| Docs freshness check | Pipeline sonunda docs dosyalarının hâlâ TBD olup olmadığını kontrol, uyarı ver | Orta |
| UI docs viewer | Studio UI'da docs sekmesi — markdown dosyalarını render ederek göster | Orta |
| Docs diff tracking | Her phase sonunda docs değişikliklerini event olarak kaydet | Düşük |

### 2.8 Proje Yönetimi & Workflow

| Özellik | Açıklama | Öncelik |
|---------|----------|---------|
| Import existing project | Var olan codebase'den başlayıp üstüne geliştirme | Yüksek |
| Git PR flow | Her phase bitince otomatik PR, reviewer agent inceleyip approve/reject | Orta |
| Human-in-the-loop | Kritik task'larda kullanıcıya onay sorma | Orta |
| Rollback | Agent'ın yaptığı commit'i tek tıkla geri alma | Orta |
| Changelog generation | Her phase bitiminde otomatik CHANGELOG.md oluşturma | Düşük |
| Blocker detection | Task çok uzun sürüyorsa otomatik escalation | Düşük |

### 2.9 AI Model Management

| Özellik | Açıklama | Öncelik |
|---------|----------|---------|
| Model fallback chain | Birinci model fail olursa ikinciye düşme (OpenAI → Anthropic → Ollama) | Orta |
| A/B testing | Aynı task'ı farklı modellerle çalıştırıp sonuçları karşılaştırma | Düşük |
| Prompt versioning | System prompt değişikliklerini track etme, başarı karşılaştırması | Düşük |
| Fine-tuning data collection | Başarılı task prompt/output çiftlerini toplama | Düşük |

### 2.10 Analytics & Reporting

| Özellik | Açıklama | Öncelik |
|---------|----------|---------|
| Token/maliyet grafiği | Zaman, agent, model bazlı maliyet görselleştirme | Yüksek |
| ROI calculator | "İnsan yazsaydı X saat, AI ile Y token/$Z" karşılaştırması | Orta |
| Weekly digest | Haftalık özet rapor: proje sayısı, task sayısı, maliyet, başarı oranı | Düşük |
| Export (PDF/CSV) | Rapor çıktısı oluşturma | Düşük |
| Benchmark | Agent takım performansının ortalama ile karşılaştırması | Düşük |

### 2.11 Entegrasyonlar & Platform

| Özellik | Açıklama | Öncelik |
|---------|----------|---------|
| Slack/Discord webhook | "Proje bitti", "task fail oldu" bildirimleri | Orta |
| GitHub issue sync | GitHub issue'dan otomatik task oluşturma | Düşük |
| Plugin sistemi | Custom tool/agent yazıp ekleme (MCP server gibi) | Düşük |
| API access | Dışarıdan programatik olarak proje yönetme | Düşük |
| Template marketplace | Hazır proje şablonları (SaaS starter, e-commerce, API boilerplate) | Düşük |

---

## 3. Önerilen Roadmap

### v1.1 — Observability, Maliyet & Dokümantasyon (Yüksek Öncelik)
> Hedef: AI harcamalarını görünür kılmak, kod kalitesini ölçmek, proje dokümanlarını otomatik doldurmak

- Token maliyet takibi (agent/task/proje bazlı)
- Maliyet dashboard'u ve grafikler
- SonarQube entegrasyonu
- ESLint/Prettier enforcement
- Live terminal stream
- Otomatik docs doldurma (PROJECT.md, ARCHITECTURE.md, API_CONTRACT.md, CHANGELOG.md)
- Docs freshness check (pipeline sonunda TBD kontrolü)

### v1.2 — Smart Execution (Yüksek Öncelik)
> Hedef: Agent'ların daha kaliteli kod üretmesini sağlamak

- Code context sharing (agent'lar arası dosya farkındalığı)
- Self-healing error-fix loop
- Review loop (coder → reviewer → coder)
- Import existing project
- Diff viewer

### v1.3 — Developer Experience (Orta Öncelik)
> Hedef: Kullanıcı deneyimini üst seviyeye taşımak

- Embedded live preview (iframe)
- Visual pipeline editor (drag & drop)
- Git PR flow (otomatik PR + review)
- One-click deploy (Vercel/Railway)
- Human-in-the-loop onay sistemi

### v1.4 — Platform & Ecosystem (Düşük Öncelik)
> Hedef: Ekosistem ve entegrasyon genişletme

- Model fallback chain
- Slack/Discord bildirimler
- Plugin sistemi
- A/B model testing
- Template marketplace
- ROI calculator

---

## 4. Başarı Metrikleri

| Metrik | Hedef |
|--------|-------|
| Task başarı oranı | > %85 (mevcut: ~%70) |
| Ortalama task maliyeti | Görünür ve takip edilebilir |
| SonarQube quality gate pass oranı | > %90 |
| Kullanıcı müdahalesi gerektiren task oranı | < %20 |
| Proje tamamlanma süresi (10 task'lık proje) | < 15 dakika |

---

## 5. Teknik Gereksinimler

- **SonarQube**: Docker container olarak çalışacak, API üzerinden scan tetiklenecek
- **Token tracking**: AI SDK'nın `usage` response'undan token sayıları okunacak
- **WebSocket**: Mevcut event-bus altyapısı üzerine terminal stream eklenecek
- **Context sharing**: Shared file index + RAG ile agent'lara mevcut kod bilgisi verilecek

---

**Onay:** Bu rapor onaylandıktan sonra v1.1 ile başlanacak ve detaylı teknik planlama yapılacaktır.
