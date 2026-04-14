# Entegrasyon Haritası

12 Nisan 2026 tarihinde doğrudan depo incelemesi ve yerel komut çıktıları ile oluşturulmuştur.

## Yapay Zeka Sağlayıcıları ve Model Yönlendirme

Arka uç, `src/studio/ai-provider-factory.ts` aracılığıyla birden fazla yapay zeka sağlayıcısı entegrasyonunu destekler:

- OpenAI
- Anthropic
- Google
- Ollama
- Özel OpenAI uyumlu uç noktalar

Sağlayıcı yapılandırması veritabanında saklanır ve şunları destekler:

- Varsayılan sağlayıcı seçimi
- Geri dönüş (fallback) sırası
- Model düzeyinde maliyet tahmini

## Claude CLI Entegrasyonu

En önemli yürütme entegrasyonu, `src/studio/cli-runtime.ts` içindeki Claude CLI çalışma zamanıdır.

Şunları yapar:

- Yaygın kurulum konumlarından `claude` ikili dosyasını bulur.
- Alt süreç yürütülmesinden gelen JSON olaylarını akış olarak iletir.
- Terminal çıktısını studio olay ardışık düzeni aracılığıyla yayınlar.
- Belirteç (token) kullanımını ve maliyeti izler.

Bu sadece bir demo entegrasyonu değil, görev çalışmaları için gerçek yürütme yoludur.

## VoltAgent / VoltOps

Uygulama hala yoğun bir şekilde VoltAgent'a bağımlıdır:

- `@voltagent/core` ajanları ve iş akışları `src/index.ts` içinde başlatılır.
- Bellek ve gözlemlenebilirlik için LibSQL adaptörleri kullanılır.
- VoltOps anahtarları ortam değişkenleri aracılığıyla desteklenir.

Bu, Oscorpex'in hem özel bir studio ürünü hem de VoltAgent tarafından barındırılan bir uygulama olduğu anlamına gelir.

## Veritabanları ve Altyapı

- Docker Compose aracılığıyla PostgreSQL + pgvector.
- `.voltagent/` altındaki yerel LibSQL dosyaları.
- Konteyner yönetimi için arka uca bağlanan Docker soketi.
- İsteğe bağlı SonarQube servisi.
- İsteğe bağlı coder-agent havuzu konteynerleri.

## Harici Bildirimler

Studio alt sisteminde Webhook desteği mevcuttur:

- Genel Webhook'lar
- Slack
- Discord

Desteklenen olaylar:

- Görev tamamlandı / başarısız oldu
- Onay gerekli / onaylandı / reddedildi
- Ardışık düzen tamamlandı
- Yürütme hataları
- Bütçe uyarıları

## Geliştirici Ortamı Bağımlılıkları

İşlevsel bir yerel ortam şunlara bağlıdır:

- Node.js
- pnpm
- Docker
- PostgreSQL konteyneri
- Görev yürütme için Claude CLI
- İsteğe bağlı yapay zeka sağlayıcısı API anahtarları

## Entegrasyon Riskleri

- Arka uç, `/var/run/docker.sock` aracılığıyla ayrıcalıklı Docker erişimine sahiptir.
- Ajan ağ yorumları izolasyon iddia eder, ancak `internal: false` dışa dönük erişimin hala mümkün olduğu anlamına gelir.
- Hibrit depolama, hata ayıklama ve yedekleme karmaşıklığını artırır.
- Kodda sağlayıcı desteği mevcuttur, ancak yürütme hala güçlü bir Claude CLI bağımlılığına sahiptir.
