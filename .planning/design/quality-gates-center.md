# Quality Gates Center — Technical Design

## Overview

Quality Gates Center is a single-screen dashboard that aggregates all release-readiness signals for a project or platform-wide view. It answers the question: "Can we ship this?"

## Scope

The center covers six gate categories:

1. **Test Gate** — Unit / integration / e2e pass rate, coverage threshold
2. **Lint Gate** — Biome / ESLint / Prettier compliance
3. **Security Gate** — Dependency audit, secret scan, SBOM check
4. **Review Gate** — Code review approval status, rejection rate
5. **Goal Gate** — Requirement validation against original goals
6. **Cost Gate** — Budget compliance, token burn rate

## Architecture

### Backend

```
GET /api/studio/quality-gates/:projectId
GET /api/studio/quality-gates/platform
```

Response shape:

```typescript
interface QualityGateRun {
  id: string;
  projectId: string;
  runAt: string;
  overallStatus: 'pass' | 'warn' | 'fail';
  gates: GateResult[];
}

interface GateResult {
  category: GateCategory;
  status: 'pass' | 'warn' | 'fail' | 'skipped';
  score: number;        // 0.0 - 1.0
  threshold: number;    // required minimum
  details: GateDetail[];
}

type GateCategory =
  | 'tests'
  | 'coverage'
  | 'lint'
  | 'security'
  | 'review'
  | 'goal'
  | 'cost';

interface GateDetail {
  label: string;
  value: string | number;
  status: 'pass' | 'warn' | 'fail';
}
```

### Data Sources

| Gate | Source Table / Module | Frequency |
|------|----------------------|-----------|
| tests | `test_runs` (future) | On CI webhook |
| coverage | `test_runs.coverage_pct` | On CI webhook |
| lint | `lint_runs` (future) | On push |
| security | `security_scans` (future) | Daily |
| review | `approvals` + `task_proposals` | Real-time |
| goal | `goal-engine` validation | On phase complete |
| cost | `token_usage` + `budget_guard` | Hourly |

### Release Decision

```typescript
interface ReleaseDecision {
  runId: string;
  canRelease: boolean;
  blockers: string[];
  warnings: string[];
  signedOffBy: string | null; // operator userId
  signedOffAt: string | null;
}
```

Operator override: an admin can manually sign off even when gates fail, with mandatory justification logged to audit.

## UI Design

- **Top bar**: Overall status badge (green / yellow / red), last run time, "Run Now" button
- **Gate cards**: One card per category, expandable for details
- **Trend sparklines**: 7-day history per gate
- **Blocker list**: Actionable items sorted by severity
- **Sign-off button**: Requires `releases:signoff` permission

## Future Work

- Automatic gate trigger via CI webhook
- Slack/Teams notification on gate failure
- Gate policy customization per project
