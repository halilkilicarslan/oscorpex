// ---------------------------------------------------------------------------
// Pipeline Helpers
// ---------------------------------------------------------------------------

import type { ProjectAgent } from '../../../lib/studio-api';
import { ROLE_COLORS } from './constants.js';

export function getAgentColor(agent: ProjectAgent): string {
  if (agent.color) return agent.color;
  const roleKey = agent.role.toLowerCase();
  for (const [key, color] of Object.entries(ROLE_COLORS)) {
    if (roleKey.includes(key)) return color;
  }
  return '#525252';
}

export function formatElapsed(startedAt?: string): string {
  if (!startedAt) return '';
  const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (elapsed < 60) return `${elapsed}s önce`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}d önce`;
  return `${Math.floor(elapsed / 3600)}s önce`;
}

export function countDoneTasks(tasks: import('../../../lib/studio-api').Task[]): number {
  return tasks.filter((t) => t.status === 'done').length;
}
