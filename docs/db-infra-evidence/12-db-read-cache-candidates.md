# DB Read Cache Candidates (EPIC 12)

**Scope**: Frequently read, rarely changed data

---

## Read Hotspot List

### 1. Project Settings
**Query**: `getProjectSetting(projectId, category, key)`
**Frequency**: Every task execution (timeout multiplier, policy settings)
**Change Frequency**: Rare (only when user updates settings)
**Cache Suitability**: ✅ HIGH

### 2. Routing Config
**Query**: `getDefaultRoutingConfig()` (implicit via `model-router.ts`)
**Frequency**: Every task execution
**Change Frequency**: Never (hardcoded)
**Cache Suitability**: ✅ HIGH (already effectively cached — it's a constant)

### 3. Agent Config
**Query**: `getAgentConfig(agentId)`
**Frequency**: Every task execution
**Change Frequency**: Rare (only when team composition changes)
**Cache Suitability**: ✅ HIGH

### 4. Policy Snapshot
**Query**: `getDefaultPolicy()` + `evaluatePolicies()`
**Frequency**: Every task execution
**Change Frequency**: Rare
**Cache Suitability**: ✅ MEDIUM-HIGH

### 5. Plan + Phases
**Query**: `getLatestPlan()` + `listPhases()`
**Frequency**: Every dispatch cycle
**Change Frequency**: Only during replanning
**Cache Suitability**: ✅ HIGH

---

## Cache Suitability Matrix

| Data | Read Freq | Change Freq | Invalidation Complexity | Cache Score |
|------|-----------|-------------|------------------------|-------------|
| Project settings | HIGH | LOW | Project update event | ✅ HIGH |
| Agent config | HIGH | LOW | Agent update event | ✅ HIGH |
| Plan + phases | HIGH | LOW | Plan change event | ✅ HIGH |
| Policy snapshot | HIGH | LOW | Policy update event | ✅ HIGH |
| Task state | HIGH | HIGH | Every state transition | ⚠️ LOW |
| Provider state | MEDIUM | MEDIUM | Cooldown expiry | ⚠️ MEDIUM |
| Token usage | LOW | N/A (write-only) | N/A | ❌ N/A |

---

## Invalidation Strategy

| Data | Trigger | Action |
|------|---------|--------|
| Project settings | `updateProject()` | Invalidate project settings cache |
| Agent config | `updateAgentConfig()` | Invalidate agent config cache |
| Plan + phases | `createPlan()`, `replan()` | Invalidate plan cache for project |
| Policy snapshot | Policy engine update | Invalidate policy cache |

---

## Backlog Document

**Status**: This analysis is the backlog. No immediate action required.

**Priority**: P3 (after query batching and pool tuning)

**Effort**: Medium — requires event-based invalidation infrastructure.
