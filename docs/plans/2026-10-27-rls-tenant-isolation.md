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

**F1 uygulamasından devredilenler**
- F2: `tenant_id NOT NULL` (CI superuser + tenant kapsamı olmadan F1'de uygulanamaz); `projects.tenant_id → tenants` FK'si `ON DELETE SET NULL` → NOT NULL ile çakışır, `RESTRICT` olmalı.
- F4: `oscorpex_migrator` `BYPASSRLS` gerektirir (backfill FORCE RLS altında tablo sahibine de uygulanır); migrator kimlik bilgisi çalışma zamanına asla verilmez.
- Bilgi: F1 ağır DDL bloğu `schema_migrations` tablosu yerine `COMMENT ON FUNCTION app_tenant()` işaretiyle bir kez çalışır; blok içeriği yine de idempotenttir. Kompozit FK'ler `NOT VALID` eklenip veri izin veriyorsa doğrulanır (eski yetim satırlar açılışı engellemez).
- F1 review düzeltmeleri: şema yalnızca `init.sql` hash'i değiştiğinde veya katalog kayması (drift) olduğunda uygulanır (`schema_meta`); `local`'e backfill yalnızca bir kez; migrator üyelikleri `INHERIT FALSE`; `is_platform_admin` sütun yetkisiyle korunur; `notifications` doğrudan `tenant_id` tablosu; `(phase_id, tenant_id)` kompozit FK; fonksiyonlarda `search_path = pg_catalog, pg_temp`.
- F2: `sys_project_tenant` / `sys_event_tenant` istekten gelen bir ID ile tenant kapsamı seçmek için kullanılmaz (yalnızca sistem yolları); `sys_api_key_lookup` NULL tenant döndürürse anahtar reddedilir.
- F2 (karar güncellendi): platform admin **operatör komutuyla** atanır (`admin:grant <email>`, migration bağlantısıyla çalışır); `OSCORPEX_PLATFORM_ADMIN_EMAILS` kaldırılır (kayıt açık + e-posta doğrulaması yok → e-posta ile atama ele geçirilebilir). Auth kapalıyken yerel kullanıcı admin.
- F2/F3 aşamalama: kapsamsız sorgu `OSCORPEX_TENANT_SCOPE_MODE` ile yönetilir — F2/F3'te varsayılan `warn` (log + metrik; DB tarafında RLS zaten 0 satır döndürür), testlerde `strict` doğrulanır; F4'te varsayılan `strict`.
- F2 alt adımları: F2-a tenant kapsamı + `pg.ts` + control-plane `initDb`; F2-b `accessGuard` + auth açıkları + `/api/observability`; F2-c platform admin yetkileri + prompt enjeksiyonu + onay rota çakışması; F2-d `tenant_id NOT NULL` + yazma düzeltmeleri + test taşıma.

**F2 review kararları (onaylandı)**
- Skill / agent_configs enjeksiyonu: uygulama seviyesinde şimdi (otomatik eşleşme yalnızca global skill'lerle; kişisel skill'ler yalnızca açık atamayla ve kendi tenant'ında; agent_configs `created_by` + sahiplik); DB seviyesi RLS F5-6'da.
- `POST /projects/import`: tenant başına çalışma alanı kökü — yol `realpath` ile `<OSCORPEX_WORKSPACE_ROOT>/<tenantId>/` altında olmalı (`resolve + normalize + sep`); platform admin muaf (loglanır); hata mesajı yolun varlığını açığa çıkarmaz.
- `/api/observability`: F5-6'ya kadar yalnızca platform admin.
- `OSCORPEX_API_KEY`: production + auth açıkken yalnızca `OSCORPEX_ALLOW_LEGACY_API_KEY=true` ile; sabit süreli karşılaştırma; denetimde `legacy-operator`.
- Ek bulgu: takım mimarı CLI'ı (`team-routes.ts:178`) kernel dizininde çalışıyor → boş, izole bir dizinde çalıştırılır.
- Projesiz control-plane onayları (`project_id` NULL): yalnızca platform admin oluşturur, görür, sonuçlandırır; tenant kullanıcıları onay oluştururken `projectId` vermek zorundadır.

**F2 üçüncü düzeltme turu (kullanıcı onayıyla kurala istisna; 2. tur review sonrası)**
1. Skill otomatik tespiti/önerileri yalnızca görünür skill'leri kullanır; çalışma zamanında global olmayan skill yalnızca projenin tenant'ına aitse uygulanır.
2. Takım mimarı CLI'ı araçsız ve planlama modunda çalışır (`bypassPermissions` yok); dosya erişimini engelleyemeyen sağlayıcı kullanılmaz (fail-closed); prompt'a yalnızca çağıranın tenant'ının özel takımları girer.
3. Review dağıtıcısının yedek agent seçimi yalnızca preset'ler ve projenin tenant'ına ait config'ler.
4. `GET /agents` ve `/agents/:id`: preset'ler + çağıranınkiler; `sourceAgentId` kopyalama yalnızca görünür config'lerden.
5. API anahtarı kapsamları: oluşturanın rol izinlerini aşamaz (`platform:admin` yalnızca platform admin); RBAC'ta kapsam yalnızca daraltır (kapsam ve rol birlikte geçmeli).
6. Kapsamsız sorgu uyarısı build çıktısında da çağıranı gösterir.
7. Düşükler: `skills`/`agent_configs` sahipliği (tenant, kullanıcı) — `tenant_id` sütunu şimdi (RLS F5-6'da); projects FK `NOT VALID` + korumalı `VALIDATE`; auth açıkken `local` tenant'lı API anahtarları reddedilir; admin import'u da `realpath` + `validateRepoPath`'ten geçer; menüde kullanıcı yüklenmeden admin bağlantıları gizlenir; yorum/kullanılmayan kod düzeltmeleri; sınır yardımcıları için test kapsamı.
Ardından yalnızca bu maddelere odaklı tek bir hedefli güvenlik doğrulaması.

**F2 son maddeler A–E (hedefli doğrulamadan; "şimdi düzelt, sonra commit" kararı — yeni review turu yok)**
- A: Takım mimarı CLI'ı MCP ve ayar kaynağı yüklemez (`--strict-mcp-config`, boş `--mcp-config`, `--setting-sources ""`, `--disallowed-tools mcp__*`); Claude CLI 2.1.308 ile argüman ayrıştırması doğrulandı (`tools:[]`, `mcp_servers:[]`).
- B: `team/recommend` yalnızca çağıranın tenant'ının özel takımlarını listeler; `team/apply` görünmeyen özel takımda 404.
- C: `POST /auth/api-keys` `settings:write` ister; API anahtarıyla çağıran yalnızca kendi kapsamlarının boş olmayan alt kümesini üretebilir; `platform:admin` yalnızca onu taşıyan anahtardan.
- D: agent config PUT/DELETE için `tenant_id` = çağıranın tenant'ı **ve** `created_by` = çağıran; `/projects/:id/agents/:agentId/start` superuser modunda da açık tenant kontrolü yapar. Tenant'sız eski kayıtlar yalnızca admin (eski iki test bu karara göre güncellendi).
- E: Admin import'u ham ve `realpath` yolunu `validateRepoPath`'ten geçirir; `/private/*` (macOS) engelli.

**Sonraki planlar (backlog)**
- Kilitli CLI modunda CLAUDE.md (kullanıcı/proje belleği) yükleniyor olabilir; araç olmadığı için sızdırma yolu yok, ama operatörün `~/.claude/CLAUDE.md` içeriği yanıta yansıyabilir. `--bare` yalnızca API anahtarıyla çalıştığı için varsayılan yapılmadı.
- Admin import'unda ev dizininin alt ağaçları (ör. `~/.ssh`) engellenmiyor (admin güvenilir operatör kararı); istenirse ev dizini alt ağaç olarak engellenir.
- F4'e kadar superuser modunda `/projects/:id/*` rotaları yalnızca RLS'e dayanır (RLS atlanır); access-guard proje tenant'ını ayrıca kontrol etmez. F4 (app rolü zorunlu) bu açığı kapatır.
- Kayıtta e-posta doğrulaması; doğrulanmış hesaplara env/e-posta ile platform admin ataması (kullanıcı isteği, F2 kararı sonrası).
- F4: çalışma zamanı kullanıcısının superuser olması ya da migrator ile aynı olması F1'de yalnızca hata olarak loglanır (Docker F4'e kadar superuser); F4'te açılışı durdurur.
- F4: superuser olmayan migrator, sahip olunan tablolarda DDL için `SET ROLE oscorpex_owner` kullanmalı; `vector` eklentisi superuser ya da önceden kurulmuş olmalı. Production'da ayrı `OSCORPEX_MIGRATION_DATABASE_URL` zorunludur.
- Kullanıcı (manuel): `.env.example`'daki eski `oscorpex_dev` şifresi yer tutucuyla değiştirilmeli; `.env`'e `POSTGRES_PASSWORD` ve yerelde `OSCORPEX_MIGRATION_DATABASE_URL` eklenmeli (hook `.env` dosyalarını koruyor).

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
- **`sys_*` fonksiyonları:** `sys_project_tenant(id)`, `sys_event_tenant(id)`, `sys_running_project_phases()` (watchdog), `sys_running_projects()` (açılış kurtarma), `sys_api_key_lookup(hash)`, `sys_platform_stats()` (yalnızca toplamlar) — sahibi `oscorpex_sysread`, sabit `search_path`, `REVOKE … FROM PUBLIC`, `GRANT EXECUTE TO oscorpex_app`.
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

## F3 — Arka plan, gerçek zamanlı yollar ve proje erişimi (ayrıntılı plan 2026-10-28, onaylandı)

### Bağlam

F2 ile istek bazlı tenant kapsamı ve gerçek RLS geldi. Etki analizi ve üç inceleme (mimari, güvenlik, backend) şunları gösterdi:
- **Arka plan yolları RLS altında çalışmıyor.** Watchdog, açılış kurtarması ve NOTIFY ile gelen olayın yeniden okunması kapsamsız. Süper kullanıcı olmayan rolle 0 satır görüyorlar. Yerel geliştirme artık bu durumda; testlerdeki örtük tenant kapsamı bunu gizliyor.
- **Olaylarda tenant yok.** Dinleyiciler olayı yayan kodun kapsamında çalışıyor. Toplu gönderimler tenant karıştırabiliyor.
- **Proje erişimi yalnızca RLS'e dayanıyor.** Bellekte projectId'ye bağlı tutulan durumlar (agent çıktı akışı, önizleme, switch-preview) RLS korumasında değil. Docker/CI F4'e kadar süper kullanıcı.
- **WebSocket zayıf.**
  - Token URL'de.
  - Kimlik yeniden doğrulanmıyor.
  - Origin kontrolü yok ve `0.0.0.0`'a bağlanıyor.
  - Giden olaylar tenant'a göre süzülmüyor.
- **Kritik:** Tenant kodu kernel sırlarıyla çalışıyor (`...process.env`). Önizleme proxy'si izleyicinin token'ını tenant uygulamasına iletiyor ve tenant HTML'ini console origin'inde sunuyor.

**Hedef:** Her arka plan ve gerçek zamanlı yol doğru tenant'ta çalışsın. Hiçbir rota, akış ya da soket başka tenant'ın projesine ulaşamasın. Tenant kodu kernel sırlarını göremesin.

### Kullanıcı kararları

- **Proje kontrolü:** `/projects/:id/*` için access-guard'da genel bir proje sahipliği kontrolü. Platform admin muaf değil.
- **WebSocket kimliği:** HTTP ile aynı kurallar ve **tek kullanımlık bilet**. Bilet 30 sn geçerli, kimlikli bir HTTP isteğiyle alınır.
- **Origin ve bağlanma:** Mevcut `OSCORPEX_CORS_ORIGINS` kullanılır. Dev'de `127.0.0.1`'e bağlanılır.
- **Control-plane sayımları:** Normal kullanıcı yalnızca kendi tenant'ını görür. Platform geneli sayımlar yalnızca platform admin içindir ve yeni bir `sys_*` fonksiyonuyla alınır.
- **Kritikler:** F3-0 olarak en başta.
- **Plugin'ler:** Platform seviyesinde kalır, olayları `tenantId` ile alır. Tenant bazlı plugin ayrı bir iş.
- **Onay akışı:** Her alt faz için rapor → onay → tek commit.

### Ortak kurallar (her alt faz)

- **Yeniden kullanılacaklar:**
  - `tenancy/tenant-scope.ts`: `runInTenant`, `runAsSystem`, `runOutsideScope`, `*AtBoundary`.
  - `pg.ts`: `callerHint`, `getUnscopedQueryCount`.
  - SQL fonksiyonları: `sys_project_tenant`, `sys_event_tenant`, `sys_running_projects`, `sys_running_project_phases`, `sys_identity_lookup`, `sys_api_key_lookup`.
  - `auth/auth-middleware.ts`: kimlik doğrulama mantığı.
  - `auth/request-identity.ts`, `security/env-sanitizer.ts` (`buildSafeChildEnv`).
  - Örnek desen: `graph-coordinator.ts:301-307`.
- **Kapsam hataları sessiz kalmaz.** `TenantScopeError` ve `UnscopedQueryError` sayaçla ve `log.error` ile raporlanır; `.catch` içinde yutulmaz.
- **Gate:**
  - Kernel paketi iki modda yeşil: yerel gerçek RLS ve CI simülasyonu.
  - `pnpm -r typecheck` temiz.
  - Console değiştiyse tsc ve vitest temiz.
  - Lint'te dosya bazında yeni hata yok.
- **Ajanlar:** Test yazarı, uygulamacı ve reviewer ayrı ajanlardır. Hiçbiri `$HOME` veya `/` altına yazmaz. İşi biten ajan kapatılır.

---

### F3-0 — Kritik güvenlik düzeltmeleri

**Tenant kodu kernel sırlarını almaz.**
- Şu üç nokta `buildSafeChildEnv()`'e geçer:
  - `app-runner/starter.ts:216`
  - `app-runner/process-manager.ts:39`
  - `routes/terminal-routes.ts:91`
- Önizlemenin kendi veritabanı değişkenleri (`dbEnvVars`) `allow` listesiyle açıkça geçirilir.

**Önizleme proxy'si** (`routes/runtime-routes.ts`):
- İsteklerde yalnızca bir izin listesindeki başlıklar iletilir: `accept*`, `content-type`, `content-length`, `user-agent`, `if-*`, `range`. `authorization`, `cookie`, `x-api-key` ve `proxy-*` hiç iletilmez.
- Yanıtlarda `set-cookie` atılır.
- Tüm proxy yanıtlarına şu başlıklar eklenir:
  - `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-modals` (`allow-same-origin` yok)
  - `X-Content-Type-Options: nosniff`

**Console:** `LivePreview.tsx:472` iframe'inin `sandbox` özelliğinden `allow-same-origin` çıkarılır.

**Test senaryoları**
1. **Uygulama ortamı:** Önizleme ve terminal süreçlerine giden env'de şunlar yok: `DATABASE_URL`, `OSCORPEX_JWT_SECRET`, `OSCORPEX_API_KEY`, `OPENAI_API_KEY`, `PG*`, `*_SECRET`. `PATH` ve önizlemenin kendi veritabanı değişkenleri var. (spawn/execFileSync mock'lanır, env yakalanır.)
2. **Proxy istekleri:** Upstream'e `Authorization`, `Cookie` ve `X-API-Key` ulaşmaz. Test için başlıkları geri döndüren yerel bir HTTP sunucusu kullanılır.
3. **Proxy yanıtları:** Upstream'in `Set-Cookie`'si istemciye ulaşmaz. HTML, JS ve SVG yanıtlarında `sandbox` CSP'si (`allow-same-origin` olmadan) ve `nosniff` bulunur.
4. **Regresyon:**
   - Proxy'lenen HTML'e `<base>` etiketi eklenmeye devam eder.
   - API-only 404 sayfası sunulmaya devam eder.
   - Mevcut app-runner ve terminal testleri yeşil.
   - Console iframe testi `allow-same-origin` olmadığını doğrular.

**F3-0 uygulamasında ortaya çıkanlar (faz içinde eklendi, kullanıcı onaylı)**
- **Kapsam genişletme:** Tenant reposunda ya da tenant girdisiyle çalışan ~21 alt süreç çağrısı daha vardı: lint, CLI demosu, kurulum komutları, git, MCP okuma araçları. Hepsi `buildSafeChildEnv`'e geçer. Statik koruma testi (AST tabanlı) `apps/kernel/src` ve `packages/provider-sdk/src` altındaki her `child_process` çağrısını denetler; yalnızca açık gerekçeli platform istisnaları muaftır.
- **Iframe kararı değişti:** `allow-same-origin` geri eklenir. Iframe uygulamanın kendi adresini açıyor (farklı origin), console token'ı `localStorage`'da ve porta bağlı. Kaldırmak güvenlik kazandırmıyor, Vite uygulamalarını bozuyor. Proxy'deki sandbox CSP kalır.
- **Ortam izin listesi:** Tenant kodu çalıştıran profiller (`app_runner`, `build_tool`, `test`) yasak listesi yerine izin listesi kullanır. Yalnızca PATH, HOME, USER, LOGNAME, SHELL, LANG/LC_*, TERM, TMPDIR/TMP/TEMP, NODE_ENV, CI, renk değişkenleri ve HTTP(S)_PROXY/NO_PROXY geçer. Uygulamanın kendi değişkenleri yalnızca açıkça eklenir; platform değerini çekmez.
- **Proxy sertleştirme:**
  - Yanıt başlıkları izin listesine tabidir; `Clear-Site-Data`, `NEL`, `Report-To` ve `Set-Cookie` düşer.
  - Yönlendirme takip edilmez.
  - 502 yanıtlarına da CSP eklenir.
  - API Explorer'ın kullanıcı tanımlı `Authorization` başlığı `x-oscorpex-upstream-authorization` ile taşınır.
- **Çok tenant'lı modda docker compose kapalı:** Auth açıkken tenant'ın `docker compose` ile önizleme başlatması reddedilir. Yerel dev'de açık kalır.
  - Son durumda kontrol `startService` içinde, komutun ilk parçasının adına bakar: `docker`, `docker-compose`, `podman`, `nerdctl`.
  - Bu yalnızca ek bir savunma katmanıdır; `sh -c` ile sarılan komutlar atlatabilir. Asıl çözüm izolasyon epic'idir.
- **İkinci inceleme turunda bulunanlar (düzeltildi):**
  - `git-manager.ts` içindeki `simpleGit` git'i tam ortamla başlatıyordu; güvenli ortama geçti ve statik teste kural eklendi.
  - Proxy akış yolunda gzip'li yanıtlar kesiliyordu (stale `content-length`).
  - 3xx yanıtlarda `location`, HTML dalı dahil `x-oscorpex-upstream-location` olarak taşınıyor.
  - Platformun `claude /usage` sorgusu `provider` profiline döndü.
  - İzin listesine `LC_*` ve Windows temel değişkenleri eklendi.
- **Bilinen ödünleşim:** `SSH_AUTH_SOCK` düştüğü için tenant tarafındaki `git+ssh` private bağımlılık kurulumları çalışmaz.
- **Sonraki işler:**
  - API Explorer auth modunda 401 alıyor (önceden de böyleydi; kernel auth başlığını göndermiyor).
  - AST koruma testi ek sertleştirme ister: `Object.assign(env, process.env)`, `cp["exec"]`.
- **Yeni epic (F4'ten önce):** Tenant iş yükü izolasyonu. Tenant kodu ve agent'lar kernel ile aynı OS kullanıcısında çalışıyor; kernel'in `.env` dosyasını ve `ps` çıktısını okuyabilir, docker ile host'a erişebilir. Env temizliği bunu tek başına kapatmaz. Kalıcı çözüm: container ya da ayrı OS kullanıcısı (mevcut container pool altyapısı değerlendirilecek). Çok tenant'lı production kullanımından önce zorunlu.

---

### F3-a — Test altyapısı (örtük kapsamı kapatma)

**Dosya bazında opt-out yardımcısı:** `__tests__/helpers/strict-scope.ts`.
- Dosya bu yardımcıyı çağırınca testler örtük tenant kapsamı olmadan, `strict` modda çalışır.
- Kapsamsız sorgu `UnscopedQueryError` verir.
- Yeni F3 testleri bunu kullanır. Mevcut 197 dosya örtük kapsamda kalır.

**Örtük kapsam envanteri:** `setup.ts`, test dışı kaynaklardan gelen örtük kapsam sorgularının `callerHint`'lerini toplar ve dosyaya yazar. Bu liste F3 kontrol listesi olarak kullanılır.

**İki tenant'lı fikstür:** Arka plan testleri için A ve B projelerini, çalışan pipeline'larını, planlarını ve fazlarını oluşturur ve temizler. Mevcut `helpers/tenancy.ts` ve `f2r3-fixtures.ts` genişletilir.

**Test senaryoları**
1. Opt-out dosyasında kapsamsız sorgu `UnscopedQueryError` fırlatır. `runInTenant(A)` içinde yalnızca A'nın verisi görünür.
2. Opt-out kullanmayan dosyalar eskisi gibi çalışır. Tam paket yeşil kalır.
3. Envanter çalışır ve test dışı çağıranları listeler.
4. Fikstür idempotenttir; temizlikten sonra satır kalmaz.

**F3-a uygulamasında ortaya çıkanlar**
- **Plan sapması (kullanıcı onayladı; dosya düzeyi varyant F3-c başında eklenir):** Opt-out dosya bazında değil test bazında yapıldı: `itStrict` ve `withStrictScope`. Hook'lar (`beforeAll`, `beforeEach`) hâlâ örtük kapsamda çalışır. `itStrict`, test sırasında örtük kapsamda sorgu çalışırsa testi düşürür.
- **Envanter:**
  - Her kayıt `{repoFrame, entryFrame, origin: test|detached, trigger, count}` biçimindedir.
  - Yığın yalnızca envanter açıkken derin yakalanır. Envanter yalnızca vitest altında açılabilir ve 500 kayıtla sınırlıdır.
  - İlk ölçümde 621 kayıt çıktı; bunların 45'i testten kopuk (fire-and-forget). Yoğun kaynaklar: `event-bus.ts`, görev tamamlama efektleri, çalışma belleği, oturum kapatma, diff yakalama, öğrenme çıkarımı, görev dağıtıcısı. Bu liste F3-c ve F3-d'nin kontrol listesidir.
- **F3-c'den önce yapılacaklar:**
  - Hook'ları da kapsayan dosya düzeyi strict varyantı.
  - `itStrict`'in aynı dosyadaki önceki testlerden kalan işleri yanlış pozitif sayma riski: kopuk kayıtlar uyarıya düşürülür.
  - Zaman aşımından sonra geç biten bir gövdenin sonraki testin modunu bozmasını önleyen bir "generation" belirteci.
- **Sonraki işler:**
  - Fikstürün veritabanı korumasına host ve port karşılaştırması eklenmesi; temizleme adımı da korunmalı.
  - `onTestFinished` testinin davranışsal hale getirilmesi.
  - Derin yığın testinin varsayılan yığın sınırını aşacak şekilde düzeltilmesi.

---

### F3-b — Genel proje erişim kontrolü ve SSE

**Access-guard'da proje sahipliği kontrolü**
- **Kapsanan yol:** `/projects/:id/...`. Şu yollar hariç: `/projects`, `/projects/import`, `/projects/from-template`.
- **Kontrol:** `sys_project_tenant(id)` çağıranın tenant'ına eşit olmalı.
  - Eşit değilse, NULL ise ya da proje yoksa aynı gövdeyle 404 döner.
  - Platform admin muaf değil.
  - Yalnızca olumlu sonuçlar önbelleğe alınır (LRU ve TTL). Projenin tenant'ı değişmez; proje silinince önbellekten çıkarılır.

**Path dışında projectId alan yerler:** `assertProjectInTenant(c, projectId)` yardımcısı eklenir. Kapsananlar:
- `ci-routes`
- inspector `:projectId`
- Hermes `x-project-id` başlığı
- `/results/:projectId`
- query/body'den `projectId` okuyan rotalar

**SSE**
- `/projects/:id/tasks/:taskId/stream`: `task.projectId === :id` olmalı. Dinleyici başına `appendTaskLogs` yazımı kaldırılır.
- `/projects/:id/agents/:agentId/stream`: agent o projeye ait olmalı.

**Soak zamanlayıcısı:** `POST /scheduler/soak` yalnızca admin'e açık. Her proje kendi tenant kapsamında çalışır.

**Rota kapsama testi:** Kayıtlı bütün Hono rotaları taranır. Proje parametresi taşıyan her rota ya genel kontrolle ya da `assertProjectInTenant` ile korunmalı.

**Test senaryoları** (iki modda, süper kullanıcı dahil)
1. **Başka tenant'ın projesi:** A kullanıcısı B'nin projesine giden şu rotalardan 404 alır; gövde, olmayan projeyle aynıdır:
   - proje detayı
   - `agents/:id/stream`
   - `app/proxy`
   - `switch-preview`
   - `terminal/info`
   - `tasks/:taskId/stream`
   - pipeline durumu (önbellekteki)
   - `ci` durumu
   - inspector
   - Hermes başlığı
2. **Yol varyantları:** Kodlanmış, sonu `/` ile biten, büyük-küçük harf farklı ve `..` içeren varyantlarla kontrol atlatılamaz.
3. **Platform admin:** B'nin projesinde 404 alır.
4. **Etkilenmeyen yollar:** `GET /projects`, `/projects/import` ve `/projects/from-template` eskisi gibi çalışır.
5. **Görev akışı:**
   - A'nın görevi B'nin projesiyle istenirse 404 döner ve hiçbir şey yazılmaz.
   - Kendi görevi akar.
   - İki izleyici açıkken loglar çoğalmaz.
6. **Rota kapsama:** Kapsama testi yeşil. Yeni korumasız bir rota testi düşürür.
7. **Performans:** Önbellek isabetinde ek sorgu yoktur. İlk istekte tek `sys_*` çağrısı yapılır; p50 önce ve sonra ölçülüp raporlanır.
8. **Regresyon:** Access-guard, SSE ve tenant-isolation testleri yeşil.

**F3-b uygulamasında ortaya çıkanlar**
- **Tasarım:**
  - Kontrol `auth/project-access.ts` içinde ve RBAC'tan önce çalışır, bu yüzden yabancı proje asla 403 almaz.
  - Yol segmentlere ayrılıp decode edilir; `..`, `.`, bozuk kodlama ve id içinde `/` ya da `\` → 404.
  - Önbellek tenant ve projeye göre anahtarlanır, yalnızca olumlu sonuçları tutar: LRU, 5000 kayıt, 5 dk. Proje silinince temizlenir.
- **Performans:** `sys_project_tenant` gidiş-dönüş süresi yerelde p50 0,08 ms, p95 0,18 ms; `SELECT 1` ile aynı. Önbellek ıskasında istek başına tenant kapsamlı tek bir sorgu (yaklaşık 0,1–0,3 ms), isabette sıfır.
- **İnceleme bulguları (düzeltme turunda):**
  - Yolun ortasında `/projects/:id` taşıyan rotalar: `/policy`, `/usage`, `/cost`.
  - Gövdedeki `projectId` ile yabancı projeye yazma: audit, incidents, presence, work-item.
  - Sandbox görev kontrolü, Hermes başlığı, gateway'in `x-tenant-id` geri dönüşü.
  - Testlerdeki zayıflıklar.
- **Karar (kullanıcı):** Alt kaynak bağlama açığı F4'e bırakıldı. Örnek: `/projects/A/tasks/<B'nin görevi>`, süper kullanıcı modunda B'nin görevini okuyup çalıştırabiliyor. F4'te uygulama kısıtlı role geçince RLS bu sorguları tenant'a göre süzer ve açık kapanır. O zamana kadar çok tenant'lı production kullanımı yok; izolasyon epic'i de ön koşul. Aynı tenant içindeki proje ile alt kaynak tutarlılığı sonraki işlere.
- **İkinci tur sonrası küçük temizlik:** Gateway'deki `x-tenant-id`/`x-actor-id` ile mcp ve hermes'teki `"dev_tenant_id"` geri dönüşleri kaldırıldı; bunlar erişilemez durumdaydı. Hermes invoke ve mcp write/apply'da boş `projectId` için açık 400.
- **Sonraki işler:**
  - Görev SSE akışı callback bitince kapanıyor; çalışan görevin canlı logu akmıyor (önceden var olan hata).
  - Yaklaşık 11 çağrı noktası için yabancı proje negatif testi yok: cost insights, classify-risk, mcp invoke/apply, hermes invoke, gateway, registry, audit/security-events GET, notifications, ci webhook. Kapsama taraması da handler düzeyine indirilmeli.
  - Onay ve skill rotaları `isProjectInTenant`'tan `assertProjectInTenant`'a taşınmalı.
  - `/policy/projects/:id` kendi projesinde de 500 dönüyor (SQL'de `project_id` sütunu yok; önceden var olan hata).
  - `openIncident` gövdeden `id` kabul ediyor. Bu, F4'e bırakılan alt kaynak sınıfında; tek satırlık düzeltmesi F4'te yapılabilir.

---

### F3-c — Event bus, NOTIFY ve anlık olaylar

**Olaylara tenant ekleme**
- `StudioEvent`'e `tenantId` eklenir (`packages/event-schema`). `emit` ve `emitTransient`'ın yaklaşık 25 çağıranı (agent stdout dahil) kapsanır.
- **Tenant kaynağı:** Çağıranın verdiği tenant yok sayılır.
  - Tenant kapsamında: ortam tenant'ı kullanılır. Projenin tenant'ıyla uyuşmazsa olay **reddedilir** (`log.error` ve sayaç).
  - Sistem kapsamında: tenant `sys_project_tenant(projectId)` ile alınır.
  - Kapsamsız çağrıda warn (strict modda hata).

**Dinleyicilere dağıtım**
- Dağıtım bus'a özel bir sınırdan başlar: `runOutsideScope` → `runInTenant(event.tenantId)`.
- Her handler ayrı çalışır, kendi try/catch'iyle; bir handler'ın hatası diğerlerini durdurmaz.
- Async handler'lar kendi kapsamında await edilir.

**Toplu gönderimler** (`event-bus.ts:100/195`, `ws-manager.ts:146/236`): Batch'ler tenant'a göre anahtarlanır. Flush sırasında veritabanı işi yapılmaz, filtreleme mesaj başına yapılır.

**NOTIFY** (`pg-listener.ts`, `event-bus.ts:199/248`)
- Yük yalnızca `id` taşır.
- Dinleyici tenant'ı `sys_event_tenant(id)` ile bulur ve olayı `runInTenant` içinde yeniden okur.
- Sahte ya da bilinmeyen kimlik yok sayılır ve sayaca yazılır.

**Diğer düzeltmeler**
- `ws-cluster.ts:172-188` olay aktarımı kaldırılır; tenant bilgisi yok ve cluster rotaları zaten ertelenmiş durumda.
- `notification-service.ts:63`: `tenantId: null` yerine projenin tenant'ı yazılır.
- Gözden geçirilecek dinleyiciler:
  - `graph-coordinator.ts:149`
  - `replay-phase.ts:15`
  - `context-session.ts:117`
  - `register-plugin-bridge.ts:68` (plugin'ler platform seviyesinde kalır, `tenantId` alır)
  - webhook bridge ve `webhook-sender.ts:246`

**Test senaryoları** (strict-scope dosyaları)
1. A kapsamında A projesi için yayılan olay A tenant'ıyla kaydedilir. Handler A kapsamında çalışır ve B'nin verisini göremez.
2. A kapsamında B projesi için yayılan olay reddedilir. B'nin hiçbir webhook, bildirim ya da plugin çağrısı tetiklenmez.
3. Sistem kapsamında yayılan olayın tenant'ı projeden alınır ve handler o tenant'ta çalışır.
4. Bir handler'ın fırlattığı hata (kapsam hatası dahil) diğer handler'ları durdurmaz ve sayaç artar.
5. Aynı batch penceresindeki A ve B olaylarında her alıcı yalnızca kendi tenant'ının olayını alır.
6. **NOTIFY:**
   - Geçerli `id` doğru tenant'ta bir kez teslim edilir.
   - Sahte tenant ya da proje içeren yük, tenant `sys_event_tenant` ile bulunduğu için etkisizdir.
   - Bilinmeyen `id` düşürülür ve sayaca yazılır.
7. `agent:output` gibi anlık olaylar `tenantId` taşır ve yalnızca o tenant'a gider.
8. Olaydan oluşan bildirim, projenin tenant'ını alır.
9. **Regresyon:** `p2-event-bus`, `pg-listener`, bildirim, webhook ve plugin testleri yeşil.

---

### F3-d — Zamanlayıcılar, watchdog, kurtarma, seeder'lar, provider-state

**Watchdog** (`execution-watchdog.ts:21`, `dispatch-coordinator.ts`)
- Tick gövdesi açıkça `runAsSystem` ile başlar. Çalışacak işler `sys_running_project_phases()` ile bulunur.
- Her proje `runOutsideScope` → `runInTenant(tenant)` içinde, kendi try/catch'iyle işlenir.
- Tenant'ı NULL olan satır atlanır ve `log.error` ile raporlanır.

**Açılış kurtarması** (`recovery-phase.ts:21`, `execution-recovery.ts:39`)
- `sys_running_projects()` kullanılır.
- Projeler sırayla ve sınırlı eşzamanlılıkla yeniden başlatılır; bütçe aşılmışsa `enforceBudgetGuard` başlatmayı engeller.

**Zamanlayıcılar:** Açılışta, herhangi bir kapsamın dışında başlar. İstek içinde tembel başlatma kaldırılır. Açılışta `currentScope()` boş olmalıdır (assert).

**Seeder'lar** (`register-seeders.ts`): `runAsSystem` içinde çalışır. Presetler NULL tenant'lı global kayıtlar olarak kalır.

**provider-state** (`provider-state.ts:101,116,144`): Tablo RLS'siz olduğu için yazım mevcut kapsamda yapılır. Kapsam geçişi yok, hata yutulmaz.

**Test senaryoları** (strict-scope ve gerçek RLS)
1. Watchdog A ve B'nin çalışan projelerini işler. Oluşan events ve token_usage doğru tenant'ı taşır.
2. Tenant'ı NULL olan satır atlanır, hata loglanır, diğer projeler işlenir.
3. **Kurtarma:**
   - A ve B'de takılı kalmış işler devam ettirilir.
   - Eşzamanlı yeniden başlatma sınırı aşılmaz.
   - Bütçesi aşılmış proje başlatılmaz.
4. İstek kapsamında oluşturulmuş bir zamanlayıcı o tenant'ı yakalamaz; tick sistemden tenant'a geçer.
5. provider-state hem tenant kapsamından hem açılıştan kalıcı yazılır, kapsam hatası oluşmaz.
6. Seed edilen presetlerin tenant'ı NULL'dur ve tüm tenant'lar görebilir.
7. **Regresyon:** `execution-engine` ve `restart-recovery` testleri yeşil.

---

### F3-e — WebSocket ve console

**Bilet alma:** `POST /ws/ticket` access-guard arkasındadır.
- Bilet 32 rastgele bayt, bellekte tutulur, 30 sn geçerlidir ve tek kullanımlıktır.
- Kullanıcıya, tenant'a, role ve token'ın son geçerlilik zamanına bağlıdır.
- Tek düğüm içindir; bu bilinen bir sınır.

**Bağlantı kurulumu** (`ws-server.ts` `verifyClient`)
- Origin `OSCORPEX_CORS_ORIGINS` içinde olmalı; varsayılana `http://localhost:5161` eklenir.
- Bilet geçerli olmalı; değilse yükseltme yapılmadan reddedilir. URL'deki `token` ve `apiKey` parametreleri artık kabul edilmez.
- **Auth kapalıyken:** Yalnızca `OSCORPEX_DEV_NO_AUTH` açıksa ve production değilse `local` tenant kullanılır (HTTP ile aynı). Origin kontrolü yine yapılır.
- Dev'de `127.0.0.1`'e bağlanılır (`HOST`, HTTP ile aynı).
- `maxPayload` 64 KB, soket başına en fazla 50 abonelik.

**Abonelik**
- `sys_project_tenant(projectId)` soketin tenant'ına eşit olmalı. Değilse, olmayan projeyle aynı hata döner.
- Her abonelikte kimlik `sys_identity_lookup` ile yeniden doğrulanır. Kullanıcı silinmiş ya da çıkarılmışsa soket kapanır.
- Token'ın süresi dolduğunda soket kapanır.

**Giden olaylar:** Mesaj başına `event.tenantId === soketin tenant'ı` kontrolü yapılır.

**Eski kodun kaldırılması**
- Tenant'sız projeleri herkese açan dallar silinir: `ws-manager.ts:330`, `auth/tenant-context.ts:118`.
- Env anahtarının `===` ile karşılaştırması kaldırılır.

**Console:** `hooks/useStudioWebSocket.ts` ve `lib/studio-api/pipeline.ts` bağlanmadan ve her yeniden bağlanmadan önce bilet alır. URL'de token taşınmaz.

**Test senaryoları**
1. **Bilet:**
   - Kimliksiz istek 401 alır.
   - Geçerli istek bilet alır.
   - Aynı bilet ikinci kez reddedilir.
   - Süresi dolmuş bilet reddedilir.
   - Kullanıcısı silinmiş biletle bağlantı reddedilir.
2. **Bağlantı:**
   - Biletsiz bağlantı ve URL'de token kullanan eski usul reddedilir.
   - Yabancı ya da `null` Origin reddedilir.
3. **Abonelik:** B'nin projesine ve olmayan projeye abonelik aynı hatayı verir; kendi projesine abonelik başarılı.
4. **Olay filtreleme:** A soketi, karışık batch'lerde ve anlık agent çıktısında dahil, B'nin hiçbir olayını almaz.
5. **Oturum sonu:** Token süresi dolunca soket kapanır. Kullanıcı silinince bir sonraki abonelikte kapanır.
6. **Limitler:** 64 KB'tan büyük mesaj soketi kapatır. 51. abonelik reddedilir.
7. **Auth kapalı dev:** `local` tenant yalnızca `OSCORPEX_DEV_NO_AUTH` açıksa ve production değilse çalışır.
8. **Console:**
   - Hook bağlanmadan önce bilet alır.
   - Yeniden bağlanırken yeni bilet alır.
   - URL'de token olmaz.
9. **Regresyon:**
   - `tenant-isolation` WS testleri güncellenir.
   - Console'un canlı güncellemeleri tarayıcıda test edilemiyor; raporda belirtilir.

---

### F3-f — Control-plane sayımları

**Tenant'a göre sayımlar** (`packages/control-plane/src/projections/service.ts:16-79`)
- `approvals`, `agent_instances`, `incidents`, `project_settings` ve `usage_telemetry` sayımları RLS'li `projects` tablosuyla birleştirilerek yapılır; böylece çağıranın tenant'ına kendiliğinden süzülür.
- `project_id`'si NULL olan satırlar sayılmaz.
- `provider_runtime_registry` ve `operator_flags` global olarak kalır.

**Platform geneli sayımlar**
- Yeni `sys_control_plane_summary()` fonksiyonu: SECURITY DEFINER, sahibi `oscorpex_sysread`, yalnızca agrega döner, `REVOKE PUBLIC`.
- Yeni rota yalnızca `platform:admin` yetkisiyle erişilebilir.

**Test senaryoları**
1. B'nin verisi varken A kullanıcısı yalnızca A'nın sayılarını görür.
2. Platform admin genel toplamı görür. Admin olmayan kullanıcı ve `platform:admin` kapsamı olmayan anahtar 403 alır.
3. `sys_control_plane_summary` PUBLIC tarafından çalıştırılamaz ve yalnızca agrega döner.
4. **Regresyon:** control-plane testleri ve console dashboard testleri yeşil.

---

### F3-g — İş kuyruğunun silinmesi

- Silinecekler:
  - `job-queue.ts`
  - `routes/job-routes.ts`
  - `routes/index.ts` içindeki mount
  - `route-permissions.ts` kayıtları
- Şema: `jobs` tablosu `DROP TABLE IF EXISTS` ile kaldırılır; `table-classification` güncellenir.
- İlgili testler silinir ya da güncellenir.

**Test senaryoları**
1. `/jobs` artık erişilebilir değil.
2. Şema uygulandıktan sonra `jobs` tablosu yok. Sınıflandırma testi yeşil.
3. Kalan import yok; typecheck temiz.

---

### Riskler

| Risk | Önlem |
|---|---|
| WebSocket protokolü kırılıyor (bilet) | Kernel ve console aynı commit'te (F3-e) |
| Önizleme sandbox'ı bazı örnek uygulamaları bozabilir (`null` Origin) | Regresyon senaryosu, raporda belirtilir |
| Watchdog ve kurtarma devreye girince birikmiş işler aynı anda başlar | Sırayla ve sınırlı başlatma, bütçe kontrolü |
| Kapsam hataları `.catch` içinde kaybolur | Sayaç ve `log.error`, F3-a'daki strict testler |
| F4'e kadar süper kullanıcı modunda uygulama kontrolleri tek bariyer | F3-b rota kapsama testi |
| Bilet deposu tek düğüm | Bilinen sınır; çok düğümlü kurulum sonraki işler listesinde |

### Sonraki işlere (backlog)

- Tenant bazlı plugin etkinleştirme
- JWT için `jti` iptal listesi
- Çok düğümlü bilet deposu
- `events.tenant_id` sütununun F5-7'den öne çekilmesi
- Önizlemenin ayrı bir origin'e taşınması

### Uçtan uca doğrulama

- **Her alt faz:** Gate komutları ve o alt fazın senaryoları. Faz raporunda senaryo bazında sonuç verilir.
- **F3 sonunda:**
  - Kernel iki modda tam yeşil.
  - Kapsamsız sorgu envanterinde test dışı çağıran kalmaz. Bu, F4'teki strict moda hazırlıktır.
  - `pnpm dev` ile yerel duman testi: watchdog A ve B projelerini görür, WebSocket bilet ile bağlanır. Sizin onayınızla yapılır, çünkü agent çalıştırabilir.

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
