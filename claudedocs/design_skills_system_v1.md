# Oscorpex Skills System — Design Document v1

## Genel Bakış

Claude'un Agent Skills modelini temel alarak, Oscorpex'e özel genişletilmiş bir skills sistemi.

## Veri Modeli

### Skills Tablosu
```sql
CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    content_md TEXT NOT NULL,            -- SKILL.md body (YAML frontmatter + markdown)
    triggers TEXT[] DEFAULT '{}',         -- Keyword triggers ["react", "hooks", "useState"]
    applicable_roles TEXT[] DEFAULT '{}', -- ["frontend-dev", "fullstack-dev"]
    provider_hint TEXT,                   -- Önerilen provider ("gemini", "claude-code", null=any)
    model_hint TEXT,                      -- Önerilen model ("claude-haiku-4-5", null=auto)
    category TEXT DEFAULT 'custom',       -- "framework" | "language" | "tool" | "workflow" | "company" | "custom"
    is_global BOOLEAN DEFAULT FALSE,      -- Tüm projeler için geçerli
    max_token_budget INTEGER DEFAULT 5000, -- Skill'in kullanabileceği max token
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skills_triggers ON skills USING GIN(triggers);
CREATE INDEX IF NOT EXISTS idx_skills_roles ON skills USING GIN(applicable_roles);
```

### Skill-Agent Assignment
```sql
CREATE TABLE IF NOT EXISTS agent_skills (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES project_agents(id) ON DELETE CASCADE,
    skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    priority INTEGER DEFAULT 0,           -- Yüksek = öncelikli inject
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(agent_id, skill_id)
);
```

### Skill-Project Assignment
```sql
CREATE TABLE IF NOT EXISTS project_skills (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, skill_id)
);
```

## SKILL.md Format

```markdown
---
name: React Hooks Expert
description: Modern React hooks patterns, custom hooks, performance optimization
triggers: [react, hooks, useState, useEffect, useMemo, useCallback]
roles: [frontend-dev, fullstack-dev]
category: framework
providerHint: claude-code
maxTokenBudget: 4000
---

## Rules
1. Always use functional components with hooks
2. Never use class components
3. Custom hooks must start with "use" prefix

## Patterns
### State Management
- Use useState for simple state
- Use useReducer for complex state logic

### Performance
- Wrap expensive computations in useMemo
- Wrap callback functions in useCallback
- Use React.memo for pure components

## Anti-patterns
- Don't use hooks inside conditions or loops
- Don't call hooks from regular functions
```

## Progressive Loading (3 Seviye)

### Level 1: Metadata (~100 token/skill)
System prompt'a eklenir (her zaman):
```
Available Skills:
- React Hooks Expert: Modern React hooks patterns [triggers: react, hooks]
- FastAPI Patterns: Python API best practices [triggers: fastapi, python, api]
```

### Level 2: Instructions (<5K token)
Task başlarken matching skill'in body'si prompt'a inject edilir:
```
## SKILL: React Hooks Expert
[SKILL.md body content here]
```

### Level 3: Resources (0 token - bash exec)
Script dosyaları context'e girmeden çalıştırılır:
```
skills/react-hooks/
├── SKILL.md
├── PATTERNS.md         ← Lazy-loaded
└── scripts/
    └── lint-hooks.sh   ← Bash ile execute, context'e girmez
```

## Runtime Akışı

```
Task execution başlar
    ↓
1. resolveSkillsForTask(task, agent)
   - Agent'a atanmış skill'ler
   - Proje skill'leri
   - Global skill'ler
   - Trigger keyword matching (task.title + task.description)
    ↓
2. prioritizeSkills(matchedSkills, tokenBudget)
   - Priority sıralaması
   - Token budget'a sığdır (toplam max 10K token)
   - Overflow → metadata-only (Level 1)
    ↓
3. injectSkills(prompt, selectedSkills)
   - Level 2 skill'leri prompt'a ekle
   - Level 1 skill'leri metadata olarak ekle
    ↓
4. Agent çalışır (skill bilgisiyle)
```

## Provider Hint Sistemi

Skill'deki `providerHint` alanı, model router'a öneride bulunur:

```typescript
// model-router.ts'de
const skillHints = getSkillProviderHints(task, agent);
if (skillHints.provider) {
    // Skill'in önerdiği provider'ı tercih et
    // Ama zorunlu değil — fallback chain'de öncelik ver
}
```

## API Endpoints

```
GET    /api/studio/skills                    — Tüm skill'leri listele
POST   /api/studio/skills                    — Yeni skill oluştur
GET    /api/studio/skills/:id                — Skill detayı
PUT    /api/studio/skills/:id                — Skill güncelle
DELETE /api/studio/skills/:id                — Skill sil

POST   /api/studio/projects/:id/skills       — Projeye skill ata
DELETE /api/studio/projects/:id/skills/:sid   — Projeden skill kaldır
GET    /api/studio/projects/:id/skills        — Proje skill'leri

POST   /api/studio/agents/:id/skills          — Agent'a skill ata
DELETE /api/studio/agents/:id/skills/:sid      — Agent'tan skill kaldır
GET    /api/studio/agents/:id/skills           — Agent skill'leri

POST   /api/studio/skills/:id/preview          — Skill inject preview (test)
```

## Frontend — Skills Sayfası

### Skill Listesi
- Kategori filtreleme (framework, language, tool, workflow, company, custom)
- Role filtreleme
- Arama (name + triggers)
- Global/project toggle

### Skill Editor
- Monaco editor (md syntax highlighting)
- YAML frontmatter validation
- Preview: "Bu skill inject edildiğinde prompt nasıl görünür?"
- Token count göstergesi

### Agent Skill Assignment
- Takım sayfasında her agent'ın yanında skill badges
- Drag & drop skill → agent atama
- Skill priority sıralama

## Implementation Fazları

### Faz 1: Backend Core
- DB schema (skills, agent_skills, project_skills)
- CRUD repo + routes
- Skill resolver (task+agent → matching skills)
- Prompt injector (prompt-assembler'a skill section ekle)

### Faz 2: Runtime Integration
- model-router'da provider hint desteği
- Token budget management (skill-aware)
- Skill usage telemetry

### Faz 3: Frontend
- Skills listesi sayfası
- .md editor (Monaco)
- Agent skill assignment UI
- Skill preview/test

### Faz 4: Advanced
- Skill marketplace (paylaşım)
- Auto-skill detection (proje analiz → skill önerisi)
- Skill versioning
- MCP tool mapping
