# Serena MCP Server — Araştırma Raporu

> **Tarih**: 2026-05-04  
> **Konu**: Serena repo analizi, best practice'ler, Claude Code CLI kurulum ve konfigürasyon  
> **Confidence**: Yüksek (resmi dokümantasyon + repo analizi)

---

## 1. Serena Nedir?

Serena, AI coding agent'lara **sembolik kod anlama** yeteneği kazandıran bir MCP (Model Context Protocol) toolkit'idir. Geleneksel metin tabanlı arama/okuma yerine, IDE benzeri yetenekler sunar:

- **Symbol-level navigasyon**: "go to definition", "find all references"
- **Semantic editing**: Sembol bazında kod düzenleme (replace_symbol_body, insert_before/after_symbol)
- **Cross-file dependency analysis**: Semboller arası ilişki takibi
- **Memory sistemi**: Proje bilgilerini session'lar arası taşıma
- **30+ dil desteği**: TypeScript, Python, Go, Rust, Java, C++, vb.
- **Ücretsiz ve açık kaynak** (MIT lisans, 23.8K GitHub star)

### Ne Zaman Kullanılmalı?
- Büyük codebase'lerde (100+ dosya) bileşenler arası bağlantıları anlamak
- Refactoring — değişikliklerin etkisini trace etmek
- Symbol-level düzenleme — line number yerine yapısal kod manipülasyonu
- Proje onboarding — yeni gelen developerın projeyi hızlıca tanıması

### Ne Zaman Gereksiz?
- Küçük, tek dosyalık projeler
- Sadece dosya okuma/yazma işlemleri (Claude Code zaten yapıyor)
- Shell komutu çalıştırma (Claude Code zaten yapıyor)

---

## 2. Kurulum (Claude Code CLI)

### Ön Gereksinimler

```bash
# uv (Python paket yöneticisi) kurulu olmalı
which uv    # /Users/iamhk/.local/bin/uv ✓
which serena # /Users/iamhk/.local/bin/serena ✓
```

> **DİKKAT**: Serena'yı MCP marketplace veya npm üzerinden kurmayın — outdated/suboptimal. Resmi Quick Start kullanın.

### Yöntem 1: Otomatik Kurulum (Önerilen)

```bash
serena setup claude-code
```

Bu komut MCP server kaydını ve hooks'ları otomatik kurar.

### Yöntem 2: Manuel — Global (Tüm Projeler)

```bash
claude mcp add --scope user serena -- serena start-mcp-server --context claude-code --project-from-cwd
```

- `--scope user`: Tüm projeler için geçerli
- `--context claude-code`: Claude Code'un built-in araçlarıyla çakışan tool'ları devre dışı bırakır
- `--project-from-cwd`: Her seferinde `pwd`'yi proje olarak kullanır

### Yöntem 3: Manuel — Proje Bazlı

```bash
claude mcp add serena -- serena start-mcp-server --context claude-code --project /Users/iamhk/development/personal/oscorpex
```

### Yöntem 4: uvx ile (Serena kurulu değilse)

```bash
claude mcp add --scope user serena -- uvx --from git+https://github.com/oraios/serena serena start-mcp-server --context claude-code --project-from-cwd
```

### Doğrulama

Claude Code içinde `/mcp` komutu ile Serena'nın bağlı olduğunu kontrol edin.

---

## 3. Claude Code Hooks Konfigürasyonu (KRİTİK)

### Neden Gerekli?

Claude Code (özellikle Opus 4.x modelleri) Serena tool'larını **unutma eğiliminde** ("agent drift"). Built-in tool açıklamaları ~16K token yer kaplıyor ve güçlü bias yaratıyor. Hooks bu sorunu çözer.

### Hooks Settings — `.claude/settings.json`

Proje seviyesi (`.claude/settings.json`) veya global (`~/.claude/settings.json`) olarak ekleyin:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "serena-hooks remind --client=claude-code"
          }
        ]
      },
      {
        "matcher": "mcp__serena__*",
        "hooks": [
          {
            "type": "command",
            "command": "serena-hooks auto-approve --client=claude-code"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "serena-hooks activate --client=claude-code"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "serena-hooks cleanup --client=claude-code"
          }
        ]
      }
    ]
  }
}
```

### Hook Açıklamaları

| Hook | Event | Ne Yapar |
|------|-------|----------|
| `remind` | PreToolUse (her tool çağrısı) | Agent ardışık grep/read_file kullanıyorsa Serena sembolik tool'larını hatırlatır |
| `auto-approve` | PreToolUse (`mcp__serena__*`) | Serena tool'larını acceptEdits modunda otomatik onaylar |
| `activate` | SessionStart | Session başında projeyi aktive eder ve talimatları yükler |
| `cleanup` | Stop | Session bittiğinde hook verilerini temizler |

### Sistem Prompt Override (Opsiyonel ama Önerilen)

Opus 4.x'in Serena tool'larını görmezden gelme sorununu aşmak için:

```bash
claude --system-prompt="$(serena prompts print-cc-system-prompt-override)"
```

Veya `CLAUDE.md` dosyasına `serena cc-system-prompt-override` içeriğini ekleyin (ancak etki system-prompt kadar güçlü olmayabilir).

---

## 4. Konfigürasyon Dosyaları

### 4.1 Global Config: `~/.serena/serena_config.yml`

Tüm projelere uygulanır. Önemli ayarlar:

```yaml
# Dil backend'i (LSP veya JetBrains)
language_backend: LSP

# Dashboard
web_dashboard: true
web_dashboard_open_on_launch: false  # Terminal kullanıcıları için false önerilir

# Default modlar
default_modes:
  - interactive
  - editing

# Tool timeout (saniye)
tool_timeout: 240

# Token sayma (varsayılan: CHAR_COUNT, alternatif: TIKTOKEN_GPT4)
token_count_estimator: CHAR_COUNT

# Symbol bilgisi bütçesi (saniye)
symbol_info_budget: 10.0

# Satır sonu
line_ending: native
```

### 4.2 Proje Config: `.serena/project.yml`

Proje bazında override'lar:

```yaml
project_name: "oscorpex"
languages:
  - typescript     # JS için de typescript kullanılır
encoding: "utf-8"
ignore_all_files_in_gitignore: true
read_only: false

# Proje bazında tool seçimi
excluded_tools: []
included_optional_tools: []

# Mod override'ları
base_modes:        # Her zaman aktif modlar
default_modes:     # Varsayılan modlar (CLI ile override edilebilir)

# Ignore pattern'leri (gitignore syntax)
ignored_paths: []

# Initial prompt (proje aktive edildiğinde LLM'e verilir)
initial_prompt: ""

# Memory pattern'leri
read_only_memory_patterns: []
ignored_memory_patterns: []
```

### 4.3 Lokal Override: `.serena/project.local.yml`

- `project.yml` ile aynı key'leri kullanır
- Git'e commit edilmez (kişisel geliştirme ayarları)
- `project.yml`'deki ayarları override eder

---

## 5. Context'ler ve Modlar

### Context'ler (Başlangıçta Belirlenir, Değiştirilemez)

| Context | Açıklama | Ne Zaman |
|---------|----------|----------|
| `claude-code` | Claude Code built-in'leriyle çakışan tool'ları devre dışı bırakır | **Claude Code CLI kullanırken (önerilen)** |
| `desktop-app` | Tüm tool'lar aktif (varsayılan) | Claude Desktop |
| `ide` | IDE assistant'ları için (VSCode, Cursor) | IDE entegrasyonu |
| `codex` | OpenAI Codex optimizasyonu | Codex CLI |
| `agent` | Otonom agent senaryoları | Agno vb. |

### Modlar (Çalışırken Değiştirilebilir)

| Mod | Açıklama |
|-----|----------|
| `interactive` | Konuşma tarzı etkileşim (varsayılan aktif) |
| `editing` | Kod düzenleme optimizasyonu (varsayılan aktif) |
| `planning` | Planlama ve analiz odaklı |
| `one-shot` | Tek seferde tamamlanacak görevler |
| `onboarding` | Proje tanıma süreci |
| `no-onboarding` | Onboarding'i atla (memory'ler korunur) |
| `no-memories` | Tüm memory tool'larını devre dışı bırak |
| `query-projects` | Diğer Serena projelerini sorgulamayı etkinleştir |

Modlar `switch_modes` tool'u ile runtime'da değiştirilebilir.

---

## 6. Memory Sistemi

### Yapı

```
.serena/memories/           # Proje bazlı memory'ler
  project/                  # Proje yapısı
  sessions/                 # Session özetleri  
  context-mode/             # Context-mode entegrasyonu
  team-restructure/         # Alan bazlı memory'ler
~/.serena/memories/global/  # Tüm projelerde paylaşılan global memory'ler
```

### Best Practice'ler

1. **Onboarding sonrası memory'leri gözden geçirin** — LLM bazen eksik veya yanlış bilgi yazabilir
2. **Memory'leri düzenleyin** — Markdown dosyaları, elle veya Dashboard'dan düzenlenebilir
3. **Topic bazlı organize edin** — `modules/frontend`, `conventions/testing` gibi `/` ile alt klasörleme
4. **Uzun session'larda `prepare_for_new_conversation`** kullanın — context window dolmadan önce özet kaydeder
5. **Global memory'leri git ile takip edin** — `~/.serena/memories/` dizinini git repo yapın
6. **read_only_memory_patterns** ile önemli memory'leri koruyun

### Onboarding Süreci

- İlk çalıştırmada otomatik tetiklenir (memory yoksa)
- Proje yapısını, build sistemini, test setup'ını analiz eder
- Context window'u doldurur — **onboarding sonrası yeni conversation başlatın**
- Bypass: `.serena/memories/` altına dummy dosya oluşturun

---

## 7. Best Practice'ler Özeti

### Kurulum
1. `serena setup claude-code` ile otomatik kur
2. Hooks'ları mutlaka ekle (agent drift'i önler)
3. `--context claude-code` kullan (tool çakışmasını önler)
4. `MCP_TIMEOUT=60000` shell profile'a ekle (büyük projelerde timeout önler)

### Günlük Kullanım
1. **Sembolik tool'ları tercih et** — `find_symbol`, `get_symbols_overview`, `find_referencing_symbols` > grep/read
2. **read_only: false** dikkatli kullan — production branch'lerde `true` düşün
3. **Modları görev tipine göre değiştir** — planlama için `planning`, kodlama için `editing`
4. **Uzun session'larda memory kaydet** — `prepare_for_new_conversation` kullan
5. **Dashboard'u kullan** — `web_dashboard: true` ile session'ı izle

### Konfigürasyon
1. **`project.yml`'i versiyonla** (git'e commit et)
2. **`project.local.yml`'i gitignore'a ekle** (kişisel ayarlar)
3. **`excluded_tools`** ile gereksiz tool'ları kapat (token tasarrufu)
4. **`ignored_paths`** ile node_modules, dist vb. hariç tut (`.gitignore` zaten okunuyor)
5. **`initial_prompt`** ile proje aktivasyonunda özel talimat ver

### Güvenlik
1. **`read_only: true`** — review/analiz session'larında
2. **`read_only_memory_patterns`** — kritik memory'leri koruma altına al
3. **Auto-approve hook'u** sadece acceptEdits modunda çalışır

---

## 8. Mevcut Oscorpex Konfigürasyon Analizi

### Durum
- Serena kurulu ve yapılandırılmış ✓
- `project.yml` mevcut, `typescript` dili aktif ✓
- Memory'ler mevcut (project, sessions, context-mode, team-restructure) ✓
- `project.local.yml` boş (override yok)

### Öneriler

| # | Öneri | Öncelik |
|---|-------|---------|
| 1 | Hooks konfigürasyonunu `.claude/settings.json`'a ekle (agent drift önlemi) | **Yüksek** |
| 2 | `serena prompts print-cc-system-prompt-override` çıktısını `CLAUDE.md`'ye ekle | **Yüksek** |
| 3 | `initial_prompt` alanını doldur (Türkçe yanıt, pnpm kullan, `.voltagent/repos/` düzenleme) | Orta |
| 4 | `ignored_paths` ile gereksiz dizinleri hariç tut: `archive/legacy/**`, `.voltagent/repos/**` | Orta |
| 5 | Global config'de `projects` listesini temizle (temp dizinler var) | Düşük |
| 6 | `web_dashboard_open_on_launch: false` zaten doğru ayarlanmış ✓ | — |

---

## 9. Oscorpex İçin Önerilen Tam Konfigürasyon

### `.claude/settings.json`'a Eklenecek Hooks

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "serena-hooks remind --client=claude-code"
          }
        ]
      },
      {
        "matcher": "mcp__serena__*",
        "hooks": [
          {
            "type": "command",
            "command": "serena-hooks auto-approve --client=claude-code"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "serena-hooks activate --client=claude-code"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "serena-hooks cleanup --client=claude-code"
          }
        ]
      }
    ]
  }
}
```

### `.serena/project.yml` Güncellemeleri

```yaml
# Eklenecek ayarlar:
ignored_paths:
  - "archive/legacy/**"
  - ".voltagent/repos/**"
  - "apps/kernel-src/**"

initial_prompt: |
  Bu proje Oscorpex — AI-powered software development platform.
  Monorepo: kernel (Hono backend), console (React 19 frontend), 10+ packages.
  Dil: TypeScript. Paket yöneticisi: pnpm. Yanıtlar Türkçe olmalı.
  .voltagent/repos/ ve archive/legacy/ dizinlerini düzenleme.
```

---

## Kaynaklar

- [Serena GitHub Repo](https://github.com/oraios/serena) — 23.8K star, MIT lisans
- [Serena Resmi Dokümantasyon](https://oraios.github.io/serena/)
- [Connecting MCP Clients](https://oraios.github.io/serena/02-usage/030_clients.html)
- [Configuration](https://oraios.github.io/serena/02-usage/050_configuration.html)
- [Memories & Onboarding](https://oraios.github.io/serena/02-usage/045_memories.html)
- [Project Workflow](https://oraios.github.io/serena/02-usage/040_workflow.html)
- [Running Serena](https://oraios.github.io/serena/02-usage/020_running.html)
- [SmartScope Serena Setup Guide](https://smartscope.blog/en/generative-ai/claude/serena-mcp-implementation-guide/)
- [Agensi Serena Complete Guide](https://www.agensi.io/learn/serena-mcp-guide)
- [ClaudeLog Serena Guide](https://claudelog.com/claude-code-mcps/serena/)
- [VibeTools Serena Guide](https://vibetools.net/posts/serena-mcp-complete-guide)
