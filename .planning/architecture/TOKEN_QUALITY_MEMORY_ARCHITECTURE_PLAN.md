# Token, Quality, and Memory Architecture Plan

## Summary

Bu planın hedefi Oscorpex'i üç eksende birlikte optimize etmek:

- `token maliyeti`: tam geçmiş tekrarını ve ham context enjeksiyonunu bitirmek
- `çıktı kalitesi`: her işi aynı modelle değil, risk ve görev tipine göre yönlendirmek
- `context/memory`: raw memory'yi saklayıp prompt'a sadece sıkıştırılmış working memory vermek

Seçilen varsayılanlar:

- `Postgres-first`
- `Aşamalı rollout`
- `Dengeli optimizasyon`

Başarı hedefleri:

- planner ve agent prompt medyan token boyutunda `%60-80` düşüş
- plan üretim ve task completion kalitesinde düşüş olmaması
- plan başına ve task başına maliyetin gözle görülür düşmesi
- retry ve review loop'larda daha kısa context ile daha hızlı toparlanma

## Target Architecture

### 1. Context Assembly Layer

Mevcut dağınık prompt oluşturma yerine tek bir `Context Packet` katmanı kurulacak.

`Context Packet` içeriği:

- `system core`
- `agent profile summary`
- `project working summary`
- `active phase/task summary`
- `recent conversation window`
- `compressed RAG`
- `acceptance criteria / verification block`

Kural:

- raw chat history prompt'a gitmeyecek
- prompt'a sadece `summary + son N mesaj + task-local context` girecek

İlk uygulanacak yerler:

- planner route
- Team Architect route
- execution-engine task prompt builder

### 2. Memory Model

Memory 4 katmanlı olacak:

1. `Raw Memory`
- mevcut chat ve step kayıtları korunur
- audit ve observability için kullanılır

2. `Working Memory`
- prompt'a girecek kısa özet katmanı
- proje hedefi, seçili takım, resolved tech stack, aktif riskler, kararlar

3. `Project Facts`
- kalıcı ve düşük değişim hızına sahip gerçekler
- örnek: product type, preview policy, approved constraints, architecture decisions

4. `Semantic Memory`
- RAG/embedding tabanlı kod ve doküman retrieval

Postgres-first veri modeli:

- `project_context_snapshots`
  - `project_id`, `kind`, `summary_json`, `source_version`, `updated_at`
- `conversation_compactions`
  - `project_id`, `channel`, `last_message_id`, `summary`, `updated_at`
- `memory_facts`
  - `project_id`, `scope`, `key`, `value`, `confidence`, `source`, `updated_at`
- `model_routing_policies`
  - `scope`, `task_type`, `risk_level`, `provider`, `model`, `effort`, `fallback_chain`

Mevcut tablolar korunur:

- `token_usage`
- `project_settings`
- `voltagent_memory_*`
- `rag_*`

### 3. Model Routing Layer

Tek model yaklaşımı bırakılacak.

Varsayılan routing politikası:

- `classification / intake cleanup / Team Architect follow-up`
  - cheap model
- `planner first pass`
  - balanced model
- `high-risk planning, complex review, hard repair`
  - strong model
- `simple reviewer / summary / rewrite / metadata generation`
  - cheap model
- `retry after prior failure`
  - önce same-tier delta retry, sonra escalation

Routing girdileri:

- task type
- risk level
- files touched count
- prior failure count
- review rejection count
- user priority
- budget state

### 4. Compression and Caching Layer

Prompt'taki pahalı bloklar yeniden tokenize edilmeyecek.

Cachelenecek bloklar:

- team summary
- planner profile summary
- project intake summary
- architecture summary
- repo summary
- current phase summary

Compression kuralları:

- RAG önce retrieve, sonra summarize, sonra inject
- long logs doğrudan değil failure summary olarak verilir
- review prompt'a sadece changed files + acceptance criteria gider
- retry prompt'a sadece delta context gider

### 5. Feedback and Cost Intelligence

Cost ve kalite aynı dashboard'da izlenebilir hale gelecek.

Yeni metrikler:

- `prompt input tokens by block`
- `compaction savings`
- `cost per plan`
- `cost per successful task`
- `retry cost waste`
- `first-pass success rate`
- `review rejection rate`
- `memory hit rate`
- `RAG usefulness rate`

## Implementation Changes

### Phase 1 — Measure and Compaction Foundation

Amaç: hiçbir davranışı bozmadan token israfını görünür yapmak ve full-history replay'i kaldırmak.

Değişiklikler:

- `Context Packet` builder eklenir
- planner chat tam history yerine:
  - project summary
  - last 4-6 turns
  - team summary
  - runtime expectations
  kullanır
- `prompt-budget` telemetry'si blok bazlı kırılır
- project summary snapshot writer eklenir
- conversation compaction job eklenir
- Team Architect ve Planner aynı context assembly yolunu kullanır

API/interface değişiklikleri:

- planner ve Team Architect prompt üretimi `Context Packet` üzerinden geçer
- analytics response'larına `prompt block metrics` eklenir

### Phase 2 — Routing and Working Memory

Amaç: kaliteyi düşürmeden ucuz modelleri varsayılan hale getirmek.

Değişiklikler:

- `model routing policy` servisi eklenir
- task class/risk class çıkarımı eklenir
- retry için `delta retry packet` oluşturulur
- working memory snapshot'ları:
  - project
  - phase
  - planner conversation
  için tutulur
- review prompt'ları sadece gerekli context ile çalışır

API/interface değişiklikleri:

- project settings altında routing policy override alanı
- analytics altında per-model ve per-task-type cost görünümü
- execution path'te `routing decision` event'i

### Phase 3 — Adaptive Quality Loop

Amaç: kaliteyi ölçüp otomatik yükseltme/escalation kurmak.

Değişiklikler:

- first-pass failure sonrası model escalation
- review rejection sonrası stronger review path
- RAG chunk compression + source ranking
- failure type classifier:
  - agent no-op
  - runner limitation
  - environment issue
  - plan quality issue
- planner update request'lerinde yalnızca decision delta gönderimi

API/interface değişiklikleri:

- failure classification alanı
- retry reason / escalation reason alanı
- compaction summary endpoint'i

## Test Plan

### Unit Tests

- `Context Packet` builder yalnızca beklenen blokları döndürmeli
- full history yerine summary + recent window kullanılmalı
- routing policy aynı girdilerde deterministic karar vermeli
- delta retry packet yalnızca gerekli failure context'i içermeli
- RAG compression token budget'i aşmamalı

### Integration Tests

- planner route yeni summary modelinde plan üretmeye devam etmeli
- Team Architect ve Planner aynı intake'ten tutarlı context almalı
- retry sonrası working memory güncellenmeli
- review rejection sonrası escalation policy doğru çalışmalı
- token analytics yeni alanlarla doğru agregasyon yapmalı

### Acceptance Scenarios

- uzun planner konuşmalarında prompt boyutu artışı lineer olmamalı
- aynı proje üzerinde ikinci plan güncellemesi ilkine göre daha ucuz olmalı
- basit görevlerde cheap model seçilmeli, kritik görevlerde escalation olmalı
- raw memory korunurken prompt kalitesi bozulmamalı
- summary bozulduğunda sistem son birkaç turdan toparlayabilmeli

## Assumptions and Defaults

- yeni altyapı ilk fazda `PostgreSQL` üzerinde kurulacak; Redis zorunlu değil
- rollout `feature flag` ile aşamalı yapılacak
- varsayılan optimizasyon politikası `balanced`
- raw memory silinmeyecek; sadece prompt'a giden katman sıkıştırılacak
- planner, Team Architect ve execution prompt assembly tek ortak servis üzerinden standardize edilecek
- model router ilk sürümde kural bazlı olacak; öğrenen/ML tabanlı karar mekanizması sonraki faza bırakılacak
- kısa vadede hedef tam yeniden yazım değil, mevcut sistemi kırmadan katman ekleyerek iyileştirmek
