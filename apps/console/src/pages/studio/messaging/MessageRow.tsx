// ---------------------------------------------------------------------------
// Message Row
// ---------------------------------------------------------------------------

import { Archive } from 'lucide-react';
import type { AgentMessage, ProjectAgent } from '../../../lib/studio-api';
import TypeBadge from './TypeBadge.js';
import MessagingAgentAvatar from './MessagingAgentAvatar.js';
import { timeAgo, agentName } from './helpers.js';

interface MessageRowProps {
  msg: AgentMessage;
  agents: ProjectAgent[];
  isSelected: boolean;
  onClick: () => void;
  onArchive: (e: React.MouseEvent) => void;
}

export default function MessageRow({ msg, agents, isSelected, onClick, onArchive }: MessageRowProps) {
  const isUnread = msg.status === 'unread';

  return (
    <div
      onClick={onClick}
      className={`group flex items-start gap-3 px-4 py-3 border-b border-[#1a1a1a] cursor-pointer transition-colors ${
        isSelected
          ? 'bg-[#1a1a1a] border-l-2 border-l-[#22c55e]'
          : 'hover:bg-[#141414]'
      } ${isUnread ? 'border-l-2 border-l-[#22c55e]' : ''}`}
    >
      <MessagingAgentAvatar agents={agents} agentId={msg.fromAgentId} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className={`text-[12px] font-medium truncate flex-1 ${
              isUnread ? 'text-[#fafafa]' : 'text-[#a3a3a3]'
            }`}
          >
            {msg.subject}
          </span>
          <span className="text-[10px] text-[#525252] shrink-0">{timeAgo(msg.createdAt)}</span>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-[#737373]">
            {agentName(agents, msg.fromAgentId)}
          </span>
          <span className="text-[10px] text-[#525252]">-&gt;</span>
          <span className="text-[10px] text-[#737373]">
            {agentName(agents, msg.toAgentId)}
          </span>
          <TypeBadge type={msg.type} />
          {isUnread && (
            <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] shrink-0" />
          )}
        </div>

        <p className="text-[10px] text-[#525252] mt-0.5 line-clamp-1">{msg.content}</p>
      </div>

      <button
        onClick={onArchive}
        className="opacity-0 group-hover:opacity-100 p-1 rounded text-[#525252] hover:text-[#a3a3a3] hover:bg-[#262626] transition-all shrink-0"
        title="Archive"
      >
        <Archive size={12} />
      </button>
    </div>
  );
}
