# Artifact Registry — Technical Design

## Overview

Versioned storage for all agent-generated outputs: reports, diffs, screenshots, test results, and review artifacts. Every artifact is immutable, hash-addressed, and linked to the run/task that produced it.

## Artifact Types

| Type | Extension | Storage | Retention |
|------|-----------|---------|-----------|
| Report | `.md`, `.pdf` | Object store | 90 days |
| Diff | `.diff`, `.patch` | Object store | 30 days |
| Screenshot | `.png`, `.jpg` | Object store | 30 days |
| Test Output | `.json`, `.xml` | Object store | 30 days |
| Generated File | `.ts`, `.tsx`, etc. | Git commit | Infinite |
| Review Artifact | `.md` | Object store | 90 days |

## Data Model

### `artifact`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | FK → tenants |
| project_id | UUID | FK → projects |
| run_id | UUID | FK → agent_sessions (nullable) |
| task_id | UUID | FK → tasks (nullable) |
| artifact_type | enum | `report`, `diff`, `screenshot`, `test_output`, `generated_file`, `review` |
| name | string | Human-readable label |
| storage_key | string | S3 key or git SHA |
| content_hash | string | SHA-256 of content |
| size_bytes | int | |
| mime_type | string | |
| created_at | timestamptz | |
| expires_at | timestamptz | Nullable — for temp artifacts |

### `artifact_lineage`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | PK |
| artifact_id | UUID | FK → artifact |
| parent_artifact_id | UUID | FK → artifact (nullable) |
| lineage_type | enum | `derived`, `superseded`, `referenced` |

## Storage Backend

- **Object store** (S3-compatible): Large binary artifacts
- **Git repository**: Generated source code (already in project repo)
- **PostgreSQL JSONB**: Small structured artifacts (< 64 KB)

## API Contract

```
GET    /api/studio/projects/:id/artifacts?type=&limit=
GET    /api/studio/artifacts/:id
GET    /api/studio/artifacts/:id/download
POST   /api/studio/projects/:id/artifacts          (internal — agents upload)
DELETE /api/studio/artifacts/:id                   (soft delete)
```

## Deduplication

Artifacts are deduplicated by `content_hash`. Uploading the same content twice returns the existing artifact ID.

## Garbage Collection

Daily cron removes artifacts where `expires_at < now()` and no lineage references exist.

## Future Work

- Full-text search across markdown artifacts
- Artifact comparison UI (diff two versions)
- Automatic artifact summary generation
