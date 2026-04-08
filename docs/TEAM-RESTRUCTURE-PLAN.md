# Team Restructure Plan — v2.0 Org & Pipeline Overhaul

## 1. Overview

Replace the current flat 9-agent structure with a Scrum-based 12-agent hierarchy
featuring dedicated teams, review loops, and parallel execution pipelines.

---

## 2. New Agent Roster (12 Agents)

| # | Role Key | Title | Team | Responsibility |
|---|----------|-------|------|----------------|
| 1 | `product-owner` | Product Owner | Leadership | PRD, vision, user communication, backlog prioritization |
| 2 | `scrum-master` | Scrum Master | Leadership | Sprint planning, task distribution, blocker resolution, pipeline orchestration |
| 3 | `tech-lead` | Tech Lead | Leadership | Architecture decisions, tech stack, cross-team code standards |
| 4 | `business-analyst` | Business Analyst | Leadership | Requirements → user stories, acceptance criteria, domain modeling |
| 5 | `design-lead` | Design Lead | Design | UI/UX, wireframes, design system, CSS/Tailwind specs |
| 6 | `frontend-dev` | Frontend Developer | Frontend | React/Vue/Next components, state management, responsive UI |
| 7 | `backend-dev` | Backend Developer | Backend | API endpoints, DB queries, auth, business logic |
| 8 | `frontend-qa` | Frontend QA Engineer | Frontend | E2E tests, accessibility, visual regression, component tests |
| 9 | `backend-qa` | Backend QA Engineer | Backend | API tests, integration tests, load tests, data validation |
| 10 | `frontend-reviewer` | Frontend Code Reviewer | Frontend | Frontend PR review, component patterns, performance audit |
| 11 | `backend-reviewer` | Backend Code Reviewer | Backend | Backend PR review, security audit, API contract validation |
| 12 | `devops` | DevOps Engineer | Operations | CI/CD, Docker, deployment, monitoring, infra |

---

## 3. Org Hierarchy (reports_to)

```
                      Product Owner
                            |
                      Scrum Master
                            |
            +-------+-------+-------+-----------+
            |       |       |       |           |
       Tech Lead  Design  BA    DevOps    (coordination hub)
            |     Lead
       +----+----+
       |         |
   Frontend   Backend
   Team       Team
   +------+  +------+
   | Dev  |  | Dev  |
   | QA   |  | QA   |
   | Rev  |  | Rev  |
   +------+  +------+
```

### reports_to Mapping

```
product-owner     → null (root)
scrum-master      → product-owner
tech-lead         → scrum-master
business-analyst  → scrum-master
design-lead       → scrum-master
devops            → scrum-master
frontend-dev      → tech-lead
backend-dev       → tech-lead
frontend-qa       → tech-lead
backend-qa        → tech-lead
frontend-reviewer → tech-lead
backend-reviewer  → tech-lead
```

---

## 4. Dependency Chain (Pipeline Flow)

### 4.1 Sequential Dependencies

```
PO → BA → Design Lead ─┬─→ Frontend Dev → Frontend QA → Frontend Reviewer ──┐
                        │                                                     │
                        └─→ Backend Dev  → Backend QA  → Backend Reviewer  ──┤
                                                                             │
                                                                        DevOps (deploy)
```

### 4.2 New Dependency Types

Current system only has `reports_to` (hierarchy) and `pipeline_order` (linear sequence).
We need richer dependency modeling:

| Type | Meaning | Example |
|------|---------|---------|
| `hierarchy` | Organizational reporting line | frontend-dev → tech-lead |
| `workflow` | Task must complete before next starts | frontend-dev → frontend-qa |
| `review` | Output must be reviewed/approved | frontend-dev → frontend-reviewer |
| `parallel` | Can execute simultaneously | frontend-dev ‖ backend-dev |
| `gate` | All inputs must complete before proceeding | frontend-reviewer + backend-reviewer → devops |

### 4.3 Review → Fix Loop

When a reviewer rejects code:
1. Task status changes to `revision` (new status)
2. Task routes back to the original dev agent
3. Dev fixes → QA retests → Reviewer re-reviews
4. Max 3 revision cycles before escalation to Tech Lead

---

## 5. Database Changes

### 5.1 Update `AgentRole` Type

```typescript
// Old (9 roles)
export type AgentRole =
  | 'pm' | 'designer' | 'architect' | 'frontend' | 'backend'
  | 'coder' | 'qa' | 'reviewer' | 'devops';

// New (12 roles)
export type AgentRole =
  | 'product-owner' | 'scrum-master' | 'tech-lead' | 'business-analyst'
  | 'design-lead' | 'frontend-dev' | 'backend-dev'
  | 'frontend-qa' | 'backend-qa'
  | 'frontend-reviewer' | 'backend-reviewer'
  | 'devops';
```

### 5.2 New Table: `agent_dependencies`

```sql
CREATE TABLE IF NOT EXISTS agent_dependencies (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_agent_id   TEXT NOT NULL REFERENCES project_agents(id) ON DELETE CASCADE,
  to_agent_id     TEXT NOT NULL REFERENCES project_agents(id) ON DELETE CASCADE,
  type            TEXT NOT NULL DEFAULT 'workflow',  -- hierarchy|workflow|review|gate
  created_at      TEXT NOT NULL
);

CREATE INDEX idx_agent_deps_project ON agent_dependencies(project_id);
CREATE INDEX idx_agent_deps_from    ON agent_dependencies(from_agent_id);
CREATE INDEX idx_agent_deps_to      ON agent_dependencies(to_agent_id);
```

### 5.3 New Table: `agent_capabilities`

Restrict which file paths/patterns each agent can read/write:

```sql
CREATE TABLE IF NOT EXISTS agent_capabilities (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES project_agents(id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope_type  TEXT NOT NULL DEFAULT 'path',  -- path|filetype|module
  pattern     TEXT NOT NULL,                  -- e.g. "src/frontend/**", "*.tsx", "api/"
  permission  TEXT NOT NULL DEFAULT 'readwrite'  -- read|write|readwrite
);
```

### 5.4 Update `tasks` Table

```sql
ALTER TABLE tasks ADD COLUMN review_status TEXT;          -- null|approved|rejected
ALTER TABLE tasks ADD COLUMN reviewer_agent_id TEXT;      -- who reviews this task
ALTER TABLE tasks ADD COLUMN revision_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN assigned_agent_id TEXT;      -- FK to project_agents.id (replaces role-based string)
```

### 5.5 New TaskStatus: `revision`

```typescript
export type TaskStatus =
  | 'queued' | 'assigned' | 'running' | 'review'
  | 'revision'  // NEW: sent back by reviewer
  | 'done' | 'failed';
```

### 5.6 Role Label Map Update

```typescript
const ROLE_LABELS: Record<string, string> = {
  'product-owner':      'Product Owner',
  'scrum-master':       'Scrum Master',
  'tech-lead':          'Tech Lead',
  'business-analyst':   'Business Analyst',
  'design-lead':        'Design Lead',
  'frontend-dev':       'Frontend Developer',
  'backend-dev':        'Backend Developer',
  'frontend-qa':        'Frontend QA Engineer',
  'backend-qa':         'Backend QA Engineer',
  'frontend-reviewer':  'Frontend Code Reviewer',
  'backend-reviewer':   'Backend Code Reviewer',
  'devops':             'DevOps Engineer',
  // Legacy compatibility
  pm: 'Project Manager',
  architect: 'Software Architect',
  frontend: 'Frontend Developer',
  backend: 'Backend Developer',
  coder: 'Full-Stack Developer',
  qa: 'QA Engineer',
  reviewer: 'Code Reviewer',
  designer: 'UI/UX Designer',
};
```

---

## 6. Pipeline Engine Changes

### 6.1 Parallel Execution

Replace linear `pipeline_order` with dependency graph execution:

```
Current:  Stage 0 → Stage 1 → Stage 2 → Stage 3 (linear)
New:      Dependency DAG with parallel branches
```

The engine should:
1. Build a DAG from `agent_dependencies` (type = workflow|review|gate)
2. Find all agents with satisfied dependencies (all predecessors done)
3. Execute them in parallel
4. When an agent completes, re-evaluate the DAG for newly unblocked agents

### 6.2 Review Loop

```
Task assigned to Dev
  → Dev completes → status = 'review'
  → Reviewer picks up → approved?
    → YES: status = 'done', unblock next stage
    → NO:  status = 'revision', task routes back to Dev
      → Dev fixes → status = 'review' again
      → Max 3 cycles, then escalate to Tech Lead
```

### 6.3 Gate Mechanism

DevOps deployment gate:
- Wait for ALL of: frontend-reviewer approved + backend-reviewer approved
- Then trigger DevOps deploy task
- This is a "gate" dependency — all inputs must be satisfied

---

## 7. Frontend: Drag & Drop Team Builder

### 7.1 Library Choice

**React Flow** (reactflow.dev) — MIT license, built for node-edge graphs:
- Drag & drop nodes
- Edge connections with labels
- Minimap, controls, background grid
- Custom node rendering (agent card with avatar)

### 7.2 UI Layout

```
+------------------------------------------------------------------+
|  Team Builder                                    [Save] [Reset]  |
+------------------------------------------------------------------+
| [Agent Palette]  |  [Canvas - React Flow]  |  [Properties Panel] |
| +-------------+  |                         |  +----------------+  |
| | PO          |  |   (PO) ──→ (SM)        |  | Name: ...      |  |
| | SM          |  |     │                   |  | Role: ...      |  |
| | Tech Lead   |  |   (TL) (DL) (BA) (DO)  |  | Model: ...     |  |
| | BA          |  |    │    │               |  | Skills: ...    |  |
| | Design Lead |  |  (FD) (BD)             |  | Avatar: [pick] |  |
| | Frontend Dev|  |    │    │               |  +----------------+  |
| | Backend Dev |  |  (FQ) (BQ)             |                      |
| | Frontend QA |  |    │    │               |                      |
| | Backend QA  |  |  (FR) (BR)             |                      |
| | FE Reviewer |  |     └──┬──┘            |                      |
| | BE Reviewer |  |      (DevOps)          |                      |
| | DevOps      |  |                         |                      |
| +-------------+  +-------------------------+                      |
+------------------------------------------------------------------+
```

### 7.3 Node Types

- **Agent Node**: Avatar + name + role badge + status indicator
- **Team Group**: Visual container grouping (Frontend Team, Backend Team)
- **Gate Node**: Diamond shape showing "all inputs required"

### 7.4 Edge Types

- **Hierarchy** (dotted gray): reports_to relationship
- **Workflow** (solid blue arrow): task flow dependency
- **Review** (dashed purple arrow): review relationship
- **Gate** (solid orange): convergence point

### 7.5 Interactions

- Drag agent from palette → canvas to add
- Draw edge between agents → select dependency type
- Click agent → show properties panel
- Right-click agent → remove, edit, duplicate
- Double-click empty area → add custom agent
- Save → persist to DB (project_agents + agent_dependencies)

---

## 8. Migration Strategy

### 8.1 Backward Compatibility

- Old role keys (pm, architect, frontend, etc.) remain in ROLE_LABELS for display
- `pipeline_order` column stays but becomes secondary to `agent_dependencies`
- Existing projects keep working with old structure
- New projects get the 12-agent template by default

### 8.2 Migration for Existing Projects

On project open, offer "Upgrade to v2 team structure":
- Map old roles to new roles:
  - `pm` → `product-owner` + `scrum-master` (split)
  - `architect` → `tech-lead`
  - `frontend` → `frontend-dev`
  - `backend` → `backend-dev`
  - `qa` → `frontend-qa` + `backend-qa` (split)
  - `reviewer` → `frontend-reviewer` + `backend-reviewer` (split)
  - `designer` → `design-lead`
  - `devops` → `devops`
  - `coder` → (assign to frontend-dev or backend-dev based on skills)
- Auto-generate `agent_dependencies` based on the standard template
- Add new agents: `business-analyst`, `scrum-master` (where missing)

---

## 9. Implementation Phases

### Phase 1: DB & Backend (Current)
1. Add new tables: `agent_dependencies`, `agent_capabilities`
2. Update `AgentRole` type with new roles
3. Add `revision` task status
4. Add task fields: `review_status`, `reviewer_agent_id`, `revision_count`, `assigned_agent_id`
5. Create 12 preset agents with avatars, names, system prompts
6. Add CRUD API routes for dependencies and capabilities
7. Update `roleLabel()` with new roles
8. Seed default dependency template

### Phase 2: Pipeline Engine v2
1. Build DAG from `agent_dependencies` instead of linear `pipeline_order`
2. Implement parallel branch execution
3. Implement review loop (revision status + max 3 cycles)
4. Implement gate dependencies (wait for all inputs)
5. Update `PipelineStage` to support branching
6. Add escalation logic (revision overflow → tech-lead)

### Phase 3: Drag & Drop Team Builder UI
1. Install React Flow (`pnpm add @xyflow/react`)
2. Create `TeamBuilder.tsx` component with canvas
3. Agent palette (left panel) — drag to add
4. Custom agent node component with avatar
5. Edge drawing with dependency type selection
6. Properties panel (right panel) — edit agent details
7. Save/load from DB
8. Team group containers (visual only)

### Phase 4: Integration & Polish
1. Update KanbanBoard to show reviewer assignments
2. Add `revision` column to Kanban
3. Update PipelineDashboard for parallel branches
4. Update OrgChart to render from `agent_dependencies`
5. Migration wizard for existing projects
6. Tests for new pipeline logic

---

## 10. New Preset Agent Details

### Product Owner — Olivia Rhye
- **Avatar**: olivia-rhye (female)
- **Skills**: product-management, requirements, prioritization, stakeholder-communication
- **Prompt**: You are Olivia Rhye, a senior Product Owner...

### Scrum Master — Loki Bright
- **Avatar**: loki-bright (male)
- **Skills**: sprint-planning, task-distribution, blocker-resolution, agile, kanban
- **Prompt**: You are Loki Bright, a senior Scrum Master...

### Tech Lead — Zahir Mays
- **Avatar**: zahir-mays (male)
- **Skills**: system-design, code-review, architecture, tech-decisions
- **Prompt**: You are Zahir Mays, a senior Tech Lead...

### Business Analyst — Natali Craig
- **Avatar**: natali-craig (female)
- **Skills**: requirements-analysis, user-stories, acceptance-criteria, domain-modeling
- **Prompt**: You are Natali Craig, a senior Business Analyst...

### Design Lead — Amelie Laurent
- **Avatar**: amelie-laurent (female)
- **Skills**: ui-design, ux-research, wireframing, design-systems, figma, accessibility
- **Prompt**: You are Amelie Laurent, a senior Design Lead...

### Frontend Developer — Sophia Perez
- **Avatar**: sophia-perez (female)
- **Skills**: react, typescript, tailwindcss, next.js, state-management
- **Prompt**: You are Sophia Perez, a senior Frontend Developer...

### Backend Developer — Drew Cano
- **Avatar**: drew-cano (male)
- **Skills**: node.js, typescript, postgresql, rest-api, authentication, microservices
- **Prompt**: You are Drew Cano, a senior Backend Developer...

### Frontend QA — Sienna Hewitt
- **Avatar**: sienna-hewitt (female)
- **Skills**: e2e-testing, accessibility, visual-regression, playwright, component-testing
- **Prompt**: You are Sienna Hewitt, a senior Frontend QA Engineer...

### Backend QA — Levi Rocha
- **Avatar**: levi-rocha (male)
- **Skills**: api-testing, integration-testing, load-testing, data-validation, jest
- **Prompt**: You are Levi Rocha, a senior Backend QA Engineer...

### Frontend Code Reviewer — Ethan Campbell
- **Avatar**: ethan-campbell (male)
- **Skills**: code-review, react-patterns, performance, accessibility-audit, best-practices
- **Prompt**: You are Ethan Campbell, a senior Frontend Code Reviewer...

### Backend Code Reviewer — Noah Pierre
- **Avatar**: noah-pierre (male)
- **Skills**: code-review, security-audit, api-design, database-optimization, best-practices
- **Prompt**: You are Noah Pierre, a senior Backend Code Reviewer...

### DevOps Engineer — Joshua Wilson
- **Avatar**: joshua-wilson (male)
- **Skills**: docker, ci-cd, kubernetes, aws, monitoring, infrastructure-as-code
- **Prompt**: You are Joshua Wilson, a senior DevOps Engineer...

---

## 11. File Capability Matrix (Default)

| Agent | Read Scope | Write Scope |
|-------|-----------|-------------|
| Product Owner | `docs/**`, `*.md` | `docs/**`, `*.md` |
| Scrum Master | `**/*` (read all) | `docs/**`, `*.md` |
| Tech Lead | `**/*` | `docs/**`, `src/shared/**` |
| Business Analyst | `docs/**`, `*.md` | `docs/**`, `*.md` |
| Design Lead | `**/*.css`, `**/*.tsx`, `docs/**` | `docs/**`, `**/*.css` |
| Frontend Dev | `src/frontend/**`, `src/shared/**`, `**/*.tsx` | `src/frontend/**`, `**/*.tsx`, `**/*.css` |
| Backend Dev | `src/backend/**`, `src/shared/**`, `**/*.ts` | `src/backend/**`, `src/api/**` |
| Frontend QA | `src/frontend/**`, `tests/frontend/**` | `tests/frontend/**` |
| Backend QA | `src/backend/**`, `tests/backend/**` | `tests/backend/**` |
| Frontend Reviewer | `src/frontend/**` (read only) | — (review comments only) |
| Backend Reviewer | `src/backend/**` (read only) | — (review comments only) |
| DevOps | `**/*` | `Dockerfile`, `docker-compose.*`, `.github/**`, `infra/**` |
