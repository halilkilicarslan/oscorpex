// ---------------------------------------------------------------------------
// Thread View
// ---------------------------------------------------------------------------

import { Loader2, Reply } from 'lucide-react';
import type { AgentMessage, ProjectAgent } from '../../../lib/studio-api';
import MessagingAgentAvatar from './MessagingAgentAvatar.js';
import TypeBadge from './TypeBadge.js';
import { TYPE_CONFIG } from './constants.js';
import { timeAgo, agentName } from './helpers.js';

interface ThreadViewProps {
  messages: AgentMessage[];
  agents: ProjectAgent[];
  loading: boolean;
  onReply: (msg: AgentMessage) => void;
}

export default function ThreadView({ messages, agents, loading, onReply }: ThreadViewProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 size={16} className="text-[#525252] animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {messages.map((msg) => {
        const cfg = TYPE_CONFIG[msg.type];
        return (
          <div
            key={msg.id}
            className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden"
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1a1a1a]">
              <MessagingAgentAvatar agents={agents} agentId={msg.fromAgentId} size="md" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12px] font-semibold text-[#fafafa]">
                    {agentName(agents, msg.fromAgentId)}
                  </span>
                  <span className="text-[10px] text-[#525252]">-&gt;</span>
                  <span className="text-[12px] text-[#a3a3a3]">
                    {agentName(agents, msg.toAgentId)}
                  </span>
                  <TypeBadge type={msg.type} />
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] text-[#fafafa]">{msg.subject}</span>
                  <span className="text-[10px] text-[#525252]">{timeAgo(msg.createdAt)}</span>
                </div>
              </div>
              <button
                onClick={() => onReply(msg)}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] transition-colors"
              >
                <Reply size={11} />
                Yanıtla
              </button>
            </div>

            <div className="px-4 py-3">
              <p className="text-[12px] text-[#a3a3a3] leading-relaxed whitespace-pre-wrap">
                {msg.content}
              </p>
            </div>

            {msg.metadata && Object.keys(msg.metadata).length > 0 && (
              <div className={`px-4 py-2 border-t border-[#1a1a1a] ${cfg.bg}`}>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(msg.metadata).map(([k, v]) => (
                    <span key={k} className="text-[10px] text-[#525252]">
                      <span className="text-[#737373]">{k}:</span> {String(v)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
