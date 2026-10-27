# Research: Claude Agent Skills, Tool Reference & Remote MCP Servers

**Tarih**: 2026-05-06
**Kaynaklar**: Claude Platform Docs (3 sayfa)

---

## 1. Agent Skills — Temel Yapı

### Skills Nedir?
Filesystem-based, reusable kaynaklar. Claude'u domain-specific uzman yapar. Prompt'lardan farkı: on-demand yüklenir, tekrar tekrar aynı talimatları verme ihtiyacını ortadan kaldırır.

### 3 Seviyeli Progressive Loading

| Seviye | Ne Zaman Yüklenir | Token Maliyeti | İçerik |
|--------|-------------------|----------------|--------|
| **Level 1: Metadata** | Her zaman (startup) | ~100 token/skill | YAML frontmatter: `name` + `description` |
| **Level 2: Instructions** | Skill tetiklendiğinde | <5K token | SKILL.md body |
| **Level 3+: Resources** | Gerektiğinde | Sınırsız | Bundled dosyalar (.md, .py, scripts/) |

### Skill Dizin Yapısı
```
pdf-skill/
├── SKILL.md          ← Ana talimatlar (YAML frontmatter + body)
├── FORMS.md          ← Ek rehber (lazy-loaded)
├── REFERENCE.md      ← Detaylı API referansı
└── scripts/
    └── fill_form.py  ← Çalıştırılabilir script
```

### Çalışma Akışı
1. **Startup**: System prompt'a skill metadata eklenir: `"PDF Processing - Extract text and tables..."`
2. **User request**: İstek skill description'a match eder
3. **Claude invokes**: `bash: read pdf-skill/SKILL.md` → Context window'a yüklenir
4. **Lazy load**: İhtiyaç duyulursa FORMS.md, scripts/ yüklenir
5. **Execute**: Skill talimatlarıyla task tamamlanır

### SKILL.md Formatı
```markdown
---
name: PDF Processing
description: Extract text and tables from PDF files, fill forms, merge documents
---

## Instructions
1. Use pdfplumber for text extraction
2. For form filling, see [FORMS.md](FORMS.md)
...
```

### Platform Desteği

| Platform | Pre-built | Custom | Dağıtım |
|----------|-----------|--------|---------|
| **Claude.ai** | ✅ | ✅ (upload) | Kişisel (her kullanıcı ayrı upload) |
| **Claude API** | ✅ | ✅ (skill_id + container) | Workspace-wide |
| **Claude Code** | ❌ | ✅ (filesystem) | `~/.claude/skills/` veya `.claude/skills/` |

### API Kullanımı (Beta)
```
Beta headers gerekli:
- code-execution-2025-08-25
- skills-2025-10-02
- files-api-2025-04-14
```

### Güvenlik Uyarıları
- Sadece güvenilen kaynaklardan skill kullanılmalı
- Malicious skill: tool invoke, code execution riski
- External URL fetch eden skill'ler özellikle riskli
- Audit: SKILL.md, scripts, images hepsini incele

---

## 2. Tool Reference — Mevcut Araçlar

### Anthropic Sağladığı Araçlar

| Tool | Type | Execution | Status |
|------|------|-----------|--------|
| **Web Search** | `web_search_20260209` | Server | GA |
| **Web Fetch** | `web_fetch_20260209` | Server | GA |
| **Code Execution** | `code_execution_*` | Server | Beta |
| **Files API** | `files_*` | Server | Beta |
| **MCP Connector** | `mcp_*` | Server | Beta |
| **Computer Use** | `computer_20250124` | Client | GA |
| **Bash** | `bash_20250124` | Client | GA |
| **Text Editor** | `text_editor_20250429` | Client | GA |

### İki Tip Tool
- **Server tools**: Anthropic altyapısında çalışır (web search, code exec)
- **Client tools**: Schema Anthropic'ten, execution uygulama tarafında (bash, text editor)

### Önemli: Code Execution Tool
- Sandbox container'da çalışır
- Skills bu container'da execute edilir
- Network erişimi yok (API'da)
- Pre-installed packages sınırlı

---

## 3. Remote MCP Servers

### Genel
- 3rd-party şirketler remote MCP server'lar deploy ediyor
- Claude API'daki MCP connector üzerinden bağlanılıyor
- Anthropic tarafından sahiplenilmiyor/onaylanmıyor

### Bağlanma
1. Server dokümantasyonunu incele
2. Auth credentials al
3. Server-specific connection instructions takip et
4. MCP connector docs: `/docs/en/agents-and-tools/mcp-connector`

### Güvenlik
- Sadece güvenilen server'lara bağlan
- Security practices ve terms incele
- Her server'ın kendi auth mekanizması var

---

## Oscorpex İçin Çıkarımlar

### Skills Sistemi Tasarımı
Claude'un kendi Skills yapısını **aynen** takip etmeliyiz:

1. **SKILL.md formatı** — YAML frontmatter + markdown body
2. **Progressive loading** — metadata her zaman, body tetiklendiğinde, resources lazy
3. **Filesystem-based** — `.oscorpex/skills/` dizini
4. **On-demand injection** — task başlarken matching skill'leri prompt'a ekle

### Token Tasarrufu İlişkisi
Skills sistemi **token management ile doğrudan ilişkili**:
- Level 1 (metadata): ~100 token/skill — her zaman yüklü, ucuz
- Level 2 (instructions): <5K token — sadece tetiklendiğinde
- Level 3 (resources): context'e girmez — bash ile execute edilir

Bu model, bizim "smart context selection" ihtiyacımızla birebir örtüşüyor.

### Multi-Provider + Skills
- Skill'ler provider-agnostic olmalı (aynı skill farklı provider'larla çalışabilmeli)
- Ama provider-specific optimization mümkün: `## Claude-specific`, `## Gemini-specific` sections

### MCP Entegrasyonu
- Oscorpex agent'ları remote MCP server'lara bağlanabilir
- Skill → MCP tool mapping: skill "hangi MCP tool'u kullanabilir" tanımlanabilir
- Gelecek: Oscorpex kendisi MCP server olabilir
