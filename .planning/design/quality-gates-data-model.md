# Quality Gates — Data Model

## Entities

### `quality_gate_run`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | PK |
| project_id | UUID | FK → projects |
| triggered_by | string | `ci`, `scheduler`, `manual` |
| run_at | timestamptz | |
| overall_status | enum | `pass`, `warn`, `fail` |
| duration_ms | int | Total evaluation time |

### `quality_gate_check`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | PK |
| run_id | UUID | FK → quality_gate_run |
| category | enum | `tests`, `coverage`, `lint`, `security`, `review`, `goal`, `cost` |
| status | enum | `pass`, `warn`, `fail`, `skipped` |
| score | numeric(4,3) | 0.000 - 1.000 |
| threshold | numeric(4,3) | Required minimum |
| raw_payload | JSONB | Provider-specific detail |

### `quality_gate_artifact`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | PK |
| check_id | UUID | FK → quality_gate_check |
| artifact_type | enum | `report`, `log`, `screenshot`, `sarif` |
| storage_path | string | S3 / filesystem path |
| size_bytes | int | |
| created_at | timestamptz | |

### `release_decision`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | PK |
| project_id | UUID | FK → projects |
| run_id | UUID | FK → quality_gate_run |
| can_release | boolean | Computed + override |
| blockers | text[] | Human-readable list |
| warnings | text[] | |
| operator_override | boolean | |
| operator_note | text | Justification |
| signed_off_by | UUID | FK → users |
| signed_off_at | timestamptz | |

## API Contract

```
GET    /api/studio/projects/:id/quality-gates/latest
GET    /api/studio/projects/:id/quality-gates/history?limit=20
POST   /api/studio/projects/:id/quality-gates/evaluate      (manual trigger)
POST   /api/studio/projects/:id/quality-gates/signoff       (admin only)
```

## Index Strategy

- `quality_gate_run(project_id, run_at DESC)` — latest lookup
- `quality_gate_check(run_id, category)` — per-run filtering
- `release_decision(project_id, signed_off_at DESC)` — audit trail
