# Plan — Tenant iş yükü izolasyonu (F4'ten önce zorunlu epic)

> Onay sonrası `docs/plans/2026-10-31-tenant-workload-isolation.md` olarak repoya kaydedilir. Ana plan: `docs/plans/2026-10-27-rls-tenant-isolation.md` ("Yeni epic (F4'ten önce)"). Önceki iş: `docs/plans/2026-10-31-production-docker-image.md`.

## Bağlam

Bugün tenant'ın etkileyebildiği her süreç kernel ile **aynı OS kullanıcısında ve aynı ağda** çalışıyor:
- **Agent CLI'ları:** Claude `bypassPermissions` ile Bash'e erişiyor, Codex `--full-auto`, Cursor `--trust --force` ile çalışıyor.
- **Üretilen uygulamalar:** dev server'lar ve önizleme.
- **Yardımcı işler:** kurulumlar, testler, lint, sonar.
- **İnteraktif terminal.**

Bu süreçler şunlara erişebiliyor:
- `/proc/<kernel>/environ` üzerinden `DATABASE_URL` (F4'e kadar superuser), `OSCORPEX_JWT_SECRET` (sahte admin JWT üretmek için yeterli) ve `OSCORPEX_VAULT_KEY`.
- Paylaşılan Claude OAuth dosyası.
- Tüm tenant repoları (`.oscorpex/repos/<projectId>`, düz dizin).
- Postgres, doğrudan ağ üzerinden.

Kernel de bu repolarda git ve dosya işlemlerini doğrudan yapıyor. Repodaki bir symlink ya da git ayarı, kernel'i kendi yetkisiyle dosya okumaya veya komut çalıştırmaya kandırabilir (confused deputy).

Mevcut docker.sock tabanlı container pool çalışmıyor:
- hata durumunda host'a düşüyor (fail-open)
- kimlik doğrulaması yok
- geri yazma adımı repo dışına yazabiliyor

Ayrıca bugün sömürülebilir, epic'ten bağımsız açıklar var. En kritiği: `cliTool:"custom"` ayarıyla tenant girdisi API anahtarlarıyla birlikte doğrudan komut olarak çalışıyor.

**Hedef:** Tenant iş yükleri, kernel sırlarını taşımayan ayrı bir runner konteynerinde tenant'a özel uid ile çalışır. Kernel repolara hiç dokunmaz. LLM kimlikleri kernel tarafındaki bir proxy'nin arkasında kalır; iş yalnızca kısa ömürlü, işe bağlı bir token görür. Ağ şöyle ayrılır: iş internete çıkabilir, iç servislere erişemez.

## Kullanıcı kararları

| Konu | Karar |
|---|---|
| Ortam | İzolasyon **her yerde zorunlu**; yerel geliştirme compose'a taşınır (kernel konteynerde, kaynak kod bağlı, tsx watch) |
| Sınır | Ayrı **runner konteyneri** (docker socket yok, kernel sırrı yok) |
| Tenant ayrımı | Tek runner içinde **tenant başına uid**. Kısmi ağ önlemleriyle başlanır; arayüz, ileride tenant başına runner'a geçilebilecek şekilde tasarlanır |
| Kapsam | Agent CLI'ları, üretilen uygulama (çalıştırma, önizleme, kurulum, test, lint, uygulama veritabanı), interaktif terminal; eski pool kaldırılır |
| Repo erişimi | **Kernel repoları hiç bağlamaz**; tüm git ve dosya işlemleri runner'da tenant uid'siyle yapılır, kernel boyutu sınırlı JSON alır |
| Ağ | İşler internete çıkar; postgres, kernel iç portları ve metadata adresi kapalı. Yalnızca kernel'in iş API'si ve LLM proxy'si açık |
| LLM kimliği | Kernel tarafında proxy, **tüm sağlayıcılar** için. Anthropic: API anahtarı ya da OAuth; OAuth **yalnızca tek operatörlü modda**. OpenAI ve Google: API anahtarı. Cursor: tenant kendi anahtarını getirir (BYOK) ve anahtar yalnızca o tenant'ın işlerine verilir |
| Eski veri | OAuth girişi yalnızca proxy tarafında kalır; eski transcript'ler taşınmaz |
| Acil açıklar | Ayrı bir ön faz (I0) olarak runner işinden önce kapatılır |

## Uzman incelemelerinden kabul edilenler

Mimari, güvenlik ve platform incelemeleri:
- **Kernel–runner kanalı:** Ortak `runner-ctl` volume'ünde unix socket'ler. Kernel ile runner'ın ortak ağı yoktur. Kimlik doğrulama HMAC challenge ile yapılır; anahtar compose `secrets:` ile verilir. mTLS sonraya bırakılır.
- **Uid:**
  - `tenant_runtime_ids` tablosu, 20000–59999 aralığında DB sekansıyla doldurulur; uid'ler **asla yeniden kullanılmaz**.
  - Neden bu aralık: 100000 üstü uid'ler rootless Docker ve userns-remap'te setuid hatası verir.
  - Kimlik çözümü: nss_wrapper ve işe özel geçici passwd.
- **Docker'ın kısıtları:** Docker içinde user namespace ve iş başına cgroup kullanılamıyor. Bu yüzden iş başına şu önlemler alınır:
  - `prlimit` (NPROC, CPU, FSIZE, NOFILE)
  - `oom_score_adj`
  - RSS izleme
  - süreç grubu öldürme
  - tenant'ın son işi bittiğinde, o uid'le `kill(-1)` gönderilerek kaçan daemon'lar temizlenir
- **Görünürlük:**
  - Prompt'lar ve sırlar argv'de değil stdin'de taşınır; `/proc/*/cmdline` diğer tenant'lara açık.
  - HOME tenant başına (kalıcı volume, 0700); TMPDIR iş başına tmpfs.
- **Egress:**
  - Tüm çıkış bir forward proxy'den geçer. Proxy DNS çözümlemesinden sonra özel, link-local, CGNAT ve metadata adreslerini reddeder.
  - Runner yalnızca internal `runner-net` ağındadır.
  - Tenant başına port blokları ve uid'e göre nft kuralları uygulanır.
- **Önizleme:** Kernel runner'a port göndermez. Önizleme `previewId` ile `preview.sock` üzerinden tünellenir.
- **Kernel runner çıktısına güvenmez:** Tüm alanlar şema doğrulamasından geçer ve boyut sınırlıdır; runner'dan gelen yollar host yolu olarak hiç kullanılmaz.
- **LLM proxy'si:**
  - İşe bağlı, opak ve iş bitince iptal edilen token.
  - Model allowlist, `max_tokens` sınırı ve rate limit.
  - Maliyet proxy'de ölçülür; bütçe koruması bu değeri kullanır, CLI'ın bildirdiğine güvenmez.
  - Prompt gövdesi içermeyen audit kaydı.
- **Uygulama veritabanları:** `db-provisioner`'ın `docker run` ile açtığı veritabanları ayrı bir `appdb` servisine taşınır; platform postgres'i hiç kullanılmaz.
- **Testler:**
  - Kernel testleri host'ta, sahte bir runner ile koşar.
  - Test veritabanı CI ile aynı olur: compose'daki pg16.
  - Runner testleri CI'da paralel bir `docker-runner` job'unda koşar.

## Ortak kurallar

- **Faz akışı:** Her faz test → kod → security-review → code-review sırasıyla ilerler. Bunlar ayrı ajanlardır, en fazla 2 tur yapılır. Ardından rapor → onay → **tek commit**.
- **Kapı:** `pnpm typecheck && pnpm lint && pnpm test` ve gerekirse console testleri. GitHub CI yeşil olmalı. Docker değişikliği varsa ilgili duman betikleri geçmeli.
- **Testlerin ortamı:** Kernel testleri hem yerel hem CI-ayna modunda koşar. CI-ayna modu: `.env` içermeyen worktree, pg16 ve `env -i`.
- **Davranış koruması:** Faz içinde bulunan yeni senaryolar raporda işaretlenir. Bir faz bitmeden sonraki faza geçilmez.
- **Sıra:** S0 ile I0 paralel → I1 → I2a → I2b → I3 → I4a → I4b → I5 → I6.
  - I0 hemen yayınlanır.
  - `pnpm dev` akışı I2a ile değişir. O fazın raporunda yeni geliştirme komutları açıkça verilir.
  - Her faz sonunda GitHub'a push edilip CI'ın yeşil olduğu görülür. Push onayı, faz onayıyla birlikte alınır.

---

## S0 — Ön denemeler (spike'lar, zaman kutulu, ürün kodu yok)

Sonuçlar bu plana eklenir. I2–I5'teki ayrıntılar değişirse kullanıcıya bildirilir. Denenecekler:

1. **Konteynerler arası temel mekanizmalar** (Docker Desktop/macOS ve ubuntu-24.04):
   - İki konteyner arasında named volume üzerinden unix socket paylaşımı.
   - Node `spawn({uid,gid,detached})`, yalnızca SETUID/SETGID/CHOWN/KILL yetenekleriyle.
   - `prlimit`, nss_wrapper.
   - `kill(-pgid)`, tini ile subreaper.
2. **Uid'e göre ağ kuralları:** `nft`/`iptables` `meta skuid` kuralları, runner'ın ağ ad alanında NET_ADMIN'li tek seferlik bir init konteyneriyle kurulabiliyor mu?
3. **Sağlayıcı CLI'larının proxy'lenebilirliği:**
   - **Claude Code:** `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` ya da `apiKeyHelper`; streaming; WebFetch ön kontrolü; telemetri ve gereksiz trafiği kapatan env'ler.
   - **Codex:** `OPENAI_BASE_URL` / `model_providers`, Responses streaming.
   - **Gemini CLI:** API anahtarı modunda base URL değiştirilebiliyor mu?
   - **Cursor:** Override olmadığını doğrula.
4. **Egress proxy uyumu:**
   - Pinlenen Node 22 imajında `NODE_USE_ENV_PROXY` destekleniyor mu?
   - npm, pnpm, git, pip ve CLI'lar `HTTPS_PROXY`'ye uyuyor mu?
   - Uymayan aracın kapalı kaldığını (fail-closed) doğrula.
5. **macOS'ta compose geliştirme döngüsü:**
   - Compose Watch + `tsx watch` performansı.
   - `node_modules` volume'de tutulursa davranış.
   - Host'taki Vite'ın 127.0.0.1:3141/3142'ye proxy'lenmesi.

**Çıktı:** Her madde için evet/hayır, gerekli ayar ve kısa kanıt.

### S0 sonuçları (2026-10-31)

Ortam: Docker Desktop 29.3, linuxkit 6.12 arm64, pinlenmiş node 22.23.4. Beş mekanizmanın hepsi çalışıyor. Aşağıdaki maddeler I2–I5'i değiştiriyor.

1. **nft kuralları runner yeniden başlayınca kayboluyor.** Ağ ad alanı her `docker restart` ve stop/start'ta yeniden oluşuyor; tek seferlik init konteyneri bu yüzden açık kalmaya (fail-open) düşüyor.
   - **Uygulanacak:** Runner entrypoint'i root + `NET_ADMIN` + `SETPCAP` ile kuralları yükler, ardından `exec setpriv --bounding-set=-net_admin,-setpcap --inh-caps=-all -- supervisor` çalıştırır. Kurallar her açılışta yeniden yüklenir.
   - **Açılış kontrolü:** Kurallar eksikse runner iş kabul etmez.
   - **Not:** `docker exec` konteynerin tüm yeteneklerini alır; bu operatör erişimidir.
2. **Supervisor uid 0 ile çalışmalı.** Ayar: `cap_drop: ALL`, `cap_add: SETUID, SETGID, CHOWN, KILL`, no-new-privileges, read-only rootfs.
   - uid 1001 ile eklenen yeteneklerin etkili değeri 0 kalıyor (ambient yok); `spawn` EPERM veriyor.
   - Node `spawn` ek grupları temizliyor.
   - DAC_OVERRIDE ve FOWNER olmadığı için supervisor tenant'ın 0700 dosyalarını okuyamıyor (istenen durum). Temizlik `rm`'i tenant olarak çalıştırır.
   - Tenant HOME'u şu sırayla kurulur: mkdir → chmod 0700 → chown.
3. **Cursor'un bir endpoint override'ı var** (`--endpoint` / `CURSOR_API_ENDPOINT`), ama kısmi: `api2.cursor.sh` yine çözümleniyor. BYOK kararı korunur; trafik egress allowlist'ten doğrudan çıkar.
4. **Codex 0.163.0 `OPENAI_BASE_URL`'i yok sayıyor.** Çalışan yöntem bir `model_providers` yapılandırması:
   ```toml
   model_provider = "oscx"
   [model_providers.oscx]
   base_url = "<proxy>/v1"
   env_key = "OSCX_LLM_TOKEN"
   wire_api = "responses"
   ```
   - Ek ayarlar: `[features] plugins=false` (github ve chatgpt.com çağrıları sıfırlanır), `check_for_update_on_startup=false`, analytics ve feedback kapalı.
   - Davranış: 401 alınca 5 kez yeniden deniyor.
5. **Claude:**
   - managed-settings'e `"skipWebFetchPreflight": true` eklenir; WebFetch'in alan adı kontrolü base URL'yi değil `api.anthropic.com`'u kullanıyor.
   - İş env'ine `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` verilir. `DISABLE_TELEMETRY` tek başına yetmiyor.
   - `ANTHROPIC_AUTH_TOKEN` ile `POST /v1/messages?beta=true` Bearer ile gidiyor; streaming çalışıyor.
6. **İş env'i:** `NODE_USE_ENV_PROXY=1` ve `NO_PROXY=<llm-proxy>`.
   - Birincisi olmadan corepack/pnpm ve Node fetch proxy'yi yok sayıyor.
   - İkincisi olmadan Claude, token'lı LLM isteğini egress proxy'sinden geçiriyor.
7. **tini zorunlu.** Node PID 1 olunca zombi süreçler birikiyor, uid başına NPROC sınırını tüketiyor ve işler takılıyor. NPROC sınırı thread'leri de sayar ve host genelinde uid başına uygulanır; en az 512 olmalı.
8. **Compose'da geliştirme:**
   - Kernel `HOST=0.0.0.0` ile dinlemeli; port `127.0.0.1:3141:3141` olarak yayınlanır.
   - Compose Watch + `tsx watch ./src` (tsx 4.21.0): değişiklikten yeniden başlamaya median 0,9 sn.
   - `node_modules` named volume'de kilit dosyası değişince eskiyor; yeniden derleme gerekir.
9. **`runner-ctl` named volume olmalı.** macOS bind mount'unda socket chmod'u başarısız oluyor.
10. **Gemini 0.64.0:**
    - `GOOGLE_GEMINI_BASE_URL` çalışıyor (`x-goog-api-key`).
    - Gerekli ayarlar: `security.auth.selectedType="gemini-api-key"`, `GEMINI_CLI_TRUST_WORKSPACE=true`, `privacy.usageStatisticsEnabled=false`.
    - Sistem ayar dosyası `/etc/gemini-cli/settings.json` root'a ait olmalı.
11. **Doğrulanmış nft kuralları:**
    - Kural sırası:
      1. established/related bağlantılar kabul (gerekli)
      2. uid < 20000 kabul
      3. Docker DNS kabul
      4. loopback'te `skuid . dport` set'iyle tenant port blokları
      5. loopback'te diğer her şey reset
      6. proxy IP:3128 kabul
      7. özel adres ve metadata reset
    - Savunma derinliği için en sona "uid ≥ 20000'den kalan her şey reddedilir" kuralı eklenir.
    - Sonuç: Tenant'lar birbirinin portlarına erişemiyor; özel IP'ler ve `169.254.169.254` reddediliyor.
12. **Diğer doğrulananlar:**
    - Unix socket named volume'de çalışıyor (dizin root:X 0750, socket 0660 grup X).
    - `prlimit` sınırları uygulanıyor.
    - nss_wrapper `whoami`, `os.userInfo()` ve `getpass`'i düzeltiyor; git için ayrıca `GIT_AUTHOR_*` ve `GIT_COMMITTER_*` env'i gerekiyor.
    - `kill(-pgid)` CAP_KILL istiyor. `setsid` yapan bir alt süreç bundan kaçıyor; onu tenant olarak çalıştırılan `kill -KILL -1` temizliyor.
    - Internal ağda dış DNS çözülmüyor (DNS ile veri sızdırma yok). Doğrudan IP denemesi ENETUNREACH alıyor; npm, git, pip, curl ve Claude proxy env'ine uyuyor.
13. **CI (ubuntu-24.04):** User namespace remap'i olmayan bir Linux host'ta tenant uid'leri gerçek host uid'leridir ve NPROC sınırı host genelinde sayılır. `docker-runner` job'u 20000–59999 aralığının host'ta kullanılmadığını kontrol eder.

---

## I0 — Acil sertleştirme (runner'dan bağımsız, bugün sömürülebilir açıklar)

**Değişiklikler:**

1. **`cliTool:"custom"` tamamen kaldırılır.**
   - Tüm şemalarda zod enum kullanılır; takım POST/PUT gövdeleri strict şemadan geçer (`validation-schemas.ts:36`, `team-routes.ts:312,441`).
   - Veritabanına CHECK kısıtı eklenir; mevcut `custom` satırları `claude-code`'a taşınır.
   - `agent-runtime.ts:109-113` dalı silinir.
   - `behavioral-prompt.ts:40` marker baypası artık işe yaramaz; test bunu kanıtlar.
2. **Prompt'lar argv yerine stdin ile verilir** (agent-runtime, planner-cli, legacy runtime). Desteklemeyen CLI'larda prompt'tan önce `--` gelir. Böylece `--settings=…` ya da `-c …` bayrak olarak yorumlanamaz.
3. **`cli-language-model.ts`:**
   - `--tools ""`, `bypassPermissions` kaldırılır.
   - Boş bir `mkdtemp` cwd'de çalışır ve iş bitince silinir.
   - `claudeSafeSettingArgs()` korunur.
4. **Kurulumlar** (`repo-dependency-sync.ts:104` ve tüm install yolları):
   - `--ignore-scripts --ignore-pnpmfile`.
   - yarn için `YARN_IGNORE_PATH=1`; `.yarnrc.yml` `yarnPath` içeriyorsa kurulum reddedilir.
5. **Eski container pool kaldırılır:**
   - `container-pool.ts`, `container-manager.ts`, `execution-workspace.ts` container dalı, `docker/coder-agent`, `docker-compose.pool.yml`, compose `agents` profili.
   - `isolationLevel: "container"` açık bir hatayla reddedilir; host'a düşmez.
   - agent-routes'taki container uç noktaları kaldırılır.
   - Eski pool kaldırıldığı için geri yazmadaki yol aşma açığı da kalkar. Workspace geri yazmasındaki yol kontrolü yine de `resolve + sep` ile sıkılaştırılır.
6. **Kernel dosya okumaları symlink yarışına karşı güvenli:**
   - Okuma sırası: `O_NOFOLLOW` ile aç → `/proc/self/fd` ya da `fstat` + realpath kapsama kontrolü → fd'den oku. macOS'ta eşdeğeri: `fs.realpath` + `lstat` + fd ile karşılaştırma.
   - `git-manager.ts:303-320` ve `isolated-workspace.ts:103-107` düzeltilir.
   - `mkdir` kontrolden sonra yapılır.
   - Not: Bu geçici bir önlem; I2'den sonra kernel repolara hiç dokunmayacak.
7. **Git sertleştirmesi:** `gitSafeEnv`'e komut çalıştırabilen ayarlar eklenir:
   - `core.sshCommand=`, `core.pager=cat`, `diff.external=` ve `--no-ext-diff`.
   - textconv ve `filter.*` kapatılır (`--no-textconv`; mümkünse `filter.<x>.process` için `-c filter.*.required=false` ve `.gitattributes` yok sayma).
   - `include.path` ve `alternates` etkisizleştirilir: `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_ALTERNATE_OBJECT_DIRECTORIES=` boş.
   - Not: Repo içi `.git/config` hâlâ okunur. Asıl çözüm I2.
8. **Cursor `--force` / `--trust`:** Yalnızca açık kullanıcı kararıyla kullanılır, varsayılan olmaz. Bugünkü davranış raporlanıp korunabilir; I4'te yeniden ele alınır.
9. **Sır argv'de olmasın:** `sonar-runner.ts:124-127`'deki token argv'den env'e taşınır.
10. **İstek gövdesinden yol alınmaz:** Envanter iki yer daha buldu:
    - `observability/rag.ts:356,390`, gövdedeki `projectPath`'le dosya okuyor.
    - `routes/test-routes.ts:30`, gövdedeki `repoPath`'te test çalıştırıyor.

    İkisi de yalnızca `projectId` alacak. Yol, `assertProjectInTenant` ile sunucu tarafında projeden çözülecek.

**Test senaryoları:**

1. **`custom` reddi:**
   - `custom` agent yapılandırması tüm rotalarda 400 alır.
   - Marker baypas istismar testi: `node -e … ## Engineering Principles (shared)` çalışmaz.
   - Veritabanındaki `custom` satırları taşınmıştır; CHECK kısıtı yeni `custom` satırını reddeder.
2. **Argüman enjeksiyonu yok:** `--settings=/x` ya da `-c foo` içeren bir prompt, sahte bir CLI ikilisinin kaydettiği argv'de bayrak olarak görünmez; prompt stdin'den gelir.
3. **`cli-language-model`:** Sahte ikilinin kaydettiği argv'de `--tools ""` var, `bypassPermissions` yok; cwd boş bir geçici dizin ve iş bitince siliniyor.
4. **Kurulum betikleri:** Kanarya `postinstall`, `.pnpmfile.cjs` ve yarn `yarnPath` çalışmaz.
5. **Container seviyesi:** Pool olmadan `isolationLevel: container` hata verir; host'ta çalışmaz.
6. **Symlink yarışı:**
   - Kontrol ile okuma arasında dosya symlink'le değiştirilince okuma başarısız olur.
   - Repoya konan `README.md → /proc/self/environ` okunmaz.
7. **Git:** Repoya konan `.git/config` filter, textconv, sshCommand, pager ve include ayarları kernel'in git çağrılarında çalışmaz; kanarya dosyalar oluşmaz.
8. **Sonar:** Token argv'de görünmez.
9. **İstekten gelen yollar:**
   - RAG indeksleme ve test rotaları gövdedeki bir yolu kabul etmez; 400 döner.
   - Başka tenant'ın `projectId`'si 404 alır.
   - `../` ya da mutlak yol denemeleri reddedilir.
10. **Regresyon:** Normal agent görevi, planner, review ve kurulum akışları değişmez. Kernel paketi iki modda, P0–P13 ve console yeşil.

### I0 sonuçları (2026-11-01)

İki inceleme turundan sonra kullanıcı onayıyla bir üçüncü düzeltme turu ve dar kontrol yapıldı. Plana göre değişen kararlar:

- **Git ön kontrolü bir izin listesi.** Repo ayarları (local, worktree ve include'lar) üç sınıfa ayrılır:
  - bilinen güvenli,
  - kernel'in komut kapsamında etkisizleştirdiği,
  - geri kalan her şey; bunlar reddedilir: `includeIf`, `extensions.*`, merge driver'ları, `url.*`, …

  Ek güvenceler:
  - `.git` gerçek bir dizin olmalı; `safe.bareRepository=explicit`.
  - Alternates karantinaya alınır.
  - Submodule'lar:
    - status ve diff `--ignore-submodules=all` ile çalışır, checkout `--quiet` ile;
    - commit'ten önce kayıt edilecek değişiklik var mı diye bakılır;
    - `git add` gitlink'leri dışarıda bırakır.
  - İstekten gelen ref'ler doğrulanır. `--end-of-options` kullanılır; ancak checkout'ta sona `--` konur, çünkü git 2.43'ten önce checkout bu seçeneği tanımıyor (runtime imajında git 2.39).
- **Sonar I5'e kadar kapalı.** Tarama ve kalite kapısı 409 döner, ayarlar kaydedilebilir. Sebep: tarayıcı motoru ayarlanan sunucudan indirip çalıştırıyor, ve repodaki `sonar-project.properties` platform token'ını yönlendirebiliyor.
- **Kurulum:**
  - npm'de git ikilisi env ile sabitlenir.
  - Yarn bayrakları, gerçekten çalışacak `yarn --version`'a göre seçilir.
  - Kurulum dizininden repo köküne kadar fiziksel yolda herhangi bir `.yarnrc*` varsa kurulum reddedilir; yani Yarn Berry I5'e kadar desteklenmez.
  - Servis dizininin gerçek yolu repo dışına çıkıyorsa kurulum ve uygulama başlatma reddedilir.
- **Sandbox:** Workspace ya da politika çözümlemesi başarısız olursa görev başarısız olur; görev kaynak repoda asla çalışmaz.
- **Prompt'lar:** Tüm CLI yollarında stdin'den verilir. Stdin hataları dinlenir (EPIPE).
- **SSRF:** `utils/url-validator.ts` `net.BlockList` kullanır; v4-mapped IPv6 normalize edilir ve IP literal'leri DNS'e hiç gitmez.
- **Docker:** `dockerode` ve imajdaki derleme araçları aşaması kaldırıldı.

**Kalan riskler** (kabul edildi; I2 veya I5'te kapanacak):
- Ön kontrol ile git çağrısı arasında, ve realpath ile spawn arasında TOCTOU.
- `.gitmodules` yalnızca index'te ya da HEAD'de olduğunda yalnız komut başına önlemler devrede.
- İçe aktarılmış repoda bozuk `.git` varken aynı tenant'ın üst reposuna kayma.
- Yarn sürüm tespiti ile kurulum arasında `packageManager` değiştirilmesi.
- JS dışı kurulumlar (mvnw, gradlew, bundle, pip, cargo) ve uygulamanın kendisi tenant kodu çalıştırır.
- macOS'taki contained-fs yolu path tabanlı (yalnızca dev).
- `/etc/hosts`'ta tanımlı isimler adres doğrulamasında çözümlenmemiş sayılıyor; Sonar yeniden açılmadan önce düzeltilmeli.

**Takip:** CI kernel testlerini runner'ın git'iyle (2.5x) koşuyor, runtime imajındaki git 2.39 ile değil. Git'e dokunan testlerin runtime imajının git sürümüyle de koşması gerekiyor; bu, I2'de runner işiyle birlikte yapılacak.

---

## I1 — Soyutlama katmanları (davranış değişmez)

**Değişiklikler:**

- **İki arayüz tanımlanır:**
  - **`WorkloadRunner`:** iş başlatma. Parametreler: `kind`, `argv`, `stdin`, env allowlist, `cwdRel`, `deadline`, `limits`, log callback, iptal. Sonuç: `CLIRunResult` ile uyumlu. Yaklaşık 24 spawn yeri (envanterden).
  - **`RepoAccess`:** Repo işlemleri; envanterdeki yaklaşık 150 çağrı yeri buraya toplanır.
    - **Dosya:** `readFile(p,{maxBytes})` (~25), `exists/stat` (~15), `listTree(sub,{depth,max,ignore})` (6), `writeFile(p,data,{mode})` (~20), `remove`, `search`.
    - **Git:** `status`, `currentBranch`, `listBranches`, `log`, `diff({ref,paths,cached,stat,maxBytes})` (9), `show`, `checkout`, `createBranch`, `merge`, `revert`, `commit`, `init`, `remoteUrl`.
    - **Üst düzey:**
      - `analyzeProject()`: `runtime-analyzer` ve uygulama tespitindeki yaklaşık 90 eşzamanlı dosya kontrolünü tek çağrıda toplar. Bu dosyalar async'e geçer.
      - `env.read/write`: proje `.env`'i.
      - `scaffold(docs|lint|sonar|template)`.
      - `workspace.isolate/writeBack`.
    - **Sınırlar:** Her okuma boyut sınırlı ve `truncated` bayrağıyla döner. Binary dosyalar base64 ya da boyut kapısıyla ele alınır. Symlink ve realpath kontrolleri I2'de runner tarafında yapılır.
- **Ölü kod temizliği:** Yalnızca testlerden çağrılan git servisleri silinir ya da arayüze bağlanır: `git/commit-executor`, `commit-proposal-service`, `git-rollback`, `git-checkpoint-service`, `checkpoint-service`'in checkout'u. Silmeden önce üretimde çağıran olmadığı doğrulanır.
- **Eşzamanlı git'in kaldırılması:** `diff-capture`, `read-only-tools` ve `terminal-routes`'taki eşzamanlı `execFileSync` git çağrıları async `RepoAccess`'e taşınır; event loop artık bloklanmaz.
- **`LocalRunner` / `LocalRepoAccess`:** Bugünkü davranışı birebir uygular.
- **Seam'ler:**
  - `packages/provider-sdk/src/cli-runner.ts` `runCLI` `WorkloadRunner`'a delege eder; adapter'lar değişmez.
  - Tüm repo git/fs çağrı yerleri `RepoAccess`'e taşınır.
  - Tüm spawn yerleri (kurulum, test-gate, lint, sonar, app-runner, terminal) `WorkloadRunner`'a taşınır.
  - `db-provisioner` bir `AppDbProvisioner` arayüzünün arkasına alınır.
- **AST koruma testi:** `child_process` ve repo yollarında `node:fs`, seam dosyaları dışında yasaktır (allowlist).

**Test senaryoları:**

1. **Regresyon:** Kernel ve console paketleri, P0–P13 ve tüm duman betikleri değişmeden geçer.
2. **AST koruması:** Seam dışında yeni bir `spawn` ya da repo fs çağrısı eklenirse test düşer (negatif fixture). `f3-0-child-env-coverage` taraması yeni yapıya uyarlanır.
3. **Sözleşme testi:** Aynı test seti hem `LocalRunner`'a hem I2'de sahte runner'a uygulanır.
4. **Sınırlar:** `RepoAccess` okumaları sınırı aşınca `truncated` döner. Bugün sınırsız olan `getDiff` ve `getFileContent` artık sınırlı.
5. **Davranış testi olmayan yollar:** Önce bugünkü davranışı kilitleyen testler yazılır, sonra taşınır. Bunlar:
   - `git-file-routes`
   - `vcs-phase-hooks`
   - `document-indexer`
   - `read-only-tools`
   - `diff-capture`

---

## I2 — Runner servisi, protokol ve repoların runner'a taşınması (ortak tek job uid)

> Boyutu nedeniyle iki commit'e bölünür:
> - **I2a:** runner, protokol, `WorkloadRunner` uzaktan çalıştırma, compose'da geliştirme ve CI. Repolar bu aşamada hâlâ iki tarafta da bağlı.
> - **I2b:** `RepoAccess` RPC'ye geçer ve kernel'in repo bağlantısı kaldırılır.
>
> Senaryolar aşağıda her iki aşama için birlikte listelenmiştir; hangisinin hangi aşamada test edildiği uygulama raporunda belirtilir.

**Değişiklikler:**

- **Runner (yeni workspace `apps/runner`, kök Dockerfile'da `runner` target'ı):**
  - Supervisor: Node, tini PID 1.
  - CLI'lar `/opt/<cli>`'de, her biri kendi kilit dosyasıyla.
  - Toolchain'ler: python3, make/g++, git, nss_wrapper.
  - Sertleştirme: read-only rootfs, no-new-privileges, `cap_add` yalnızca SETUID/SETGID/CHOWN/KILL. Kernel imajından Claude CLI çıkarılır.
- **Protokol** (`runner-ctl` volume'ünde `jobs.sock`, HMAC challenge):
  - Mesajlar: `start`, `out{seq,fd,bytes}`, `credit`, `cancel{graceMs}`, `exit{code,signal,reason}`, `fs.*`, `git.*`.
  - Süreç yönetimi: setsid, setgroups `[]` + setresuid, `NO_NEW_PRIVS`, rlimit'ler.
  - Sınırlar: deadline'ı runner uygular, çıktı boyutu sınırlı.
  - Dayanıklılık: lease (kernel N saniye görünmezse iş öldürülür), `bootId` ve yeniden bağlanma raporu, `attemptId` ile idempotent başlatma.
- **Kernel tarafı:**
  - `RunnerWorkloadRunner` / `RunnerRepoAccess` istemcileri.
  - Kernel **repo volume'ünü bağlamaz.**
  - Runner'dan gelen her yanıt şema doğrulamasından geçer ve boyut sınırlıdır.
  - Runner olmadan açılış reddedilir (testler hariç; testler sahte runner kullanır).
- **Bu fazda uid:** Tüm tenant'lar için ortak tek bir job uid (20000). Kernel sırları ve postgres ağı iş tarafından zaten görünmez; tenant ayrımı I3'te.
- **Workspace kopyaları:** `isolated-workspace` geçici kopyaları runner'da yapılır.
- **Geliştirme compose'da:**
  - `docker-compose.dev.yml`: backend için `target: dev`, `tsx watch` ve Compose Watch.
  - 3141/3142 `127.0.0.1`'e yayınlanır; console Vite host'ta kalır.
  - `pnpm dev`, `docker compose … up --watch` olur.
  - Dev postgres pg16; kernel testleri host'ta bu veritabanına karşı ve sahte runner ile koşar.
  - CLAUDE.md ve README komutları güncellenir.
- **CI:** Paralel `docker-runner` job'u ve `scripts/docker/smoke-runner.sh`.

**Test senaryoları:**

1. **Sır erişimi yok:** Runner'daki bir iş (Bash'li agent simülasyonu) şunlara erişemez:
   - `/proc/1/environ` (runner supervisor'ı), kernel'in env'i
   - `DATABASE_URL` ve `OSCORPEX_*` değerleri
   - `/run/secrets`
   - OAuth dosyası
   - docker.sock
2. **Ağ:** Postgres, `backend:3141/3142` ve `169.254.169.254` erişilemez.
3. **İptal ve süre:**
   - İptal, Bash'in alt süreçleri dahil tüm ağacı öldürür.
   - Deadline aşılınca iş öldürülür.
   - Çıktı sınırı aşılınca kesilir ve kernel'in belleği şişmez.
4. **Dayanıklılık:**
   - Kernel yeniden başlayınca çalışan işler raporlanır ve yeniden bağlanılır.
   - Runner yeniden başlayınca işler `lost` olur ve mevcut retry/watchdog yolu çalışır.
5. **Kanal güvenliği:** HMAC'siz ya da yanlış HMAC'li istemci reddedilir; tekrar oynatılan (replay) istek reddedilir.
6. **Repo işlemleri:**
   - Kernel konteynerinde repo dizini yoktur.
   - Tüm git ve dosya işlemleri RPC ile çalışır: dosya tarayıcı, diff, commit, checkpoint, geri yazma.
   - Runner'ın döndürdüğü kötü niyetli bir yol (`../`) ya da aşırı büyük yanıt reddedilir.
7. **Compose geliştirme döngüsü:**
   - Kaynak dosyada değişiklik yapınca kernel yeniden başlar.
   - Host'taki Vite API ve WebSocket'e ulaşır.
8. **Regresyon:**
   - Kernel paketi (sahte runner ile) yeşil.
   - `smoke-kernel.sh`, `smoke-console.sh` ve `smoke-compose.sh` yeni yapıya uyarlanıp geçer.
   - Uçtan uca: bir projede gerçek bir görev runner'da çalışır ve dosya yazar. Bu adım için operatörün Claude kimliği gerekir; elle yapılır.

---

## I3 — Tenant başına uid

**Değişiklikler:**

- **Uid tablosu:** `tenant_runtime_ids(tenant_id PK, uid UNIQUE, created_at)`.
  - Sekans 20000'den başlar; 59999'u aşarsa hata.
  - Tenant silinse de satır silinmez (uid yeniden kullanılmaz).
  - `init.sql`'e eklenir; `table-classification` ve RLS durumu belirlenir.
- **Dizin düzeni:**
  - Repolar `/repos/<uid>/<projectId>`; `/repos/<uid>` 0700 ve tenant uid'sine ait.
  - Tenant HOME'u `/homes/<uid>` (0700): pnpm store, `CLAUDE_CONFIG_DIR` ve CLI ayarları.
- **Supervisor yetkileri:** Yalnızca mkdir ve chown yapar. Diğer tüm dosya işlemleri tenant uid'siyle çalışan bir yardımcıda yapılır.
- **Sınırlar ve temizlik:**
  - `RLIMIT_NPROC` uid başına uygulanır.
  - Tenant'ın son işi bitince o uid'le `kill(-1)` süpürmesi yapılır.
- **Taşıma:** Tek seferlik `repos-init` servisi (root, CHOWN+FOWNER, ağ yok). migrate'in yazdığı proje→uid eşlemesine göre `chown -hR` yapar ve bir marker dosyası bırakır.

**Test senaryoları:**

1. **Tenant ayrımı:** A'nın işi şunlara erişemez:
   - B'nin reposu, HOME'u, `/tmp` dosyaları ve `/proc/<B süreci>/environ`'u
   - B'nin işini öldürme (`kill`)
2. **Uid tahsisi:**
   - Silinen bir tenant'ın uid'si yeni tenant'a verilmez.
   - Aralık dolunca açık bir hata verilir.
3. **Taşıma:** Mevcut repolar doğru uid'lere geçer; ikinci çalıştırma idempotenttir.
4. **Kaynak sınırları:** Fork bombası yalnızca o tenant'ın NPROC sınırına takılır; diğer tenant'ın işi çalışmaya devam eder.
5. **Regresyon:** I2 testlerinin tamamı.

---

## I4 — LLM kimlik proxy'si

### I4a — Anthropic

**Değişiklikler:**

- **Proxy:** Kernel'de, ayrı bir dinleyicide, yalnızca `runner-net`'ten erişilebilir.
- **İş token'ı:** İşe özel ve opak. TTL iş süresinden kısa; iş bitince iptal edilir; tenant'a ve işe bağlıdır.
- **Kontroller:** model allowlist, `max_tokens` sınırı, rate limit.
- **Bütçe:** Maliyet proxy'de ölçülür ve `enforceBudgetGuard` bu değeri kullanır.
- **Audit:** Prompt gövdesi içermez.
- **Runner tarafı:**
  - managed-settings `ANTHROPIC_BASE_URL`'i proxy'ye yönlendirir; işe `ANTHROPIC_AUTH_TOKEN` olarak iş token'ı verilir.
  - Repo `.claude/settings.json` ile base URL değiştirilirse yalnızca iptal edilmiş, değersiz bir token sızar.
- **Çalışma modu ayarı** (tek operatör / çok tenant): Çok tenant modunda API anahtarı zorunlu, OAuth reddedilir. Tek operatör modunda OAuth token yenilemesi proxy'de yapılır (`cli-usage/oauth.ts`).

### I4b — OpenAI (Codex), Google (Gemini), Cursor

**Değişiklikler:**

- **Codex ve Gemini:** API anahtarı modunda aynı proxy deseni (S0 sonucuna göre). ChatGPT ve Google girişleri izole modda reddedilir.
- **Cursor (BYOK):** Tenant kendi anahtarını girer; anahtar vault'ta şifrelenir ve yalnızca o tenant'ın Cursor işine verilir. Diğer tenant'lar ve kernel loglarında görünmez.

**Test senaryoları:**

1. **Gerçek anahtar sızmaz:** İşin env'inde ve dosya sisteminde gerçek API anahtarı ya da OAuth token'ı yoktur.
2. **Token yaşam döngüsü:**
   - İş bittikten sonra token 401 alır.
   - A'nın token'ı B'nin bütçesini harcayamaz.
3. **Kontroller:**
   - İzin listesinde olmayan model 403 alır.
   - `max_tokens` sınırı uygulanır.
   - Bütçe aşılınca istek reddedilir ve pipeline duraklatılır.
4. **Base URL değiştirme:** Repo ayarıyla base URL değiştiren bir iş yalnızca iptal edilmiş token'ı sızdırır.
5. **Çalışma modu:** Çok tenant modunda OAuth yapılandırması açılışta reddedilir.
6. **Diğer sağlayıcılar:**
   - Codex ve Gemini proxy üzerinden çalışır.
   - Cursor BYOK anahtarı yalnızca sahibinin işinde görünür.
7. **Regresyon:** Maliyet ve telemetri raporları; tek operatör modunda OAuth akışı.

---

## I5 — Ağ, önizleme, terminal ve uygulama veritabanları

**Değişiklikler:**

- **Egress:**
  - `runner-net` internal kalır. Egress `egress-proxy` servisinden geçer: `resolveAndValidateUrl` yeniden kullanılır; DNS çözümlemesinden sonra özel, link-local, CGNAT, metadata ve host-gateway adresleri reddedilir; trafik iş token'ıyla ilişkilendirilir.
  - İş env'ine `HTTPS_PROXY` ve `NODE_USE_ENV_PROXY` verilir.
- **Uid'e göre nft kuralları:** Ağ ad alanında tek seferlik bir init ile kurulur.
  - Tenant uid'si yalnızca kendi port bloğunda dinleyebilir ve loopback'te yalnızca kendi bloğuna bağlanabilir.
  - Supervisor soketine yalnızca root erişebilir.
- **Önizleme:**
  - Supervisor `preview.sock` sunar ve portları kendisi tahsis eder; `lsof` hatası da düzelir.
  - `runtime-routes.ts` proxy'si undici `socketPath` ile `previewId` üzerinden çalışır; kernel port göndermez. HMR tünellenir. Önizleme yanıtlarında CSP sandbox korunur.
- **Uygulama durumu:** `app-runner` state'i runner'dan okunur.
- **Terminal:** Allowlist'teki komutlar akışlı kısa işler olarak runner'da çalışır.
- **Uygulama veritabanları:** `appdb` servisi (ayrı postgres, `runner-net`'te). `db-provisioner` orada tenant başına veritabanı ve kullanıcı oluşturur; platform veritabanını hiç kullanmaz.
- **Console:** LivePreview iframe'i aynı origin'deki önizleme rotasını kullanır. Docker'daki LivePreview kısıtı da böylece kalkar.

**Test senaryoları:**

1. **Egress:**
   - A'nın işi postgres'e, `backend` iç portlarına, supervisor soketine, `169.254.169.254`'e, `host.docker.internal`'a ve B'nin dev server'ına bağlanamaz.
   - DNS rebinding ile bir iç IP'ye yönlendirilen istek reddedilir.
   - Egress proxy'yi atlayan araç dışarı çıkamaz.
2. **Port blokları:** A, B'nin port bloğunda dinleyemez (port gaspı başarısız).
3. **Önizleme:**
   - Önizleme yalnızca kernel'in atadığı hedefe gider; runner'ın bildirdiği bir host veya port kabul edilmez.
   - HMR çalışır.
   - 404 HTML'i escape edilir.
4. **Terminal:** Allowlist dışındaki komut reddedilir; komutlar tenant uid'siyle çalışır.
5. **Uygulama veritabanları:** `appdb` veritabanları tenant başına ayrıdır; A, B'nin veritabanına bağlanamaz.
6. **Regresyon:** Önizleme ve LivePreview tarayıcıda çalışır (Playwright); kernel ve console paketleri yeşil.

---

## I6 — Kapanış

**Değişiklikler:**

- **Belgeler:** `docs/docker-setup.md`, CLAUDE.md ve README güncellenir. Tehdit modeli belgesi yazılır: neyi durdurduğu, neyi durdurmadığı ve kalan riskler. Kalan riskler:
  - Aynı runner'da paylaşılan geçici portlar ve bellek.
  - Supervisor ele geçirilirse.
  - Çekirdek istismarı.
  - Tenant'ın kendi verisini egress ile dışarı çıkarması.
- **Ana plan:** RLS planının F4 notları güncellenir. Agent ortamında artık sır olmadığı için aynı-uid riski kapanır.
- **Doğrulama:** Tüm duman betikleri, iki tenant'lı tarayıcı kontrolü ve gerçek bir agent görevinin uçtan uca çalışması (operatörle).

---

## Kritik dosyalar

- **Kernel:**
  - Agent ve CLI çalıştırma: `agent-runtime.ts`, `cli-language-model.ts`, `planner-cli.ts`, `legacy/cli-runtime.ts`
  - Kurulum, test ve lint: `repo-dependency-sync.ts`, `test-gate.ts`, `test-runner.ts`, `lint-runner.ts`, `sonar-runner.ts`, `task-runners.ts`
  - Uygulama ve önizleme: `app-runner/*`, `routes/runtime-routes.ts`, `routes/terminal-routes.ts`, `db-provisioner.ts`
  - Repo erişimi: `git-manager.ts`, `git/*`, `diff-capture.ts`, `execution/isolated-workspace.ts`, `execution/provider-execution-service.ts`
  - Güvenlik: `security/env-sanitizer.ts`, `git/git-safe-config.ts`, `budget-guard.ts`
  - Doğrulama: `validation-schemas.ts`, `team-routes.ts`
  - Eski pool: `container-*.ts`, `execution-workspace.ts`
- **Paketler:** `packages/provider-sdk/src/cli-runner.ts`, `adapters/*/src/index.ts`
- **Yeni:** `apps/runner/` (supervisor), egress-proxy, kernel'de LLM proxy modülü
- **Altyapı:** Kök `Dockerfile` (runner target'ı), `docker-compose.yml`, `docker-compose.dev.yml`, `docker/claude-cli/managed-settings.json`, `scripts/docker/*.sh`, `.github/workflows/ci.yml`
- **Veritabanı:** `apps/kernel/scripts/init.sql` (`tenant_runtime_ids`, `custom` CHECK, proxy token ve audit tabloları)

## Riskler

| Risk | Önlem |
|---|---|
| Epic çok büyük | Fazlar tek tek yayınlanabilir; I0 hemen değer üretir; I2 en büyük faz, gerekirse I2a (exec) ve I2b (repo RPC) olarak bölünür |
| Docker Desktop'ta mekanizmalar farklı davranır | S0 spike'ları; CI ubuntu-24.04'te gerçek doğrulama |
| Sağlayıcı CLI'ları proxy'yi desteklemez | S0; desteklemeyen sağlayıcı izole modda kapalı kalır ya da BYOK'a düşer |
| Geliştirme döngüsü yavaşlar | Compose Watch, `node_modules` volume'de, testler host'ta sahte runner ile |
| Kernel–runner kanalının tek nokta olması | Lease, `bootId`, idempotent `attemptId`; runner düşerse işler `lost` olur ve retry yoluna girer |
| Tek runner'da tenant'lar arası kalan riskler | Tehdit modelinde açıkça belgelenir; arayüz, tenant başına runner'a geçişe hazır |

## Uçtan uca doğrulama

- **Her faz:** Kendi senaryoları, kapı komutları (iki mod) ve GitHub CI yeşil.
- **I2'den itibaren:** `smoke-runner.sh`, yalıtım saldırılarını gerçekten deneyen bir betik:
  - `/proc` ve sır okuma
  - başka tenant'ın reposu
  - ağ: postgres, kernel ve metadata
  - fork bombası
  - süreç ağacının öldürülmesi
- **Epic sonu:**
  - İki tenant'la tarayıcıda önizleme ve terminal kontrolü.
  - Gerçek bir agent görevinin uçtan uca çalışması (operatörün kimliğiyle).
  - Kötü niyetli repo içeriğiyle (symlink'ler, git ayarları, postinstall) kernel'in etkilenmediğinin kanıtı.
