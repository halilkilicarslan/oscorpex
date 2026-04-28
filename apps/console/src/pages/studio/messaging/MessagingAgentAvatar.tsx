// ---------------------------------------------------------------------------
// Messaging Agent Avatar
// Shows profile photo with colored left border for message center context.
// ---------------------------------------------------------------------------

import AgentAvatarImg from '../../../components/AgentAvatar.js';
import type { ProjectAgent } from '../../../lib/studio-api';

interface MessagingAgentAvatarProps {
  agents: ProjectAgent[];
  agentId: string;
  size?: 'sm' | 'md';
}

export default function MessagingAgentAvatar({ agents, agentId, size = 'sm' }: MessagingAgentAvatarProps) {
  const agent = agents.find((a) => a.id === agentId);
  const avatar = agent?.avatar ?? '?';
  const name = agent?.name ?? agentId;
  const color = agent?.color ?? '#525252';
  return (
    <div
      className="rounded-lg shrink-0 border border-[#262626]"
      style={{ borderLeftColor: color, borderLeftWidth: 2 }}
    >
      <AgentAvatarImg avatar={avatar} name={name} size={size === 'sm' ? 'sm' : 'md'} />
    </div>
  );
}
