// ---------------------------------------------------------------------------
// Team Graph Shared Constants — 12 edge tipi, renk haritası, açıklamalar
// TeamBuilderPage, TeamGraphView, TeamTemplatePreview, TeamBuilder tarafından kullanılır
// ---------------------------------------------------------------------------

export const TEAM_COLOR_MAP: Record<string, string> = {
  'product-owner': '#f59e0b',
  'scrum-master': '#06b6d4',
  'tech-lead': '#3b82f6',
  'business-analyst': '#8b5cf6',
  'design-lead': '#f472b6',
  'frontend-dev': '#ec4899',
  'backend-dev': '#22c55e',
  'frontend-qa': '#a855f7',
  'backend-qa': '#a855f7',
  'frontend-reviewer': '#ef4444',
  'backend-reviewer': '#ef4444',
  'security-reviewer': '#dc2626',
  'docs-writer': '#14b8a6',
  devops: '#0ea5e9',
};

export interface EdgeStyle {
  stroke: string;
  strokeDasharray?: string;
  animated?: boolean;
}

export const EDGE_STYLES: Record<string, EdgeStyle> = {
  hierarchy: { stroke: '#525252', strokeDasharray: '5 5' },
  workflow: { stroke: '#3b82f6' },
  review: { stroke: '#a855f7', strokeDasharray: '8 4', animated: true },
  gate: { stroke: '#f59e0b' },
  escalation: { stroke: '#ef4444', strokeDasharray: '4 2' },
  pair: { stroke: '#22c55e', strokeDasharray: '2 2' },
  conditional: { stroke: '#f97316', strokeDasharray: '6 3' },
  fallback: { stroke: '#6b7280', strokeDasharray: '8 4' },
  notification: { stroke: '#06b6d4', strokeDasharray: '3 3' },
  handoff: { stroke: '#8b5cf6' },
  approval: { stroke: '#f59e0b', strokeDasharray: '4 4', animated: true },
  mentoring: { stroke: '#14b8a6', strokeDasharray: '6 2' },
};

export const EDGE_LABELS: Record<string, string> = {
  hierarchy: 'Reports To',
  workflow: 'Workflow',
  review: 'Review',
  gate: 'Gate',
  escalation: 'Escalation',
  pair: 'Pair',
  conditional: 'Conditional',
  fallback: 'Fallback',
  notification: 'Notification',
  handoff: 'Handoff',
  approval: 'Approval',
  mentoring: 'Mentoring',
};

export const EDGE_DESCRIPTIONS: Record<string, string> = {
  hierarchy: 'Reporting hierarchy. Non-blocking, organizational structure only.',
  workflow: 'Source agent feeds target agent; target cannot run until source completes.',
  review: 'Target agent reviews source agent output. If rejected, source re-runs.',
  gate: 'Approval gate — target cannot proceed without approval from source.',
  escalation: 'If source fails a certain number of times, escalation to target agent.',
  pair: 'Two agents work in parallel on the same task in the same wave.',
  conditional: 'Activates when a runtime condition is met (e.g. security-sensitive file).',
  fallback: 'If source fails, target agent takes over as an alternative.',
  notification: 'Informational, non-blocking message.',
  handoff: 'Formal work handoff — requires documentation.',
  approval: 'Single-task approval gate; can block the entire phase.',
  mentoring: 'Advisory / feedback relationship, non-blocking.',
};
