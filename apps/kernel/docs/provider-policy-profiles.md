# Provider Policy Profiles

## Overview

Provider Policy Profiles let projects control the trade-off between cost, quality, and locality when selecting AI providers. A profile is stored per-project in `project_settings` (category: `model_routing`, key: `provider_policy_profile`) and influences both primary provider selection and cost-aware model downgrading.

## Available Profiles

| Profile | Default Provider | Cost Optimization | Quality Preservation | Use Case |
|---------|-----------------|-------------------|----------------------|----------|
| `balanced` | Claude Code | S/M tiers only | After failures | Default — good mix of cost and quality |
| `cheap` | Gemini | All tiers | Disabled | Cost-sensitive projects |
| `quality` | Claude Code | Disabled | Always | Maximum quality, no downgrades |
| `local-first` | Ollama | S/M only | After failures | Privacy / offline-first projects |
| `fallback-heavy` | Claude Code | S/M only | After failures | Maximum fallback coverage |

## Configuration

Set the profile via project settings:

```sql
INSERT INTO project_settings (project_id, category, key, value)
VALUES ('p-1', 'model_routing', 'provider_policy_profile', 'cheap');
```

Or pass it explicitly when calling `resolveModel`:

```typescript
const result = await resolveModel(task, {
  projectId: "p-1",
  profile: "local-first",
});
```

## Profile Behavior Details

### balanced
- Primary provider: `claude-code`
- Fallback order: claude-code → codex → cursor → gemini → ollama
- Cost downgrade allowed for S/M tiers only
- Quality preserved after failures (no downgrade if `priorFailures > 0`)

### cheap
- Primary provider: `gemini`
- Fallback order: ollama → gemini → codex → claude-code → cursor
- Cost downgrade allowed for all tiers (S, M, L, XL)
- Quality NOT preserved after failures (keeps trying cheaper models)

### quality
- Primary provider: `claude-code`
- Fallback order: claude-code → cursor → codex → gemini → ollama
- No cost downgrade at any tier
- Always uses the best model for the tier

### local-first
- Primary provider: `ollama`
- Fallback order: ollama → claude-code → codex → cursor → gemini
- Cost downgrade allowed for S/M tiers
- Falls back to remote providers if local is unavailable

### fallback-heavy
- Primary provider: `claude-code`
- Fallback order: same as balanced
- All remaining providers are included in the fallback chain (up to 4 fallbacks)
- Useful when reliability is more important than latency

## How It Works

1. **Profile Resolution**: `resolveModel` reads the profile from project settings (or uses the explicit `profile` parameter).
2. **Primary Provider Selection**: `selectPrimaryProvider(profile, cliTool)` determines the default provider. An explicit `cliTool` always overrides the profile.
3. **Model Selection**: The profile's `allowCostDowngrade` and `downgradeTiers` influence `selectCostAwareModel`:
   - If downgrade is disabled, the base model is always used
   - If downgrade is enabled but the tier is not in `downgradeTiers`, no downgrade
   - If `preserveQualityOnFailure` is true and there were prior failures, no downgrade
4. **Telemetry**: The selected profile is included in `ResolvedModel.selectedProfile` and logged in `decisionReason`.

## Invalid Profiles

If an invalid profile value is encountered, the system logs a warning and falls back to `balanced`. This ensures the system never breaks due to a bad config value.

## Future Enhancements

- Per-task profile override
- Profile-based fallback chain integration in execution-engine
- UI for profile selection in project settings
