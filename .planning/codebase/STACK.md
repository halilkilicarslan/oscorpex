# Kod Tabanı Teknolojileri (Stack)

12 Nisan 2026 tarihinde doğrudan depo incelemesi ve yerel komut çıktıları ile oluşturulmuştur.

## Özet

Oscorpex, iki ana uygulamadan oluşan TypeScript tabanlı bir monorepo yapısıdır:

- `src/`: Hono ve VoltAgent üzerine inşa edilmiş Node.js arka ucu.
- `console/`: Studio ve gözlemlenebilirlik konsolu için React + Vite ön ucu.

Arka uç, çoklu ajan (multi-agent) yazılım görevlerini planlayan ve yürüten bir yapay zeka orkestrasyon sunucusudur. Ön uç ise proje planlama, yürütme, önizleme, günlükler, izlemeler, dosyalar ve ekip yönetimi için yoğun bir operasyon arayüzüdür.

## Temel Teknolojiler

### Arka Uç (Backend)

- Dil: TypeScript (ESM)
- Çalışma Zamanı: Node.js 20.19+
- HTTP Sunucusu: `@voltagent/server-hono` üzerinden Hono
- Yapay Zeka Çerçevesi: `@voltagent/core`
- Ajan Yürütme:
  - Birincil görev yürütme yolu: `src/studio/cli-runtime.ts` içindeki Claude CLI alt süreçleri.
  - Yapılandırılabilir sağlayıcı yolu: AI SDK (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`)
- Derleme: `tsdown`
- Geliştirici Çalıştırıcısı: `tsx watch`
- Formatlama/Linting: Biome
- Testler: Vitest

### Ön Uç (Frontend)

- Dil: TypeScript + TSX
- UI Çerçevesi: React 19
- Paketleyici/Sunucu: Vite 8
- Yönlendirme: `react-router-dom` 7
- Stil: Tailwind CSS 4
- Testler: Vitest + Testing Library + jsdom
- Linting: ESLint + React Hooks eklentisi + React Refresh eklentisi
- Görselleştirme/UI Kütüphaneleri:
  - `@xyflow/react`
  - `@xterm/xterm`
  - `lucide-react`
  - `react-markdown`

## Veri ve Süreklilik

Depo şu anda hibrit bir süreklilik modeli kullanmaktadır:

- Studio uygulama verileri için PostgreSQL + pgvector
- VoltAgent belleği ve gözlemlenebilirliği için `.voltagent/` altındaki LibSQL/SQLite dosyaları
- Studio alt sistemindeki dosya tabanlı ajan günlükleri

`scripts/init.sql` dosyasından gözlemlenen şema ayak izi:

- 38 adet `CREATE TABLE` ifadesi
- pgvector uzantısı etkinleştirilmiş

## Paketleme ve Operasyonlar

- Paket Yöneticisi: pnpm
- Konteynerizasyon: Docker + Docker Compose
- İsteğe Bağlı Servisler:
  - PostgreSQL (`pgvector/pgvector:pg16`)
  - SonarQube
  - Önceden ısıtılmış coder-agent konteynerleri

## Ölçek Göstergeleri

- `src/` + `console/src/` altındaki kaynak dosyalar: 135
- Yaklaşık kaynak boyutu: 57.702 satır
- `src/studio/routes.ts` içindeki Studio API rota tanımları: 132

## Versiyon/Dokümantasyon Kayması

Belgelenen teknoloji yığını genel olarak doğru ancak tamamen güncel değil:

- `README.md` React 18 diyor; `console/package.json` React 19 kullanıyor.
- `ARCHITECTURE.md` hala 4242 portunda VoltAgent/LibSQL'i açıklıyor, ancak mevcut çalışma zamanı PostgreSQL ile 3141 portunda Oscorpex/Hono kullanıyor.
