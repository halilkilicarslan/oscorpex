# Docker kurulumu

Production stack: `postgres` -> `migrate` (tek seferlik şema uygulama) -> `backend` (kernel) -> `console` (nginx, tek origin).
Dışarıya yalnızca console yayınlanır: `127.0.0.1:5161`. Kernel ve postgres host'tan erişilemez.

## Gerekli değişkenler

Shell'de ya da `docker-compose.yml`'in yanındaki `.env` dosyasında (commit'lenmez) verilir.

| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `POSTGRES_PASSWORD` | evet | Veritabanı parolası. URL'e gömüldüğü için hex üretin. |
| `OSCORPEX_JWT_SECRET` | evet | JWT imza sırrı. |
| `OSCORPEX_CONSOLE_PORT` | hayır | Console'un host portu (varsayılan `5161`, yalnızca `127.0.0.1`). |
| `ANTHROPIC_API_KEY` | hayır | Claude CLI dışındaki sağlayıcı çağrıları için. |

Zaten bir `.env` dosyanız varsa iki değişkeni elle ekleyin. Yeni bir `.env` oluşturmak için (mevcut dosyanın üzerine yazmaz, varsa dokunmayın; sırlar yalnızca bir kez üretilir):

```bash
[ -e .env ] || (umask 077 && printf 'POSTGRES_PASSWORD=%s\nOSCORPEX_JWT_SECRET=%s\n' "$(openssl rand -hex 24)" "$(openssl rand -hex 32)" > .env)
```

Kaynak ayarları (isteğe bağlı): `OSCORPEX_BACKEND_MEM_LIMIT` (8g), `OSCORPEX_BACKEND_PIDS_LIMIT` (2048),
`OSCORPEX_BACKEND_CPUS` (varsayılan sınırsız; Docker, host CPU sayısından büyük değeri reddeder), `OSCORPEX_POSTGRES_MEM_LIMIT` (2g). Backend'in tmpfs'leri (`/tmp` 1g, `/home/oscorpex` 512m)
bellek limitine dahildir.

İkisinden biri eksikse `docker compose` başlamayı reddeder.

## Başlatma

```bash
docker compose up -d --build
```

Sıra: postgres sağlıklı -> `migrate` şemayı uygular ve çıkar -> backend -> console. Ardından `http://localhost:5161`.

## İlk admin

Önce console'dan kayıt olun (kullanıcı var olmalı), sonra:

```bash
docker compose run --rm migrate node dist/admin-grant.js grant <email>
```

Geri almak için `grant` yerine `revoke`.

## Claude girişi

Claude CLI girişi (OAuth) kalıcı `claude-home` volume'ünde tutulur:

```bash
docker compose exec backend claude
```

Ana yürütme yolu `ANTHROPIC_API_KEY`'i claude'a geçirmez; OAuth faturalandırması korunur. Bir proxy/gateway
kullanacaksanız `ANTHROPIC_BASE_URL`'i `docker/claude-cli/managed-settings.json` içinde değiştirip imajı yeniden
derleyin (`docker compose build`); dosya imajda root'a ait `/etc/claude-code/managed-settings.json` olur.
Kullanıcı düzeyindeki ayarlar bilerek yüklenmez.

## Bilinen kısıtlar

- **CORS origin'leri:** `OSCORPEX_CORS_ORIGINS` yalnızca `http://localhost:<port>` ve `http://127.0.0.1:<port>` içerir.
  Tarayıcıda hangisini yazarsanız o çalışır; başka bir host adı için compose dosyasını uyarlayın. Origin'i listede
  olmayan yazma istekleri (POST/PUT/PATCH/DELETE) reddedilir.
- **LivePreview** Docker'da çalışmaz: uygulama portları yayınlanmaz ve `frame-src 'self'` doğrudan port iframe'ini engeller.
- **Rate limit:** Backend, nginx'in `X-Forwarded-For`'una güvenir (`OSCORPEX_TRUSTED_PROXY=true`). Docker Desktop port
  yayınında istemci IP'leri gateway IP'sine dönüşebilir; bu durumda `/auth/*` limiti istemciler arasında ortak olur.
  Ayrıca bu ayar XFF'e backend'in ağlarındaki herhangi bir eşten güvenir: sonar konteyneri XFF'i
  taklit edebilir (takip işi).
- **Agent havuzu kaldırıldı:** Eski konteyner havuzu (`agents` profili, `docker/coder-agent`, `docker-compose.pool.yml`)
  silindi; `isolationLevel: container`/`vm` açık bir hatayla reddedilir, host'a düşmez. Yerine workload izolasyonu
  epic'indeki runner gelecek.
- **F4 öncesi:** Runtime hâlâ veritabanı süper kullanıcısıyla bağlanır; `migrate` ve backend aynı bağlantıyı kullanır.
  Kısıtlı `oscorpex_app` rolüne geçiş F4'te yapılır.
- **Aynı uid kalan riski:** Kernel ve agent CLI aynı uid'le (1001) çalışır; bir agent kernel'in ortamını (`/proc`)
  ve diğer tenant'ların repolarını okuyabilir. Çözüm tenant workload izolasyonu epic'indedir.
- **`claude-home` paylaşımlıdır:** Tüm tenant'ların transcript'leri ve OAuth token'ı aynı volume'dedir (yalnızca backend, `0700`).

## Yedekleme

Kalıcı durum: `pgdata`, `oscorpex-data` (repolar, loglar), `studio-data`, `claude-home`. Yedekleri repo dışında,
yalnızca sahibine açık bir dizine alın (`umask 077`).

```bash
umask 077; B=~/oscorpex-backup; mkdir -p "$B"
docker compose exec -T postgres pg_dump -U oscorpex oscorpex | gzip > "$B/db.sql.gz"
docker run --rm -v <proje>_oscorpex-data:/v:ro -v "$B":/b busybox@sha256:a7dbc319b1438115a207e11930dc4bb3e643dcb3ec0bdd694bb36cd8fad289ec \
  tar czf /b/oscorpex-data.tgz -C /v .
```

`<proje>`, compose proje adıdır (varsayılan: dizin adı). `claude-home` yedeği OAuth token'ını içerir: şifreli saklayın
ya da yedeklemeyin (kaybederseniz `docker compose exec backend claude` ile yeniden giriş yapılır).
`docker compose down -v` tüm volume'leri siler.

## Eski kurulumdan yükseltme

- Volume'ler isimle yeniden kullanılır. Eski bir geliştirme `pgdata`'sı eski parolasını korur: yeni `POSTGRES_PASSWORD`
  uymaz. Ya eski parolayı verin ya da veriye ihtiyacınız yoksa `docker compose down -v` ile sıfırlayın.
- Eski `repos` volume'ü artık kullanılmaz (repolar `oscorpex-data`'dadır); gerekirse `docker volume rm` ile silin.
- Postgres'in `initdb` mount'u kaldırıldı: şema yalnızca `migrate` servisiyle uygulanır.

## Geliştirme override'ları

- `docker-compose.dev.yml`: yalnızca postgres'i `127.0.0.1:5432`'de yayınlar (host'ta `pnpm dev` için).
  Port doluysa `OSCORPEX_DEV_PG_PORT` verin. Örnek:
  `POSTGRES_PASSWORD=oscorpex_dev OSCORPEX_JWT_SECRET=dev docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres`

## Doğrulama

`scripts/docker/smoke-compose.sh` stack'i benzersiz bir proje adıyla sıfırdan kurar, sertleştirme, port, ağ,
kalıcılık, admin-grant ve WebSocket kontrollerini yapar, sonra her şeyi siler.
