// ---------------------------------------------------------------------------
// Preset Agent Sheet — right-side panel showing all properties of a preset
// agent on the Team Builder page. Read-only.
// ---------------------------------------------------------------------------

import { useEffect } from 'react';
import { X, BadgeCheck } from 'lucide-react';
import { roleLabel, type AgentConfig } from '../../lib/studio-api';
import AgentAvatarImg from '../../components/AgentAvatar';

interface PresetAgentSheetProps {
  agent: AgentConfig;
  color: string;
  onClose: () => void;
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="bg-[#0a0a0a] border border-[#262626] rounded-lg px-3 py-2.5">
      <span className="text-[10px] text-[#525252] font-medium uppercase tracking-wide block mb-1">
        {label}
      </span>
      <span className={`text-[13px] text-[#fafafa] ${mono ? 'font-mono' : ''}`}>
        {value || '—'}
      </span>
    </div>
  );
}

export default function PresetAgentSheet({ agent, color, onClose }: PresetAgentSheetProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50 transition-opacity"
        onClick={onClose}
      />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-[520px] max-w-[95vw] bg-[#0a0a0a] border-l border-[#262626] flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-5 border-b border-[#1f1f1f] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <AgentAvatarImg avatar={agent.avatar} name={agent.name} size="xl" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-[16px] font-semibold text-[#fafafa] truncate">{agent.name}</h2>
                {agent.isPreset && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide bg-[#a855f7]/10 text-[#a855f7] border border-[#a855f7]/20">
                    <BadgeCheck size={11} />
                    Preset
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span
                  className="w-2.5 h-2.5 rounded-full border border-[#262626]"
                  style={{ backgroundColor: color }}
                  title={color}
                />
                <span className="text-[12px] text-[#525252]">{roleLabel(agent.role)}</span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[#1f1f1f] text-[#525252] hover:text-[#a3a3a3] transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 flex flex-col gap-5">
          {/* Identity */}
          <div>
            <span className="text-[11px] text-[#737373] font-medium uppercase tracking-wide block mb-2">
              Identity
            </span>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Role" value={agent.role} mono />
              <Field
                label="Color"
                value={
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="w-4 h-4 rounded border border-[#262626]"
                      style={{ backgroundColor: color }}
                    />
                    <span className="font-mono text-[11px]">{color}</span>
                  </span>
                }
              />
              <Field
                label="Agent ID"
                value={<span className="text-[11px]">{agent.id.slice(0, 8)}…</span>}
                mono
              />
              <Field label="Type" value={agent.isPreset ? 'Preset' : 'Custom'} />
            </div>
          </div>

          {/* Runtime */}
          <div>
            <span className="text-[11px] text-[#737373] font-medium uppercase tracking-wide block mb-2">
              Runtime
            </span>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Model" value={agent.model} mono />
              <Field label="CLI Tool" value={agent.cliTool} mono />
            </div>
          </div>

          {/* Personality */}
          {agent.personality && (
            <div>
              <span className="text-[11px] text-[#737373] font-medium uppercase tracking-wide block mb-2">
                Personality
              </span>
              <p className="text-[13px] text-[#a3a3a3] leading-relaxed">{agent.personality}</p>
            </div>
          )}

          {/* Skills */}
          {agent.skills.length > 0 && (
            <div>
              <span className="text-[11px] text-[#737373] font-medium uppercase tracking-wide block mb-2">
                Skills ({agent.skills.length})
              </span>
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

          {/* Avatar URL (debug-friendly) */}
          {agent.avatar && (
            <div>
              <span className="text-[11px] text-[#737373] font-medium uppercase tracking-wide block mb-2">
                Avatar
              </span>
              <div className="bg-[#0a0a0a] border border-[#262626] rounded-lg px-3 py-2 text-[11px] text-[#737373] font-mono break-all">
                {agent.avatar}
              </div>
            </div>
          )}

          {/* System Prompt */}
          {agent.systemPrompt && (
            <div>
              <span className="text-[11px] text-[#737373] font-medium uppercase tracking-wide block mb-2">
                System Prompt
              </span>
              <pre className="text-[11px] text-[#a3a3a3] font-mono leading-relaxed whitespace-pre-wrap break-words bg-[#0a0a0a] border border-[#262626] rounded-lg p-3 max-h-[300px] overflow-y-auto">
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
        </div>
      </div>
    </>
  );
}
