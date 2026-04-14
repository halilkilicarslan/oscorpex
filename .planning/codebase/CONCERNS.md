# Temel Sorunlar

12 Nisan 2026 tarihinde doğrudan depo incelemesi ve yerel komut çıktıları ile oluşturulmuştur.

## 1. Dokümantasyon Kayması

Depo dokümantasyonu artık mevcut sistemi tutarlı bir şekilde açıklamamaktadır.

Örnekler:

- `README.md` React 18 diyor, mevcut ön uç React 19.
- `ARCHITECTURE.md` 4242 portunda VoltAgent/LibSQL'i açıklıyor.
- Mevcut çalışma zamanı, PostgreSQL ve LibSQL yan depoları ile 3141 portunda Oscorpex + Hono kullanıyor.

Etki:

- Oryantasyon karmaşası.
- Yanlış dağıtım/hata ayıklama varsayımları riski.

## 2. Çekirdek Yollardaki "Dev Dosyalar" (God Files)

Birkaç kritik dosya, güvenli değişim hızı için çok büyüktür:

- `src/studio/routes.ts` - 3.079 satır
- `src/studio/db.ts` - 2.191 satır
- `src/studio/execution-engine.ts` - 1.106 satır
- `src/studio/pipeline-engine.ts` - 917 satır
- `src/studio/task-engine.ts` - 850 satır
- `console/src/lib/studio-api.ts` - 1.889 satır
- `console/src/pages/studio/StudioHomePage.tsx` - 816 satır

Etki:

- Zorlaşan kod incelemeleri (reviews).
- Daha yüksek regresyon olasılığı.
- Zayıf sahiplik sınırları.

## 3. Ön Üç/Arka Uç Sözleşme Kayması

Ön uç kendi tip evrenini korumaktadır ve bu evren mevcut davranıştan zaten sapmaktadır.

Somut kanıtlar:

- Testler ve derleme (build), zorunlu `gender` alanı nedeniyle başarısız oluyor.
- Derleme, zorunlu `fallbackOrder` alanı nedeniyle başarısız oluyor.
- `ProjectAnalytics` yapısı, tüm testler güncellenmeden değişti.
- `LogsPage.tsx`, yerel arayüzünde tanımlanmayan bir alan bekliyor.

Etki:

- Kullanıcı arayüzü değişiklikleri kırılgandır.
- Testler, yeniden yapılandırmaları (refactoring) güvenilir bir şekilde korumaz.

## 4. Test Ortamı Kararsızlığı

Arka uç testleri PostgreSQL'e dayanmaktadır ancak test kurulumu şemayı otomatik olarak başlatmaz. Ön uç testleri de API istemci yapısı değişikliklerine karşı hassastır.

Etki:

- Yerel güven, test sayısının önerdiğinden daha düşüktür.
- Ek kurulum olmadan CI (Sürekli Entegrasyon) kararsız olacaktır.

## 5. Çalışma Zamanı Analizi ile Port Atama Karışıklığı

`analyzeProject()` hem hedeflenen portları tespit eder hem de mevcut makinedeki çakışmaları önlemek için bunları değiştirir.

Etki:

- Belirsiz (nondeterministic) testler.
- Bulanıklaşan anlamlar: analiz sonucu vs. çalıştırılabilir tahsis.

Önerilen yön:

- "Tespit edilen port" ile "tahsis edilen boş port" ayrılmalıdır.

## 6. Hibrit Depolama ve İsimlendirme Karmaşıklığı

Ürün PostgreSQL, pgvector, LibSQL, dosya günlükleri ve yerel depo bileşenlerini kullanırken aynı zamanda Oscorpex/VoltAgent/VoltOps isimlendirmelerini karıştırmaktadır.

Etki:

- Yüksek bilişsel yük.
- Zorlaşan operasyonel hata ayıklama.

## 7. Ön Üç Hook Disiplini Uygulanmıyor

ESLint çıktısı, durumun (state) efektler içinde ayarlandığı veya render sırasında saf olmayan değerlerin hesaplandığı birçok yer göstermektedir.

Etki:

- Kaçınılabilir yeniden render işlemleri.
- Güncel olmayan durum hataları.
- Bakımı zor bileşen mantığı.

## 8. Docker Ayrıcalık Yüzeyi

Arka uç `/var/run/docker.sock` bağlar ve ajan orkestrasyonu konteyner yürütülmesine bağlıdır.

Etki:

- Arka uç süreci için çok yüksek yerel ana makine erişimi.
- Güvenilir bir geliştirici ortamı olarak değerlendirilmeli, sıradan bir hizmet gibi açılmamalıdır.

## Öncelikli Öneriler

1. Dokümanları yeniden doğru hale getirin ve mimari için tek bir gerçek kaynağı seçin.
2. CI'yı stabilize edin:
   - Test şemasını önyükleyin (bootstrap).
   - Ön uç derlemesini onarın.
   - Ön uç testlerini yeşile döndürün.
3. API ve analitik tipleri için paylaşılan sözleşmeleri (contracts) çıkarın.
4. En büyük arka uç ve ön uç dosyalarını bağlamsal sınırlara (bounded contexts) göre bölün.
5. Çalışma zamanı analizini, çalışma zamanı port tahsisinden ayırın.
