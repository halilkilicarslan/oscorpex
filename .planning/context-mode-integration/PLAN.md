# Context-Mode Entegrasyon Planı — Oscorpex Native Integration

> **Tarih**: 2026-04-17
> **Kaynak Analiz**: https://github.com/mksglu/context-mode (~16K LOC)
> **Karar**: Plugin değil, native entegrasyon. SQLite yerine mevcut PostgreSQL (tsvector + pg_trgm).

---

## Problem

AI agent'lar çalışırken:
- Tool output'ları context window'u dolduruyor (50 dosyaya kadar raw listing)
- Agent crash/timeout = tüm bilgi kaybı (session recovery yok)
- Cross-agent context relevant değil (tüm completed files listeleniyor)
- Context compress olduğunda agent neyi edit ettiğini unutuyor
- Token maliyeti gereksiz yüksek (~25-40K token/task prompt)

## Çözüm

context-mode'un 5 temel mekanizmasını 4 yeni modül olarak Oscorpex'e entegre etmek:

```
src/studio/
├── context-store.ts      ← FTS ContentStore (PG tsvector + pg_trgm)
├── context-session.ts    ← Session event tracking + resume snapshots
├── context-analytics.ts  ← Context savings metrics + reporting
└── context-sandbox.ts    ← Output sandboxing (büyük output → indexed ref)
```

---

## Faz 1: Context Store (FTS Engine)

**Öncelik**: EN YÜKSEK — Diğer fazların temeli
**Yeni dosya**: `src/studio/context-store.ts`
**DB dosyası**: `src/studio/db/context-repo.ts`

### 1.1 PostgreSQL Schema

```sql
-- pg_trgm extension (bir kez)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Content sources (indexleme operasyonları)
CREATE TABLE IF NOT EXISTS context_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  chunk_count INT NOT NULL DEFAULT 0,
  code_chunk_count INT NOT NULL DEFAULT 0,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, label)
);

CREATE INDEX IF NOT EXISTS idx_ctx_sources_project ON context_sources(project_id);

-- Content chunks (FTS indexli)
CREATE TABLE IF NOT EXISTS context_chunks (
  id SERIAL PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES context_sources(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'prose', -- 'code' | 'prose'
  tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) STORED
);

CREATE INDEX IF NOT EXISTS idx_ctx_chunks_fts ON context_chunks USING GIN(tsv);
CREATE INDEX IF NOT EXISTS idx_ctx_chunks_trgm ON context_chunks USING GIN(content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ctx_chunks_source ON context_chunks(source_id);
```

### 1.2 Chunking Algoritmaları (context-mode'dan adapte)

**Markdown chunking** (kaynak: `store.ts:L800-900`):
- H1-H4 heading'lerde split, hierarchical title stack
- Code block'ları intact tut (``` ... ``` bloğu bölünmez)
- 4KB üstü chunk'ları paragraph boundary'de böl, suffix "(N)"
- Title: joined heading stack ("H1 > H2 > H3")

**JSON chunking** (kaynak: `store.ts:L950-1050`):
- Object key-path'lerde recurse (title = key path)
- Array'leri identity field'larla batch'le (id, name, title, path, slug)
- Flat object = tek chunk, nested = recurse

**Plain-text chunking**:
- Blank-line split (3-200 section, her biri <5KB)
- Fallback: 20 satırlık fixed-size gruplar, 2 satır overlap

### 1.3 Search API

```typescript
interface ContextSearchOptions {
  projectId: string;
  queries: string[];
  limit?: number;         // default 5
  source?: string;        // filter by source label
  contentType?: "code" | "prose";
  maxTokens?: number;     // default 3000
}

interface ContextSearchResult {
  title: string;
  content: string;
  source: string;
  rank: number;
  contentType: "code" | "prose";
  matchLayer: "tsvector" | "trigram" | "fuzzy";
}

// Ana search fonksiyonu — RRF (Reciprocal Rank Fusion)
async function searchContext(opts: ContextSearchOptions): Promise<ContextSearchResult[]>

// Index fonksiyonu
async function indexContent(projectId: string, content: string, source: string, type?: "markdown" | "json" | "plain"): Promise<number>

// Cleanup
async function cleanupStale(projectId: string, maxAgeDays?: number): Promise<number>
```

**Search stratejisi** (context-mode RRF'den adapte):
1. **Layer 1**: `ts_rank(tsv, plainto_tsquery('english', $query))` — PG tsvector BM25-equivalent
2. **Layer 2**: `similarity(content, $query)` — pg_trgm trigram match (typo toleransı)
3. **RRF merge**: `score = Σ 1/(60 + rank)` her layer'dan
4. **Proximity reranking**: Title match boost + term proximity

### 1.4 Entegrasyon Noktaları

- `db/context-repo.ts` — CRUD + search queries
- `context-store.ts` — Chunking + search orchestration
- `db/index.ts` — Barrel export'a ekle

### 1.5 Testler

- Markdown chunking (heading split, code block preserve, oversized chunk split)
- JSON chunking (nested objects, arrays with identity fields)
- tsvector search (exact match, stemming, relevance ranking)
- Trigram fallback (typo tolerance, partial match)
- RRF merge (multi-layer score fusion)
- Source dedup (re-index same label)
- Cleanup (stale sources removal)

---

## Faz 2: Output Sandboxing

**Öncelik**: YÜKSEK — Doğrudan token tasarrufu
**Değişen dosya**: `src/studio/execution-engine.ts`
**Yeni dosya**: `src/studio/context-sandbox.ts`

### 2.1 Task Output Indexing

`markTaskDone()` sonrası agent output'unu FTS'e indexle:

```typescript
// task-engine.ts — markTaskDone() içine ekle
await contextStore.indexContent(
  task.projectId,
  taskOutput,                              // agent'ın ürettiği output
  `task:${task.id}:${task.title}`,         // source label
  "markdown"
);
```

### 2.2 buildTaskPrompt() Refactor

**Mevcut** (50 dosya raw listing + 4000 token completedTasks):
```typescript
// Tüm completed task'ların dosyalarını listele
const codeContext = await this.buildCodeContext(projectId);
```

**Yeni** (FTS search ile sadece relevant dosyalar):
```typescript
const relevantContext = await contextSandbox.compactCrossAgentContext({
  projectId,
  taskTitle: task.title,
  taskDescription: task.description,
  maxTokens: 3000,
  maxFiles: 10,
});
```

### 2.3 Compact Reference Format

```markdown
## Cross-Agent Context (12 tasks completed, 47 files)

### Relevant Files (search: "user authentication middleware")
- src/auth/middleware.ts (backend-dev, Task #4: "Auth middleware")
- src/auth/types.ts (backend-dev, Task #4)
- src/routes/login.ts (backend-dev, Task #7: "Login endpoint")

### Recent Changes Summary
- Authentication system implemented (3 files, backend-dev)
- User model + migrations (2 files, backend-dev)

### Recent Errors (last 2)
- TypeError: Cannot read property 'userId' (Task #9, frontend-dev)
```

### 2.4 Threshold Logic (context-mode'dan)

```typescript
function shouldIndex(output: string): "inline" | "compact" | "index" {
  const bytes = Buffer.byteLength(output, "utf-8");
  if (bytes < 20_000) return "inline";      // <20KB: olduğu gibi döndür
  if (bytes < 100_000) return "compact";    // 20-100KB: compact reference
  return "index";                            // >100KB: zorunlu FTS index
}
```

### 2.5 Testler

- Output threshold (inline/compact/index karar mantığı)
- Compact reference generation (format doğruluğu)
- FTS search integration (relevant file retrieval)
- Token budget enforcement
- Edge case: boş output, tek dosya, 100+ dosya

---

## Faz 3: Session Events (Crash Recovery)

**Öncelik**: ORTA — Robustness artışı
**Yeni dosya**: `src/studio/context-session.ts`
**DB dosyası**: `src/studio/db/context-repo.ts` (extend)

### 3.1 Event Schema

```sql
CREATE TABLE IF NOT EXISTS context_events (
  id SERIAL PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id),
  agent_id UUID REFERENCES project_agents(id),
  session_key TEXT NOT NULL,           -- project_id:task_id composite
  type TEXT NOT NULL,                  -- file_read, file_write, error, git_commit, task_done, etc.
  category TEXT NOT NULL,              -- file, error, git, task, decision
  priority INT NOT NULL DEFAULT 2,     -- 1=critical, 5=low
  data TEXT NOT NULL,
  data_hash TEXT NOT NULL,             -- md5 for dedup
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ctx_events_session ON context_events(session_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ctx_events_dedup ON context_events(session_key, type, data_hash);
```

### 3.2 Event-Bus Bridge

Mevcut `event-bus.ts` event'lerini `context_events`'e yazan listener:

```typescript
// context-session.ts
export function initContextSession(eventBus: EventBus): void {
  eventBus.on("task:completed", (data) => {
    trackEvent({ type: "task_done", category: "task", priority: 1, data: JSON.stringify(data) });
  });

  eventBus.on("task:failed", (data) => {
    trackEvent({ type: "error", category: "error", priority: 1, data: JSON.stringify(data) });
  });

  eventBus.on("agent:output", (data) => {
    // Parse output for file operations
    const fileOps = extractFileOperations(data.output);
    for (const op of fileOps) {
      trackEvent({ type: `file_${op.type}`, category: "file", priority: 2, data: op.path });
    }
  });
}
```

### 3.3 Resume Snapshot Builder

Agent retry/crash sonrası inject edilecek context:

```typescript
interface ResumeSnapshot {
  filesTracked: Array<{ path: string; ops: string }>;  // "edit×3, read×2"
  errors: string[];
  completedSteps: string[];
  environment: { cwd: string };
}

async function buildResumeSnapshot(sessionKey: string): Promise<string> {
  // Group events by category
  // Build compact XML/markdown summary
  // Include search hints for full details
}
```

### 3.4 Task Retry Integration

```typescript
// execution-engine.ts — retry logic'e entegre
if (task.retryCount > 0) {
  const resume = await contextSession.buildResumeSnapshot(`${task.projectId}:${task.id}`);
  prompt += `\n\n## Previous Session Context\n${resume}`;
}
```

### 3.5 Eviction Policy (context-mode'dan)

- Max 500 event per session_key
- Priority-based eviction: lowest priority + oldest first
- SHA256 dedup: son 5 event içinde aynı type+hash → skip

### 3.6 Testler

- Event tracking (event-bus → context_events)
- Dedup (aynı event tekrar yazılmaz)
- Eviction (500 limit aşıldığında low-priority silinir)
- Resume snapshot (correct format, all categories)
- Retry integration (resume context prompt'a inject)

---

## Faz 4: Context Analytics

**Öncelik**: DÜŞÜK — Observability
**Yeni dosya**: `src/studio/context-analytics.ts`
**Route**: `src/studio/routes/analytics-routes.ts` (extend)

### 4.1 Metrics

```typescript
interface ContextMetrics {
  // Per-task savings
  rawBytes: number;           // Original output size
  compactBytes: number;       // After sandboxing
  savedBytes: number;         // Difference
  savingsPercent: number;     // Reduction %

  // Search efficiency
  searchCalls: number;
  searchHits: number;
  avgRelevanceScore: number;

  // Session continuity
  totalEvents: number;
  resumeCount: number;        // How many times resume was used

  // Token estimation
  estimatedTokensSaved: number;  // savedBytes / 4
}
```

### 4.2 Route

```
GET /api/studio/projects/:projectId/analytics/context
```

Response: per-project context metrics + per-task breakdown

### 4.3 Frontend Component

`console/src/pages/studio/ProjectReport.tsx` — yeni "Context Efficiency" section:
- Before/after bar chart (raw vs compact bytes)
- Token savings trend
- Search hit rate
- Top indexed sources

### 4.4 Testler

- Metrics calculation (savings, search efficiency)
- Route response format
- Edge cases (no data, single task, many tasks)

---

## Entegrasyon Matrisi

| Mevcut Modül | Değişiklik | Faz |
|-------------|-----------|-----|
| `execution-engine.ts` | `buildTaskPrompt()` → FTS search + compact refs | 2 |
| `task-engine.ts` | `markTaskDone()` → output indexing + event tracking | 1, 3 |
| `context-packet.ts` | Mode-bazlı FTS search integration | 2 |
| `context-builder.ts` | RAG + FTS hybrid search | 1 |
| `event-bus.ts` | Context events bridge listener | 3 |
| `prompt-budget.ts` | Compact ref token estimation | 2 |
| `scripts/init.sql` | Yeni tablolar (context_sources, context_chunks, context_events) | 1, 3 |
| `db/index.ts` | context-repo barrel export | 1 |
| `routes/analytics-routes.ts` | Context metrics endpoint | 4 |
| `console/.../ProjectReport.tsx` | Context efficiency UI | 4 |

## Beklenen Etki

| Metrik | Mevcut | Hedef |
|--------|--------|-------|
| Cross-agent context boyutu | ~50 dosya raw (8-12KB) | ~10 relevant dosya compact (2-3KB) |
| Task prompt boyutu | ~25-40K token | ~15-25K token |
| Agent crash recovery | Sıfırdan başla | Session resume ile devam |
| Downstream relevance | Tüm completed files | BM25-ranked relevant files |
| Token cost per task | Baseline | %30-40 azalma |
| Search hit rate | N/A | >%80 hedef |

## Riskler

| Risk | Etki | Mitigasyon |
|------|------|-----------|
| pg_trgm extension yüklü değilse | FTS eksik kalır | `CREATE EXTENSION IF NOT EXISTS` + startup check |
| Chunking kalitesi düşükse | Irrelevant search results | context-mode'un battle-tested algoritmalarını adapte et |
| Compact refs çok kısa | Agent context kaybeder | Threshold tuning + A/B test |
| Event tracking overhead | DB yükü artar | Batch insert + async write |

## Referanslar

- context-mode kaynak: `/tmp/context-mode-analysis/` (clone)
- Serena memory: `context-mode/analysis-complete`
- context-mode README: https://github.com/mksglu/context-mode
- Oscorpex mevcut context: `src/studio/context-packet.ts`, `src/studio/context-builder.ts`
