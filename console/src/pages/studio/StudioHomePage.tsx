import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  FolderOpen,
  Trash2,
  Play,
  Pause,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Code2,
  X,
  FolderInput,
  LayoutTemplate,
  ListTodo,
  CheckCircle,
  Wrench,
  Archive,
} from 'lucide-react';
import {
  fetchProjects,
  createProject,
  createCustomTeam,
  importProject,
  fetchProjectAgents,
  fetchProjectAnalytics,
  createProjectFromTemplate,
  deleteProject,
  fetchTeamTemplates,
  fetchCustomTeams,
  fetchProjectTemplates,
  fetchPresetAgents,
  roleLabel,
  streamTeamArchitectChat,
  type AgentConfig,
  type ArchitectMessage,
  type Project,
  type TeamTemplate,
  type CustomTeamTemplate,
  type ProjectTemplateInfo,
  type ProjectAgent,
  type ProjectAnalytics,
  type TeamArchitectIntake,
} from '../../lib/studio-api';
import AgentAvatarImg from '../../components/AgentAvatar';

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<Project['status'], { color: string; icon: React.ReactNode; label: string }> = {
  planning: { color: 'text-[#f59e0b]', icon: <Clock size={12} />, label: 'Planning' },
  approved: { color: 'text-[#3b82f6]', icon: <CheckCircle2 size={12} />, label: 'Approved' },
  running: { color: 'text-[#22c55e]', icon: <Loader2 size={12} className="animate-spin" />, label: 'Running' },
  paused: { color: 'text-[#a855f7]', icon: <Pause size={12} />, label: 'Paused' },
  completed: { color: 'text-[#22c55e]', icon: <CheckCircle2 size={12} />, label: 'Completed' },
  failed: { color: 'text-[#ef4444]', icon: <XCircle size={12} />, label: 'Failed' },
  maintenance: { color: 'text-[#f97316]', icon: <Wrench size={12} />, label: 'Maintenance' },
  archived: { color: 'text-[#6b7280]', icon: <Archive size={12} />, label: 'Archived' },
};

function StatusBadge({ status }: { status: Project['status'] }) {
  const s = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${s.color}`}>
      {s.icon}
      {s.label}
    </span>
  );
}

function resolveTeamMember(role: string, presetAgents: AgentConfig[]) {
  const preset = presetAgents.find((agent) => agent.role === role);
  return {
    role,
    name: preset?.name ?? roleLabel(role),
    title: roleLabel(role),
    avatar: preset?.avatar ?? roleLabel(role).slice(0, 1).toUpperCase(),
  };
}

function TeamRosterPreview({
  roles,
  presetAgents,
  limit = 4,
  columns = 'wide',
}: {
  roles: string[];
  presetAgents: AgentConfig[];
  limit?: number;
  columns?: 'compact' | 'wide';
}) {
  const members = roles.map((role) => resolveTeamMember(role, presetAgents));
  const visibleMembers = members.slice(0, limit);
  const remaining = members.length - visibleMembers.length;
  const gridClass = columns === 'compact' ? 'grid-cols-2' : 'grid-cols-2 2xl:grid-cols-3';

  return (
    <div className="mt-3">
      <div className={`grid gap-2.5 ${gridClass}`}>
      {visibleMembers.map((member) => (
        <div
          key={`${member.role}-${member.name}`}
          className="flex items-center gap-2.5 rounded-xl border border-[#202020] bg-[#121212] px-2.5 py-2"
        >
          <AgentAvatarImg avatar={member.avatar} name={member.name} size="sm" />
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-[#f3f4f6] truncate">{member.name}</div>
            <div className="text-[10px] text-[#737373] truncate">{member.title}</div>
          </div>
        </div>
      ))}
      </div>
      {remaining > 0 && (
        <div className="text-[10px] text-[#6b7280] px-1">
          +{remaining} more team member{remaining > 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

type TeamCandidate = {
  id: string;
  name: string;
  description: string;
  roles: string[];
  source: 'preset' | 'custom';
};

type TeamRecommendation = {
  candidate: TeamCandidate | null;
  reason: string;
};

const PROJECT_TYPE_OPTIONS = [
  { value: 'web-app', label: 'Web app', hint: 'User-facing product or SaaS app' },
  { value: 'dashboard', label: 'Dashboard', hint: 'Admin panel or internal analytics UI' },
  { value: 'landing-page', label: 'Landing page', hint: 'Marketing site or presentation page' },
  { value: 'api-service', label: 'API / backend', hint: 'Service, backend or integration layer' },
  { value: 'internal-tool', label: 'Internal tool', hint: 'Ops, CRM or business workflow app' },
  { value: 'automation', label: 'Automation', hint: 'Agents, workflows or scheduled jobs' },
  { value: 'unknown', label: 'Not sure yet', hint: 'Planner should infer the direction' },
] as const;

function hasAnyRole(roles: string[], candidates: string[]): boolean {
  return roles.some((role) => candidates.includes(role));
}

function buildTeamCandidates(
  templates: TeamTemplate[],
  customTeams: CustomTeamTemplate[],
): TeamCandidate[] {
  return [
    ...customTeams.map((team) => ({
      id: team.id,
      name: team.name,
      description: team.description,
      roles: team.roles,
      source: 'custom' as const,
    })),
    ...templates.map((team) => ({
      id: team.id,
      name: team.name,
      description: team.description,
      roles: team.roles,
      source: 'preset' as const,
    })),
  ];
}

function recommendTeamCandidate(
  candidates: TeamCandidate[],
  context: {
    projectType: string;
    previewEnabled: boolean;
    techPreference: string[];
  },
): TeamRecommendation {
  if (candidates.length === 0) {
    return { candidate: null, reason: 'No team templates available.' };
  }

  const scored = candidates.map((candidate) => {
    let score = 0;
    const { roles } = candidate;
    const hasFrontend = hasAnyRole(roles, ['frontend-dev', 'frontend', 'design-lead', 'designer']);
    const hasBackend = hasAnyRole(roles, ['backend-dev', 'backend', 'architect', 'tech-lead']);
    const hasDevops = hasAnyRole(roles, ['devops']);
    const hasQA = hasAnyRole(roles, ['frontend-qa', 'backend-qa', 'qa']);
    const hasReviewer = hasAnyRole(roles, ['frontend-reviewer', 'backend-reviewer', 'reviewer']);
    const lowerName = `${candidate.name} ${candidate.description}`.toLowerCase();
    const prefs = context.techPreference.join(' ').toLowerCase();

    score += hasAnyRole(roles, ['product-owner', 'pm']) ? 3 : 0;
    score += hasReviewer ? 2 : 0;
    score += hasQA ? 1 : 0;

    switch (context.projectType) {
      case 'landing-page':
        score += hasFrontend ? 5 : -3;
        score += hasAnyRole(roles, ['design-lead', 'designer']) ? 4 : 0;
        score += hasBackend ? -2 : 0;
        score += hasDevops ? -1 : 0;
        break;
      case 'api-service':
        score += hasBackend ? 5 : -3;
        score += hasFrontend ? -2 : 0;
        score += hasDevops ? 2 : 0;
        break;
      case 'dashboard':
      case 'internal-tool':
      case 'web-app':
        score += hasFrontend ? 4 : -2;
        score += hasBackend ? 4 : -2;
        score += hasDevops ? 1 : 0;
        break;
      case 'automation':
        score += hasBackend ? 5 : -2;
        score += hasDevops ? 3 : 0;
        score += hasFrontend ? -1 : 0;
        break;
      default:
        score += hasFrontend && hasBackend ? 4 : 0;
    }

    if (context.previewEnabled && (context.projectType === 'landing-page' || context.projectType === 'web-app' || context.projectType === 'dashboard')) {
      score += hasFrontend ? 2 : -2;
    }

    if (/\breact|next|vite|tailwind|frontend\b/.test(prefs)) score += hasFrontend ? 2 : -1;
    if (/\bnode|express|hono|fastify|nestjs|prisma|drizzle|postgres|backend\b/.test(prefs)) score += hasBackend ? 2 : -1;
    if (/\bdeploy|infra|docker|kubernetes|aws\b/.test(prefs)) score += hasDevops ? 2 : 0;

    if (lowerName.includes('full stack')) score += 1;
    if (candidate.source === 'preset') score += 0.25;

    return { candidate, score, hasFrontend, hasBackend, hasDevops };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return { candidate: null, reason: 'No suitable team recommendation found.' };

  let reason = 'Balanced choice based on the current project intake.';
  if (context.projectType === 'landing-page' && best.hasFrontend) {
    reason = 'Frontend ve tasarım ağırlıklı olduğu için bu takım landing page için daha uygun.';
  } else if (context.projectType === 'api-service' && best.hasBackend) {
    reason = 'Backend ve servis teslimatı ağırlıklı olduğu için bu takım API projesine daha uygun.';
  } else if ((context.projectType === 'dashboard' || context.projectType === 'web-app') && best.hasFrontend && best.hasBackend) {
    reason = 'Hem arayüz hem uygulama mantığı gerektiği için dengeli bir ürün takımı önerildi.';
  } else if (context.projectType === 'automation' && (best.hasBackend || best.hasDevops)) {
    reason = 'Otomasyon ve workflow işleri için backend/ops kabiliyeti öne çıktığı için bu takım seçildi.';
  } else if (context.previewEnabled && best.hasFrontend) {
    reason = 'Preview beklentisi olduğu için çalıştırılabilir arayüz odaklı takım tercih edildi.';
  }

  return { candidate: best.candidate, reason };
}

type TeamArchitectRecommendation = {
  decision: 'recommend-existing' | 'recommend-custom' | 'need-more-info';
  teamTemplateId?: string;
  reasoning?: string[];
  followUpQuestions?: string[];
  customTeam?: {
    name: string;
    description: string;
    roles: string[];
  };
};

function parseTeamArchitectRecommendation(text: string): TeamArchitectRecommendation | null {
  const match = text.match(/```team-json\s*\n([\s\S]*?)\n```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as TeamArchitectRecommendation;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Project card
// ---------------------------------------------------------------------------

function ProjectCard({
  project,
  onOpen,
  onDelete,
}: {
  project: Project;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [agents, setAgents] = useState<ProjectAgent[]>([]);
  const [analytics, setAnalytics] = useState<ProjectAnalytics | null>(null);

  useEffect(() => {
    fetchProjectAgents(project.id).then(setAgents).catch(() => {});
    fetchProjectAnalytics(project.id).then(setAnalytics).catch(() => {});
  }, [project.id]);

  const completionPct = analytics && analytics.totalTasks > 0
    ? Math.round((analytics.completedTasks / analytics.totalTasks) * 100)
    : 0;

  return (
    <div
      onClick={onOpen}
      className="bg-[#111111] border border-[#262626] rounded-xl p-5 hover:border-[#333] transition-colors group cursor-pointer"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-[#1f1f1f] flex items-center justify-center">
            <Code2 size={18} className="text-[#22c55e]" />
          </div>
          <div>
            <h3 className="text-[14px] font-semibold text-[#fafafa]">{project.name}</h3>
            <StatusBadge status={project.status} />
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#1f1f1f] text-[#525252] hover:text-[#ef4444] transition-all"
          title="Delete project"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Description */}
      {project.description && (
        <p className="text-[12px] text-[#737373] mb-3 line-clamp-2">{project.description}</p>
      )}

      {/* Tech stack */}
      {project.techStack.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {project.techStack.map((tech) => (
            <span
              key={tech}
              className="text-[10px] px-1.5 py-0.5 rounded bg-[#1f1f1f] text-[#a3a3a3] border border-[#262626]"
            >
              {tech}
            </span>
          ))}
        </div>
      )}

      {/* Team avatars */}
      {agents.length > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <div className="flex -space-x-1.5">
            {agents.slice(0, 6).map((agent) => (
              <AgentAvatarImg
                key={agent.id}
                avatar={agent.avatar}
                name={agent.name}
                size="xs"
                className="ring-2 ring-[#111111]"
              />
            ))}
          </div>
          <span className="text-[10px] text-[#525252]">
            {agents.length} {agents.length === 1 ? 'agent' : 'agents'}
          </span>
        </div>
      )}

      {/* Mini metrics */}
      {analytics && analytics.totalTasks > 0 && (
        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center gap-1">
            <ListTodo size={11} className="text-[#525252]" />
            <span className="text-[10px] text-[#a3a3a3]">{analytics.totalTasks}</span>
          </div>
          <div className="flex items-center gap-1">
            <CheckCircle size={11} className="text-[#22c55e]" />
            <span className="text-[10px] text-[#22c55e]">{analytics.completedTasks}</span>
          </div>
          {analytics.inProgressTasks > 0 && (
            <div className="flex items-center gap-1">
              <Loader2 size={11} className="text-[#3b82f6]" />
              <span className="text-[10px] text-[#3b82f6]">{analytics.inProgressTasks}</span>
            </div>
          )}
          {/* Progress bar */}
          <div className="flex-1 h-1.5 bg-[#1f1f1f] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#22c55e] rounded-full transition-all"
              style={{ width: `${completionPct}%` }}
            />
          </div>
          <span className="text-[10px] text-[#525252]">{completionPct}%</span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-[#1f1f1f]">
        <span className="text-[10px] text-[#525252]">
          {new Date(project.createdAt).toLocaleDateString()}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors"
        >
          {project.status === 'planning' ? (
            <>
              <Play size={12} />
              Start Planning
            </>
          ) : (
            <>
              <FolderOpen size={12} />
              Open
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create project modal
// ---------------------------------------------------------------------------

function CreateProjectModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (project: Project) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [projectType, setProjectType] = useState('web-app');
  const [techPreferenceInput, setTechPreferenceInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<TeamTemplate[]>([]);
  const [customTeams, setCustomTeams] = useState<CustomTeamTemplate[]>([]);
  const [presetAgents, setPresetAgents] = useState<AgentConfig[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [plannerAgents, setPlannerAgents] = useState<AgentConfig[]>([]);
  const [selectedPlanner, setSelectedPlanner] = useState<string>('');
  const [previewEnabled, setPreviewEnabled] = useState(true);
  const [step, setStep] = useState<1 | 2>(1);
  const [teamMode, setTeamMode] = useState<'auto' | 'manual'>('auto');
  const [architectMessages, setArchitectMessages] = useState<ArchitectMessage[]>([]);
  const [architectInput, setArchitectInput] = useState('');
  const [architectStreaming, setArchitectStreaming] = useState(false);
  const [architectStreamText, setArchitectStreamText] = useState('');
  const [architectRecommendation, setArchitectRecommendation] = useState<TeamArchitectRecommendation | null>(null);
  const [architectError, setArchitectError] = useState<string | null>(null);

  useEffect(() => {
    fetchTeamTemplates().then(setTemplates).catch(() => {});
    fetchCustomTeams().then(setCustomTeams).catch(() => {});
    fetchPresetAgents()
      .then((agents) => {
        setPresetAgents(agents);
        const planners = agents.filter((agent) => agent.role === 'product-owner' || agent.role === 'pm');
        setPlannerAgents(planners);
        if (planners.length > 0) setSelectedPlanner(planners[0].id);
      })
      .catch(() => {});
  }, []);

  const techPreference = techPreferenceInput
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const teamCandidates = buildTeamCandidates(templates, customTeams);
  const recommendation = recommendTeamCandidate(teamCandidates, {
    projectType,
    previewEnabled,
    techPreference,
  });
  const recommendationId = recommendation.candidate?.id ?? '';

  useEffect(() => {
    if (teamMode !== 'auto') return;
    if (recommendationId && recommendationId !== selectedTemplate) {
      setSelectedTemplate(recommendationId);
    }
  }, [teamMode, recommendationId, selectedTemplate]);

  const architectCustomTeam = architectRecommendation?.decision === 'recommend-custom'
    ? architectRecommendation.customTeam
    : null;
  const architectRecommendedTeam = architectRecommendation?.decision === 'recommend-existing'
    ? teamCandidates.find((team) => team.id === architectRecommendation.teamTemplateId) ?? null
    : null;
  const selectedTeam =
    teamCandidates.find((team) => team.id === selectedTemplate) ??
    architectRecommendedTeam ??
    (architectCustomTeam
      ? {
          id: 'architect-custom',
          name: architectCustomTeam.name,
          description: architectCustomTeam.description,
          roles: architectCustomTeam.roles,
          source: 'custom' as const,
        }
      : recommendation.candidate ?? null);
  const selectedTeamName = selectedTeam?.name ?? 'Planner will choose a default team';
  const selectedPlannerAgent = plannerAgents.find((agent) => agent.id === selectedPlanner) ?? plannerAgents[0] ?? null;
  const effectiveTeamTemplateId = teamMode === 'auto'
    ? (architectRecommendedTeam?.id || recommendation.candidate?.id || selectedTemplate || undefined)
    : (selectedTemplate || undefined);
  const canContinueToTeam = name.trim().length > 0;
  const architectIntake: TeamArchitectIntake = {
    name: name.trim(),
    description: description.trim(),
    projectType,
    previewEnabled,
    techPreference,
  };

  const sendArchitectMessage = (message: string, historyOverride?: ArchitectMessage[]) => {
    const text = message.trim();
    if (!text || architectStreaming) return;

    const nextMessages = historyOverride ?? [...architectMessages, { role: 'user', content: text }];
    setArchitectMessages(nextMessages);
    setArchitectStreaming(true);
    setArchitectStreamText('');
    setArchitectError(null);

    let accumulated = '';
    streamTeamArchitectChat(
      architectIntake,
      nextMessages,
      (chunk) => {
        accumulated += chunk;
        setArchitectStreamText(accumulated);
      },
      (fullText) => {
        const finalText = fullText || accumulated;
        const assistantMessage: ArchitectMessage = { role: 'assistant', content: finalText };
        setArchitectMessages((prev) => [...prev, assistantMessage]);
        setArchitectStreaming(false);
        setArchitectStreamText('');
        setArchitectInput('');

        const parsed = parseTeamArchitectRecommendation(finalText);
        if (parsed) {
          setArchitectRecommendation(parsed);
          if (parsed.decision === 'recommend-existing' && parsed.teamTemplateId) {
            setSelectedTemplate(parsed.teamTemplateId);
          }
        }
      },
      (err) => {
        setArchitectStreaming(false);
        setArchitectStreamText('');
        setArchitectError(err.message);
      },
    );
  };

  useEffect(() => {
    if (step !== 2 || teamMode !== 'auto' || architectMessages.length > 0 || architectStreaming) return;
    sendArchitectMessage('Bu intake için en uygun takımı öner. Gerekirse kısa takip soruları sor.');
  }, [step, teamMode]);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      let teamTemplateId = effectiveTeamTemplateId;
      if (!teamTemplateId && architectCustomTeam) {
        const customTeam = await createCustomTeam({
          name: architectCustomTeam.name,
          description: architectCustomTeam.description,
          roles: architectCustomTeam.roles,
          dependencies: [],
        });
        teamTemplateId = customTeam.id;
      }
      const project = await createProject({
        name: name.trim(),
        description: description.trim(),
        projectType,
        techPreference,
        teamTemplateId,
        plannerAgentId: selectedPlanner || undefined,
        previewEnabled,
      });
      onCreate(project);
    } catch (err) {
      console.error('Failed to create project:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#111111] border border-[#262626] rounded-3xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl shadow-black/30">
        <div className="flex items-center justify-between px-6 pt-6 pb-5 border-b border-[#1f1f1f] shrink-0">
          <div>
            <h2 className="text-[18px] font-semibold text-[#fafafa]">New Project</h2>
            <p className="text-[12px] text-[#6b7280] mt-1">
              Önce brief’i gir, sonra planlamadan önce takımı kur.
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#1f1f1f] text-[#525252] hover:text-[#a3a3a3]">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-6">
          <div className="mb-6 flex items-center gap-3">
            {[
              { id: 1, title: 'Project Brief', caption: 'Intent and goals' },
              { id: 2, title: 'Team Setup', caption: 'Build the team first' },
            ].map((item) => {
              const active = step === item.id;
              const complete = step > item.id;
              return (
                <div key={item.id} className="flex items-center gap-3">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-full border text-[12px] font-semibold ${
                    active
                      ? 'border-[#22c55e] bg-[#22c55e]/10 text-[#22c55e]'
                      : complete
                        ? 'border-[#3b82f6] bg-[#3b82f6]/10 text-[#93c5fd]'
                        : 'border-[#2a2a2a] bg-[#111111] text-[#6b7280]'
                  }`}>
                    {item.id}
                  </div>
                  <div className="min-w-[120px]">
                    <div className={`text-[12px] font-medium ${active ? 'text-[#fafafa]' : 'text-[#a3a3a3]'}`}>{item.title}</div>
                    <div className="text-[10px] text-[#525252]">{item.caption}</div>
                  </div>
                  {item.id === 1 && <div className="hidden sm:block h-px w-10 bg-[#262626]" />}
                </div>
              );
            })}
          </div>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_360px]">
            <div className="space-y-6">
              {step === 1 && (
                <>
                  <div className="rounded-2xl border border-[#1f1f1f] bg-[linear-gradient(180deg,#121212_0%,#0a0a0a_100%)] px-5 py-5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280] mb-2">Step 1</p>
                    <h3 className="text-[15px] font-semibold text-[#fafafa]">Brief’i gir, ihtiyaç sinyalini netleştir.</h3>
                    <p className="text-[12px] leading-6 text-[#737373] mt-2 max-w-2xl">
                      Bu adımda yalnızca ne yapmak istediğini tarif et. Sonraki adımda sistem önce uygun takımı kuracak,
                      sonra planner bu somut takıma göre detaylı planı çıkaracak.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[#1f1f1f] bg-[#0d0d0d] px-5 py-5 space-y-5">
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                      <div>
                        <label className="text-[12px] text-[#737373] font-medium block mb-1.5">Project Name</label>
                        <input
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Counter App, CRM Dashboard, Landing Site..."
                          className="w-full px-3 py-2.5 bg-[#080808] border border-[#262626] rounded-xl text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none"
                          autoFocus
                        />
                      </div>

                      <div>
                        <label className="text-[12px] text-[#737373] font-medium block mb-1.5">Project Type</label>
                        <select
                          value={projectType}
                          onChange={(e) => setProjectType(e.target.value)}
                          className="w-full px-3 py-2.5 bg-[#080808] border border-[#262626] rounded-xl text-[13px] text-[#fafafa] focus:border-[#22c55e] focus:outline-none"
                        >
                          {PROJECT_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {PROJECT_TYPE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setProjectType(option.value)}
                          className={`text-left rounded-2xl border px-3.5 py-3 transition-colors ${
                            projectType === option.value
                              ? 'border-[#22c55e] bg-[#22c55e]/8'
                              : 'border-[#262626] bg-[#0a0a0a] hover:border-[#333]'
                          }`}
                        >
                          <div className="text-[12px] font-medium text-[#fafafa]">{option.label}</div>
                          <div className="text-[10px] text-[#6b7280] mt-1 leading-5">{option.hint}</div>
                        </button>
                      ))}
                    </div>

                    <div>
                      <label className="text-[12px] text-[#737373] font-medium block mb-1.5">What do you want to build?</label>
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Describe the product, user flow, and the outcome you expect. Example: A simple counter app with increment, decrement, reset, keyboard-friendly controls, and a clean mobile layout."
                        rows={6}
                        className="w-full px-3 py-3 bg-[#080808] border border-[#262626] rounded-xl text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none resize-none leading-6"
                      />
                      <p className="text-[11px] text-[#525252] mt-2">
                        Planner bu metni proje gereksinimi, kapsam ve başarı kriteri olarak yorumlar.
                      </p>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                      <label className="flex items-start gap-3 rounded-xl border border-[#262626] bg-[#090909] px-3.5 py-3.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={previewEnabled}
                          onChange={(e) => setPreviewEnabled(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-[#333] bg-[#111111] text-[#22c55e] focus:ring-[#22c55e]"
                        />
                        <div>
                          <div className="text-[12px] font-medium text-[#fafafa]">Preview / Run App gerekli</div>
                          <div className="text-[11px] text-[#525252] mt-1 leading-5">
                            Uygulamayı studio içinde çalıştırıp incelemek istiyorsan açık bırak.
                          </div>
                        </div>
                      </label>

                      <div className="rounded-xl border border-[#262626] bg-[#090909] px-4 py-4">
                        <label className="text-[12px] text-[#737373] font-medium block mb-1.5">Technology Preference</label>
                        <input
                          type="text"
                          value={techPreferenceInput}
                          onChange={(e) => setTechPreferenceInput(e.target.value)}
                          placeholder="React, Next.js, Supabase, Tailwind..."
                          className="w-full px-3 py-2.5 bg-[#080808] border border-[#262626] rounded-xl text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none"
                        />
                        <p className="text-[11px] text-[#525252] mt-2 leading-5">
                          Bilmiyorsan boş bırak. Planner önerir; onaylı plandan sonra gerçek tech stack projeye yazılır.
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {step === 2 && (
                <div className="rounded-2xl border border-[#1f1f1f] bg-[#0d0d0d] px-5 py-5 space-y-5">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280] mb-2">Step 2</p>
                    <h3 className="text-[15px] font-semibold text-[#fafafa]">Planlamadan önce takımı kur.</h3>
                    <p className="text-[12px] leading-6 text-[#737373] mt-2 max-w-2xl">
                      İstersen sistem brief’e göre uygun takımı önerir, istersen manuel seçersin. Planner detaylı task planını
                      bu somut takım yapısına göre üretir.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <div className="inline-flex rounded-xl border border-[#262626] bg-[#0a0a0a] p-1">
                      <button
                        type="button"
                        onClick={() => setTeamMode('auto')}
                        className={`px-3 py-2 rounded-lg text-[12px] font-medium transition-colors ${
                          teamMode === 'auto'
                            ? 'bg-[#22c55e] text-[#0a0a0a]'
                            : 'text-[#a3a3a3] hover:text-[#fafafa]'
                        }`}
                      >
                        Team Architect
                      </button>
                      <button
                        type="button"
                        onClick={() => setTeamMode('manual')}
                        className={`px-3 py-2 rounded-lg text-[12px] font-medium transition-colors ${
                          teamMode === 'manual'
                            ? 'bg-[#3b82f6] text-white'
                            : 'text-[#a3a3a3] hover:text-[#fafafa]'
                        }`}
                      >
                        Ben seçeceğim
                      </button>
                    </div>
                    <div className="text-[11px] text-[#6b7280]">
                      Current: <span className="text-[#d4d4d8]">{selectedTeamName}</span>
                    </div>
                  </div>

                  {teamMode === 'auto' && recommendation.candidate && (
                    <div className="rounded-2xl border border-[#22c55e]/30 bg-[#22c55e]/5 px-5 py-5 space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#86efac] mb-2">Team Architect</div>
                          <div className="text-[15px] font-semibold text-[#fafafa]">
                            {architectRecommendedTeam?.name ?? architectCustomTeam?.name ?? recommendation.candidate.name}
                          </div>
                          <p className="text-[12px] leading-6 text-[#a7f3d0] mt-2">
                            {architectRecommendation?.reasoning?.[0] ?? recommendation.reason}
                          </p>
                        </div>
                        <div className="rounded-full border border-[#22c55e]/30 px-2.5 py-1 text-[10px] font-medium text-[#86efac]">
                          {architectCustomTeam ? 'Custom' : (architectRecommendedTeam?.source === 'custom' || recommendation.candidate.source === 'custom') ? 'Custom' : 'Preset'}
                        </div>
                      </div>
                      <p className="text-[11px] text-[#737373] leading-5">
                        {architectCustomTeam?.description ?? architectRecommendedTeam?.description ?? recommendation.candidate.description}
                      </p>
                      <TeamRosterPreview
                        roles={architectCustomTeam?.roles ?? architectRecommendedTeam?.roles ?? recommendation.candidate.roles}
                        presetAgents={presetAgents}
                        limit={6}
                        columns="wide"
                      />

                      <div className="rounded-2xl border border-[#1f1f1f] bg-[#0c0c0c] p-4">
                        <div className="text-[11px] font-medium text-[#a3a3a3] mb-3">Conversation</div>
                        <div className="space-y-3 max-h-[280px] overflow-y-auto pr-1">
                          {architectMessages.map((message, index) => {
                            const displayContent = message.role === 'assistant'
                              ? message.content.replace(/```team-json\s*\n[\s\S]*?\n```/g, '').trim()
                              : message.content;
                            if (!displayContent) return null;
                            return (
                              <div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[12px] leading-6 whitespace-pre-wrap ${
                                  message.role === 'user'
                                    ? 'bg-[#1f3d2a] text-[#e5e7eb]'
                                    : 'bg-[#151515] border border-[#262626] text-[#d4d4d8]'
                                }`}>
                                  {displayContent}
                                </div>
                              </div>
                            );
                          })}
                          {architectStreaming && (
                            <div className="flex justify-start">
                              <div className="max-w-[85%] rounded-2xl px-3 py-2 text-[12px] leading-6 bg-[#151515] border border-[#262626] text-[#d4d4d8] whitespace-pre-wrap">
                                {architectStreamText.replace(/```team-json\s*\n[\s\S]*?\n```/g, '').trim() || 'Thinking...'}
                              </div>
                            </div>
                          )}
                        </div>
                        {architectError && (
                          <div className="mt-3 rounded-xl border border-[#7f1d1d] bg-[#450a0a]/30 px-3 py-2 text-[11px] text-[#fca5a5]">
                            {architectError}
                          </div>
                        )}
                        {architectRecommendation?.followUpQuestions && architectRecommendation.followUpQuestions.length > 0 && (
                          <div className="mt-3 text-[11px] text-[#a3a3a3]">
                            Team Architect asks: {architectRecommendation.followUpQuestions.join(' / ')}
                          </div>
                        )}
                        <div className="mt-3 flex gap-2">
                          <input
                            value={architectInput}
                            onChange={(e) => setArchitectInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                sendArchitectMessage(architectInput);
                              }
                            }}
                            placeholder="Team Architect'a cevap ver..."
                            className="flex-1 px-3 py-2 bg-[#080808] border border-[#262626] rounded-xl text-[12px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => sendArchitectMessage(architectInput)}
                            disabled={!architectInput.trim() || architectStreaming}
                            className="px-3 py-2 rounded-xl text-[12px] font-medium bg-[#22c55e] text-[#0a0a0a] disabled:opacity-50"
                          >
                            Send
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {teamMode === 'manual' && (
                    <div className="grid gap-3 xl:grid-cols-2">
                      {teamCandidates.map((team) => (
                        <button
                          key={team.id}
                          type="button"
                          onClick={() => setSelectedTemplate(team.id)}
                          className={`text-left p-4 rounded-2xl border transition-colors ${
                            selectedTemplate === team.id
                              ? 'border-[#3b82f6] bg-[#3b82f6]/6'
                              : 'border-[#262626] bg-[#0a0a0a] hover:border-[#333]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[13px] font-medium text-[#fafafa]">{team.name}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                              team.source === 'custom'
                                ? 'border-[#3b82f6]/30 text-[#93c5fd]'
                                : 'border-[#262626] text-[#6b7280]'
                            }`}>
                              {team.source === 'custom' ? 'Custom' : 'Preset'}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#737373] mt-1.5 leading-5">{team.description}</p>
                          <TeamRosterPreview roles={team.roles} presetAgents={presetAgents} columns="wide" />
                        </button>
                      ))}
                    </div>
                  )}

                  {plannerAgents.length > 0 && (
                    <div>
                      <label className="text-[12px] text-[#737373] font-medium block mb-1.5">Planner</label>
                      <select
                        value={selectedPlanner}
                        onChange={(e) => setSelectedPlanner(e.target.value)}
                        className="w-full px-3 py-2.5 bg-[#080808] border border-[#262626] rounded-xl text-[13px] text-[#fafafa] focus:border-[#22c55e] focus:outline-none"
                      >
                        {plannerAgents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.name} — {roleLabel(agent.role)}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-[#525252] mt-2">
                        Planner her projede zorunlu; bu seçim planning persona’sını belirler.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-4 lg:sticky lg:top-0 self-start">
              <div className="rounded-2xl border border-[#1f1f1f] bg-[linear-gradient(180deg,#101010_0%,#0a0a0a_100%)] px-5 py-5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280] mb-3">Summary</p>
                <div className="space-y-3 text-[12px]">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[#525252]">Project</span>
                    <span className="text-[#fafafa] text-right">{name.trim() || 'Untitled project'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[#525252]">Type</span>
                    <span className="text-[#fafafa] text-right capitalize">{projectType.replace(/-/g, ' ')}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[#525252]">Team</span>
                    <span className="text-[#fafafa] text-right">{selectedTeamName}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[#525252]">Planner</span>
                    <span className="text-[#fafafa] text-right">{selectedPlannerAgent?.name ?? 'Not selected'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[#525252]">Preview</span>
                    <span className={previewEnabled ? 'text-[#22c55e]' : 'text-[#a3a3a3]'}>
                      {previewEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-[#525252]">Tech pref</span>
                    <span className="text-[#fafafa] text-right">{techPreference.join(', ') || 'Planner decides'}</span>
                  </div>
                </div>
                {selectedTeam && (
                  <div className="mt-4 pt-4 border-t border-[#1f1f1f]">
                    <div className="text-[11px] font-medium text-[#a3a3a3] mb-2">Selected Team</div>
                    <TeamRosterPreview
                      roles={selectedTeam.roles.slice(0, 6)}
                      presetAgents={presetAgents}
                      limit={3}
                      columns="compact"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[#1f1f1f] shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13px] text-[#a3a3a3] hover:text-[#fafafa] border border-[#262626] hover:border-[#333] transition-colors"
          >
            Cancel
          </button>
          {step === 2 && (
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2 rounded-lg text-[13px] text-[#a3a3a3] hover:text-[#fafafa] border border-[#262626] hover:border-[#333] transition-colors"
            >
              Back
            </button>
          )}
          {step === 1 ? (
            <button
              onClick={() => setStep(2)}
              disabled={!canContinueToTeam}
              className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Continue to Team
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!name.trim() || loading}
              className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Creating...' : 'Create Project'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import project modal
// ---------------------------------------------------------------------------

function ImportProjectModal({ onClose, onImport }: {
  onClose: () => void;
  onImport: (project: Project) => void;
}) {
  const [name, setName] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [templates, setTemplates] = useState<TeamTemplate[]>([]);
  const [presetAgents, setPresetAgents] = useState<AgentConfig[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [plannerAgents, setPlannerAgents] = useState<AgentConfig[]>([]);
  const [selectedPlanner, setSelectedPlanner] = useState<string>('');
  const [previewEnabled, setPreviewEnabled] = useState(true);

  useEffect(() => {
    fetchTeamTemplates().then(setTemplates).catch(() => {});
    fetchPresetAgents()
      .then((agents) => {
        setPresetAgents(agents);
        const planners = agents.filter((agent) => agent.role === 'product-owner' || agent.role === 'pm');
        setPlannerAgents(planners);
        if (planners.length > 0) setSelectedPlanner(planners[0].id);
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async () => {
    if (!name.trim() || !repoPath.trim()) return;
    setLoading(true);
    setError('');
    try {
      const project = await importProject({
        name: name.trim(),
        repoPath: repoPath.trim(),
        teamTemplateId: selectedTemplate || undefined,
        plannerAgentId: selectedPlanner || undefined,
        previewEnabled,
      });
      onImport(project);
    } catch (err: any) {
      setError(err?.message || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#111111] border border-[#262626] rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-6 pb-5 border-b border-[#1f1f1f] shrink-0">
          <h2 className="text-[16px] font-semibold text-[#fafafa]">Import Project</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#1f1f1f] text-[#525252] hover:text-[#a3a3a3]">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <div className="text-[12px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="block text-[12px] text-[#a3a3a3] mb-1.5">Project Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My App"
              className="w-full px-3 py-2 rounded-lg bg-[#0a0a0a] border border-[#262626] text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[12px] text-[#a3a3a3] mb-1.5">Repository Path</label>
            <input
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              placeholder="/Users/you/projects/my-app"
              className="w-full px-3 py-2 rounded-lg bg-[#0a0a0a] border border-[#262626] text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none font-mono"
            />
            <p className="text-[11px] text-[#525252] mt-1">Absolute path to existing local repository</p>
          </div>

          {/* Team template picker */}
          {templates.length > 0 && (
            <div>
              <label className="block text-[12px] text-[#a3a3a3] mb-1.5">Team Template</label>
              <div className="space-y-2">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTemplate(selectedTemplate === t.id ? '' : t.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                      selectedTemplate === t.id
                        ? 'border-[#22c55e] bg-[#22c55e]/5'
                        : 'border-[#262626] hover:border-[#333]'
                    }`}
                  >
                    <p className="text-[12px] font-medium text-[#fafafa]">{t.name}</p>
                    <p className="text-[11px] text-[#737373] mt-0.5">{t.description}</p>
                    <TeamRosterPreview roles={t.roles} presetAgents={presetAgents} limit={3} columns="compact" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {plannerAgents.length > 0 && (
            <div>
              <label className="block text-[12px] text-[#a3a3a3] mb-1.5">Planner</label>
              <select
                value={selectedPlanner}
                onChange={(e) => setSelectedPlanner(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#0a0a0a] border border-[#262626] text-[13px] text-[#fafafa] focus:border-[#22c55e] focus:outline-none"
              >
                {plannerAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} — {roleLabel(agent.role)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <label className="flex items-start gap-3 rounded-lg border border-[#262626] bg-[#0a0a0a] px-3 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={previewEnabled}
              onChange={(e) => setPreviewEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[#333] bg-[#111111] text-[#22c55e] focus:ring-[#22c55e]"
            />
            <div>
              <div className="text-[12px] font-medium text-[#fafafa]">Preview / Run App gerekli</div>
              <div className="text-[11px] text-[#525252] mt-1">
                Sadece repo içinden preview bekliyorsan açık bırak. Aksi halde Preview sekmesi gizlenir.
              </div>
            </div>
          </label>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[#1f1f1f] shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13px] text-[#a3a3a3] hover:text-[#fafafa] border border-[#262626] hover:border-[#333] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || !repoPath.trim() || loading}
            className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Importing...' : 'Import Project'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template project modal
// ---------------------------------------------------------------------------

function TemplateProjectModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (project: Project) => void;
}) {
  const [name, setName] = useState('');
  const [templates, setTemplates] = useState<ProjectTemplateInfo[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [plannerAgents, setPlannerAgents] = useState<AgentConfig[]>([]);
  const [selectedPlanner, setSelectedPlanner] = useState<string>('');
  const [previewEnabled, setPreviewEnabled] = useState(true);

  useEffect(() => {
    fetchProjectTemplates().then((t) => {
      setTemplates(t);
      if (t.length > 0) setSelectedTemplate(t[0].id);
    }).catch(() => {});
    fetchPresetAgents()
      .then((agents) => {
        const planners = agents.filter((agent) => agent.role === 'product-owner' || agent.role === 'pm');
        setPlannerAgents(planners);
        if (planners.length > 0) setSelectedPlanner(planners[0].id);
      })
      .catch(() => {});
  }, []);

  const selected = templates.find((t) => t.id === selectedTemplate);

  const handleSubmit = async () => {
    if (!name.trim() || !selectedTemplate) return;
    setLoading(true);
    setError('');
    try {
      const project = await createProjectFromTemplate({
        name: name.trim(),
        templateId: selectedTemplate,
        plannerAgentId: selectedPlanner || undefined,
        previewEnabled,
      });
      onCreate(project);
    } catch (err: any) {
      setError(err?.message || 'Failed to create project');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#111111] border border-[#262626] rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-6 pb-5 border-b border-[#1f1f1f] shrink-0">
          <h2 className="text-[16px] font-semibold text-[#fafafa]">New from Template</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#1f1f1f] text-[#525252] hover:text-[#a3a3a3]">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <div className="text-[12px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="block text-[12px] text-[#a3a3a3] mb-1.5">Project Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My App"
              className="w-full px-3 py-2 rounded-lg bg-[#0a0a0a] border border-[#262626] text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none"
            />
          </div>

          {/* Template picker */}
          <div>
            <label className="block text-[12px] text-[#a3a3a3] mb-1.5">Template</label>
            <div className="space-y-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedTemplate(t.id)}
                  className={`w-full text-left px-3 py-3 rounded-lg border transition-colors ${
                    selectedTemplate === t.id
                      ? 'border-[#22c55e] bg-[#22c55e]/5'
                      : 'border-[#262626] hover:border-[#333]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] font-medium text-[#fafafa]">{t.name}</p>
                    <span className="text-[10px] text-[#525252]">{t.teamTemplate}</span>
                  </div>
                  <p className="text-[11px] text-[#737373] mt-0.5">{t.description}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {t.techStack.map((tech) => (
                      <span key={tech} className="text-[10px] px-1.5 py-0.5 rounded bg-[#1f1f1f] text-[#a3a3a3] border border-[#262626]">
                        {tech}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {selected && (
            <div className="text-[11px] text-[#525252]">
              Team: <span className="text-[#a3a3a3]">{selected.teamTemplate}</span> &middot;
              Tech: <span className="text-[#a3a3a3]">{selected.techStack.join(', ')}</span>
            </div>
          )}

          {plannerAgents.length > 0 && (
            <div>
              <label className="block text-[12px] text-[#a3a3a3] mb-1.5">Planner</label>
              <select
                value={selectedPlanner}
                onChange={(e) => setSelectedPlanner(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#0a0a0a] border border-[#262626] text-[13px] text-[#fafafa] focus:border-[#22c55e] focus:outline-none"
              >
                {plannerAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} — {roleLabel(agent.role)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <label className="flex items-start gap-3 rounded-lg border border-[#262626] bg-[#0a0a0a] px-3 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={previewEnabled}
              onChange={(e) => setPreviewEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[#333] bg-[#111111] text-[#22c55e] focus:ring-[#22c55e]"
            />
            <div>
              <div className="text-[12px] font-medium text-[#fafafa]">Preview / Run App gerekli</div>
              <div className="text-[11px] text-[#525252] mt-1">
                Template projelerde de preview ihtiyacı proje seviyesinde ayrı tutulur.
              </div>
            </div>
          </label>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[#1f1f1f] shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13px] text-[#a3a3a3] hover:text-[#fafafa] border border-[#262626] hover:border-[#333] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || !selectedTemplate || loading}
            className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Creating...' : 'Create from Template'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function StudioHomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    try {
      const data = await fetchProjects();
      setProjects(data);
    } catch {
      // API not ready yet
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this project?')) return;
    await deleteProject(id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <div className="p-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#fafafa]">Oscorpex</h1>
          <p className="text-sm text-[#737373] mt-1">
            Describe your idea, let AI agents build it
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium border border-[#262626] text-[#a3a3a3] hover:text-[#fafafa] hover:border-[#333] transition-colors"
          >
            <FolderInput size={16} />
            Import
          </button>
          <button
            onClick={() => setShowTemplate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium border border-[#262626] text-[#a3a3a3] hover:text-[#fafafa] hover:border-[#333] transition-colors"
          >
            <LayoutTemplate size={16} />
            Template
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] transition-colors"
          >
            <Plus size={16} />
            New Project
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="text-[#525252] animate-spin" />
        </div>
      ) : projects.length === 0 ? (
        <div className="bg-[#111111] border border-[#262626] rounded-xl p-16 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#1f1f1f] flex items-center justify-center mb-4">
            <Code2 size={28} className="text-[#333]" />
          </div>
          <h3 className="text-[15px] font-medium text-[#a3a3a3] mb-1">No projects yet</h3>
          <p className="text-[13px] text-[#525252] max-w-sm mb-4">
            Create your first project and start planning with AI Planner. Your AI dev team will handle the rest.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors"
          >
            <Plus size={14} />
            Create Project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onOpen={() => navigate(`/studio/${project.id}`)}
              onDelete={() => handleDelete(project.id)}
            />
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreate={(project) => {
            setProjects((prev) => [project, ...prev]);
            setShowCreate(false);
            navigate(`/studio/${project.id}`);
          }}
        />
      )}

      {/* Import modal */}
      {showImport && (
        <ImportProjectModal
          onClose={() => setShowImport(false)}
          onImport={(project) => {
            setProjects((prev) => [project, ...prev]);
            setShowImport(false);
            navigate(`/studio/${project.id}`);
          }}
        />
      )}

      {/* Template modal */}
      {showTemplate && (
        <TemplateProjectModal
          onClose={() => setShowTemplate(false)}
          onCreate={(project) => {
            setProjects((prev) => [project, ...prev]);
            setShowTemplate(false);
            navigate(`/studio/${project.id}`);
          }}
        />
      )}
    </div>
  );
}
