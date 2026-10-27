#!/bin/bash
# biome-format.sh — Auto-format edited files with Biome
# Runs after Edit/Write tool calls

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only format JS/TS/JSON files that Biome handles
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx|*.json|*.jsonc)
    # Run biome format silently, don't fail the hook if biome errors.
    # No --unsafe: unsafe fixes change semantics (e.g. `x!.id` -> `x?.id`).
    npx @biomejs/biome check --write "$FILE_PATH" 2>/dev/null || true
    ;;
esac

exit 0
