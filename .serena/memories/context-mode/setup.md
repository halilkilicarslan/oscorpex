# Context-Mode Setup & Usage

## Installation
- Plugin: `context-mode@context-mode` v1.0.89
- Marketplace: `mksglu/context-mode` (GitHub)
- Settings: `~/.claude/settings.json` → `enabledPlugins["context-mode@context-mode"]: true`
- Extra marketplace: `extraKnownMarketplaces.context-mode.source.repo = "mksglu/context-mode"`

## Hook Delivery
- Hooks defined in plugin `hooks.json` at `~/.claude/plugins/cache/context-mode/context-mode/1.0.89/hooks/hooks.json`
- Auto-injected by plugin system — NOT manually added to settings.json hooks section
- Hook script: `pretooluse.mjs`, `posttooluse.mjs`, `precompact.mjs`, `sessionstart.mjs`, `userpromptsubmit.mjs`
- Uses `${CLAUDE_PLUGIN_ROOT}` variable resolved at plugin runtime

## Doctor Check (2026-04-21)
- Server: PASS
- FTS5/SQLite: PASS (native module)
- Hook script: PASS
- Runtimes: 6/11 (JS, Shell, Python, Ruby, PHP, Perl)
- Performance: NORMAL (Bun not installed — optional 3-5x boost)

## MCP Tools Available
- `ctx_batch_execute` — Primary research tool (runs commands, auto-indexes, searches)
- `ctx_search` — Follow-up queries against indexed data
- `ctx_execute` / `ctx_execute_file` — Data processing, log analysis, computation
- `ctx_fetch_and_index` — Fetch URLs and index content (replaces WebFetch)
- `ctx_stats` — Session token savings stats
- `ctx_doctor` — Diagnostics
- `ctx_purge` — Wipe knowledge base (destructive)
- `ctx_upgrade` — Pull latest and reinstall
- `ctx_insight` — Analytics dashboard (localhost:4747)
- `ctx_index` — Manual content indexing

## Usage Rules
- Use `ctx_batch_execute` for research (replaces multiple Bash/Read calls)
- Use `ctx_search` for follow-up questions (multi-query in one call)
- Use `ctx_execute`/`ctx_execute_file` for data processing only
- NEVER use ctx_execute to create/modify files — use Write/Edit tools
- NEVER use Bash for commands producing >20 lines — use ctx_batch_execute
- After /clear or /compact: knowledge base preserved, use `ctx purge` to reset

## Coexistence with Serena
- Both Serena hooks and context-mode hooks active simultaneously
- Serena hooks: in settings.json (remind, auto-approve, activate, cleanup)
- Context-mode hooks: in plugin hooks.json (pretooluse routing, posttooluse capture, precompact snapshot)
- No conflicts — different matcher patterns
