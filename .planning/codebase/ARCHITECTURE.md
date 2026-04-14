# Mimari Analiz

12 Nisan 2026 tarihinde doğrudan depo incelemesi ve yerel komut çıktıları ile oluşturulmuştur.

## Üst Düzey Yapı

Depo en iyi dört katman olarak anlaşılabilir:

1. Giriş Uygulama Katmanı
   - `src/index.ts`
   - VoltAgent, Hono rotaları, WebSocket sunucusu, webhook göndericisi ve konteyner havuzunu başlatır.

2. Studio Arka Uç Katmanı
   - `src/studio/*`
   - Proje yönetimi, planlama, yürütme, ardışık düzen (pipeline) orkestrasyonu, depo/dosya erişimi, çalışma zamanı analizi, uygulama çalıştırma, metrikler, sağlayıcılar ve webhook'lar.

3. Console Ön Uç Katmanı
   - `console/src/*`
   - Studio operasyonları ve gözlemlenebilirlik için büyük SPA (Single Page Application).

4. Destekleyici/Demo Katmanı
   - `src/agents/*`, `src/tools/*`, `src/workflows/*`
   - Asistan/araştırmacı yardımcı programları ve örnek iş akışı mantığı.

## Çalışma Zamanı Akışı

Tipik bir proje yürütme akışı:

1. Kullanıcı ön uçta bir proje oluşturur veya içe aktarır.
2. Arka uç, proje meta verilerini PostgreSQL'e kaydeder.
3. PM tarzı planlama mantığı planlar, fazlar ve görevler oluşturur.
4. `task-engine` görev yaşam döngüsünü, onay kapılarını ve faz geçişlerini yönetir.
5. `pipeline-engine` ajan bağımlılıklarını DAG dalgalarına dönüştürür.
6. `execution-engine` hazır görevleri dağıtır.
7. `cli-runtime` hedef depoda Claude CLI alt süreçlerini başlatır.
8. Olaylar, günlükler, dosyalar, analitikler ve uygulama önizleme durumu API ve WebSocket kanalları aracılığıyla yüzeye çıkarılır.

## Arka Uç Mimari Özellikleri

### Güçlü Yönler

- `src/studio/` altında net alt sistem isimlendirmeleri.
- Görev yaşam döngüsü, yürütme dağıtımı ve ardışık düzen grafiği mantığı arasında makul ayrım.
- Güçlü özellik kapsamı: planlama, onaylar, maliyet takibi, doküman üretimi, çalışma zamanı keşfi, uygulama önizlemesi, webhook'lar.

### Zayıf Yönler

- Arka uç, çok fazla davranışı birkaç çok büyük dosyada toplamıştır:
  - `src/studio/routes.ts`: 3.079 satır
  - `src/studio/db.ts`: 2.191 satır
  - `src/studio/execution-engine.ts`: 1.106 satır
  - `src/studio/pipeline-engine.ts`: 917 satır
  - `src/studio/task-engine.ts`: 850 satır
- API, orkestrasyon, süreklilik ve ürün politikası, daha dar servisler yerine doğrudan iç içe uygulanmıştır.

## Ön Uç Mimari Özellikleri

### Güçlü Yönler

- `console/src/lib/studio-api.ts` içinde merkezi API istemcisi.
- `console/src/main.tsx` içinde tembel yüklenen (lazy-loaded) üst düzey rotalar.
- Çoğu studio iş akışını kapsayan zengin kullanıcı arayüzü yüzeyi.

### Zayıf Yönler

- Bazı sayfalar çok büyük ve durum (state) ağırlıklıdır:
  - `console/src/pages/studio/StudioHomePage.tsx`: 816 satır
  - `console/src/lib/studio-api.ts`: 1.889 satır
  - `console/src/pages/studio/ProjectPage.tsx`: 362 satır
- Yerel kullanıcı arayüzü durumu ve efekt mantığı birbirine sıkı sıkıya bağlıdır.
- Ön uç sözleşmeleri (contracts), arka uç tiplerinden veya şemadan paylaşılmak yerine manuel olarak kopyalanmıştır.

## Mimari Kayma (Drift)

Depo, çakışan ürün kimlikleri içermektedir:

- Mevcut kod tabanı adı ve özellik seti: Oscorpex Studio
- Geçmiş/dokümante edilmiş referanslar: VoltAgent / VoltOps / eski konsol topolojisi

Bu sadece kozmetik bir sorun değildir. Dokümanlarda, portlarda, depolama açıklamalarında ve terminolojide kendini gösterir; bu da oryantasyonu yavaşlatacak ve bakım maliyetini artıracaktır.
