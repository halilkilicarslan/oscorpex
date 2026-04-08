# Team Restructure Plan v2.0

## 12 Agent Roster
| Role Key | Title | Team |
|----------|-------|------|
| product-owner | Product Owner | Leadership |
| scrum-master | Scrum Master | Leadership |
| tech-lead | Tech Lead | Leadership |
| business-analyst | Business Analyst | Leadership |
| design-lead | Design Lead | Design |
| frontend-dev | Frontend Developer | Frontend |
| backend-dev | Backend Developer | Backend |
| frontend-qa | Frontend QA Engineer | Frontend |
| backend-qa | Backend QA Engineer | Backend |
| frontend-reviewer | Frontend Code Reviewer | Frontend |
| backend-reviewer | Backend Code Reviewer | Backend |
| devops | DevOps Engineer | Operations |

## Hierarchy (reports_to)
- product-owner → null (root)
- scrum-master → product-owner
- tech-lead, business-analyst, design-lead, devops → scrum-master
- frontend-dev, backend-dev, frontend-qa, backend-qa, frontend-reviewer, backend-reviewer → tech-lead

## Pipeline Flow (Parallel)
PO → BA → Design Lead ─┬→ FE Dev → FE QA → FE Reviewer ─┐
                        └→ BE Dev → BE QA → BE Reviewer ──┤→ DevOps

## New DB Tables
- `agent_dependencies` (from_agent_id, to_agent_id, type: hierarchy|workflow|review|gate)
- `agent_capabilities` (agent_id, scope_type, pattern, permission)

## New Task Fields
- review_status (null|approved|rejected)
- reviewer_agent_id
- revision_count (max 3 then escalate)
- assigned_agent_id (FK to project_agents.id)

## New TaskStatus: `revision`

## Review Loop
Dev completes → Reviewer picks up → approved? YES → done / NO → revision → back to Dev (max 3x)

## Implementation Phases
1. DB & Backend (new tables, roles, presets, API)
2. Pipeline Engine v2 (DAG, parallel, review loop, gates)
3. Drag & Drop Team Builder (React Flow)
4. Integration & Polish (Kanban, OrgChart, migration wizard)

## Avatar Assignments
See docs/TEAM-RESTRUCTURE-PLAN.md Section 10

## Full Plan
docs/TEAM-RESTRUCTURE-PLAN.md
