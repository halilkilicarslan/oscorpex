// ---------------------------------------------------------------------------
// Messaging Helpers
// ---------------------------------------------------------------------------

import type { ProjectAgent } from '../../lib/studio-api';

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function agentName(agents: ProjectAgent[], id: string): string {
  return agents.find((a) => a.id === id)?.name ?? id;
}
