# Human Review Inbox — Technical Design

## Overview

A unified inbox for operators to review, approve, or reject items that require human judgment before the pipeline proceeds.

## Inbox Item Types

| Type | Source | Action |
|------|--------|--------|
| Approval | `approvals` table | Approve / Reject / Escalate |
| Incident | `incidents` table | Ack / Resolve / Escalate |
| Graph Mutation | `graph_mutations` table | Accept / Reject / Defer |
| High-Risk Task | Task risk score > threshold | Confirm / Cancel |
| Review Rejection | Review loop failed | Override / Re-assign |

## Data Model

### `review_inbox_item`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | FK → tenants |
| project_id | UUID | FK → projects |
| item_type | enum | `approval`, `incident`, `graph_mutation`, `high_risk_task`, `review_rejection` |
| source_id | UUID | FK to source table |
| status | enum | `pending`, `acknowledged`, `resolved`, `escalated` |
| priority | enum | `low`, `medium`, `high`, `critical` |
| assigned_to | UUID | FK → users (nullable) |
| created_at | timestamptz | |
| resolved_at | timestamptz | |
| resolution | enum | `approved`, `rejected`, `escalated`, `overridden` |
| operator_note | text | |

## UI Design

- **Inbox view**: Filterable table with columns Type, Project, Priority, Age, Assignee
- **Detail drawer**: Contextual information + action buttons
- **Bulk actions**: Select multiple items → Approve / Reject / Assign
- **SLA indicator**: Color-coded age (green < 1h, yellow < 4h, red > 4h)
- **Escalation path**: Auto-assign to on-call if unacknowledged > SLA

## Routing Rules

```typescript
interface RoutingRule {
  id: string;
  tenantId: string;
  itemType: InboxItemType;
  condition: string;      // e.g. "priority == 'critical'"
  assigneePool: string[]; // userIds or role names
  fallbackRole: string;   // e.g. "owner"
}
```

## Notifications

- WebSocket push on new inbox item
- Email digest every 15 min for unacknowledged items
- PagerDuty/Opsgenie integration for critical items

## Future Work

- ML-based priority prediction from task content
- Auto-suggestion based on historical operator decisions
