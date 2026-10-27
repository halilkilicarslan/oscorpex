# Project Hooks & Tooling Configuration

## Global Hooks (`~/.claude/settings.json`)
- **PreToolUse**: Serena remind (all tools), Serena auto-approve (`mcp__serena__*`)
- **SessionStart**: Serena activate, context-mode cache-heal
- **Stop**: Serena cleanup
- **Notification**: macOS desktop notification (Glass sound)
- **Env**: MCP_TIMEOUT=60000

## Project Hooks (`oscorpex/.claude/settings.json`)
- **PreToolUse (Edit|Write)**: `protect-files.sh` — blocks .voltagent/repos/, archive/legacy/, kernel-src/, .env, node_modules/, .git/
- **PostToolUse (Edit|Write)**: `biome-format.sh` — auto-formats TS/JS/JSON with Biome

## Context-Mode
- Installed as plugin (marketplace): `context-mode@context-mode`
- Version: v1.0.107
- Hooks: auto-registered (PreToolUse, PostToolUse, PreCompact, SessionStart)
- Doctor: all PASS

## Serena
- Context: `claude-code` (disables duplicate tools)
- Flag: `--project-from-cwd` (global scope)
- Hooks: remind, auto-approve, activate, cleanup
- Config: `~/.serena/serena_config.yml` (LSP backend, interactive+editing modes)
- Project config: `.serena/project.yml` (typescript, ignored_paths, initial_prompt set)

## Shell Aliases
- `claude()`: teammate-mode tmux (standard)
- `cc()`: teammate-mode tmux + dangerously-skip-permissions + serena system-prompt override
- `vibe()`: separate CLAUDE_CONFIG_DIR for alternate config
