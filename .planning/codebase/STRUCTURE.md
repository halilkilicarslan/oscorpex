# Depo Yapısı

12 Nisan 2026 tarihinde doğrudan depo incelemesi ve yerel komut çıktıları ile oluşturulmuştur.

## Kök Düzen

- `src/`
  - Arka uç giriş noktası, ajanlar, araçlar, iş akışları ve studio alt sistemi.
- `console/`
  - Ön uç SPA ve ön uç testleri.
- `scripts/`
  - PostgreSQL başlatma betikleri.
- `docker/`
  - coder-agent imajı.
- `docs/`
  - Yol haritası ve planlama dökümanları.
- `coverage/`, `dist/`
  - Üretilen çıktılar (artifacts).

## Arka Uç Yapısı

### `src/index.ts`

Uygulama önyüklemesi (bootstrap). Şunları başlatır:

- VoltAgent sunucusu.
- Hono studio rotaları.
- Gözlemlenebilirlik rotaları.
- WebSocket sunucusu.
- Webhook göndericisi.
- Konteyner havuzu ön ısıtması.

### `src/studio/`

Ana ürün arka ucu. Önemli kümeler:

- Yürütme ve Orkestrasyon
  - `execution-engine.ts`
  - `pipeline-engine.ts`
  - `task-engine.ts`
  - `agent-runtime.ts`
  - `cli-runtime.ts`

- Süreklilik ve Şema Erişimi
  - `db.ts`
  - `pg.ts`

- Proje/Çalışma Zamanı Operasyonları
  - `app-runner.ts`
  - `runtime-analyzer.ts`
  - `db-provisioner.ts`
  - `container-manager.ts`
  - `container-pool.ts`

- Ürün Özellikleri
  - `routes.ts`
  - `webhook-sender.ts`
  - `agent-messaging.ts`
  - `docs-generator.ts`
  - `git-manager.ts`
  - `api-discovery.ts`

- Testler
  - `src/studio/__tests__/`

### Diğer Arka Uç Klasörleri

- `src/agents/`
  - Asistan, özetleyici, çevirmen, araştırmacı, kod asistanı.
- `src/tools/`
  - Hesap makinesi, tarih-saat, hava durumu, web araması.
- `src/workflows/`
  - Şu anda bir gider onay iş akışı örneği içerir.

## Ön Üç Yapısı

### `console/src/main.tsx`

Tembel yüklenen (lazy-loaded) rota sayfalarıyla üst düzey SPA yönlendirmesi.

### `console/src/pages/studio/`

Temel studio kullanıcı arayüzü özellikleri:

- Ana sayfa / Proje oluşturma.
- Proje detay sayfası.
- PM (Proje Yöneticisi) sohbeti.
- Ekip oluşturucu.
- Kanban panosu.
- Ardışık düzen panosu.
- Canlı önizleme.
- Çalışma zamanı paneli.
- Dosya gezgini.
- Mesaj merkezi.
- Ayarlar ve sağlayıcılar.

### `console/src/lib/studio-api.ts`

Ön uç/arka uç iletişimi için tek büyük API istemcisi ve tip tanım merkezi.

### `console/src/__tests__/`

Ön uç test kapsamı, temel studio kullanıcı arayüzü yüzeylerinde yoğunlaşır.

## Gözlemlenen Yapısal Desen

Kod tabanı özellik bakımından zengindir ancak dosya ayrıntı düzeyi kabadır. Çoğu alan (domain) mevcuttur, ancak çoğu modüler dilimler yerine büyük dosyalarda toplanmıştır. Bu, kısa vadeli geliştirme hızını artırırken uzun vadeli bakımı zorlaştırır.
