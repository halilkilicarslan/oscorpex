# Oscorpex Control Plane Boundary

This document defines the boundaries between the **Control Plane** (`@oscorpex/control-plane`) and the **Execution Kernel** (`@oscorpex/kernel`).

## What the Control Plane Does

- **Agent Registry**: Tracks which agent/provider runtimes are registered, their capabilities, and runtime status.
- **Heartbeat / Presence**: Monitors liveness of agents and providers via heartbeat records. Computes `online | degraded | cooldown | offline` states.
- **Approval Center**: Queues high-risk task approvals, policy overrides, provider overrides. Blocks execution until approved.
- **Security Audit Layer**: Records operator actions, provider enable/disable, cooldown/degraded events, replay/restore actions.
- **Usage / Cost Visibility**: Aggregates project/provider-level usage and cost rollups. Tracks budget consumption.
- **Incident Feed**: Surfaces runtime problems (degraded providers, stuck tasks, approval blocks) for operator attention.
- **Dashboard Projections**: Provides lightweight summary views for console/admin dashboards.

## What the Control Plane Does NOT Do

- Does NOT execute tasks.
- Does NOT run pipelines.
- Does NOT manage the DAG or task graph.
- Does NOT spawn provider CLI processes.
- Does NOT handle RAG search or context building.
- Does NOT manage sandbox lifecycles.

## Data Exchange Boundary

### Kernel → Control Plane (writes)
- Provider startup/shutdown → Registry update
- Provider health check result → Heartbeat record
- Provider degraded/cooldown → Incident feed + Audit event
- High-risk task created → Approval request
- Task completed/failed → Usage rollup input

### Control Plane → Kernel (reads only)
- Registry state → used by kernel for provider selection
- Approval decision → used by kernel to block/unblock execution
- Presence state → used by kernel for routing decisions

### DB Boundary
- Control Plane uses its own tables: `agent_instances`, `provider_runtime_registry`, `agent_presence`, `runtime_heartbeats`, `approvals`, `approval_events`, `audit_events`, `security_events`, `incidents`, `incident_events`, `usage_rollups`, `cost_rollups`.
- Control Plane reads kernel tables in read-only mode: `projects`, `tasks`, `phases`, `agent_runs`, `events`, `token_usage`.
- Control Plane NEVER writes to kernel execution tables directly.

## Ownership Rules

| Concern | Owner |
|---------|-------|
| Task execution | Kernel |
| Pipeline orchestration | Kernel |
| Provider lifecycle | Kernel |
| Sandbox management | Kernel |
| Agent registration visibility | Control Plane |
| Approval queue | Control Plane |
| Audit trail | Control Plane |
| Cost aggregation | Control Plane |
| Incident surfacing | Control Plane |
| Operator dashboard | Control Plane |
