import { useState, useEffect } from 'react';
import { X, Loader2, FileText } from 'lucide-react';
import {
  addProjectAgent,
  updateProjectAgent,
  fetchProviders,
  fetchAgentFile,
  writeAgentFile,
  fetchAvatars,
  type AIProvider,
  type ProjectAgent,
  type AvatarOption,
  type Gender,
} from '../../lib/studio-api';
import { getModelsFromProviders } from '../../lib/model-options';
import AgentAvatar from '../../components/AgentAvatar';

const ROLE_OPTIONS = [
  { value: 'pm', label: 'Project Manager' },
  { value: 'designer', label: 'UI/UX Designer' },
  { value: 'architect', label: 'Architect' },
  { value: 'frontend', label: 'Frontend Developer' },
  { value: 'backend', label: 'Backend Developer' },
  { value: 'coder', label: 'Full-Stack Coder' },
  { value: 'qa', label: 'QA Engineer' },
  { value: 'reviewer', label: 'Code Reviewer' },
  { value: 'devops', label: 'DevOps Engineer' },
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
  const [gender, setGender] = useState<Gender>(agent?.gender ?? 'male');
  const [role, setRole] = useState(agent?.role ?? 'custom');
  const [model, setModel] = useState(agent?.model ?? '');
  const [cliTool, setCliTool] = useState(agent?.cliTool ?? 'claude-code');
  const [personality, setPersonality] = useState(agent?.personality ?? '');
  const [skillInput, setSkillInput] = useState('');
  const [skills, setSkills] = useState<string[]>(agent?.skills ?? []);
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Avatar picker
  const [avatarOptions, setAvatarOptions] = useState<AvatarOption[]>([]);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  // Provider-driven model select
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [modelGroups, setModelGroups] = useState<{ label: string; models: string[] }[]>([]);

  // .md file mode toggles
  const [promptMode, setPromptMode] = useState<'inline' | 'file'>('inline');
  const [skillsMode, setSkillsMode] = useState<'inline' | 'file'>('inline');

  // Skills .md file content (separate state so inline tags are preserved)
  const [skillsMdContent, setSkillsMdContent] = useState('');

  useEffect(() => {
    fetchProviders()
      .then((p) => {
        setProviders(p);
        setModelGroups(getModelsFromProviders(p));
      })
      .catch(() => {
        // Providers endpoint may not be ready; fall back to text input
      });
  }, []);

  // Load avatars when gender changes
  useEffect(() => {
    fetchAvatars(gender).then(setAvatarOptions).catch(() => {});
  }, [gender]);

  // Suppress unused variable warning — providers is used implicitly via getModelsFromProviders
  void providers;

  // ---- .md file handlers ---------------------------------------------------

  const loadPromptFile = async () => {
    if (!agent) return;
    try {
      const { content } = await fetchAgentFile(projectId, agent.id, 'system-prompt.md');
      // Skip the first heading line and blank line, keep the rest
      const lines = content.split('\n');
      const bodyStart = lines.findIndex((l, i) => i > 0 && l.trim() === '') + 1;
      setSystemPrompt(lines.slice(bodyStart).join('\n').trim());
    } catch {
      // File may not exist yet — leave current content as-is
    }
  };

  const savePromptFile = async () => {
    if (!agent) return;
    try {
      await writeAgentFile(
        projectId,
        agent.id,
        'system-prompt.md',
        `# ${name} — System Prompt\n\n${systemPrompt}\n`,
      );
    } catch {
      // Best-effort; backend may not be ready yet
    }
  };

  const loadSkillsFile = async () => {
    if (!agent) return;
    try {
      const { content } = await fetchAgentFile(projectId, agent.id, 'skills.md');
      setSkillsMdContent(content);
    } catch {
      // File may not exist yet — seed with current inline skills as markdown
      const seed = skills.length > 0 ? skills.map((s) => `- ${s}`).join('\n') : '';
      setSkillsMdContent(seed ? `# ${name} — Skills\n\n${seed}\n` : '');
    }
  };

  const saveSkillsFile = async () => {
    if (!agent) return;
    try {
      await writeAgentFile(projectId, agent.id, 'skills.md', skillsMdContent);
    } catch {
      // Best-effort; backend may not be ready yet
    }
  };

  // Pre-load file content when switching to file mode
  const handleTogglePromptMode = () => {
    const next = promptMode === 'inline' ? 'file' : 'inline';
    setPromptMode(next);
    if (next === 'file' && agent) {
      loadPromptFile();
    }
  };

  const handleToggleSkillsMode = () => {
    const next = skillsMode === 'inline' ? 'file' : 'inline';
    setSkillsMode(next);
    if (next === 'file' && agent) {
      loadSkillsFile();
    }
  };

  // ---- Skills (inline) -----------------------------------------------------

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

  // ---- Submit --------------------------------------------------------------

  const isValid = name.trim().length > 0 && role.length > 0;

  const handleSubmit = async () => {
    if (!isValid) return;
    setLoading(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        avatar: avatar.trim() || '🤖',
        gender,
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

  // ---- Render --------------------------------------------------------------

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
          {/* Avatar + Name + Gender row */}
          <div className="flex gap-3 items-end">
            {/* Avatar preview + picker toggle */}
            <div className="flex flex-col items-center gap-1">
              <label className={labelClass}>Avatar</label>
              <button
                type="button"
                onClick={() => setShowAvatarPicker(!showAvatarPicker)}
                className="relative group"
              >
                <AgentAvatar avatar={avatar} name={name || '?'} size="xl" />
                <span className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] text-white transition-opacity">
                  Change
                </span>
              </button>
            </div>
            <div className="flex-1 flex flex-col gap-3">
              <div>
                <label className={labelClass}>
                  Name <span className="text-[#ef4444]">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Agent name"
                  className={inputClass}
                  autoFocus
                />
              </div>
              <div>
                <label className={labelClass}>Gender</label>
                <div className="flex gap-2">
                  {(['male', 'female'] as Gender[]).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGender(g)}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
                        gender === g
                          ? 'bg-[#22c55e]/10 border-[#22c55e]/40 text-[#22c55e]'
                          : 'bg-[#0a0a0a] border-[#262626] text-[#525252] hover:text-[#a3a3a3]'
                      }`}
                    >
                      {g === 'male' ? 'Male' : 'Female'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Avatar picker grid */}
          {showAvatarPicker && (
            <div className="bg-[#0a0a0a] border border-[#262626] rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-[#525252]">
                  Select avatar ({gender === 'male' ? 'Male' : 'Female'})
                </span>
                <button
                  type="button"
                  onClick={() => setShowAvatarPicker(false)}
                  className="text-[#525252] hover:text-[#a3a3a3]"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="grid grid-cols-6 gap-2 max-h-[200px] overflow-y-auto">
                {avatarOptions.map((opt) => (
                  <button
                    key={opt.url}
                    type="button"
                    onClick={() => {
                      setAvatar(opt.url);
                      setShowAvatarPicker(false);
                    }}
                    className={`relative group rounded-lg p-1 transition-all ${
                      avatar === opt.url
                        ? 'ring-2 ring-[#22c55e] bg-[#22c55e]/10'
                        : 'hover:bg-[#1f1f1f]'
                    }`}
                    title={opt.name}
                  >
                    <img
                      src={opt.url}
                      alt={opt.name}
                      className="w-full aspect-square rounded-full object-cover"
                      loading="lazy"
                    />
                    <span className="absolute bottom-0 left-0 right-0 text-[8px] text-center text-[#737373] truncate opacity-0 group-hover:opacity-100 transition-opacity">
                      {opt.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

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
            {modelGroups.length > 0 ? (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className={selectClass}
              >
                <option value="">Select model...</option>
                {modelGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.models.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="gpt-4o-mini, claude-sonnet-4-20250514..."
                className={inputClass + ' font-mono'}
              />
            )}
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
            <div className="flex items-center justify-between mb-1.5">
              <label className={labelClass + ' mb-0'}>Skills</label>
              {agent ? (
                <button
                  type="button"
                  onClick={handleToggleSkillsMode}
                  className="flex items-center gap-1 text-[11px] text-[#525252] hover:text-[#a3a3a3] transition-colors"
                >
                  <FileText size={11} />
                  {skillsMode === 'inline' ? 'View .md file' : 'Edit inline'}
                </button>
              ) : (
                <span className="text-[10px] text-[#404040] italic">.md files available after save</span>
              )}
            </div>
            {skillsMode === 'file' ? (
              <div className="bg-[#0a0a0a] border border-[#262626] rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] text-[#525252] font-mono">skills.md</span>
                  <button
                    type="button"
                    onClick={loadSkillsFile}
                    className="text-[11px] text-[#22c55e] hover:underline"
                  >
                    Reload from file
                  </button>
                </div>
                <textarea
                  value={skillsMdContent}
                  onChange={(e) => setSkillsMdContent(e.target.value)}
                  rows={6}
                  className={inputClass + ' resize-none font-mono text-[12px] leading-relaxed'}
                />
                <button
                  type="button"
                  onClick={saveSkillsFile}
                  className="mt-2 text-[11px] px-2 py-1 rounded bg-[#1f1f1f] text-[#a3a3a3] hover:text-[#fafafa] transition-colors"
                >
                  Save to .md file
                </button>
              </div>
            ) : (
              <>
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
              </>
            )}
          </div>

          {/* System Prompt */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={labelClass + ' mb-0'}>System Prompt</label>
              {agent ? (
                <button
                  type="button"
                  onClick={handleTogglePromptMode}
                  className="flex items-center gap-1 text-[11px] text-[#525252] hover:text-[#a3a3a3] transition-colors"
                >
                  <FileText size={11} />
                  {promptMode === 'inline' ? 'View .md file' : 'Edit inline'}
                </button>
              ) : (
                <span className="text-[10px] text-[#404040] italic">.md files available after save</span>
              )}
            </div>
            {promptMode === 'file' ? (
              <div className="bg-[#0a0a0a] border border-[#262626] rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] text-[#525252] font-mono">system-prompt.md</span>
                  <button
                    type="button"
                    onClick={loadPromptFile}
                    className="text-[11px] text-[#22c55e] hover:underline"
                  >
                    Reload from file
                  </button>
                </div>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={8}
                  className={inputClass + ' resize-none font-mono text-[12px] leading-relaxed'}
                />
                <button
                  type="button"
                  onClick={savePromptFile}
                  className="mt-2 text-[11px] px-2 py-1 rounded bg-[#1f1f1f] text-[#a3a3a3] hover:text-[#fafafa] transition-colors"
                >
                  Save to .md file
                </button>
              </div>
            ) : (
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="You are a senior frontend engineer..."
                rows={6}
                className={inputClass + ' resize-none font-mono text-[12px] leading-relaxed'}
              />
            )}
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
