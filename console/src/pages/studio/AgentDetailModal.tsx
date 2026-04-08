import { X, Pencil } from 'lucide-react';
import { roleLabel, type ProjectAgent } from '../../lib/studio-api';
import AgentAvatarImg from '../../components/AgentAvatar';

interface AgentDetailModalProps {
  agent: ProjectAgent;
  onClose: () => void;
  onEdit: () => void;
}

export default function AgentDetailModal({ agent, onClose, onEdit }: AgentDetailModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#111111] border border-[#262626] rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-5 border-b border-[#1f1f1f] shrink-0">
          <div className="flex items-center gap-3">
            <AgentAvatarImg avatar={agent.avatar} name={agent.name} size="xl" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[16px] font-semibold text-[#fafafa]">{agent.name}</h2>
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                    agent.sourceAgentId
                      ? 'bg-[#a3a3a3]/10 text-[#737373] border border-[#333]'
                      : 'bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20'
                  }`}
                >
                  {agent.sourceAgentId ? 'Template' : 'Custom'}
                </span>
              </div>
              <span className="text-[12px] text-[#525252]">{roleLabel(agent.role)}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[#1f1f1f] text-[#525252] hover:text-[#a3a3a3] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 flex flex-col gap-5">
          {/* Meta row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#0a0a0a] border border-[#262626] rounded-lg px-3 py-2.5">
              <span className="text-[10px] text-[#525252] font-medium uppercase tracking-wide block mb-1">Model</span>
              <span className="text-[13px] text-[#fafafa] font-mono">{agent.model || '—'}</span>
            </div>
            <div className="bg-[#0a0a0a] border border-[#262626] rounded-lg px-3 py-2.5">
              <span className="text-[10px] text-[#525252] font-medium uppercase tracking-wide block mb-1">CLI Tool</span>
              <span className="text-[13px] text-[#fafafa] font-mono">{agent.cliTool || '—'}</span>
            </div>
          </div>

          {/* Personality */}
          {agent.personality && (
            <div>
              <span className="text-[11px] text-[#737373] font-medium uppercase tracking-wide block mb-2">Personality</span>
              <p className="text-[13px] text-[#a3a3a3] leading-relaxed">{agent.personality}</p>
            </div>
          )}

          {/* Skills */}
          {agent.skills.length > 0 && (
            <div>
              <span className="text-[11px] text-[#737373] font-medium uppercase tracking-wide block mb-2">Skills</span>
              <div className="flex flex-wrap gap-1.5">
                {agent.skills.map((skill) => (
                  <span
                    key={skill}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-[#1f1f1f] text-[#a3a3a3] border border-[#262626]"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* System Prompt */}
          {agent.systemPrompt && (
            <div>
              <span className="text-[11px] text-[#737373] font-medium uppercase tracking-wide block mb-2">System Prompt</span>
              <pre className="text-[11px] text-[#a3a3a3] font-mono leading-relaxed whitespace-pre-wrap break-words bg-[#0a0a0a] border border-[#262626] rounded-lg p-3 max-h-[200px] overflow-y-auto">
                {agent.systemPrompt}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#1f1f1f] shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13px] text-[#a3a3a3] hover:text-[#fafafa] border border-[#262626] hover:border-[#333] transition-colors"
          >
            Close
          </button>
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] transition-colors"
          >
            <Pencil size={13} />
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}
