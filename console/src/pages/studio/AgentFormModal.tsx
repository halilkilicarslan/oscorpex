import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { addProjectAgent, updateProjectAgent, type ProjectAgent } from '../../lib/studio-api';

const ROLE_OPTIONS = [
  { value: 'pm', label: 'PM' },
  { value: 'architect', label: 'Architect' },
  { value: 'frontend', label: 'Frontend' },
  { value: 'backend', label: 'Backend' },
  { value: 'qa', label: 'QA' },
  { value: 'reviewer', label: 'Reviewer' },
  { value: 'devops', label: 'DevOps' },
  { value: 'custom', label: 'Custom' },
];

const CLI_TOOL_OPTIONS = [
  { value: 'claude-code', label: 'claude-code' },
  { value: 'codex', label: 'codex' },
  { value: 'aider', label: 'aider' },
  { value: 'custom', label: 'custom' },
];

interface AgentFormModalProps {
  mode: 'create' | 'edit';
  agent?: ProjectAgent;
  projectId: string;
  onClose: () => void;
  onSave: (agent: ProjectAgent) => void;
}

const inputClass =
  'w-full px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none';
const selectClass =
  'w-full px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[13px] text-[#fafafa] focus:border-[#22c55e] focus:outline-none appearance-none';
const labelClass = 'text-[12px] text-[#737373] font-medium block mb-1.5';

export default function AgentFormModal({ mode, agent, projectId, onClose, onSave }: AgentFormModalProps) {
  const [name, setName] = useState(agent?.name ?? '');
  const [avatar, setAvatar] = useState(agent?.avatar ?? '');
  const [role, setRole] = useState(agent?.role ?? 'custom');
  const [model, setModel] = useState(agent?.model ?? '');
  const [cliTool, setCliTool] = useState(agent?.cliTool ?? 'claude-code');
  const [personality, setPersonality] = useState(agent?.personality ?? '');
  const [skillInput, setSkillInput] = useState('');
  const [skills, setSkills] = useState<string[]>(agent?.skills ?? []);
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addSkill = () => {
    const skill = skillInput.trim();
    if (skill && !skills.includes(skill)) {
      setSkills([...skills, skill]);
      setSkillInput('');
    }
  };

  const removeSkill = (skill: string) => {
    setSkills(skills.filter((s) => s !== skill));
  };

  const isValid = name.trim().length > 0 && role.length > 0;

  const handleSubmit = async () => {
    if (!isValid) return;
    setLoading(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        avatar: avatar.trim() || '🤖',
        role,
        model: model.trim(),
        cliTool,
        personality: personality.trim(),
        skills,
        systemPrompt: systemPrompt.trim(),
      };

      let saved: ProjectAgent;
      if (mode === 'edit' && agent) {
        saved = await updateProjectAgent(projectId, agent.id, payload);
      } else {
        saved = await addProjectAgent(projectId, payload);
      }
      onSave(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#111111] border border-[#262626] rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-5 border-b border-[#1f1f1f] shrink-0">
          <h2 className="text-[16px] font-semibold text-[#fafafa]">
            {mode === 'create' ? 'New Agent' : 'Edit Agent'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[#1f1f1f] text-[#525252] hover:text-[#a3a3a3] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 flex flex-col gap-4">
          {/* Name + Avatar row */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className={labelClass}>
                Name <span className="text-[#ef4444]">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Senior Frontend Engineer"
                className={inputClass}
                autoFocus
              />
            </div>
            <div className="w-24">
              <label className={labelClass}>Avatar</label>
              <input
                type="text"
                value={avatar}
                onChange={(e) => setAvatar(e.target.value)}
                placeholder="🤖"
                className={inputClass + ' text-center text-lg'}
                maxLength={4}
              />
            </div>
          </div>

          {/* Role + CLI Tool row */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className={labelClass}>
                Role <span className="text-[#ef4444]">*</span>
              </label>
              <div className="relative">
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className={selectClass}
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex-1">
              <label className={labelClass}>CLI Tool</label>
              <div className="relative">
                <select
                  value={cliTool}
                  onChange={(e) => setCliTool(e.target.value)}
                  className={selectClass}
                >
                  {CLI_TOOL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Model */}
          <div>
            <label className={labelClass}>Model</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-4o-mini, claude-sonnet-4-20250514..."
              className={inputClass + ' font-mono'}
            />
          </div>

          {/* Personality */}
          <div>
            <label className={labelClass}>Personality</label>
            <textarea
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              placeholder="Describe how this agent behaves and communicates..."
              rows={2}
              className={inputClass + ' resize-none'}
            />
          </div>

          {/* Skills */}
          <div>
            <label className={labelClass}>Skills</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addSkill(); }
                }}
                placeholder="TypeScript, React, Testing..."
                className="flex-1 px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none"
              />
              <button
                onClick={addSkill}
                type="button"
                className="px-3 py-2 rounded-lg bg-[#1f1f1f] text-[#a3a3a3] hover:text-[#fafafa] text-[12px] font-medium transition-colors"
              >
                Add
              </button>
            </div>
            {skills.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {skills.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20"
                  >
                    {skill}
                    <button
                      onClick={() => removeSkill(skill)}
                      type="button"
                      className="hover:text-white"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* System Prompt */}
          <div>
            <label className={labelClass}>System Prompt</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a senior frontend engineer..."
              rows={6}
              className={inputClass + ' resize-none font-mono text-[12px] leading-relaxed'}
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-[12px] text-[#ef4444]">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[#1f1f1f] shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13px] text-[#a3a3a3] hover:text-[#fafafa] border border-[#262626] hover:border-[#333] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!isValid || loading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading && <Loader2 size={13} className="animate-spin" />}
            {loading ? 'Saving...' : mode === 'create' ? 'Create Agent' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
