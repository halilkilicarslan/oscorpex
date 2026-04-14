# Kurallar ve Desenler

12 Nisan 2026 tarihinde doğrudan depo incelemesi ve yerel komut çıktıları ile oluşturulmuştur.

## Kod Stili

- Her yerde TypeScript kullanımı.
- ESM import/export yapısı.
- Arka uç çoğunlukla tek tırnak (single quotes) kullanır.
- Ön uç çoğunlukla tek tırnak kullanır.
- Yorumlar İngilizce ve Türkçe karışıktır.

## Arka Uç Desenleri

- Servis benzeri singleton modüller (`taskEngine`, `executionEngine`, `pipelineEngine`).
- Veritabanı erişimi tek bir büyük modülde merkezileştirilmiştir.
- Hono rotaları tek bir büyük rota dosyasında kaydedilir.
- `eventBus` üzerinden olay güdümlü koordinasyon.
- Görev durumu geçişleri, veritabanı ve motor modüllerinde açıkça kodlanmıştır.

## Ön Üç Desenleri

- Fonksiyonel React bileşenleri.
- Birçok `useState` + `useEffect` güdümlü ekran.
- `studio-api.ts` içinde merkezileştirilmiş fetch yardımcıları.
- Koyu kullanıcı arayüzü varsayılanları ile Tailwind yardımcı stil kullanımı.
- Özellik sayfaları genellikle kendi veri yükleme ve görünüm durumlarına sahiptir.

## Test Kuralları

- Arka uç testleri `src/**/*.test.ts` ve `src/studio/__tests__/` altındadır.
- Ön uç testleri `console/src/__tests__/` altındadır.
- Her iki tarafta da Vitest kullanılır.

## Dokümantasyon Kuralları

- Depoda birden fazla üst düzey döküman bulunmaktadır:
  - `README.md`
  - `ARCHITECTURE.md`
  - `DEPLOYMENT.md`
  - `GETTING_STARTED.md`
  - `QUICKSTART.md`
- Dokümanlar yararlıdır ancak artık kod tabanı ile tamamen uyumlu değildir.

## Sürtünme Noktaları

- Ön uç/arka uç sözleşmeleri (contracts) paylaşılmak yerine manuel olarak kopyalanmaktadır.
- Bazı ürün terminolojileri tutarsızdır:
  - Oscorpex
  - VoltAgent
  - VoltOps
- Rota, Veritabanı ve orkestrasyon dosyaları, ekip düzeyinde sahipliğin zorlaştığı boyutu aşmıştır.
- Lint kuralları ve gerçek ön uç kodlama stili şu anda senkronize değildir.

## Kasıtlı Görünenler

- Ekip, ürün özelliklerini hızlı bir şekilde sunmak için optimize olmaktadır.
- Gözlemlenebilirlik ve operatör araçlarına güçlü bir vurgu vardır.
- Sistem, Docker destekli altyapı ile yerel öncelikli (local-first) geliştirme için tasarlanmıştır.
