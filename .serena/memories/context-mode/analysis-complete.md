# Context-Mode Analysis — Oscorpex Entegrasyonu

## Analiz Tarihi: 2026-04-17
## Kaynak: https://github.com/mksglu/context-mode (clone: /tmp/context-mode-analysis)
## Durum: Analiz tamamlandı, entegrasyon planı hazır, implementasyon bekliyor

## context-mode Temel Mekanizmaları

### 1. FTS5 Content Store (store.ts — 1555 LOC)
- SQLite FTS5 ile porter stemmer + trigram dual tokenization
- BM25 + RRF (Reciprocal Rank Fusion) multi-layer search
- Fuzzy correction via Levenshtein distance + vocabulary table
- Markdown chunking: heading split + code block preserve
- JSON chunking: key-path recursive walk
- Threshold: <20KB direkt, 20-100KB intent-based, >100KB zorunlu index
- Sonuç: 315KB → 5.4KB (%98 azalma)

### 2. Session Event Tracking (session/ — 1582 LOC toplam)
- 15 event kategorisi: file, error, git, task, decision, rule, env, cwd, subagent, mcp, skill, intent, data, role, plan
- Priority-based eviction (max 1000/session, lowest priority first)
- SHA256 dedup (son 5 event window)
- Resume snapshot: XML table-of-contents + runnable search queries
- Zero truncation: full data DB'de, snapshot sadece navigasyon

### 3. Sandbox Execution (executor.ts — 498 LOC)
- Process isolation (stdout/stderr buffer, 100MB hard cap)
- Network byte tracking (__CM_NET__ markers)
- FS byte tracking (__CM_FS__ markers)
- Intent-driven search: büyük output'larda sadece relevant kısımlar
- 11 dil desteği (JS, TS, Python, Shell, Ruby, Go, Rust, PHP, Perl, R, Elixir)

### 4. Security (security.ts — 556 LOC)
- 48 env variable deny list (shell/node/python/ruby/go injection prevention)
- Shell-escape detection regex (Python os.system, JS exec, Ruby backticks, etc.)
- Command deny-only enforcement (split chained commands, check each segment)
- File path deny patterns (glob-to-regex)

### 5. Analytics (analytics.ts — 518 LOC)
- Per-tool context savings (raw vs context bytes)
- Token estimation: 4 bytes = 1 token
- 15 personal + 56 enterprise metrics
- Session continuity metrics

## Oscorpex Entegrasyon Planı

### Karar: Plugin değil, native entegrasyon
- context-mode'un prensipleri 4 yeni modül olarak sisteme entegre edilecek
- SQLite yerine mevcut PostgreSQL kullanılacak (tsvector + pg_trgm)

### Yeni Modüller
```
src/studio/
├── context-store.ts      ← FTS ContentStore (PG tsvector + pg_trgm)
├── context-session.ts    ← Session event tracking + resume snapshots
├── context-analytics.ts  ← Context savings metrics
└── context-sandbox.ts    ← Output sandboxing (büyük output → indexed ref)
```

### Entegrasyon Noktaları
- execution-engine.ts → buildTaskPrompt() refactor (FTS search + compact refs)
- task-engine.ts → markTaskDone()/failTask() → output indexing + event tracking
- context-packet.ts → mode-bazlı FTS search integration
- event-bus.ts → context_events bridge

### Fazlar
1. **Context Store** (FTS engine) — PG schema + chunking + search API
2. **Output Sandboxing** — buildTaskPrompt() refactor, compact references
3. **Session Events** — event-bus bridge, resume snapshots, crash recovery
4. **Analytics** — savings metrics, frontend dashboard

### Beklenen Etki
- Cross-agent context: 50 raw dosya → 10 relevant compact ref
- Task prompt: 25-40K → 15-25K token (%35-40 azalma)
- Agent crash: sıfırdan → session resume
- Token cost: %30-40 azalma

## Önemli Kaynak Dosyalar (context-mode)
- `/tmp/context-mode-analysis/src/store.ts` — ContentStore (FTS5, chunking, search)
- `/tmp/context-mode-analysis/src/server.ts` — MCP server (tool definitions, sandbox logic)
- `/tmp/context-mode-analysis/src/executor.ts` — PolyglotExecutor (process isolation)
- `/tmp/context-mode-analysis/src/security.ts` — Security firewall
- `/tmp/context-mode-analysis/src/session/extract.ts` — Event extraction (15 categories)
- `/tmp/context-mode-analysis/src/session/snapshot.ts` — Resume snapshot builder
- `/tmp/context-mode-analysis/src/session/db.ts` — SessionDB (events, meta, resume tables)
- `/tmp/context-mode-analysis/src/session/analytics.ts` — Analytics engine
