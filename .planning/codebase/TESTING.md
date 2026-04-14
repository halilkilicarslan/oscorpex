# Test ve Doğrulama

12 Nisan 2026 tarihinde doğrudan depo incelemesi ve yerel komut çıktıları ile oluşturulmuştur.

## Çalıştırılan Komutlar

Arka Uç:

- `pnpm typecheck`
- `pnpm build`
- `pnpm test`
- `pnpm lint`

Ön Üç:

- `cd console && pnpm build`
- `cd console && pnpm test:run`
- `cd console && pnpm lint`

## Arka Uç Durumu

### Başarılı

- `pnpm typecheck`: Başarılı
- `pnpm build`: Başarılı

### Başarısız

- `pnpm test`: Başarısız
  - 12 test dosyası çalıştırıldı
  - Toplam 161 test
  - 132 başarılı
  - 27 atlandı
  - 2 başarısız
  - 2 suite başarısız

Hata kategorileri:

- Veritabanı test ortamı tam olarak önyüklenmemiş
  - `src/studio/__tests__/db.test.ts`
  - `src/studio/__tests__/task-engine.test.ts`
  - Hata: `chat_messages` ilişkisi (tablosu) mevcut değil.

- Çalışma zamanı analizörü test kayması
  - `src/studio/__tests__/runtime-analyzer.test.ts`
  - Beklenen portlar: `8080` ve `3000`
  - Gerçek portlar: `8081` ve `3003`
  - Muhtemelen analiz sırasında port çakışmasını önleme mantığının portları değiştirmesinden kaynaklanıyor.

- `pnpm lint`: Başarısız
  - 395 Biome hatası rapor edildi.
  - En görünür sorunlar formatlama ve import sıralaması.
  - Bazı test dosyaları da null olmayan iddialar (non-null assertions) gibi stil kurallarını ihlal ediyor.

## Ön Üç Durumu

### Başarısız

- `cd console && pnpm test:run`: Başarısız
  - 10 test dosyası çalıştırıldı
  - Toplam 213 test
  - 211 başarılı
  - 2 başarısız

Başarısız test dosyası:

- `console/src/__tests__/ProjectSettings.test.tsx`

Gözlemlenen nedenler:

- `../lib/studio-api` mock'u artık `fetchProjectCosts` içermiyor.
- Ayarların yüklenmesi artık `Promise.allSettled` kullanıyor, bu nedenle hata yüzeyi orijinal test beklentilerinden farklı.

- `cd console && pnpm build`: TypeScript derlemesi sırasında başarısız oldu
  - Testlerde ve UI tiplerinde sözleşme (contract) kayması:
    - `ProjectAgent.gender` artık zorunlu.
    - `AIProvider.fallbackOrder` artık zorunlu.
    - `ProjectAnalytics` yapısı değişti.
  - `LogsPage.tsx`, yerel bir arayüzde tanımlanmayan `trace_flags` alanını bekliyor.
  - `src/test/setup.ts` içinde Node tipi yapılandırması eksik.

- `cd console && pnpm lint`: Başarısız
  - 72 hata, 5 uyarı.
  - Tekrar eden kategoriler:
    - Kullanılmayan değişkenler.
    - `any` kullanımı.
    - React Hooks `set-state-in-effect`.
    - Render sırasında `Date.now()` gibi saflık (purity) ihlalleri.
    - Efektlerde eksik bağımlılıklar.
    - `jsx-a11y/no-autofocus` için eksik ESLint kural eklentisi.

## Yorumlama

Depo aktif olarak geliştiriliyor ancak şu anda temiz bir CI-hazır (Sürekli Entegrasyon) durumda değil.

Arka uç çekirdeği hala derleniyor, bu güçlü bir işaret. Ön uç daha fazla sözleşme kayması ve lint borcu taşıyor; arka uç test düzeneği ise deterministik veritabanı başlatılmasına ihtiyaç duyuyor.
