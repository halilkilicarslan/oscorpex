import { useEffect, useMemo, useState } from 'react';
import { Brain, Loader2, Save, X } from 'lucide-react';
import AgentAvatar from '../../components/AgentAvatar';
import {
  type PlannerReasoningEffort,
  updateProjectAgent,
  type PlannerCLIProvider,
  type PlannerCLIProviderInfo,
  type PlannerChatModel,
  type ProjectAgent,
} from '../../lib/studio-api';

const CLI_TOOL_OPTIONS = [
  { value: 'claude-code', label: 'claude-code' },
  { value: 'codex', label: 'codex' },
  { value: 'aider', label: 'aider' },
  { value: 'none', label: 'none' },
];

const inputClass =
  'w-full rounded-xl border border-[#262626] bg-[#0a0a0a] px-3 py-2 text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none';
const labelClass = 'mb-1.5 block text-[12px] font-medium text-[#737373]';

interface PlannerSettingsModalProps {
  projectId: string;
  plannerAgent: ProjectAgent | null;
  plannerProviders: PlannerCLIProviderInfo[];
  plannerAvailable: boolean | null;
  selectedProvider: PlannerCLIProvider;
  selectedModel: PlannerChatModel;
  selectedEffort: PlannerReasoningEffort | null;
  onClose: () => void;
  onSavePlanner: (
    provider: PlannerCLIProvider,
    model: PlannerChatModel,
    effort: PlannerReasoningEffort | null,
  ) => void;
  onAgentSaved: (agent: ProjectAgent) => void;
}

export default function PlannerSettingsModal({
  projectId,
  plannerAgent,
  plannerProviders,
  plannerAvailable,
  selectedProvider,
  selectedModel,
  selectedEffort,
  onClose,
  onSavePlanner,
  onAgentSaved,
}: PlannerSettingsModalProps) {
  const availableProviders = plannerProviders.filter((provider) => provider.available);

  const [provider, setProvider] = useState<PlannerCLIProvider>(selectedProvider);
  const [model, setModel] = useState<PlannerChatModel>(selectedModel);
  const [effort, setEffort] = useState<PlannerReasoningEffort | null>(selectedEffort);
  const [savingPlanner, setSavingPlanner] = useState(false);
  const [savingAgent, setSavingAgent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(plannerAgent?.name ?? '');
  const [role, setRole] = useState(plannerAgent?.role ?? '');
  const [avatar, setAvatar] = useState(plannerAgent?.avatar ?? '');
  const [gender, setGender] = useState(plannerAgent?.gender ?? 'male');
  const [personality, setPersonality] = useState(plannerAgent?.personality ?? '');
  const [agentModel, setAgentModel] = useState(plannerAgent?.model ?? '');
  const [cliTool, setCliTool] = useState(plannerAgent?.cliTool ?? 'claude-code');
  const [skillsText, setSkillsText] = useState((plannerAgent?.skills ?? []).join(', '));
  const [systemPrompt, setSystemPrompt] = useState(plannerAgent?.systemPrompt ?? '');
  const [color, setColor] = useState(plannerAgent?.color ?? '#22c55e');
  const [pipelineOrder, setPipelineOrder] = useState(String(plannerAgent?.pipelineOrder ?? 0));
  const [reportsTo, setReportsTo] = useState(plannerAgent?.reportsTo ?? '');

  useEffect(() => {
    setProvider(selectedProvider);
    setModel(selectedModel);
    setEffort(selectedEffort);
  }, [selectedProvider, selectedModel, selectedEffort]);

  useEffect(() => {
    setName(plannerAgent?.name ?? '');
    setRole(plannerAgent?.role ?? '');
    setAvatar(plannerAgent?.avatar ?? '');
    setGender(plannerAgent?.gender ?? 'male');
    setPersonality(plannerAgent?.personality ?? '');
    setAgentModel(plannerAgent?.model ?? '');
    setCliTool(plannerAgent?.cliTool ?? 'claude-code');
    setSkillsText((plannerAgent?.skills ?? []).join(', '));
    setSystemPrompt(plannerAgent?.systemPrompt ?? '');
    setColor(plannerAgent?.color ?? '#22c55e');
    setPipelineOrder(String(plannerAgent?.pipelineOrder ?? 0));
    setReportsTo(plannerAgent?.reportsTo ?? '');
  }, [plannerAgent]);

  const providerOptions = useMemo(() => {
    return availableProviders.map((item) => ({
      value: item.id,
      label: `${item.label}${item.version ? ` — ${item.version}` : ''}`,
      models: item.models,
      defaultModel: item.defaultModel,
      efforts: item.efforts,
      defaultEffort: item.defaultEffort,
    }));
  }, [availableProviders]);

  const modelOptions = useMemo(() => {
    const current = providerOptions.find((item) => item.value === provider);
    return current?.models ?? [];
  }, [providerOptions, provider]);

  const effortOptions = useMemo(() => {
    const current = providerOptions.find((item) => item.value === provider);
    return current?.efforts ?? [];
  }, [providerOptions, provider]);

  useEffect(() => {
    const current = providerOptions.find((item) => item.value === provider);
    if (!current) return;
    if (!current.models.includes(model)) {
      setModel(current.defaultModel);
    }
    if (current.efforts.length === 0) {
      setEffort(null);
    } else if (!effort || !current.efforts.includes(effort)) {
      setEffort(current.defaultEffort ?? current.efforts[0] ?? null);
    }
  }, [provider, providerOptions, model, effort]);

  const handleSavePlanner = async () => {
    setSavingPlanner(true);
    setError(null);
    try {
      onSavePlanner(provider, model, effort);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Planner ayarlari kaydedilemedi');
    } finally {
      setSavingPlanner(false);
    }
  };

  const handleSaveAgent = async () => {
    if (!plannerAgent) return;
    setSavingAgent(true);
    setError(null);
    try {
      const updated = await updateProjectAgent(projectId, plannerAgent.id, {
        name: name.trim(),
        role: role.trim(),
        avatar: avatar.trim(),
        gender,
        personality: personality.trim(),
        model: agentModel.trim(),
        cliTool,
        skills: skillsText
          .split(',')
          .map((skill) => skill.trim())
          .filter(Boolean),
        systemPrompt: systemPrompt.trim(),
        color: color.trim(),
        pipelineOrder: Number.parseInt(pipelineOrder, 10) || 0,
        reportsTo: reportsTo.trim() || undefined,
      });
      onAgentSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Planner ajanı güncellenemedi');
    } finally {
      setSavingAgent(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[#262626] bg-[#111111]">
        <div className="flex items-center justify-between border-b border-[#1f1f1f] px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#22c55e]/10 text-[#22c55e]">
              <Brain size={18} />
            </div>
            <div>
              <h2 className="text-[16px] font-semibold text-[#fafafa]">Planner Settings</h2>
              <p className="text-[12px] text-[#525252]">
                Planner provider / model seç ve planner ajanını düzenle
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#525252] transition-colors hover:bg-[#1f1f1f] hover:text-[#a3a3a3]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          {error && (
            <div className="mb-4 rounded-xl border border-[#7f1d1d] bg-[#450a0a]/40 px-4 py-3 text-[12px] text-[#f87171]">
              {error}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <section className="rounded-2xl border border-[#262626] bg-[#0a0a0a] p-5">
              <h3 className="mb-1 text-[14px] font-semibold text-[#fafafa]">Planner Engine</h3>
              <p className="mb-4 text-[12px] leading-6 text-[#525252]">
                Planner sohbetini çalıştıracak CLI sağlayıcısını ve modelini seçin.
              </p>

              {plannerAvailable === false && (
                <div className="mb-4 rounded-xl border border-[#f59e0b]/20 bg-[#f59e0b]/10 px-4 py-3 text-[12px] text-[#f59e0b]">
                  Planner kullanılamıyor. Claude, Codex veya Gemini CLI kurulu olmalı.
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className={labelClass}>CLI Provider</label>
                  <select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value as PlannerCLIProvider)}
                    disabled={availableProviders.length === 0}
                    className={inputClass}
                  >
                    {providerOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Model</label>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    disabled={modelOptions.length === 0}
                    className={inputClass}
                  >
                    {modelOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Reasoning Effort</label>
                  <select
                    value={effort ?? ''}
                    onChange={(e) => setEffort((e.target.value || null) as PlannerReasoningEffort | null)}
                    disabled={effortOptions.length === 0}
                    className={inputClass}
                  >
                    {effortOptions.length === 0 ? (
                      <option value="">Bu CLI için yok</option>
                    ) : (
                      effortOptions.map((option: PlannerReasoningEffort) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <button
                  onClick={handleSavePlanner}
                  disabled={savingPlanner}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#22c55e] px-4 py-2.5 text-[12px] font-medium text-[#0a0a0a] transition-colors hover:bg-[#16a34a] disabled:opacity-50"
                >
                  {savingPlanner ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Planner Ayarlarını Kaydet
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-[#262626] bg-[#0a0a0a] p-5">
              <div className="mb-4 flex items-center gap-4">
                <AgentAvatar avatar={avatar} name={name || 'Planner'} size="xl" />
                <div>
                  <h3 className="text-[14px] font-semibold text-[#fafafa]">Planner Agent</h3>
                  <p className="text-[12px] text-[#525252]">
                    Planner ajanının tüm bilgileri burada düzenlenebilir.
                  </p>
                </div>
              </div>

              {!plannerAgent ? (
                <div className="rounded-xl border border-[#262626] bg-[#111111] px-4 py-3 text-[12px] text-[#737373]">
                  Bu projede planner ajanı bulunamadı.
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className={labelClass}>Name</label>
                    <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Role</label>
                    <input value={role} onChange={(e) => setRole(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Avatar</label>
                    <input value={avatar} onChange={(e) => setAvatar(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Gender</label>
                    <select value={gender} onChange={(e) => setGender(e.target.value as 'male' | 'female')} className={inputClass}>
                      <option value="male">male</option>
                      <option value="female">female</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Agent Model</label>
                    <input value={agentModel} onChange={(e) => setAgentModel(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>CLI Tool</label>
                    <select value={cliTool} onChange={(e) => setCliTool(e.target.value)} className={inputClass}>
                      {CLI_TOOL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Color</label>
                    <input value={color} onChange={(e) => setColor(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Pipeline Order</label>
                    <input value={pipelineOrder} onChange={(e) => setPipelineOrder(e.target.value)} className={inputClass} />
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelClass}>Reports To</label>
                    <input value={reportsTo} onChange={(e) => setReportsTo(e.target.value)} className={inputClass} />
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelClass}>Skills</label>
                    <input
                      value={skillsText}
                      onChange={(e) => setSkillsText(e.target.value)}
                      className={inputClass}
                      placeholder="skill-a, skill-b, skill-c"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelClass}>Personality</label>
                    <textarea
                      value={personality}
                      onChange={(e) => setPersonality(e.target.value)}
                      rows={3}
                      className={inputClass + ' resize-none'}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelClass}>System Prompt</label>
                    <textarea
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      rows={8}
                      className={inputClass + ' resize-y font-mono text-[12px]'}
                    />
                  </div>

                  <div className="md:col-span-2">
                    <button
                      onClick={handleSaveAgent}
                      disabled={savingAgent}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#1f1f1f] px-4 py-2.5 text-[12px] font-medium text-[#fafafa] transition-colors hover:bg-[#262626] disabled:opacity-50"
                    >
                      {savingAgent ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      Planner Agent Bilgilerini Kaydet
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
