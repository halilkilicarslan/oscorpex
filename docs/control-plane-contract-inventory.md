# Control Plane Contract Inventory

> Generated during Contract Cleanup mini-epic.

## Canonical Source of Truth

All control-plane contract types live in **`@oscorpex/control-plane`**.
Console re-exports them from `apps/console/src/types/control-plane.ts`.

## Type Mapping

| Semantic Name | Canonical Row Type | Location | Casing |
|---|---|---|---|
| `ApprovalRequest` | `ApprovalRow` | `packages/control-plane/src/approvals/repo.ts` | snake_case |
| `ApprovalEvent` | `ApprovalEventRow` | `packages/control-plane/src/approvals/repo.ts` | snake_case |
| `AuditEvent` | `AuditEventRow` | `packages/control-plane/src/audit/repo.ts` | snake_case |
| `SecurityEvent` | `SecurityEventRow` | `packages/control-plane/src/audit/repo.ts` | snake_case |
| `Incident` | `IncidentRow` | `packages/control-plane/src/incidents/repo.ts` | snake_case |
| `IncidentEvent` | `IncidentEventRow` | `packages/control-plane/src/incidents/repo.ts` | snake_case |
| `AgentInstance` | `AgentInstanceRow` | `packages/control-plane/src/registry/repo.ts` | snake_case |
| `ProviderRuntime` | `ProviderRuntimeRow` | `packages/control-plane/src/registry/repo.ts` | snake_case |
| `CapabilitySnapshot` | `CapabilitySnapshotRow` | `packages/control-plane/src/registry/repo.ts` | snake_case |
| `ControlPlaneSummary` | *(inline)* | `packages/control-plane/src/projections/index.ts` | camel_case |
| `ApprovalSummary` | *(inline)* | `packages/control-plane/src/projections/index.ts` | camel_case |
| `RuntimeHealthSummary` | *(inline)* | `packages/control-plane/src/projections/index.ts` | camel_case |
| `CostSummary` | *(inline)* | `packages/control-plane/src/projections/index.ts` | camel_case |

## Runtime Transformations

| Field | DB Type | API Response | UI Expected |
|---|---|---|---|
| `capabilities` | `TEXT` (JSON string) | `string[]` (parsed in endpoint) | `string[]` |
| `details` | `TEXT` (JSON string) | `string` | `string` |
| `payload` | `TEXT` (JSON string) | `string` | `string` |

## Drift Prevention

- Package barrel (`packages/control-plane/src/index.ts`) exports row types + semantic aliases.
- Console `types/control-plane.ts` is a **thin re-export barrel** — no duplicate definitions.
- `@oscorpex/control-plane` is a `workspace:*` dependency of console.
- Build both console and kernel after any control-plane type change.
