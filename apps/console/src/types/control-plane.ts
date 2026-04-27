export interface ApprovalRequest {
  id: string;
  project_id: string | null;
  kind: string;
  status: string;
  title: string;
  description: string;
  requested_by: string;
  approved_by: string | null;
  rejected_by: string | null;
  created_at: string;
  resolved_at: string | null;
  expires_at: string;
}

export interface AuditEvent {
  id: string;
  project_id: string | null;
  category: string;
  severity: string;
  actor: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface SecurityEvent {
  id: string;
  project_id: string | null;
  event_type: string;
  severity: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface Incident {
  id: string;
  project_id: string | null;
  type: string;
  status: string;
  title: string;
  description: string;
  severity: string;
  acknowledged_by: string | null;
  resolved_by: string | null;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

export interface AgentInstance {
  id: string;
  name: string;
  role: string;
  status: string;
  project_id: string | null;
  registered_at: string;
  last_seen_at: string | null;
}

export interface ProviderRuntime {
  id: string;
  name: string;
  type: string;
  status: string;
  last_health_check_at: string | null;
  cooldown_until: string | null;
  capabilities: string[];
}

export interface ControlPlaneSummary {
  pendingApprovals: number;
  activeAgents: number;
  cooldownProviders: number;
  openIncidents: number;
  projectsOverBudget: number;
  lastUpdatedAt: string;
}
