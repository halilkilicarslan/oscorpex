# Oscorpex Kod Tabanı Analizi ve Stratejik Rapor
**Tarih:** 14 Nisan 2026
**Durum:** Gizli / Dahili Mühendislik Raporu

## 1. Yönetici Özeti

Oscorpex, otonom yazılım geliştirme görevleri için tasarlanmış gelişmiş bir yapay zeka (AI) orkestrasyon platformudur. Proje, yüksek performanslı bir Node.js arka ucu (Hono/VoltAgent) ile özellik açısından zengin bir React 19 ön ucunu entegre eden monorepo benzeri bir yapı izlemektedir. Platform; planlama, görev yürütme ve gözlemlenebilirlik konularında ileri düzey yetenekler sergilese de, şu anda ölçeklendirmeyi ve bakımı zorlaştırabilecek teknik borçlar, dokümantasyon sapmaları ve mimari "dev dosya" (god file) yapılarıyla karşı karşıyadır.

---

## 2. Teknik Yığın ve Mimari

### 2.1 Temel Teknolojiler
- **Arka Uç (Backend):** Node.js 20.19+, Hono (`@voltagent/server-hono` üzerinden), `@voltagent/core`.
- **Ön Uç (Frontend):** React 19, Vite 8, Tailwind CSS 4, iş akışı görselleştirmesi için `@xyflow/react`.
- **Veri Saklama:** Uygulama verileri için PostgreSQL (pgvector) ve gözlemlenebilirlik/bellek için LibSQL/SQLite kullanan hibrit bir model.
- **Yapay Zeka Yürütme:** Temel olarak Claude CLI alt süreçleri tarafından yönlendirilir; AI SDK üzerinden OpenAI, Anthropic ve Google desteği mevcuttur.

### 2.2 Mimari Katmanlar
1. **Giriş Katmanı (`src/index.ts`):** Servis önyüklemesini, WebSocket sunucularını ve konteyner havuzlarını koordine eder.
2. **Studio Arka Uç (`src/studio/*`):** Sistemin "beyni"dir; proje planlamasını, görev yaşam döngülerini (`task-engine`) ve yürütmeyi (`execution-engine`) yönetir.
3. **Console Ön Uç (`console/src/*`):** Proje yönetimi, gerçek zamanlı günlükler (logs) ve ajan etkileşimi için yoğun bir operasyon arayüzüdür.
4. **Ajan/Araç Katmanı (`src/agents/*`, `src/tools/*`):** Uzmanlaşmış ajanlar (araştırmacı, kod yazıcı) ve yardımcı araçlar (web araması, hesap makinesi).

---

## 3. Entegrasyon Ekosistemi

Platformun gücü, derin entegrasyon yeteneklerinden gelmektedir:
- **Claude CLI:** JSON olaylarını akış olarak ileten ve maliyet takibi yapan temel yürütme motorudur.
- **Docker:** Konteynerize edilmiş ajan yürütme ve önceden hazırlanmış "coder-agent" havuzları için kullanılır.
- **Bildirim Servisleri:** Slack, Discord ve genel Webhook'lar için hazır destek sunar.
- **VoltAgent Framework:** Ajan tabanlı iş akışları ve gözlemlenebilirlik depoları için sisteme derinlemesine gömülüdür.

---

## 4. Kritik Sorunlar ve Riskler

### 4.1 Dokümantasyon ve İsimlendirme Sapması
Kod tabanı ile dokümantasyonu arasında belirgin bir uyumsuzluk vardır. "VoltAgent" veya "VoltOps" referansları, "Oscorpex" markasıyla yan yana durmaya devam etmektedir; ayrıca dokümante edilen portlar ve bağımlılıklar (örneğin React 18 vs 19) güncel değildir.

### 4.2 Mimari "Dev Dosyalar" (God Files)
Kritik mantık, geliştirici üretkenliğini engelleyebilecek birkaç devasa dosyada toplanmıştır:
- `src/studio/routes.ts` (3.000+ satır)
- `src/studio/db.ts` (2.000+ satır)
- `console/src/lib/studio-api.ts` (1.800+ satır)

### 4.3 Kontrat Kırılganlığı
Ön uç kendi tip (type) evrenini yönetmektedir, bu da "kontrat sapmasına" yol açmaktadır. Arka uç şemasındaki son değişiklikler (örneğin `gender` veya `fallbackOrder` gibi zorunlu alanlar), ön uç derlemelerini ve testlerini bozmuştur.

### 4.4 Güvenlik: Docker Ayrıcalıkları
Arka uç, `/var/run/docker.sock` erişimine ihtiyaç duymaktadır. Konteyner yönetimi için gerekli olsa da, bu durum üretim ortamlarında sıkı bir şekilde kontrol edilmesi gereken yüksek ayrıcalıklı bir alan oluşturmaktadır.

---

## 5. Kalite ve Test Durumu

Mevcut doğrulama metrikleri, aktif olarak geliştirilen ancak stabilize edilmesi gereken bir sistemi göstermektedir:
- **Arka Uç Testleri:** ~%82 başarı oranı. Hatalar temel olarak test ortamlarında başlatılmamış veritabanı şemalarından kaynaklanmaktadır.
- **Ön Uç Testleri:** İzolasyonda neredeyse %100 başarı oranı, ancak kontrat uyumsuzlukları nedeniyle **derleme (build) süreci başarısız** olmaktadır.
- **Linting:** Arka uçta Biome ve ön uçta ESLint üzerinden, özellikle React hook disiplini ve `any` kullanımı etrafında yüksek hacimli uyarılar mevcuttur.

---

## 6. Stratejik Öneriler

### 6.1 Faz 1: Stabilizasyon (Kısa Vadeli)
1. **Dokümantasyonu Birleştirin:** `README.md` ve `ARCHITECTURE.md` dosyalarını mevcut uygulama durumuyla senkronize edin.
2. **Derleme Hattını Onarın:** Kontrat sapmasından kaynaklanan ön uç TypeScript hatalarını giderin.
3. **Test Veritabanını Hazırlayın:** Arka uç Vitest paketleri için otomatik şema başlatma mekanizmasını kurun.

### 6.2 Faz 2: Yeniden Yapılandırma (Orta Vadeli)
1. **Dev Dosyaları Bölün:** `routes.ts` ve `db.ts` dosyalarını alan bazlı modüllere (örneğin `ProjectService`, `TaskService`) ayırın.
2. **Paylaşılan Kontratlar:** Ön uç ve arka ucu senkronize etmek için API tiplerini paylaşılan bir pakete taşıyın veya şema öncelikli (örneğin tRPC veya Zod-to-TS) bir yaklaşıma geçin.
3. **Hook Disiplini:** Devasa ön uç bileşenlerini (`StudioHomePage`), mantığı sunumdan ayıracak şekilde özel (custom) hook'lara bölün.

### 6.3 Faz 3: Operasyonel Mükemmellik (Uzun Vadeli)
1. **İsimlendirmeyi Konsolide Edin:** Tüm modüllerde ve depolarda "VoltAgent" markasından "Oscorpex" markasına geçişi tamamlayın.
2. **Güvenlik Sıkılaştırması:** Konteyner yönetimi için daha düşük ayrıcalıklı alternatifleri araştırın veya yürütme motorunu ana API'den izole edin.

---
*Bu rapor Gemini CLI Orkestratörü tarafından oluşturulmuştur.*
