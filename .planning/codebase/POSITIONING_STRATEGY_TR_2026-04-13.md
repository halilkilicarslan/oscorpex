# Oscorpex Konumlandırma Stratejisi Raporu

Oluşturulma tarihi:

- 2026-04-13

Bu rapor şu kaynaklara dayanır:

- mevcut Oscorpex kod tabanı analizi
- önceki detaylı teknik raporlar
- güncel rakip haritası

## 1. Oscorpex Nedir?

Benim profesyonel görüşüme göre Oscorpex:

**AI destekli yazılım teslimatını yöneten bir kontrol düzlemidir.**

Yani ürünün ana değeri:

- sadece kod yazdırmak değil
- sadece bir editör deneyimi sunmak değil
- sadece prompt ile uygulama üretmek değil

Asıl yaptığı şey:

- isteği alır
- işi planlara ve görevlere böler
- uygun agent’lara dağıtır
- execution sürecini yönetir
- review, approval, preview ve gözlemlenebilirlik katmanı ekler

Kısa tanım:

**Oscorpex, AI ile kod yazdıran değil, AI ile yazılım teslim ettiren sistemdir.**

## 2. Ana Ürün Tezi

Oscorpex’in en güçlü ürün tezi şu:

> Takımların yalnızca daha iyi kod yazan modellere değil, AI tarafından yapılan mühendislik işini planlayan, yöneten, denetleyen ve görünür kılan bir sisteme ihtiyacı var.

Bu yüzden ürünün gerçek değeri şu zincirde yatıyor:

- planlama
- görev dağıtımı
- çoklu agent orkestrasyonu
- review
- onay
- runtime / preview
- maliyet ve operasyon görünürlüğü

## 3. Konumlandırma Cümlesi

### Ana konumlandırma

**Oscorpex, AI destekli yazılım teslimatının kontrol düzlemidir.**

### Genişletilmiş konumlandırma

**Oscorpex, ürün taleplerini uzmanlaşmış AI agent’lar ile planlanan, çalıştırılan, incelenen ve doğrulanan yazılım teslimat akışlarına dönüştürür.**

### Kısa slogan önerileri

1. **Fikirden incelenmiş çalışan yazılıma, AI agent’larla**
2. **AI yazsın, Oscorpex yönetsin**
3. **AI destekli yazılım teslimatının kontrol merkezi**
4. **Planla, çalıştır, incele, gönder**
5. **AI ile kod üretmekten, AI ile teslimat yönetimine**

## 4. İdeal Müşteri Profili

## 4.1 En güçlü hedef müşteri

| Segment | Neden uygun |
|---|---|
| Teknik founder liderliğindeki startup’lar | Az ekiple daha hızlı ürün çıkarmak isterler |
| 3-20 kişilik ürün mühendisliği ekipleri | AI kullanmak ister ama kontrolü kaybetmek istemez |
| Ajanslar / software studio’lar | Tekrarlanabilir teslimat akışına ihtiyaç duyarlar |
| Internal platform / DevEx ekipleri | Mühendislik işinin etrafına yönetişim katmanı kurmak isterler |
| Var olan repo üstünde çalışan ekipler | Brownfield geliştirme için review, diff, preview ve kontrol isterler |

## 4.2 Daha zayıf uyum gösteren segmentler

| Segment | Neden daha zayıf |
|---|---|
| “Sadece daha iyi AI kod editörü” arayan geliştiriciler | Cursor, Codex, Copilot daha doğrudan çözüm |
| Teknik olmayan “chat ile app yapayım” kitlesi | Replit, Lovable, Bolt daha erişilebilir |
| Bugün ağır enterprise compliance bekleyen kurumlar | Policy enforcement, tenancy ve auth daha da güçlenmeli |

## 4.3 En iyi ilk alıcı kim?

Bence en doğru ilk buyer profili:

**teknik founder, engineering manager veya platform kafasıyla düşünen küçük takım lideri**

Çünkü bu kişiler:

- teslimat darboğazını hisseder
- sadece kod değil süreç verimliliği arar
- AI’dan hız ister ama kontrolü kaybetmek istemez

## 5. Rakip Haritası

Rakipleri 3 grupta okumak daha sağlıklı.

## 5.1 Grup A: Editör-merkezli AI kod araçları

Bu ürünler bireysel geliştirici verimliliğinde güçlüdür ama tam teslimat kontrol düzlemi değildir.

| Ürün | Resmî çerçeve | Güçlü olduğu yer | Oscorpex’in avantaj sağlayabileceği yer |
|---|---|---|---|
| Cursor | AI ile daha iyi kod yazma | Editör UX’i, hızlı coding loop | Workflow, approval, preview, maliyet ve delivery orchestration |
| OpenAI Codex | AI coding partner | Güçlü agentic coding ve görev tamamlama | Çoklu agent yönetimi, planlama-first deneyim, operator görünürlüğü |
| GitHub Copilot coding agent | GitHub ve VS Code içine gömülü coding agent | GitHub native akış, dağıtım gücü, kurumsal erişim | Daha güçlü delivery control plane yaklaşımı |

## 5.2 Grup B: Otonom mühendis / agent platformları

Stratejik olarak en yakın rakipler bunlar.

| Ürün | Resmî çerçeve | Güçlü olduğu yer | Oscorpex’in fark yaratabileceği yer |
|---|---|---|---|
| Devin | AI software engineer | Otonomi, backlog work, güçlü algı | Daha görünür kontrol, daha iyi operator console, planning+preview birleşimi |
| Factory | Agent-native software development | Kurumsal yönetişim, ticket-to-PR akışı | Planlama, preview, runtime ve gözlemlenebilirliği tek yerde toplama |

## 5.3 Grup C: Prompt-to-app / vibe coding ürünleri

Doğrudan aynı kategori değiller ama buyer algısında karşılaştırılacaklar.

| Ürün | Resmî çerçeve | Güçlü olduğu yer | Oscorpex’in fark yaratabileceği yer |
|---|---|---|---|
| Replit Agent | Doğal dilden app/site üretimi | Basitlik, build+deploy entegrasyonu | Takım akışı, review, governance, brownfield delivery |
| Lovable | Chat ile app/site üretimi | Düşük bariyer, hızlı başlangıç | Repo-merkezli mühendislik süreçleri |
| Bolt.new | Chat ile full-stack uygulama üretimi | Hızlı prototipleme, browser-native loop | Agent orkestrasyonu, kontrollü teslimat süreci |

## 6. Pazar İçgörüsü

Piyasa bugün üç ana anlatıya ayrılıyor:

1. **AI editörü**
2. **AI ile uygulama üretici**
3. **AI mühendis / agent platformu**

Oscorpex’in en güçlü hattı birinci veya ikinci hat değil.

En doğru kategori:

**AI mühendislik işini yönetilebilir hale getiren teslimat platformu**

Bu yüzden mesajlarda şu kavramlar öne çıkmalı:

- kontrol
- görünürlük
- orkestrasyon
- onay
- inceleme
- çalıştırılabilir sonuç

Şunlar daha az öne çıkmalı:

- autocomplete kalitesi
- editör ergonomisi
- “tek prompt ile app üret”

## 7. Oscorpex’in Güçlü Ayrışma Noktaları

| Yetenek | Neden değerli |
|---|---|
| Planlama-first akış | Çoğu ürün koddan başlar, Oscorpex teslimat planından başlar |
| Çoklu agent takım modeli | Ürünü “asistan” değil “teslimat organizasyonu” gibi hissettirir |
| Review ve approval loop | Güven ve yönetişim sağlar |
| Runtime analysis + app runner + preview | Kod üretiminden çalışan sonuca geçişi kapsar |
| Cost ve operasyon görünürlüğü | Bireysel geliştirici değil takım ihtiyacına hitap eder |
| Event/trace/observability yüzeyi | Operatör ve yönetici kullanımını destekler |

Kısa ifade:

**Oscorpex, AI coding tool ile software delivery system arasında duran katmanda güçlü.**

## 8. Oscorpex’in Zayıf Kaldığı Alanlar

| Zayıflık | Neden önemli |
|---|---|
| PR akışı eksik | Uçtan uca teslimat vaadinin eksik halkası |
| Runner abstraction eksik | Claude merkezliliği kırılmalı |
| Policy enforcement tam değil | Enterprise güveni için kritik |
| Frontend kalite kapıları tam yeşil değil | Ürünün güven algısını etkiler |
| Multi-tenant/auth olgun değil | Takım bazlı ciddi kullanım için gerekli |

## 9. Önerilen Ana Konumlandırma

Eğer tek bir cümle seçilecekse benim önerim:

**Oscorpex, AI coding’i kontrollü yazılım teslimatına dönüştüren kontrol düzlemidir.**

Bu cümle şu avantajları sağlar:

- editör olmadığını netleştirir
- sadece kod üretmediğini anlatır
- takım ve süreç kullanımına işaret eder
- yönetim ve denetim katmanını vurgular

## 10. Landing Page Mesajı

## 10.1 Hero başlık önerileri

### Seçenek A

**Ürün taleplerini, AI agent’larla incelenmiş ve çalışan yazılıma dönüştürün**

İşi planlayın, uzman agent’lara dağıtın, değişiklikleri inceleyin ve sonucu tek bir kontrol panelinden önizleyin.

### Seçenek B

**AI agent’lar kod yazabilir. Oscorpex takımınızın bunu güvenle göndermesini sağlar.**

İstekten plana, görevden review ve preview’a kadar tüm teslimat akışını yönetin.

### Seçenek C

**AI destekli yazılım teslimatının kontrol merkezi**

AI agent’ları bir mühendislik takımı gibi yönetin: planlayın, görevlendirin, diff’leri inceleyin, onay verin ve sonucu çalıştırın.

## 10.2 Hero altı destek mesajları

- İstekleri otomatik olarak phase ve task’lara bölün
- Uzmanlaşmış AI agent’ları aynı codebase üzerinde çalıştırın
- Değişiklikleri görün, onaylayın, yeniden deneyin
- Preview, maliyet, log ve event akışını gerçek zamanlı izleyin

## 10.3 “Nasıl çalışır?” bölümü

1. **İşi tanımla**
   Feature, bug, migration veya iç araç talebini gir.

2. **Planı oluştur**
   Oscorpex işi phase ve task’lara ayırır, agent’lara dağıtır.

3. **Takımı çalıştır**
   Agent’lar uygular, test eder, inceler, gerekiyorsa revize eder.

4. **İncele ve onayla**
   Diff, log, event ve preview üzerinden yapılan işi değerlendir.

5. **Gönder**
   AI çıktısını kontrollü yazılım teslimatına dönüştür.

## 10.4 “Neden sadece Cursor / Replit / Devin değil?” bölümü

Bu bölüm önemli, çünkü kullanıcı bunu zaten soracak.

| Eğer ihtiyacın buysa | En doğru fit |
|---|---|
| AI destekli güçlü kod editörü | Cursor / Codex / Copilot |
| Hızlı prompt-to-app üretimi | Replit / Lovable / Bolt |
| Kontrollü çoklu agent yazılım teslimatı | Oscorpex |

## 10.5 CTA önerileri

- **İlk AI teslimat akışını başlat**
- **İlk agent destekli projeni çalıştır**
- **AI ile teslimatın nasıl yönetildiğini gör**
- **Bir talebi çalışan ürüne dönüştür**

## 11. Farklı Kitleler İçin Mesajlar

## Teknik Founder

**Daha hızlı üret, mühendislik kontrolünü kaybetme**

Feature taleplerini AI agent’larla planlanmış, incelenmiş ve doğrulanmış iş akışlarına dönüştür.

## Engineering Manager

**AI’ı bireysel editörlerden takım iş akışına taşı**

AI ile yapılan işi planla, yönet, incele ve görünür hale getir.

## Ajans / Studio

**Client projelerinde tekrar edilebilir AI destekli teslimat akışları kur**

Şablonlar, agent rolleri ve review loop’ları ile çıktı hızını artır, kaosu değil.

## Platform / DevEx Takımı

**AI mühendislik işinin etrafına yönetişim katmanı kur**

Planlama, execution, observability ve policy’yi tek sistemde topla.

## 12. Go-To-Market Önerisi

Benim önerim:

- Oscorpex’i önce “en iyi AI coding agent” diye satma
- Oscorpex’i önce “chat ile uygulama yap” diye satma
- Oscorpex’i “AI ile yapılan mühendislik işini yönetilebilir hale getiren sistem” olarak sat

Bu daha savunulabilir ve daha farklılaşmış bir konumdur.

## 13. Son Tavsiye

Eğer tek bir karar cümlesi bırakacaksak şu olsun:

**Oscorpex, AI ile kod yazmayı değil, AI ile yazılım teslim etmeyi optimize etmeli.**

