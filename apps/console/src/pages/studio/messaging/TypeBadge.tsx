// ---------------------------------------------------------------------------
// Type Badge
// ---------------------------------------------------------------------------

import type { AgentMessageType } from '../../lib/studio-api';
import { TYPE_CONFIG } from './constants.js';

export default function TypeBadge({ type }: { type: AgentMessageType }) {
  const cfg = TYPE_CONFIG[type];
  return (
    <span
      className={`inline-flex items-center text-[9px] font-semibold px-1.5 py-0.5 rounded border uppercase tracking-wide ${cfg.bg} ${cfg.text} ${cfg.border}`}
    >
      {cfg.label}
    </span>
  );
}
