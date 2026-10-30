# Plan — Production Docker imajı (F4 öncesi ayrı iş)

> Onay sonrası `docs/plans/2026-10-31-production-docker-image.md` olarak repoya kaydedilir. Ana plan: `docs/plans/2026-10-27-rls-tenant-isolation.md` ("Ayrı iş (F4'ten önce) — Production Docker imajı").

## Bağlam

F4'te uygulama kısıtlı role (`oscorpex_app`) geçecek ve şema ayrı bir migrator bağlantısıyla uygulanacak. Bunun ön koşulu, çalışan bir production imajı. Etki analizi ve üç inceleme (mimari, güvenlik, deployment) şunu gösterdi.

**Bugün kernel imajı hiç derlenmiyor.**
- İlk kurulum `ERR_PNPM_IGNORED_BUILDS` ile kırılıyor. pnpm sürümü sabit değil ve `pnpm-workspace.yaml` kurulumdan önce kopyalanmıyor.
- Derlense bile production aşaması kernel bağımlılıklarını kurmuyor.

**Console imajı da bozuk.**
- `.dockerignore` `apps/console`'u dışlıyor.
- nginx, API'yi yanlış porta (4242) yönlendiriyor.
- WebSocket doğrudan 3142'ye bağlanıyor, ama bu port yayınlanmıyor.

**Kritik güvenlik açıkları:**
- `.dockerignore` yalnızca kökte eşleşiyor. `COPY . .` şunları derleme katmanına taşıyor: kök `.env`, `apps/console/.env`, tenant repolarındaki 123 `.env` dosyası, `.serena`, `.claude` ve darwin `node_modules`.
- Kod, çalışma kullanıcısına ait. Bir agent `init.sql`'i değiştirirse, dosya bir sonraki açılışta süper kullanıcıyla uygulanır.

**Diğer sorunlar:**
- Kernel'in diğer portları 0.0.0.0'da yayınlanıyor.
- `env_file`, `POSTGRES_PASSWORD` dahil her değişkeni kernel'e veriyor.
- postgres'in ilk açılışında şemayı süper kullanıcıyla uygulayan mount, migration yolunu maskeliyor.
- `init.sql` yoksa kernel production'da bile sessizce devam ediyor.
- Repo verisi `/app/.oscorpex`'e yazılıyor, ama volume başka yerde. Yeniden başlatmada projeler kayboluyor.
- İlk admin'i oluşturan komut (`admin:grant`) `tsx` gerektiriyor ve imajda çalışmıyor.
- CI son 5 çalıştırmada başarısız: pnpm kurulum adımı sürümsüz ve `packageManager` alanı yok.

**Hedef:** sıfırdan bir `docker compose up` ile şunlar çalışır:
1. postgres açılır.
2. Ayrı bir migrate servisi şemayı uygular.
3. Kernel açılır; root olmayan kullanıcıyla, salt-okunur kök dosya sistemiyle ve sır taşımadan.
4. Console nginx üzerinden tek origin'de açılır.

`/health` 200 döner, imajda hiçbir sır yoktur ve CI imajları derleyip duman testi yapar.

## Kullanıcı kararları

| Konu | Karar |
|---|---|
| Agent CLI | Claude CLI imaja dahil, sürüm sabit; diğer sağlayıcılar build arg ile isteğe bağlı |
| Taban imaj | `node:22-bookworm-slim` (digest ile sabit) |
| Kabul | Compose ile uçtan uca |
| CI | Push'suz derleme + duman testi |
| Migration | Ayrı tek seferlik `migrate` servisi; kernel yalnızca `DATABASE_URL` alır |
| İlk admin | İmajda derlenmiş `admin-grant` komutu (`docker compose run --rm migrate …`) |
| Claude kimliği | **Kalıcı `~/.claude` volume** (OAuth girişi mümkün). Bilinçli risk: tüm tenant'ların transcript'leri ve token aynı volume'de; yalnızca kernel'e bağlanır, `0700`. İzolasyon epic'inde yeniden ele alınacak. |
| Portlar | Dışarıya yalnızca console `127.0.0.1:5161`; kernel ve postgres kapalı |

## Ortak kurallar

- Her alt faz şu sırayla ilerler: test → kod → security-review → code-review (ayrı ajanlar, en fazla 2 tur). Ardından rapor → onay → tek commit.
- Kernel testleri iki modda koşar. Console değişirse tsc ve vitest çalışır. Lint'te dosya bazında yeni hata olmaz.
- Docker testleri `scripts/docker/` altındaki duman betikleriyle yapılır.
- Derleme bağlamına `.env` girmez. Yerel derlemeler izin listesi `.dockerignore` ile yapılır.
- `.env.example`'daki kullanıcı değişikliğine dokunulmaz.

---

## D1 — Araç zinciri ve derleme bağlamı

- **pnpm sabitleme:**
  - Kök `package.json`'a `"packageManager": "pnpm@12.6.0+sha512.…"` eklenir; corepack kullanılır.
  - CI'da `pnpm/action-setup` sürümü bu alandan okur.
  - CI'a `permissions: contents: read` eklenir.
- **Kök `.dockerignore` izin listesine geçer:** `*` ile her şey dışlanır, sonra yalnızca gerekenler açılır:
  - kök `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig*.json`
  - `apps/kernel/{package.json,src,scripts,tsconfig*.json,tsdown.config.ts}`
  - `packages/*/{package.json,src,tsconfig*.json,tsdown.config.ts}`
  - `adapters/*/…`
  - `docker/claude-cli/`
- **Her durumda dışlananlar:** `**/node_modules`, `**/dist`, `**/.env*` (`!.env.example` hariç), `**/.oscorpex`, `**/.voltagent`, `**/*.pem`.
- **Console:** Ayrı `apps/console/Dockerfile.dockerignore`.
- **CI'daki `docker compose config`:** D5/D6'ya taşındı (aşağıya bakın).

> **D1 uygulamasında netleşenler:**
> - **`.env.example` da dışlanır.** İmaj derlemesi ona ihtiyaç duymuyor.
> - **Ortak dışlama bloğu:** Her ignore dosyası (kök, `apps/console/Dockerfile.dockerignore`, `docker/coder-agent/.dockerignore`) aynı "common-deny" bloğuyla biter. Blok sır ve yerel durum adlarını kapsar: `.env*`, `.claude*`, `.npmrc`, `.netrc`, anahtar ve sertifika uzantıları, `id_*`, `*.db`, `*.log`, editör dizinleri, testler, `src` altındaki eski `.js` çıktıları. Bloğun her dosyada aynı olduğu test edilir.
> - **`docker/claude-cli`'dan yalnızca iki manifest alınır:** `package.json` ve `package-lock.json`.
> - **Console:** `public/` dizininden yalnızca `*.svg` alınır.
> - **Eski bağlamlar:** Eski `apps/console/.dockerignore` her şeyi dışlar. `coder-agent` bağlamı da artık izin listesiyle korunur.
> - **pnpm 12 kilit dosyası:** `packageManager` alanı eklenince pnpm 12, `pnpm-lock.yaml`'ın başına ayrı bir "boot" belgesi yazar (`packageManagerDependencies` ve pnpm ikililerinin bütünlük özetleri). Bu belge yalnızca ilk belgeyi okuyan tarayıcıları körleştirir: osv-scanner, HEAD'deki kilit dosyasında 676 paket ve 29 açıklı paket görüyor, boot belgeli dosyada ise 15 paket ve 0 açıklı paket. Bu yüzden boot belgesi commit'lenmez. `pnpm-workspace.yaml`'a `pmOnFail: ignore` eklenir; kilit dosyası tek belgeli kalır. Sürüm zorlaması Docker'da corepack'te (sha512 sabitleme), CI'da şimdilik `action-setup`'ın tam sürümünde, D6'dan itibaren corepack'te olur.
> - **Node 20 ve corepack:** Node 20'deki corepack 0.32 pnpm 12'yi çalıştıramaz. corepack kontrolleri bu yüzden `node:22-bookworm-slim` konteynerinde yapılır; yerel global pnpm 12.6.0 çalışmaya devam eder.
> - **CI hijyeni:** CI'da checkout `persist-credentials: false` ile yapılır. `npx vitest` yerine `pnpm exec vitest` kullanılır.

**Test senaryoları** (`scripts/docker/check-context.sh`; bağlam, içerik taşımayan, yalnızca adlardan oluşan bir aynayla ve `RUN --mount=type=bind` ile listelenir):
1. Bağlamda `.env`, `apps/console/.env`, `**/.oscorpex/**`, `**/node_modules/**`, `.serena`, `.claude`, `*.pem` yok. Kanarya `.env` ve tenant `.env.production` dosyalarıyla doğrulanır.
2. Bağlamda derleme için gereken dosyalar var: tüm `package.json`'lar, kilit dosyası, kaynaklar.
3. Console Dockerfile'ının bağlamında `apps/console` kaynakları var, `.env` yok.
4. `corepack pnpm --version` = 12.6.0. Kilit dosyası `--frozen-lockfile` ile kurulur.
5. **Regresyon:** yerel `pnpm install` ve `pnpm -r build` çalışmaya devam eder.

## D2 — Çalışma zamanı paketleme ön koşulları (kod, test-first)

- **Paket dosyaları:**
  - Tüm `packages/*` ve kernel `package.json`'larına `"files": ["dist"]` eklenir; kernel'e ayrıca `scripts/init.sql`.
  - Amaç: `pnpm deploy` derleme çıktısını düşürmesin.
- **Kernel derleme girişleri** (`apps/kernel/tsdown.config.ts`):
  - `src/index.ts`
  - `src/migrate.ts` (yeni): `applySchema` ile migration bağlantısından şemayı uygular ve çıkar.
  - `scripts/admin-grant.ts` (`tsx` gerektirmeyen derlenmiş komut).
- **`db-bootstrap.ts`:**
  - `init.sql` bulunamazsa production'da hata verir (bugün sessizce "unchanged" dönüyor).
  - Yeni **verify modu:** production'da migration bağlantısı yoksa kernel şemayı uygulamaz. `schema_meta` hash'inin gömülü `init.sql` hash'iyle eşleştiğini ve katalogda sapma olmadığını doğrular. Eşleşmezse "önce migrate çalıştırın" hatasıyla açılmayı reddeder.
  - Ayrıca şema uygulama hataları production'da kesin olarak fatal olur.
- **Yeniden kullanılacaklar:** `applySchema`, `schemaHash`, `prepareSchemaSql`, `checkRuntimeIsolation`, drift kontrolü (`db-bootstrap.ts`); `apps/kernel/scripts/admin-grant.ts` mantığı.

**Test senaryoları** (vitest, iki mod):
1. `migrate` girişi şemayı uygular ve 0 ile çıkar; migration bağlantısı yoksa açık hatayla çıkar.
2. Verify modu:
   - Hash eşleşiyorsa açılır.
   - `schema_meta` yoksa ya da hash farklıysa açılmaz, hata mesajı "migrate" der.
   - Sapma varsa açılmaz.
3. Production'da `init.sql` yoksa hata verir; geliştirmede bugünkü davranış korunur.
4. Derlenmiş `admin-grant` (`node dist/admin-grant.js`) bir kullanıcıya admin verir ve kaldırır; migrator bağlantısı ister.
5. `pnpm deploy --filter @oscorpex/kernel --prod` çıktısında kernel `dist` (tüm chunk'lar), `scripts/init.sql` ve her `@oscorpex/*` paketinin `dist`'i bulunur. Bir duman testi her paketi `import()` eder.
6. **Regresyon:** tam kernel paketi iki modda yeşil; yerel `pnpm dev` açılışı (migration URL ile) değişmez.

## D3 — Kernel Dockerfile

- **Aşamalar** (hepsi `node:22-bookworm-slim@sha256:…`):
  1. `deps`: manifestler ve kilit dosyası; `corepack pnpm install --frozen-lockfile` (BuildKit cache mount). Derleme araçları (python3, make, g++) yalnızca bu aşamada bulunur.
  2. `build`: `pnpm --filter @oscorpex/kernel... build`.
  3. `deploy`: `pnpm --filter @oscorpex/kernel deploy --prod /out`. Gerekirse `inject-workspace-packages`.
  4. `claude-cli`: `docker/claude-cli/package.json` ve `package-lock.json` (tam sürüm ve integrity) → `npm ci`. Bu yöntem `npm i -g` yerine seçildi, çünkü kilit dosyası bütünlüğünü sağlar.
  5. `runtime`: yalnızca `git`, `ca-certificates`, `tini`.
- **Runtime kuralları:**
  - setuid/setgid bitleri silinir.
  - `/app` ve CLI `root:root`, salt-okunur.
  - Kullanıcı `oscorpex` (uid 1001), `HOME=/home/oscorpex`.
  - `CLAUDE_CLI_PATH`, `DISABLE_AUTOUPDATER=1`.
  - `WORKDIR /app`; `init.sql`, `/app/scripts/init.sql`'de.
  - Yazılabilir dizinler yalnızca volume ya da tmpfs: `/app/.oscorpex`, `/app/.voltagent`, `/home/oscorpex/.claude`, `/tmp`.
  - `ENTRYPOINT ["tini","--"]`, `CMD ["node","dist/index.js"]`.
  - `HEALTHCHECK`: node fetch ile `/health`.
- **Sağlayıcı CLI'ları:** Claude dışındakiler `ARG` ile isteğe bağlı (varsayılan kapalı).

**Test senaryoları** (`scripts/docker/smoke-kernel.sh`):
1. İmaj `--no-cache` ile derlenir.
2. `docker run --rm img node -e` her `@oscorpex/*` paketini yükler.
3. `claude --version` sabitlenen sürümü verir.
4. `id -u` = 1001.
5. `/proc/1/status` içinde CapEff=0 ve NoNewPrivs=1 (compose ayarlarıyla).
6. `find / -xdev -perm /6000` boş döner.
7. Çalışma kullanıcısı `dist`, `scripts/init.sql` ve CLI dizinine yazamaz.
8. **Sır taraması:**
   - Kanarya değerler (kök `.env`, tenant `.env.production`, `*.pem`) `docker save` katmanlarında, `--target build` imajında, `docker history --no-trunc` ve `docker inspect` çıktısında yok.
   - Gerçek `sk-ant-` ya da `OPENAI` değeri yok.
9. `HEALTHCHECK` tanımlı.
10. **Regresyon:** D2 duman testleri imaj içinde geçer.

## D4 — Console Dockerfile ve nginx

- **Console Dockerfile:**
  - corepack ile sabit pnpm.
  - bookworm builder; `pnpm --filter "console..." build`. Paketin adı `console`. Kökteki `dev:console` ve `build:console` script'lerindeki `@oscorpex/console` filtresi hiçbir pakete eşleşmiyor; bunlar da düzeltilir.
  - Güvenlik başlığı snippet'i bir `apps/console/nginx/` dizinine konursa `Dockerfile.dockerignore`'a eklenir.
  - Duman testi console'u `docker compose build console` ile derler. Böylece `Dockerfile.dockerignore`'un Dockerfile'ın yanında gerçekten bulunduğu da sınanır.
  - Runtime `nginx:1.27-alpine@sha256:…`, root olmayan nginx.
  - `Dockerfile.dockerignore` (D1).
- **`nginx.conf`:**
  - `= /health` → `backend:3141`.
  - `/api/studio/ws` → `backend:3142`; Upgrade/Connection başlıklarıyla.
  - `/api` → `backend:3141`; SSE için `proxy_buffering off`.
  - Dinamik upstream için `resolver 127.0.0.11`.
  - `index.html` no-cache; hash'li asset'ler immutable.
  - Her location'da güvenlik başlıkları (include ile): CSP, `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'` / `X-Frame-Options: DENY`, `Referrer-Policy`.
  - `server_tokens off`.
- **Console WebSocket adresi** (`hooks/useStudioWebSocket.ts`, `lib/studio-api/pipeline.ts`): production derlemesinde aynı origin ve `/api/studio/ws`, port yok. Geliştirmede `VITE_STUDIO_WS_PORT` ile bugünkü davranış korunur.

**Test senaryoları:**
1. Console vitest:
   - production modunda WS adresi aynı origin'i kullanır, port içermez (https altında `wss`);
   - dev modunda port bugünkü gibi kalır.
2. Duman (`smoke-console.sh`):
   - `/` 200 ve `<div id="root">` içeriyor;
   - `index.html` `Cache-Control: no-cache`, asset'ler immutable;
   - güvenlik başlıkları `/`, `/assets/*` ve `/api/*` yanıtlarının hepsinde var;
   - `Server` başlığında sürüm yok.
3. nginx üzerinden `/health` 200, `/api/studio/...` ise kernel'e ulaşır.
4. nginx üzerinden WS: bilet alınır, bağlantı 101 döner. Yabancı Origin reddedilir (F3-e).
5. **Regresyon:** console vitest ve tsc yeşil; `pnpm dev:console` proxy'si değişmez.

## D5 — Compose

- **Servisler ve sıralama:**
  1. `postgres` (healthcheck; yayınlanan port yok; `db` iç ağında).
  2. `migrate` (kernel imajı, `node dist/migrate.js`, `OSCORPEX_MIGRATION_DATABASE_URL`, tek seferlik).
  3. `backend` (`depends_on: migrate: service_completed_successfully`).
  4. `console` (`depends_on: backend: service_healthy`).
- **Kaldırılan:** postgres'in `initdb` `init.sql` mount'u.
- **Backend ortamı** açık listeyle verilir, `env_file` yok:
  - `DATABASE_URL`, `NODE_ENV=production`, `OSCORPEX_AUTH_ENABLED=true`
  - `OSCORPEX_JWT_SECRET` (`:?` ile zorunlu)
  - `OSCORPEX_CORS_ORIGINS=http://localhost:5161`
  - isteğe bağlı `ANTHROPIC_API_KEY`
- Backend'de **ne** `POSTGRES_PASSWORD` ne de migration bağlantısı bulunur.
- **Backend sertleştirme:** `read_only: true`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, tmpfs `/tmp`.
- **Volume'ler:**
  - `oscorpex-data:/app/.oscorpex` (repolar, loglar)
  - `studio-data:/app/.voltagent`
  - `claude-home:/home/oscorpex/.claude` (kullanıcı kararı)
  - `pgdata`
- **Ağlar:** `db` (internal: postgres, migrate, backend) ve `frontend` (backend, console). Agent havuzu profili bugünkü gibi kalır.
- **Portlar:** yalnızca `127.0.0.1:5161:8080` (console). Kernel ve postgres yayınlanmaz.
- **İlk admin:** `docker compose run --rm migrate node dist/admin-grant.js grant <email>`. Kısa bir kurulum notuna yazılır (README değil, `docs/`).
- **Uyum:** `docker-compose.dev.yml` override'ı yeni yapıya uyarlanır.

**Test senaryoları** (`scripts/docker/smoke-compose.sh`, `trap` ile `down -v`):
1. Sıfırdan `down -v && up --wait`:
   - migrate 0 ile çıkar;
   - şema migrator bağlantısıyla uygulanmıştır (`schema_meta` var); initdb mount yok;
   - backend healthy; nginx üzerinden `/health` 200; console sayfası geliyor.
2. Kernel container'ının env'inde `POSTGRES_PASSWORD` ve `OSCORPEX_MIGRATION_DATABASE_URL` yok.
3. `OSCORPEX_JWT_SECRET` verilmezse compose başlamayı reddeder.
4. Dinleyen tek host portu `127.0.0.1:5161`; 3141, 3142 ve 5432 host'tan kapalı. Console container'ı postgres'e erişemez.
5. Bir proje oluşturulduktan sonra `down && up` (volume'ler korunarak) yapılınca repo durur.
6. `admin-grant` bir kullanıcıya admin yetkisi verir; o kullanıcı platform rotasına erişir.
7. Backend'de CapEff=0, NoNewPrivs=1; kök dosya sistemi salt-okunur, yazma denemesi başarısız olur.
8. WS bilet + nginx üzerinden bağlantı ve olay akışı çalışır.
9. **Regresyon:** yerel geliştirme akışı (`pnpm dev`, `docker-compose.dev.yml`) çalışır; F3-e'nin Origin ve rate-limit testleri değişmez.

## D6 — CI

- `build` job'u düzeltilir: `packageManager` alanı ve `permissions: contents: read`.
- **Yeni `docker` job'u:**
  - `docker/setup-buildx-action`; kernel ve console için `build-push-action` (`push: false`, `load: true`, gha cache).
  - Ardından `scripts/docker/smoke-compose.sh` çalışır (gizli değerler `openssl rand` ile üretilir) ve `check-context.sh` sır taraması yapılır.
  - Her durumda `down -v`.
- **Sabitleme:** Kullanılan action'lar ve `pgvector/pgvector` imajı SHA ya da digest ile sabitlenir.
- **D1 incelemesinden devredilenler:**
  - **pnpm doğrulaması:** `pnpm/action-setup` `+sha512` ekini doğrulamıyor. CI'da pnpm'in sabitlenen hash'le doğrulanması için şu sıra kullanılır:
    1. `setup-node` (`cache:` olmadan)
    2. `corepack enable && corepack install`
    3. `pnpm store path` için `actions/cache`
  - **Kontrol adımı:** `pnpm --version` = 12.6.0 kontrolü eklenir.
  - **Job ayarları:** `timeout-minutes` ve `concurrency` (cancel-in-progress) eklenir.
  - **Docker adımları:** `docker compose config` ve Docker derleme adımları `.env` olmadan çalışır; gizli değerler CI'da üretilir (D5 ile birlikte). Eski "Docker build backend/console" adımları D3/D4 Dockerfile'larıyla yenilenir. **Bu adımlar yenilenene kadar CI kırmızı kalır;** D1 öncesinde de kırmızıydı.
  - **Statik analiz:** `actionlint` ve `zizmor` ile workflow taraması yapılır.
  - **`check-toolchain.sh --install`:** yalnızca yerel `docker` driver'lı builder'da çalışır. CI'da `docker/setup-buildx-action`'dan önce koşturulur.
  - **Sürüm kontrolü:** `pmOnFail: ignore` pnpm'in kendi sürüm kontrolünü kapatır. `error` ve `warn` de kilit dosyasına boot belgesini yazar, bu yüzden kullanılamaz. CI'daki `pnpm --version` = 12.6.0 adımı bu açığı kapatır.
  - **Bağımlılık taraması:** CI'a osv-scanner (ya da dependency-review) adımı eklenir. Kilit dosyasının tek belgeli kaldığı `check-toolchain.sh` ile zaten doğrulanır.

**Test senaryoları:**
1. Workflow YAML geçerli (`actionlint`, yerelde varsa).
2. Duman betikleri yerelde CI ile aynı komutlarla geçer.
3. GitHub CI'ın gerçekten yeşil olması ancak push sonrası görülebilir. Push sizin onayınıza bağlı olduğu için raporda ayrıca belirtilir.

---

## Kritik dosyalar

- **Docker ve dağıtım:** `Dockerfile`, `.dockerignore`, `apps/console/Dockerfile`, `apps/console/Dockerfile.dockerignore` (yeni), `apps/console/nginx.conf`, `docker-compose.yml`, `docker-compose.dev.yml`, `docker/claude-cli/` (yeni)
- **Betikler:** `scripts/docker/*.sh` (yeni)
- **CI ve paketler:** `.github/workflows/ci.yml`, kök `package.json`, `packages/*/package.json`, `apps/kernel/package.json`
- **Kernel:** `apps/kernel/tsdown.config.ts`, `apps/kernel/src/migrate.ts` (yeni), `apps/kernel/scripts/admin-grant.ts`, `apps/kernel/src/studio/db-bootstrap.ts`, `apps/kernel/src/boot-phases/db-phase.ts`
- **Console:** `apps/console/src/hooks/useStudioWebSocket.ts`, `apps/console/src/lib/studio-api/pipeline.ts`
- **Belge:** `docs/` altında kısa bir kurulum notu

## Riskler

| Risk | Önlem |
|---|---|
| `pnpm deploy` derleme çıktısını düşürür | `files` alanı + imaj içinde her paketi `import()` eden duman testi (D2/D3) |
| Kalıcı `~/.claude` volume tüm tenant transcript'lerini biriktirir | Kullanıcı kararı; yalnızca kernel'e bağlı, `0700`; izolasyon epic'inde yeniden ele alınır |
| Salt-okunur kök dosya sistemi bilinmeyen bir yazma yolunu kırar | Duman testinde proje oluşturma ve agent çalıştırma; gerekli dizinler volume ya da tmpfs |
| Native modüller (cpu-features, ssh2, esbuild) | Derleme ve çalışma aşaması aynı bookworm; derleme araçları yalnızca deps aşamasında |
| F4 ile çakışma (roller) | Migrate servisi ve verify modu F4'ün migrator/app ayrımına hazırlık; kernel hâlâ süper kullanıcı bağlantısıyla çalışır, F4 değiştirecek |
| GitHub CI yalnızca push ile doğrulanır | Duman betikleri yerelde CI ile aynı komutla çalışır |

## Uçtan uca doğrulama

- **Her alt faz:** kendi senaryoları; kernel iki modda tam yeşil; console tsc ve vitest; lint.
- **Son durum:** temiz bir makinede `scripts/docker/smoke-compose.sh` uçtan uca geçer:
  - sıfır `compose up`
  - migrate
  - `/health`
  - console
  - WS
  - sır, kullanıcı ve port taramaları
  - admin-grant
  - kalıcılık
- **Manuel kontrol:** tarayıcıda `http://localhost:5161`'de giriş yapılır, proje oluşturulur ve canlı olaylar izlenir.
