# Oscorpex Deep Analysis Report

**Tarih:** 2026-05-02
**Kod Tabanı:** ~89K LOC (47K backend, 42K frontend)
**Analiz Yöntemi:** 5 paralel uzman agent (güvenlik, performans, mimari, kalite, bug)

---

## Yönetici Özeti

| Alan | Toplam Bulgu | Kritik | Yüksek | Orta | Düşük |
|------|-------------|--------|--------|------|-------|
| Güvenlik | 17 | 1 | 5 | 6 | 4 |
| Performans | 21 | 4 | 8 | 7 | 2 |
| Mimari | 33 | 7 | 12 | 9 | 5 |
| Kod Kalitesi | 62 | 5 | 28 | 21 | 8 |
| Bug/Hata | 21 | 1 | 6 | 7 | 7 |
| **TOPLAM** | **154** | **18** | **59** | **50** | **26** |

### Genel Skorlar

| Metrik | Skor |
|--------|------|
| Kod Kalitesi | **62/100** |
| Mimari Sağlığı | **5.5/10** |
| Güvenlik Olgunluğu | **7.0/10** |
| Performans | **~5/10** |

---

## ACIL MÜDAHALE GEREKTİREN BULGULAR (P0)

### 1. `.env` Dosyasında Gerçek OpenAI API Anahtarı [GÜVENLİK — KRİTİK]
- **Dosya:** `/.env:6`
- **Risk:** `sk-proj-p8RSbV...` gerçek anahtar diskte düz metin
- **Eylem:** Anahtarı OpenAI panelinden **derhal iptal edin**, vault/secrets manager kullanın

### 2. `listTasks(projectId)` — Yanlış Parametre [BUG — KRİTİK]
- **Dosya:** `task-engine.ts:1308`
- **Etki:** `checkApprovalTimeouts` hiç çalışmıyor — `waiting_approval` task'lar sonsuza kadar askıda
- **Neden:** `listTasks(phaseId)` beklerken `projectId` geçiriliyor, sorgu her zaman boş dönüyor
- **Fix:** Phase'leri alıp her biri için `listTasks(phase.id)` çağırılmalı

### 3. JWT Timing Attack — `!==` ile İmza Karşılaştırması [GÜVENLİK — YÜKSEK]
- **Dosya:** `auth/jwt.ts:66`
- **Etki:** Saldırgan byte-byte JWT imzasını tahmin edebilir
- **Fix:** `crypto.timingSafeEqual()` kullanılmalı (password.ts'de zaten doğru kullanılmış)

### 4. Command Injection — `db-provisioner.ts` ve `container-pool.ts` [GÜVENLİK — YÜKSEK]
- **Dosyalar:** `db-provisioner.ts:159,192,231,243,259` — `container-pool.ts:323-329,522`
- **Etki:** `containerName`, `repoPath`, env değişkenleri shell'e interpole ediliyor
- **Fix:** `execFileSync` kullanın (shell yok), env'leri dosya olarak yazın

### 5. Self-Healing Retry Semaphore Bypass [BUG — YÜKSEK]
- **Dosya:** `execution-engine.ts:1336-1339`
- **Etki:** `_executeTaskInner` doğrudan çağrılarak semaphore acquire atlanıyor — concurrency limiti kırılıyor
- **Fix:** `setImmediate(() => this.executeTask(...))` ile re-queue edin

### 6. `advanceStage` Deadlock Riski [BUG — YÜKSEK]
- **Dosya:** `pipeline-engine.ts:812-842`
- **Etki:** Paralel task tamamlamalarında `SELECT FOR UPDATE` deadlock oluşabilir
- **Fix:** `advanceStage` çağrılarını debounce edin

### 7. N+1 Query — `getReadyTasks` [PERFORMANS — KRİTİK]
- **Dosya:** `task-engine.ts:1034-1058`
- **Etki:** Her watchdog döngüsünde (15s) potansiyel 900 ayrı DB sorgusu
- **Fix:** `listTasksByIds([...allDepIds])` ile tek sorguda çözün

### 8. `appendTaskLogs` Read-Modify-Write [PERFORMANS — KRİTİK]
- **Dosya:** `db/task-repo.ts:445-458`
- **Etki:** Her log satırı için tam output JSON okuma-yazma döngüsü
- **Fix:** PostgreSQL JSONB atomic append kullanın

---

## GÜVENLİK ANALİZİ (17 Bulgu)

### Kritik (1)
| # | Bulgu | Dosya |
|---|-------|-------|
| S1 | .env'de gerçek OpenAI API key | `/.env:6` |

### Yüksek (5)
| # | Bulgu | Dosya |
|---|-------|-------|
| S2 | SQL Injection: LIMIT/OFFSET parametresiz | `db/run-repo.ts:86-90` |
| S3 | Command Injection: containerName interpolasyonu | `db-provisioner.ts:159,192,231` |
| S4 | Command Injection: repoPath shell interpolasyonu | `container-pool.ts:522` |
| S5 | Command Injection: env değişkenleri shell'de | `container-pool.ts:323-329` |
| S6 | JWT timing attack (`!==` karşılaştırma) | `auth/jwt.ts:66` |

### Orta (6)
| # | Bulgu | Dosya |
|---|-------|-------|
| S7 | Hardcoded JWT secret (fallback) | `auth/jwt.ts:9` |
| S8 | Auth production'da devre dışı bırakılabilir | `auth/auth-middleware.ts:105-108` |
| S9 | SSRF: Webhook URL'leri kullanıcı kontrolünde | `webhook-sender.ts:331` |
| S10 | SSRF: Proxy endpoint URL yönlendirmesi | `routes/runtime-routes.ts:88-178` |
| S11 | Path traversal: git-manager symlink bypass | `git-manager.ts:250-256` |
| S12 | Webhook secret düz metin olarak header'da | `webhook-sender.ts:319-321` |

### Düşük (4)
| # | Bulgu | Dosya |
|---|-------|-------|
| S13 | Hardcoded DB kimlik bilgileri | `db-provisioner.ts:52-66` |
| S14 | Rate limiting yok (login dahil) | Global |
| S15 | Güvenlik header'ları eksik (CSP, HSTS) | Global |
| S17 | Tenant izolasyonu auth'a bağımlı (koşullu) | `auth/tenant-context.ts` |

### Pozitif
- XSS riski yok (`dangerouslySetInnerHTML` = 0)
- Parametreli SQL büyük çoğunlukta
- RBAC + sandbox + budget guard mevcut
- Parola hash'leme doğru (scrypt + timingSafeEqual)

---

## PERFORMANS ANALİZİ (21 Bulgu)

### Kritik (4)
| # | Bulgu | Dosya | Etki |
|---|-------|-------|------|
| P1 | N+1 query: `getReadyTasks` bağımlılık sorgusu | `task-engine.ts:1034` | 900 sorgu/15s |
| P2 | Watchdog sıralı proje tarama | `execution-engine.ts:264` | 50-100 sorgu/15s |
| P3 | `appendTaskLogs` read-modify-write | `task-repo.ts:445` | Her log satırı = 1 DB round-trip |
| P4 | `getDbPoolConfig()` hiç kullanılmıyor | `pg.ts:22` | Pool ayarlanamaz |

### Yüksek (8)
| # | Bulgu | Dosya |
|---|-------|-------|
| P5 | `listChatMessages` LIMIT'siz | `event-repo.ts:87` |
| P6 | `listTokenUsage` LIMIT'siz | `analytics-repo.ts:199` |
| P7 | Eksik DB indeksleri (tasks, token_usage, events) | `init.sql` |
| P8 | `completeTask` sıralı await zinciri | `task-engine.ts:~620` |
| P9-12 | Frontend çoklu bağımsız polling (3s/5s/10s/15s) | Birden fazla bileşen |

### Hızlı Kazanımlar (1-3 gün)
1. `pg.ts`'de `getDbPoolConfig()` sonucunu kullan (30 satır)
2. 3 kritik DB indeksi ekle (`init.sql`)
3. HTTP compress middleware ekle (`app.use('*', compress())`)
4. `listChatMessages`'a `LIMIT 200` ekle

---

## MİMARİ ANALİZİ (33 Bulgu — Skor: 5.5/10)

### En Kritik Sorunlar

| Sorun | Detay |
|-------|-------|
| **Service Layer YOK** | Route'lar doğrudan DB'ye erişiyor, iş mantığı route handler'larda |
| **DI YOK** | 25+ singleton, test edilebilirlik çok düşük |
| **Engine Üçgen Coupling** | execution-engine ↔ task-engine ↔ pipeline-engine karşılıklı bağımlı |
| **project-routes.ts = 1440 LOC** | 7+ bounded context tek dosyada (plan chat, intake, scope, template...) |
| **In-Memory State** | Pipeline cache, dispatch guard, concurrency — yatay ölçekleme engelliyor |
| **Redis Stub** | `RedisStateProvider` tüm metodları throw ediyor |
| **API Versiyonlama YOK** | Breaking change durumunda tüm istemciler kırılır |
| **Tutarsız Hata Formatı** | 4 farklı error response formatı; 201 status ile `error` alanı (!) |

### Mimari Skorlar

| Boyut | Skor |
|-------|------|
| Modülerlik | 6.5/10 |
| Katmanlama | 4.0/10 |
| SOLID Uyumu | 4.5/10 |
| Tip Güvenliği | 5.5/10 |
| Ölçeklenebilirlik | 3.5/10 |
| Gözlemlenebilirlik | 8.0/10 |

### pg.js Doğrudan Erişen Modüller (15+)
`agent-messaging`, `agent-runtime`, `context-builder`, `task-engine`, `execution-engine`, `sprint-manager`, `sonar-runner`, `document-indexer`, `vector-store`, `replay-store`, `context-analytics`, `cli-usage`, `auth-routes`

---

## KOD KALİTESİ ANALİZİ (62 Bulgu — Skor: 62/100)

### Tip Güvenliği
- **276 `as any`** toplam (123 production, 153 test)
- **0 `@ts-ignore`** — disiplinli yaklaşım
- En kötü: `operator-action-routes.ts` (11 adet, sıfır runtime validasyon)
- Kernel adapter katmanı: `as unknown as CoreTask` pattern'i tehlikeli

### En Sorunlu 10 Dosya

| Dosya | LOC | Skor |
|-------|-----|------|
| `cli-usage.ts` | 1659 | 25/100 |
| `operator-action-routes.ts` | 176 | 30/100 |
| `kernel/index.ts` | 449 | 35/100 |
| `pipeline-routes.ts` | ~200 | 35/100 |
| `project-routes.ts` | 1440 | 40/100 |
| `ws-server.ts + ws-manager.ts` | ~450 | 40/100 |
| `PromptsPage.tsx` | 1166 | 40/100 |
| `execution-engine.ts` | 1564 | 45/100 |
| `graph-coordinator.ts` | 567 | 45/100 |
| `release-decision-service.ts` | 668 | 45/100 |

### Hata Yönetimi
- **Frontend ErrorBoundary = 0** — Runtime hatası tüm uygulamayı kırar
- Console'da **32 adet** `.catch(() => {})` — sessiz hata yutma
- Route'larda **103 adet** `String(err)` ile stack trace kaybı
- **29 adet** `c.req.json().catch(() => ({}))` — boş obje fallback

---

## BUG/HATA ANALİZİ (21 Bulgu)

### Doğrulanmış Buglar (8)

| ID | Önem | Bulgu | Dosya |
|----|------|-------|-------|
| BUG-001 | **KRİTİK** | `listTasks(projectId)` — yanlış parametre, approval timeout çalışmıyor | `task-engine.ts:1308` |
| BUG-002 | YÜKSEK | Map üzerinde iterasyon sırasında silme | `execution-engine.ts:430-435` |
| BUG-003 | YÜKSEK | `runGoalEvaluation` parametre adı yanıltıcı (goalId ≠ taskId) | `execution-engine.ts:1185` |
| BUG-004 | YÜKSEK | `startedAt: undefined` DB'de sıfırlamıyor | `execution-engine.ts:336,396,458` |
| BUG-005 | ORTA | `Number(invalidString)` = NaN → timeout hiç tetiklenmez | `task-engine.ts:1301` |
| BUG-006 | YÜKSEK | `failTask` guard'ı yasal senaryolarda throw atıyor | `task-engine.ts:917-918` |
| BUG-007 | ORTA | Agent null iken startTask+failTask zinciri kırılıyor | `execution-engine.ts:680-688` |
| BUG-008 | ORTA | Protocol blocker'da task sonsuza kadar "blocked" kalıyor | `execution-engine.ts:711-728` |

### Potansiyel Buglar (6)

| ID | Önem | Bulgu | Dosya |
|----|------|-------|-------|
| PBUG-001 | ORTA | Token toplamında NaN riski (`500 + undefined`) | `execution-engine.ts:1061` |
| PBUG-002 | ORTA | Event handler sızıntısı (unsubscribe garantisi yok) | `graph-coordinator.ts:110-137` |
| PBUG-003 | ORTA | Boş projectId cache'e yazılıyor | `task-engine.ts:1280` |
| PBUG-004 | **YÜKSEK** | Self-healing retry semaphore bypass | `execution-engine.ts:1338` |
| PBUG-005 | **YÜKSEK** | advanceStage deadlock riski | `pipeline-engine.ts:812` |
| PBUG-006 | DÜŞÜK | `output.filesCreated` null spread hatası | `task-engine.ts:549` |

### Şüpheli Desenler (7)
- `_dispatchingTasks` çok süreçli ortamda etkisiz
- `setTimeout` deferred retry takip edilmiyor
- `setInterval` temizlenmeden kalıyor
- Pipeline cache invalidation penceresi
- Boş string NaN riski (approval timeout)
- Review sonrası `completedAt` boş kalabiliyor
- `failTask` sonrası hemen `project.status = "failed"` (retry öncesi)

---

## ÖNCELİKLENDİRİLMİŞ EYLEM PLANI

### Faz 1 — Acil (Bu Hafta)
| # | Eylem | Etki | Süre |
|---|-------|------|------|
| 1 | OpenAI API key iptal + vault'a taşı | Güvenlik | 15dk |
| 2 | BUG-001 fix: `checkApprovalTimeouts` doğru phase query | İşlevsellik | 1s |
| 3 | JWT `timingSafeEqual` fix | Güvenlik | 30dk |
| 4 | Command injection fix (execFileSync) | Güvenlik | 2s |
| 5 | PBUG-004 fix: retry semaphore bypass | Kararlılık | 1s |

### Faz 2 — Kısa Vade (1-2 Hafta)
| # | Eylem | Etki | Süre |
|---|-------|------|------|
| 6 | N+1 query fix + eksik DB indeksleri | Performans | 1g |
| 7 | `appendTaskLogs` JSONB atomic append | Performans | 0.5g |
| 8 | BUG-004,006 fix: startedAt + failTask guard | Kararlılık | 0.5g |
| 9 | SQL injection fix (LIMIT/OFFSET parametrize) | Güvenlik | 30dk |
| 10 | Frontend ErrorBoundary ekleme | Dayanıklılık | 2s |
| 11 | HTTP compress middleware | Performans | 15dk |
| 12 | `pg.ts` pool config entegrasyonu | Yapılandırma | 30dk |

### Faz 3 — Orta Vade (3-4 Hafta)
| # | Eylem | Etki |
|---|-------|------|
| 13 | `project-routes.ts` bölme (5 dosya) | Bakım |
| 14 | Service Layer oluşturma | Mimari |
| 15 | Operator action routes runtime validasyon (Zod) | Güvenlik |
| 16 | `cli-usage.ts` provider-bazlı modüllere bölme | Bakım |
| 17 | SSRF koruma (webhook + proxy) | Güvenlik |
| 18 | advanceStage deadlock fix (debounce) | Kararlılık |
| 19 | Frontend polling → WebSocket konsolidasyonu | Performans |
| 20 | `as any` azaltma (123 → <50) | Tip güvenliği |

### Faz 4 — Uzun Vade (1-2 Ay)
| # | Eylem | Etki |
|---|-------|------|
| 21 | DI Container tanıtma | Test edilebilirlik |
| 22 | Engine üçgen coupling kırma (interface'ler) | Modülerlik |
| 23 | Redis entegrasyonu (SharedStateProvider) | Ölçeklenebilirlik |
| 24 | API versiyonlama altyapısı | Evrim |
| 25 | Task dispatch'i message queue'ya taşıma | Ölçeklenebilirlik |

---

## POZİTİF BULGULAR

Sisteminizin güçlü yanları:

1. **Structured logging** — Pino ile tüm modüllerde tutarlı JSON logging
2. **Claim-based dispatch** — `SELECT FOR UPDATE SKIP LOCKED` ile concurrent korunma
3. **Sandbox path validation** — `realpath + normalize + sep` doğru uygulanmış
4. **Injection limits** — Per-task quota (3), per-phase budget (10), recursion depth (2)
5. **Graph invariant validation** — Cycle detection (DFS), self-edge, duplicate edge
6. **XSS korunması** — `dangerouslySetInnerHTML` = 0
7. **0 `@ts-ignore`** — Disiplinli tip yönetimi
8. **Control-plane ayırımı** — Temiz paket sınırları, sıfır dış bağımlılık
9. **YAGNI disiplini** — 5 gereksiz route devre dışı bırakılmış
10. **1098+ backend test** — Kapsamlı test altyapısı
11. **Parola hash'leme** — scrypt + timingSafeEqual doğru kullanılmış
12. **Budget guard** — Maliyet circuit breaker, auto-pause pipeline
