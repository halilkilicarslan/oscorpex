# Plan — Gerçek DB Seviyesinde Tenant İzolasyonu (RLS)

> Durum: onaylandı (2026-10-27). Kapsam analizi, etki analizi ve subagent tartışması (architect / security / postgres) sonrası hazırlandı.

## Bağlam

Tenant izolasyonu bugün kağıt üzerinde var, pratikte yok:
- `pg.ts` `setTenantContext` → `set_config(...,true)` havuzdan rastgele bağlantıda tek sorgu → **etkisiz**. `withTenantTransaction` doğru ama 0 çağıran.
- Docker/CI uygulamayı **superuser** ile bağlıyor → RLS tamamen atlanıyor. Yerelde (superuser değil + FORCE RLS) sıkı politikalar yazmaları reddediyor (26 test).
- 20 tabloda RLS var; 45 tabloda `project_id` var ama RLS yok; ~35 tabloda tenant verisi var ama tenant sütunu yok.
- Güvenlik incelemesi ek açıklar buldu: koda gömülü superuser bağlantı dizesi + public 5432, tenant'lar arası prompt enjeksiyonu (global skills, learning promote), alt kaydın başka tenant'ın projesine bağlanabilmesi, WS/SSE kontrolleri, çelişen auth ayarları, kimlik doğrulamasız `/api/observability` (yazma dahil).

**Hedef:** Her istek ve arka plan işi, doğru tenant ile ve RLS'yi atlayamayan bir rolle veritabanına erişsin; tenant bağlamı olmayan erişim hata versin (fail-closed); hiçbir tenant başka tenant'ın verisini okuyamasın/yazamasın/etkileyemesin.

## Onaylanan kararlar

| Konu | Karar |
|---|---|
| Tenant uygulama | Her sorgu kendi transaction'ında: `BEGIN → set_config('app.current_tenant_id', $1, true) → sorgu → COMMIT` (aynı client). Oturum seviyesi `SET` yasak. |
| Sistem işleri | `sys_*` SECURITY DEFINER fonksiyonları (yalnızca ID/agregat döner). RLS'yi atlayan login rolü yok. |
| `tenant_id` tipi | Hepsi TEXT (6 UUID tablo tek seferlik dönüştürülür). |
| Varsayılan tenant | id `00000000-0000-0000-0000-000000000001`, slug `local`. Yalnızca auth kapalı ve `NODE_ENV !== production` iken. |
| Politika şekli | `USING (tenant_id = (SELECT app_tenant())) WITH CHECK (aynı)`; `app_tenant()` = `NULLIF(current_setting(...,true),'')` → boş/tanımsızsa 0 satır, hata yok. NULL kaçışı yasak (preflight grep'i korunur). |
| Roller | `oscorpex_owner` (NOLOGIN, tablo sahibi), `oscorpex_migrator` (LOGIN, şemayı uygular), `oscorpex_app` (LOGIN, NOSUPERUSER, NOBYPASSRLS, yalnızca DML), `oscorpex_sysread` (NOLOGIN, `sys_*` sahibi). |
| Kapsam | F0–F5 + 45 tablo + tüm güvenlik ek bulguları (#1–#7). Docker prod imajı F4'ten önce ayrı iş. |

### Kapsam değişiklikleri (F0 review sonrası, onaylandı)

F0 güvenlik incelemesi: "platform admin" kavramı yok; `/auth/register` ile kayıt olan her tenant sahibi tüm izinlere sahip ve platform geneli tablolara yazabiliyor (`ai_providers` baseUrl → platform anahtarı + tüm prompt'lar sızar; preset `agent_configs` → tenant'lar arası prompt enjeksiyonu; `operator_flags` → platformu durdurma).

| Konu | Karar | Faz |
|---|---|---|
| Platform admin | `users.is_platform_admin` + ilk kurulum `OSCORPEX_PLATFORM_ADMIN_EMAILS`; auth kapalıyken yerel kullanıcı admin. Platform geneli/sistem tablolarına ve operatör kontrollerine yazma bu yetkiyi ister. | Sütun F1, kontroller F2 |
| `ai_providers`, `registered_plugins`, `provider_runtime_registry` | Platform geneli; yazma yalnızca platform admin | F2 |
| `agent_configs`, `project_templates`, `skills` | Bölünür: preset/genel kayıtlar herkesçe okunur, yalnızca admin yazar; kullanıcı kayıtları tenant'a ait + RLS | F2 (yetki), F5-6 (RLS) |
| `operator_flags`, `operator_actions` | Sistem; yazma yalnızca platform admin | F2 |
| `cli_*`, `provider_state` | Sistem; yalnızca sistem yazar | F2 |
| `jobs` / job-queue / `/jobs` rotaları | Silinir | F3 |
| `marketplace_items` | Legacy (rotası bağlı değil) | — |
| Sınıflandırma matrisi | `writer` alanı (`tenant` / `platform-admin` / `system-only`) ve paylaşılan satır işareti eklenir; katalog testi veritabanı kataloğundan okur, tenant dışı tablolar testte sabit listedir, RLS kontrolü iki yönlüdür. | F0 |
| `asSystem` / iç içe kurallar | Uygulama kapsamına bağlı olduğu için F2'ye taşındı; F0'da yalnızca DB seviyesi yardımcılar (`withTenantTx`, `withAppRole`) | F2 |

**F0 review'larından devredilenler**
- F1: katalog testi `relforcerowsecurity`'yi de doğrular; `public` şemadaki tüm tablolar sınıflandırılmış olmalı (yalnızca test tablolarına izin listesi); `withAppRole` sahiplik kontrolü `pg_has_role('oscorpex_app', relowner, 'USAGE')` ile genişler.
- F2: `writer` alanını RBAC'a karşı doğrulayan test; `plugins:*` dahil platform geneli yazma izinleri tenant sahibinden platform admin'e taşınır (`auth/rbac.ts:16`, `routes/plugin-routes.ts:46,72`).
- F5-6: `agent_skills.tenant_id` ebeveynden değil yazan tenant'tan (`DEFAULT app_tenant()`) gelir; preset agent / global skill ebeveynlerinde tenant yok.

## Süreç (her faz)

test → kod → security-review → code-review (ayrı agent'lar; reviewer'a diff verilir) · gate: `pnpm typecheck && pnpm lint && pnpm test` + `pnpm --filter console test:run` · faz raporu (senaryo bazında sonuçlar) → onay → faz başına tek commit.
**Bilinen başlangıç durumu (F0'da tam paketle ölçüldü):** yerelde 101 kernel testi / 25 dosya kırmızı (CI superuser olduğu için RLS kaynaklılar orada yeşil): ~92'si RLS (`projects`/`project_plans` yazmaları reddediliyor) → F2 sonunda 0; 11'i birbiriyle tutarsız eski testler (8 auth/access-guard/p0-hardening → F2'de yeniden yazılır; 3 diğer → F1 öncesi temizlikte düzeltildi). Ayrıca `packages/event-schema` 2 typecheck hatası (temizlikte düzeltildi) ve kernel'de 509 biome hatası (ayrı iş). Gate = "yeni başarısızlık yok".

**F1 öncesi temizlik (hızlı yol, tamamlandı):** 3 tutarsız test + `event-schema` tipleri. Testlerden biri gerçek bir production hatasını ortaya çıkardı: console'un onay/ret istekleri kernel şemasınca reddediliyordu (şema ve rota düzeltildi).

**Temizlik review'ından devredilenler**
- F2: `/approvals/:id/approve|reject` ve `GET /approvals/:id` iki sistem tarafından tanımlı; önce bağlanan control-plane rotaları quality-gate rotalarını yutuyor (`routes/index.ts:200` vs `:210`). Karar: control-plane onayları `/control-plane/approvals/...` yoluna taşınır (`control-plane/approvals/approval-routes.ts`, console `lib/studio-api/control-plane.ts`, rota izinleri). Control-plane approve/reject/escalate `actor`'ü istek gövdesinden alıyor (OWASP A01) → tenant bağlamından alınır. Gerçek `studio` router'ını bağlayan bir rota çakışma testi eklenir.
- F5-2: onay kararındaki `artifactIds`'in aynı tenant'a ait olduğu doğrulanır.

---

## F0 — Kararlar ve test altyapısı

- **Tablo sınıflandırma matrisi** (118 tablo): `apps/kernel/src/studio/tenancy/table-classification.ts` — her tablo: `tenant-owned | pre-tenant | global | system | legacy`. Mevcut dağılım: RLS'li 20 · project_id/RLS'siz 45 · tenant_id/RLS'siz 8 · task-keyed 2 · sınıflandırılacak 43 (skills, prompt_templates, rag_*, observability_*, alert_*, triggers, feedbacks, custom_team_templates, …). **Sınıflandırma faz raporunda onayınıza sunulur.**
- **Test yardımcıları:** `__tests__/helpers/tenancy.ts` — iki tenant (A/B) seed, `asTenant(id, fn)`, `asSystem(fn)`, `asAppRole(fn)` (`SET LOCAL ROLE oscorpex_app` ile, F1'den itibaren RLS'yi gerçekten test eder).
- Mevcut `tenant-rls.test.ts`, `tenant-isolation.test.ts`, `sprint3-enforcement.test.ts` envanteri: hangi mock'lar kaldırılacak.

**Test senaryoları**
1. init.sql'deki her tablo matriste var; sınıflandırılmamış yeni tablo testi düşürür.
2. Yardımcılar: A/B seed idempotent; `asTenant` iç içe kurallarına uyar (bkz. F2).

---

## F1 — Veritabanı temeli (yalnızca şema; uygulama davranışı değişmez)

- **Bağlantı sertleştirme (#1):** `pg.ts:26`, `pg-listener.ts:45`, `packages/control-plane/src/pg.ts:20` gömülü fallback'ler kaldırılır → `DATABASE_URL` yoksa boot hatası. `docker-compose.yml` 5432 → `127.0.0.1:5432`, şifreler `${VAR:?}`. `security/env-sanitizer.ts` desen tabanlı (`*DATABASE_URL*`, `PG*`, `*_DSN`, `POSTGRES*`).
- **Roller:** idempotent `DO $$ IF NOT EXISTS (pg_roles) … $$`; şifreler init.sql'de değil (F4'te deploy adımında). Tablo sahipliği `oscorpex_owner`'a; migrator owner üyesi. `GRANT` + `ALTER DEFAULT PRIVILEGES` ile yeni tablolar otomatik kapsanır.
- **Şema:**
  - `app_tenant()` (STABLE, PARALLEL SAFE); 6 UUID `tenant_id` → TEXT (korumalı tek seferlik blok).
  - `local` tenant seed (`ON CONFLICT DO NOTHING`); NULL `tenant_id` backfill (projeler, sonra çocuklar ebeveynden), toplu ve tekrar çalıştırılınca no-op; `CHECK NOT VALID → VALIDATE → SET NOT NULL`.
  - `tenant_id DEFAULT app_tenant()` + BEFORE INSERT trigger (eksikse projeden kopyalar) → plan/faz/öneri/import yazmaları kod değişmeden düzelir.
  - **Kompozit FK (#3):** `projects UNIQUE(id, tenant_id)`; `(project_id, tenant_id) → projects(id, tenant_id)`; `tenant_id` değiştirilemez trigger'ı.
  - 20 tablonun politikaları **DROP + CREATE** (mevcut DB'lerde de güncellenir), USING + WITH CHECK; `projects` kopya politikası silinir.
- **`sys_*` fonksiyonları:** `sys_project_tenant(id)`, `sys_event_tenant(id)`, `sys_runnable_projects()`, `sys_stuck_tasks()`, `sys_api_key_lookup(hash)`, `sys_platform_stats()` — sahibi `oscorpex_sysread`, sabit `search_path`, `REVOKE … FROM PUBLIC`, `GRANT EXECUTE TO oscorpex_app`.
- **Bootstrap:** `db-bootstrap.ts` ve `__tests__/setup.ts` → `OSCORPEX_MIGRATION_DATABASE_URL` (dev'de `DATABASE_URL` fallback), `pg_advisory_lock`, `lock_timeout`; ağır DDL şema-sürüm satırıyla korunur (her açılışta ACCESS EXCLUSIVE kilit alınmaz).
- `pg.ts` `withTransaction`: ROLLBACK başarısızsa `release(err)` (#7b).

**Test senaryoları** (`asAppRole` ile)
1. `app_tenant()`: tanımsız/`''`/değer → NULL/NULL/değer; hata yok.
2. Tenant ayarı yokken her RLS tablosunda `count(*) = 0`, eski UUID tablolar dahil hata yok.
3. A, B'nin `tenant_id`'siyle INSERT yapamaz (WITH CHECK); satırı B'ye taşıyan UPDATE başarısız; `tenant_id` değiştirilemez.
4. `tenant_id` verilmeden A kapsamında INSERT → A'yı alır (default/trigger).
5. A, B'nin projesine bağlı görev/plan/faz ekleyemez (kompozit FK).
6. init.sql iki kez + NULL tenant'lı eski DB'de → aynı son durum; ikinci çalıştırmada backfill 0; politika metinlerinde `tenant_id IS NULL` yok; preflight script'leri geçer.
7. `sys_*` yalnızca ID/agregat döner; PUBLIC EXECUTE yok; app rolü ALTER TABLE / RLS kapatma yapamaz.
8. `DATABASE_URL` yoksa boot hatası; env-sanitizer `PGPASSWORD`, `FOO_DATABASE_URL` vb. temizler.
9. Uygulama bugünkü kullanıcıyla aynen çalışır (regresyon yok).

---

## F2 — İstek bazlı tenant bağlamı + auth açıkları

- **Kapsam deposu:** `apps/kernel/src/studio/tenancy/tenant-scope.ts` (örnek: `correlation-context.ts` ALS yapısı) — `{kind:'tenant', tenantId} | {kind:'system', reason}`; `runInTenant`, `runAsSystem` (istek kapsamı aktifken hata), iç içe kuralları: A→B hata, sistem→tenant serbest, tenant→sistem hata.
- **`pg.ts`:** `query/queryOne/execute` tenant kapsamında aynı client'ta BEGIN+set_config+sorgu+COMMIT; `withTransaction` BEGIN sonrası bir kez set_config; sistem kapsamı → GUC `''` (yalnızca `sys_*` anlamlı); **kapsamsız sorgu → `UnscopedQueryError`**. `withClient(fn)` 5 manuel `connect()` yerini alır (`vector-store.ts`, `db/settings-repo.ts`, `db/provider-repo.ts`×2, `db/dependency-repo.ts`); `getPool` export'u kaldırılır; ham havuz ve oturum seviyesi `SET` kullanımını yasaklayan grep testi.
- **control-plane:** `initPool(pool)` → `initDb({query, queryOne, execute, withTransaction})` (`packages/control-plane/src/pg.ts`, `boot-phases/db-phase.ts:17`).
- **Guard:** `auth/access-guard.ts:77` → `return runInTenant(tid, next)`; `auth-middleware.ts:63,104` `setTenantContext` çağrıları ve ölü kod (`setTenantContext`, `withTenantTransaction`, `withTenantFilter`, `isTenantIsolationEnabled`) silinir.
- **Auth (#5, #7a):** auth modu açılışta tek yerde belirlenir (`boot-phases/auth-config-phase.ts`); `DEV_NO_AUTH` + `AUTH_ENABLED` birlikteyse açılış reddedilir; `local` tenant yalnızca auth kapalı ve prod değilken; auth açıkken `local` tenant'lı token reddedilir; legacy `OSCORPEX_API_KEY` → `local`; API anahtarı doğrulama `sys_api_key_lookup`; register/login sistem yolu; `/api/auth` gerekli rotalar guard arkasında; `DELETE /api-keys/:id` sahiplik kontrolü (`auth-routes.ts:281`, `tenant-repo.ts:181`).
- **Observability (#6 erişim kısmı):** `observability/index.ts:26` guard arkasına; `/platform/stats` platform admin + `sys_platform_stats`.
- **Prompt enjeksiyonu (#2 uygulama kısmı):** global skill oluşturma/düzenleme/silme yalnızca platform admin (`route-permissions.ts:232`, `skill-resolver.ts:95`); learning promote sahiplik kontrolü (`graph-routes.ts:343`, `cross-project-learning.ts:279`).
- **Yazma düzeltmeleri:** `graph-coordinator.ts:308` `"system"` → gerçek tenant; import/şablon rotaları tenant'ı geçirir (`project-crud-routes.ts:204,283`).
- **Testler:** `setup.ts` varsayılan olarak `runInTenant(LOCAL)`; A/B yardımcıları.

**Test senaryoları**
1. HTTP: A yalnızca A'yı listeler; B'nin projesi → 404; B'yi güncelleme → 404/0 satır.
2. Havuz `max=2`, A/B iç içe + geri alınmış transaction → görünürlük asla karışmaz; A'dan sonra yeniden kullanılan bağlantı boş GUC görür.
3. Kapsamsız sorgu → `UnscopedQueryError`; sistem kapsamında düz sorgu → 0 satır; istek içinden `runAsSystem` → hata.
4. Auth modları: DEV_NO_AUTH → local; legacy anahtar → local; JWT/`osx_` anahtar → kendi tenant'ı; çelişen ayarlar → açılış hatası; auth açıkken local token → 401.
5. Kimliksiz `/api/observability` → 401; A, B'nin izlerini okuyamaz.
6. A, B'nin API anahtarını silemez.
7. Admin olmayan global skill düzenleyemez; A, B'nin kalıbını promote edemez.
8. control-plane sorguları tenant taşır (A, B'nin onaylarını görmez).
9. Performans: benchmark'ta sorgu gecikmesi önce/sonra p50/p95 kaydedilir; eşik aşılırsa raporlanır.
10. Yerel ~92 RLS kaynaklı test başarısızlığı → 0; 8 auth/access-guard/p0-hardening testi yeni davranışa göre yeniden yazılmış ve yeşil.
11. Gerçek `studio` router'ı üzerinden: `/approvals/:id/approve` quality-gate onayına, `/control-plane/approvals/:id/approve` control-plane onayına gider; `GET /approvals/pending` quality-gate'e ulaşır; control-plane `actor` gövdeden alınamaz.

---

## F3 — Arka plan ve gerçek zamanlı yollar (#4)

- **Event bus** (`event-bus.ts:96,242`): `emit` olaya `tenantId` damgalar (kapsamdan veya `sys_project_tenant`); kayıt o tenant'ta yapılır; her dinleyici `runInTenant(event.tenantId)` içinde çalışır; kayıt hatası error log + metrik (sessiz değil); NOTIFY yükü `tenantId + id` taşır, yeniden okuma kapsamlı.
- **Watchdog / kurtarma** (`execution/dispatch-coordinator.ts:49`, `execution-recovery.ts:35`): keşif `runAsSystem` + `sys_runnable_projects/sys_stuck_tasks`; proje işi `runInTenant(row.tenant_id)`.
- **`pg-listener.ts`:** yük yalnızca ID; yeniden okuma kapsamlı.
- **WebSocket** (`ws-manager.ts:205-213,319-329`, `ws-server.ts:83`): tenant'sız bağlantı yalnızca auth kapalıyken `local`, aksi halde red; abonelikte proje tenant kontrolü; giden olaylar `event.tenantId` ile filtrelenir; Origin izin listesi.
- **SSE** (`task-routes.ts:256,287,297`, `project-execution-routes.ts:122`): `task.projectId === :id` ve tenant doğrulaması; dinleyiciler istek tenant'ında.
- **Zamanlayıcılar** (9 `setInterval`: adaptive-concurrency, agent-runtime, collaboration, container-pool, execution-watchdog, job-queue, rate-limiter, ws-cluster, ws-manager): açılışta sistem kapsamında başlar, istek içinde tembel başlatılmaz.
- **control-plane projections:** tenant'lar arası sayımlar `sys_*` veya tenant başına.
- **job-queue / scheduler:** `startWorker`'ın çağıranı yok → worker silinir; scheduler işleri tenant kapsamlı.

**Test senaryoları**
1. Kurtarma ve watchdog A ile B'nin takılı görevlerini işler; oluşan events/token_usage doğru tenant'ı taşır.
2. Sistem kapsamından yayılan olayın dinleyicileri olayın tenant'ında çalışır; ikinci bağlantıdan gelen NOTIFY doğru çözülür.
3. Olay kaydı hatası error log + sayaç üretir.
4. WS: env anahtarı / tenant'sız JWT / A'nın JWT'si B'nin projesine abone olamaz; yabancı Origin el sıkışması reddedilir.
5. SSE: A'nın görevi + B'nin proje id'si → 404, olay yok.
6. İstek içinden tetiklenen zamanlayıcı o tenant'ı yakalamaz.

---

## Ayrı iş (F4'ten önce) — Production Docker imajı

İmajı gerçekten build et; kernel bağımlılıklarının kurulduğunu doğrula (workspace manifest'leri / `pnpm deploy --filter @oscorpex/kernel --prod`); konteyner açılışı + `/health`.

---

## F4 — Uygulamayı kısıtlı role geçirme

- Çalışma zamanı `oscorpex_app` (`DATABASE_URL`), şema `oscorpex_migrator` (`OSCORPEX_MIGRATION_DATABASE_URL`).
- **Açılış doğrulaması:** mevcut kullanıcı superuser / BYPASSRLS / tablo sahibi ise açılış reddedilir.
- docker-compose: rolleri ve şifreleri env'den oluşturan init script'i; ayrı bağlantı dizeleri; 5432 yalnızca localhost. CI: aynı roller; kurulum migrator ile, testler app rolüyle.
- Preflight script'leri (`production-preflight.sh`, `rc1-soak-runner.sh`, `tenant-isolation-smoke.sh`): rol kontrolleri + A/B smoke.
- **Geri dönüş:** `DATABASE_URL`'i migrator'a çevirmek (belgelenir).

**Test senaryoları**
1. Kernel + console paketleri app rolüyle tamamen yeşil.
2. Açılış superuser / bypassrls / tablo sahibiyle reddedilir.
3. Sıfır `docker compose up`: kernel app rolüyle açılır, `/health` OK, A/B smoke testi geçer.
4. CI yeşil.

---

## F5 — Kalan tablolar (alan bazında gruplar)

Her grup: `tenant_id TEXT NOT NULL DEFAULT app_tenant()` + ebeveynden backfill + (varsa) kompozit FK + `(tenant_id, project_id)` index + ENABLE/FORCE RLS + USING/WITH CHECK.

| Grup | Tablolar |
|---|---|
| 1 Agent çalışma zamanı (10) | agent_capabilities, agent_capability_grants, agent_daily_stats, agent_episodes, agent_instances, agent_protocol_messages, agent_runs, agent_sessions, agent_strategy_patterns, runtime_heartbeats |
| 2 Yönetişim / kalite (17) | approval_requests, approval_rules, approvals, audit_events, incidents, quality_gate_evaluations, quality_gates, quality_signals, release_candidates, review_results, test_results, security_events, sonar_scans, ci_trackings, command_audit_logs, sandbox_policies, sandbox_sessions |
| 3 Bağlam / hafıza (10) | context_events, context_search_log, context_search_stats, context_sources, conversation_compactions, memory_facts, project_context_snapshots, artifact_references, task_diffs, verification_results |
| 4 Planlama / yürütme (10) | execution_goals, graph_mutations, intake_questions, replan_events, runs, task_proposals, plugin_executions, project_settings, project_skills, webhooks |
| 5 tenant_id'li RLS'siz (8) | approval_decisions, learning_patterns, override_actions, release_decisions, rollback_triggers + pre-tenant: api_keys, users, user_roles (auth `sys_*` yoluyla) |
| 6 Tenant sütunsuz tenant verisi (F0 matrisine göre) | skills/agent_skills (global = `scope='global'`, yazma yalnızca admin), prompt_templates, alert_rules/history, triggers/trigger_logs, feedbacks, rag_* (4), observability_* (3), custom_team_templates, replay_snapshots, incident/approval_events, operator_*, agent_presence, webhook_deliveries, … |
| 7 Alt sorgu politikalı 10 tablo | events, project_agents, agent_dependencies, pipeline_runs, token_usage, work_items, sprints, notifications, agent_messages, chat_messages → doğrudan `tenant_id` |

**Test senaryoları**
1. Katalog testi: matriste `tenant-owned` olan her tablo RLS ENABLE+FORCE, WITH CHECK'li politika; hiçbir politikada `tenant_id IS NULL` yok.
2. Her grup için A/B okuma/yazma/güncelleme/silme izolasyonu (tablo listesi üzerinde parametrik test).
3. A, B'nin agent'larının göreceği skill'i oluşturamaz/düzenleyemez; global skill'i yalnızca admin yazar, herkes okur.
4. Observability/alarm/tetikleyici/prompt şablonu verileri tenant'lar arası görünmez.
5. NULL `project_id`'li kayıtlar (ör. notifications) da tenant'a bağlı.

---

## Kritik dosyalar

`apps/kernel/src/studio/pg.ts` · `tenancy/` (yeni) · `auth/access-guard.ts` · `auth/auth-middleware.ts` · `auth/tenant-context.ts` · `boot-phases/{auth-config,db,http}-phase.ts` · `db-bootstrap.ts` · `event-bus.ts` · `pg-listener.ts` · `ws-manager.ts` / `ws-server.ts` · `routes/{task,project-execution,project-crud,auth,graph}-routes.ts` · `observability/index.ts` · `execution/dispatch-coordinator.ts` · `execution-recovery.ts` · `security/env-sanitizer.ts` · `packages/control-plane/src/pg.ts` · `apps/kernel/scripts/init.sql` · `__tests__/setup.ts` · `docker-compose.yml` · `.github/workflows/ci.yml` · `scripts/*.sh`

Yeniden kullanılacaklar: `correlation-context.ts` (ALS deseni), `pg.ts` `withTransaction`, `auth/tenant-context.ts` `getTenantContext`, `db/helpers.ts` `buildUpdateFields`.

## Uçtan uca doğrulama

- Her faz: gate komutları + o fazın senaryoları (`asAppRole` ile gerçek RLS altında).
- F4 sonrası: sıfır `docker compose up` → app rolüyle açılış → iki tenant'lı smoke (`scripts/tenant-isolation-smoke.sh` genişletilmiş) → CI yeşil.
- F5 sonrası: katalog testi tüm `tenant-owned` tabloları kapsar.

## Riskler

- F1 yalnızca şema; F4 geçişi tek bağlantı dizesiyle geri alınır.
- Sorgu başına transaction maliyeti F2'de ölçülür.
- F5 büyük → gruplar halinde, her grup kendi commit'i.
- Başka tenant'ın verisine ihtiyaç duyan her yeni sistem işi bir `sys_*` migration'ı gerektirir (bilinçli sürtünme).
