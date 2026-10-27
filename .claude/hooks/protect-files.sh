#!/bin/bash
# protect-files.sh — Block edits to legacy/generated/sensitive paths
# Exit 2 = block the tool call, Exit 0 = allow

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Protected path patterns
PROTECTED_PATTERNS=(
  ".voltagent/repos/"
  "archive/legacy/"
  "apps/kernel-src/"
  ".env"
  "node_modules/"
  ".git/"
)

for pattern in "${PROTECTED_PATTERNS[@]}"; do
  if [[ "$FILE_PATH" == *"$pattern"* ]]; then
    echo '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"Protected path: '"$pattern"' — this directory should not be edited. See CLAUDE.md constraints."}}'
    exit 2
  fi
done

exit 0
