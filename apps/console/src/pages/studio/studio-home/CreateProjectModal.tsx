import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import {
	applyProjectTeam,
	approveProjectScope,
	createProject,
	createCustomTeam,
	fetchTeamTemplates,
	fetchCustomTeams,
	fetchPresetAgents,
	recommendProjectTeam,
	roleLabel,
	saveProjectScopeDraft,
	streamTeamArchitectChat,
	type AgentConfig,
	type ArchitectMessage,
	type Project,
	type TeamTemplate,
	type CustomTeamTemplate,
	type TeamArchitectIntake,
} from '../../../lib/studio-api';
import AgentAvatarImg from '../../../components/AgentAvatar';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TeamCandidate = {
	id: string;
	name: string;
	description: string;
	roles: string[];
	source: 'preset' | 'custom';
};

export type TeamRecommendation = {
	candidate: TeamCandidate | null;
	reason: string;
};

export type TeamArchitectRecommendation = {
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PROJECT_TYPE_OPTIONS = [
	{ value: 'web-app', label: 'Web app', hint: 'User-facing product or SaaS app' },
	{ value: 'dashboard', label: 'Dashboard', hint: 'Admin panel or internal analytics UI' },
	{ value: 'landing-page', label: 'Landing page', hint: 'Marketing site or presentation page' },
	{ value: 'api-service', label: 'API / backend', hint: 'Service, backend or integration layer' },
	{ value: 'internal-tool', label: 'Internal tool', hint: 'Ops, CRM or business workflow app' },
	{ value: 'automation', label: 'Automation', hint: 'Agents, workflows or scheduled jobs' },
	{ value: 'unknown', label: 'Not sure yet', hint: 'Planner should infer the direction' },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function resolveTeamMember(role: string, presetAgents: AgentConfig[]) {
	const preset = presetAgents.find((agent) => agent.role === role);
	return {
		role,
		name: preset?.name ?? roleLabel(role),
		title: roleLabel(role),
		avatar: preset?.avatar ?? roleLabel(role).slice(0, 1).toUpperCase(),
	};
}

function hasAnyRole(roles: string[], candidates: string[]): boolean {
	return roles.some((role) => candidates.includes(role));
}

export function buildTeamCandidates(templates: TeamTemplate[], customTeams: CustomTeamTemplate[]): TeamCandidate[] {
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

export function recommendTeamCandidate(
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

		if (
			context.previewEnabled &&
			(context.projectType === 'landing-page' || context.projectType === 'web-app' || context.projectType === 'dashboard')
		) {
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
		reason = 'Frontend-heavy team recommended for landing page projects.';
	} else if (context.projectType === 'api-service' && best.hasBackend) {
		reason = 'Backend-focused team recommended for API service projects.';
	} else if (
		(context.projectType === 'dashboard' || context.projectType === 'web-app') &&
		best.hasFrontend &&
		best.hasBackend
	) {
		reason = 'Balanced product team recommended for both UI and application logic.';
	} else if (context.projectType === 'automation' && (best.hasBackend || best.hasDevops)) {
		reason = 'Backend/ops team selected for automation and workflow tasks.';
	} else if (context.previewEnabled && best.hasFrontend) {
		reason = 'Frontend-focused team preferred for preview-enabled projects.';
	}

	return { candidate: best.candidate, reason };
}

export function parseTeamArchitectRecommendation(text: string): TeamArchitectRecommendation | null {
	const match = text.match(/```team-json\s*\n([\s\S]*?)\n```/);
	if (!match) return null;
	try {
		return JSON.parse(match[1]) as TeamArchitectRecommendation;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// TeamRosterPreview
// ---------------------------------------------------------------------------

export function TeamRosterPreview({
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

// ---------------------------------------------------------------------------
// CreateProjectModal
// ---------------------------------------------------------------------------

export function CreateProjectModal({
	onClose,
	onCreate,
}: {
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
	const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
	const [teamMode, setTeamMode] = useState<'auto' | 'manual'>('auto');
	const [architectMessages, setArchitectMessages] = useState<ArchitectMessage[]>([]);
	const [architectInput, setArchitectInput] = useState('');
	const [architectStreaming, setArchitectStreaming] = useState(false);
	const [architectStreamText, setArchitectStreamText] = useState('');
	const [architectRecommendation, setArchitectRecommendation] = useState<TeamArchitectRecommendation | null>(null);
	const [architectError, setArchitectError] = useState<string | null>(null);
	const [createdProject, setCreatedProject] = useState<Project | null>(null);
	const [scopeApproved, setScopeApproved] = useState(false);
	const [backendRecommendation, setBackendRecommendation] = useState<{
		decision: 'recommend-existing' | 'recommend-custom' | 'need-more-info';
		teamTemplateId?: string;
		reasoning?: string;
		templateName?: string;
	} | null>(null);
	const [teamApplied, setTeamApplied] = useState(false);
	const [teamConfirmed, setTeamConfirmed] = useState(false);

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
			setTeamConfirmed(false);
		}
	}, [teamMode, recommendationId, selectedTemplate]);

	const architectCustomTeam =
		architectRecommendation?.decision === 'recommend-custom' ? architectRecommendation.customTeam : null;
	const architectRecommendedTeam =
		architectRecommendation?.decision === 'recommend-existing'
			? (teamCandidates.find((team) => team.id === architectRecommendation.teamTemplateId) ?? null)
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
			: (recommendation.candidate ?? null));
	const selectedTeamName = selectedTeam?.name ?? 'Planner will choose a default team';
	const selectedPlannerAgent = plannerAgents.find((agent) => agent.id === selectedPlanner) ?? plannerAgents[0] ?? null;
	const effectiveTeamTemplateId =
		teamMode === 'auto'
			? (architectRecommendedTeam?.id || recommendation.candidate?.id || selectedTemplate || undefined)
			: (selectedTemplate || undefined);
	const canCreateShell = name.trim().length > 0 && description.trim().length >= 10;
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
						setTeamConfirmed(false);
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
		if (step !== 2 || architectMessages.length > 0 || architectStreaming) return;
		const desc = description.trim();
		const hasTech = techPreference.length > 0;
		const techInfo = hasTech ? `\nKullanıcının teknoloji tercihi: ${techPreference.join(', ')}` : '';
		const prompt = `Yeni proje intake:\nProje adı: ${name}\nAçıklama: ${desc}${techInfo}\n\nLütfen projeyi anlamak için kullanıcıya sorular sor. İlk mesajda takım önerme — önce projeyi anla.`;
		sendArchitectMessage(prompt);
	}, [step]);

	const handleCreateShell = async () => {
		if (!name.trim()) return;
		setLoading(true);
		try {
			const project = await createProject({
				name: name.trim(),
				description: description.trim(),
				projectType,
				techPreference,
				plannerAgentId: selectedPlanner || undefined,
				previewEnabled,
			});
			setCreatedProject(project);
			setStep(2);
		} catch (err) {
			console.error('Failed to create project shell:', err);
		} finally {
			setLoading(false);
		}
	};

	const handleSaveScopeDraft = async () => {
		if (!createdProject) return;
		setLoading(true);
		try {
			await saveProjectScopeDraft(createdProject.id, {
				problemStatement: description.trim(),
				goals: [],
				nonGoals: [],
				constraints: [],
				risks: [],
				acceptanceCriteria: [],
				validationPlan: [],
				requiredCapabilities: techPreference,
				recommendedTeamRoles: selectedTeam?.roles ?? [],
				status: 'ready_for_review',
			});
			setStep(3);
		} catch (err) {
			console.error('Failed to save scope draft:', err);
		} finally {
			setLoading(false);
		}
	};

	const handleApproveScope = async () => {
		if (!createdProject) return;
		setLoading(true);
		try {
			await approveProjectScope(createdProject.id);
			setScopeApproved(true);
			const recommendationResult = await recommendProjectTeam(createdProject.id);
			setBackendRecommendation(recommendationResult);
			if (recommendationResult.decision === 'recommend-existing' && recommendationResult.teamTemplateId) {
				setSelectedTemplate(recommendationResult.teamTemplateId);
				setTeamConfirmed(false);
			}
			setStep(4);
		} catch (err) {
			console.error('Failed to approve scope or fetch team recommendation:', err);
		} finally {
			setLoading(false);
		}
	};

	const handleContinueToApply = () => {
		setStep(5);
	};

	const handleApplyTeam = async () => {
		if (!createdProject) return;
		setLoading(true);
		try {
			let teamTemplateId = effectiveTeamTemplateId || backendRecommendation?.teamTemplateId;
			if (!teamTemplateId && architectCustomTeam) {
				const customTeam = await createCustomTeam({
					name: architectCustomTeam.name,
					description: architectCustomTeam.description,
					roles: architectCustomTeam.roles,
					dependencies: [],
				});
				teamTemplateId = customTeam.id;
			}
			await applyProjectTeam(createdProject.id, {
				teamTemplateId,
				customTeam: !teamTemplateId && architectCustomTeam ? architectCustomTeam : undefined,
				plannerAgentId: selectedPlanner || undefined,
			});
			setTeamApplied(true);
			onCreate(createdProject);
		} catch (err) {
			console.error('Failed to apply team:', err);
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
						<p className="text-[12px] text-[#6b7280] mt-1">Project shell, scope approval, recommendation ve team apply adımları.</p>
					</div>
					<button onClick={onClose} className="p-1 rounded hover:bg-[#1f1f1f] text-[#525252] hover:text-[#a3a3a3]">
						<X size={18} />
					</button>
				</div>

				<div className="overflow-y-auto flex-1 px-6 py-6">
					<div className="mb-6 flex items-center gap-3">
						{[
							{ id: 1, title: 'Project Shell', caption: 'Create base project' },
							{ id: 2, title: 'Scoping Interview', caption: 'Clarify scope with agent' },
							{ id: 3, title: 'Scope Review', caption: 'Approve contract' },
							{ id: 4, title: 'Team Recommendation', caption: 'Select team strategy' },
							{ id: 5, title: 'Team Apply', caption: 'Apply team and finish' },
						].map((item) => {
							const active = step === item.id;
							const complete = step > item.id;
							return (
								<div key={item.id} className="flex items-center gap-3">
									<div
										className={`flex h-9 w-9 items-center justify-center rounded-full border text-[12px] font-semibold ${
											active
												? 'border-[#22c55e] bg-[#22c55e]/10 text-[#22c55e]'
												: complete
													? 'border-[#3b82f6] bg-[#3b82f6]/10 text-[#93c5fd]'
													: 'border-[#2a2a2a] bg-[#111111] text-[#6b7280]'
										}`}
									>
										{item.id}
									</div>
									<div className="min-w-[120px]">
										<div className={`text-[12px] font-medium ${active ? 'text-[#fafafa]' : 'text-[#a3a3a3]'}`}>
											{item.title}
										</div>
										<div className="text-[10px] text-[#525252]">{item.caption}</div>
									</div>
									{item.id < 5 && <div className="hidden sm:block h-px w-6 bg-[#262626]" />}
								</div>
							);
						})}
					</div>
					<div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_360px]">
						<div className="space-y-6">
							{step === 1 && (
								<>
									<div className="rounded-2xl border border-[#1f1f1f] bg-[linear-gradient(180deg,#121212_0%,#0a0a0a_100%)] px-6 py-6">
										<div className="flex items-center gap-3 mb-4">
											<div className="w-10 h-10 rounded-xl bg-[#22c55e]/10 flex items-center justify-center">
												<span className="text-[#22c55e] text-lg">+</span>
											</div>
											<div>
												<h3 className="text-[16px] font-semibold text-[#fafafa]">Yeni Proje</h3>
												<p className="text-[12px] text-[#737373]">Fikrini anlat, gerisini biz halledelim</p>
											</div>
										</div>

										<div className="space-y-5">
											<div>
												<label className="text-[12px] text-[#a3a3a3] font-medium block mb-2">Proje Adı</label>
												<input
													type="text"
													value={name}
													onChange={(e) => setName(e.target.value)}
													placeholder="Örn: Todo App, E-Ticaret Sitesi, Blog Platformu..."
													className="w-full px-4 py-3 bg-[#080808] border border-[#262626] rounded-xl text-[14px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none transition-colors"
													autoFocus
												/>
											</div>

											<div>
												<label className="text-[12px] text-[#a3a3a3] font-medium block mb-2">Proje Tipi</label>
												<select
													value={projectType}
													onChange={(e) => setProjectType(e.target.value)}
													className="w-full px-4 py-3 bg-[#080808] border border-[#262626] rounded-xl text-[14px] text-[#fafafa] focus:border-[#22c55e] focus:outline-none transition-colors"
												>
													{PROJECT_TYPE_OPTIONS.map((option) => (
														<option key={option.value} value={option.value}>
															{option.label} — {option.hint}
														</option>
													))}
												</select>
											</div>

											<div>
												<label className="text-[12px] text-[#a3a3a3] font-medium block mb-2">Ne yapmak istiyorsunuz?</label>
												<textarea
													value={description}
													onChange={(e) => setDescription(e.target.value)}
													placeholder={"Projenizi kendi cümlelerinizle anlatın. Teknik detay gerekmez.\n\nÖrnek: Kullanıcıların yapılacak işlerini ekleyip takip edebileceği basit bir uygulama. Filtreleme ve tamamlananları silme özelliği olsun."}
													rows={5}
													className="w-full px-4 py-3 bg-[#080808] border border-[#262626] rounded-xl text-[14px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none resize-none leading-7 transition-colors"
												/>
												{description.trim().length > 0 && description.trim().length < 10 && (
													<p className="text-[11px] text-[#f59e0b] mt-1.5">En az 10 karakter gerekli ({description.trim().length}/10)</p>
												)}
												{description.trim().length >= 10 && (
													<p className="text-[11px] text-[#525252] mt-1.5">Sonraki adımda PM asistanı sizinle detayları konuşacak</p>
												)}
											</div>
										</div>
									</div>
								</>
							)}

							{step === 2 && (
								<div className="rounded-2xl border border-[#1f1f1f] bg-[#0d0d0d] px-5 py-5 space-y-5">
									<div>
										<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280] mb-2">Step 2 — Scoping Interview</p>
										<h3 className="text-[15px] font-semibold text-[#fafafa]">Projenizi birlikte tanımlayalım</h3>
										<p className="text-[12px] leading-6 text-[#737373] mt-2 max-w-2xl">
											PM asistanı projenizi anlamak için birkaç soru soracak. Teknik bilgi gerekmez — sadece ne istediğinizi anlatın.
										</p>
									</div>
									<div className="rounded-2xl border border-[#1f1f1f] bg-[#0c0c0c] p-4">
										<div className="text-[11px] font-medium text-[#a3a3a3] mb-3">Conversation</div>
										<div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
											{architectMessages.map((message, index) => {
												const displayContent =
													message.role === 'assistant'
														? message.content.replace(/```team-json\s*\n[\s\S]*?\n```/g, '').trim()
														: message.content;
												if (!displayContent) return null;
												return (
													<div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
														<div
															className={`max-w-[85%] rounded-2xl px-3 py-2 text-[12px] leading-6 whitespace-pre-wrap ${
																message.role === 'user'
																	? 'bg-[#1f3d2a] text-[#e5e7eb]'
																	: 'bg-[#151515] border border-[#262626] text-[#d4d4d8]'
															}`}
														>
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
												placeholder="Soruları yanıtlayın veya projeniz hakkında detay ekleyin..."
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

							{step === 3 && (
								<div className="rounded-2xl border border-[#1f1f1f] bg-[#0d0d0d] px-5 py-5 space-y-4">
									<div>
										<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280] mb-2">Step 3 — Scope Contract Review</p>
										<h3 className="text-[15px] font-semibold text-[#fafafa]">Scope contract onayı zorunlu.</h3>
									</div>
									<div className="rounded-xl border border-[#262626] bg-[#090909] px-4 py-4 space-y-2 text-[12px]">
										<div className="text-[#525252]">Problem Statement</div>
										<div className="text-[#fafafa]">{description.trim() || 'No description provided.'}</div>
										<div className="pt-2 text-[#525252]">Required capabilities</div>
										<div className="text-[#fafafa]">{techPreference.join(', ') || 'Not specified'}</div>
										<div className="pt-2 text-[#525252]">Candidate roles</div>
										<div className="text-[#fafafa]">{selectedTeam?.roles.join(', ') || 'No inferred roles yet'}</div>
									</div>
									<div className="text-[11px] text-[#737373]">
										Bu adımı onaylamadan team recommendation ekranı açılmaz.
									</div>
								</div>
							)}

							{step === 4 && (
								<div className="rounded-2xl border border-[#1f1f1f] bg-[#0d0d0d] px-5 py-5 space-y-5">
									<div>
										<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280] mb-2">Step 4 — Team Recommendation</p>
										<h3 className="text-[15px] font-semibold text-[#fafafa]">Planlamadan önce takımı kur.</h3>
										<p className="text-[12px] leading-6 text-[#737373] mt-2 max-w-2xl">
											Scope approval sonrası backend recommendation burada görünür. İstersen manuel override yapabilirsin.
										</p>
									</div>
									{backendRecommendation && (
										<div className="rounded-xl border border-[#22c55e]/30 bg-[#22c55e]/5 px-3 py-2 text-[12px] text-[#bbf7d0]">
											{backendRecommendation.reasoning ?? `Decision: ${backendRecommendation.decision}`}
										</div>
									)}

									<div className="flex flex-wrap items-center gap-3">
										<div className="inline-flex rounded-xl border border-[#262626] bg-[#0a0a0a] p-1">
											<button
												type="button"
												onClick={() => setTeamMode('auto')}
												className={`px-3 py-2 rounded-lg text-[12px] font-medium transition-colors ${
													teamMode === 'auto' ? 'bg-[#22c55e] text-[#0a0a0a]' : 'text-[#a3a3a3] hover:text-[#fafafa]'
												}`}
											>
												Team Architect
											</button>
											<button
												type="button"
												onClick={() => setTeamMode('manual')}
												className={`px-3 py-2 rounded-lg text-[12px] font-medium transition-colors ${
													teamMode === 'manual' ? 'bg-[#3b82f6] text-white' : 'text-[#a3a3a3] hover:text-[#fafafa]'
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
													<div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#86efac] mb-2">
														Team Architect
													</div>
													<div className="text-[15px] font-semibold text-[#fafafa]">
														{architectRecommendedTeam?.name ?? architectCustomTeam?.name ?? recommendation.candidate.name}
													</div>
													<p className="text-[12px] leading-6 text-[#a7f3d0] mt-2">
														{architectRecommendation?.reasoning?.[0] ?? recommendation.reason}
													</p>
												</div>
												<div className="rounded-full border border-[#22c55e]/30 px-2.5 py-1 text-[10px] font-medium text-[#86efac]">
													{architectCustomTeam
														? 'Custom'
														: architectRecommendedTeam?.source === 'custom' ||
															  recommendation.candidate.source === 'custom'
															? 'Custom'
															: 'Preset'}
												</div>
											</div>
											<p className="text-[11px] text-[#737373] leading-5">
												{architectCustomTeam?.description ??
													architectRecommendedTeam?.description ??
													recommendation.candidate.description}
											</p>
											<TeamRosterPreview
												roles={
													architectCustomTeam?.roles ??
													architectRecommendedTeam?.roles ??
													recommendation.candidate.roles
												}
												presetAgents={presetAgents}
												limit={6}
												columns="wide"
											/>

											<div className="rounded-2xl border border-[#1f1f1f] bg-[#0c0c0c] p-4">
												<div className="text-[11px] font-medium text-[#a3a3a3] mb-3">Conversation</div>
												<div className="space-y-3 max-h-[280px] overflow-y-auto pr-1">
													{architectMessages.map((message, index) => {
														const displayContent =
															message.role === 'assistant'
																? message.content.replace(/```team-json\s*\n[\s\S]*?\n```/g, '').trim()
																: message.content;
														if (!displayContent) return null;
														return (
															<div
																key={`${message.role}-${index}`}
																className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
															>
																<div
																	className={`max-w-[85%] rounded-2xl px-3 py-2 text-[12px] leading-6 whitespace-pre-wrap ${
																		message.role === 'user'
																			? 'bg-[#1f3d2a] text-[#e5e7eb]'
																			: 'bg-[#151515] border border-[#262626] text-[#d4d4d8]'
																	}`}
																>
																	{displayContent}
																</div>
															</div>
														);
													})}
													{architectStreaming && (
														<div className="flex justify-start">
															<div className="max-w-[85%] rounded-2xl px-3 py-2 text-[12px] leading-6 bg-[#151515] border border-[#262626] text-[#d4d4d8] whitespace-pre-wrap">
																{architectStreamText.replace(/```team-json\s*\n[\s\S]*?\n```/g, '').trim() ||
																	'Thinking...'}
															</div>
														</div>
													)}
												</div>
												{architectError && (
													<div className="mt-3 rounded-xl border border-[#7f1d1d] bg-[#450a0a]/30 px-3 py-2 text-[11px] text-[#fca5a5]">
														{architectError}
													</div>
												)}
												{architectRecommendation?.followUpQuestions &&
													architectRecommendation.followUpQuestions.length > 0 && (
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
													onClick={() => { setSelectedTemplate(team.id); setTeamConfirmed(false); }}
													className={`text-left p-4 rounded-2xl border transition-colors ${
														selectedTemplate === team.id
															? 'border-[#3b82f6] bg-[#3b82f6]/6'
															: 'border-[#262626] bg-[#0a0a0a] hover:border-[#333]'
													}`}
												>
													<div className="flex items-center justify-between gap-3">
														<span className="text-[13px] font-medium text-[#fafafa]">{team.name}</span>
														<span
															className={`text-[10px] px-2 py-0.5 rounded-full border ${
																team.source === 'custom'
																	? 'border-[#3b82f6]/30 text-[#93c5fd]'
																	: 'border-[#262626] text-[#6b7280]'
															}`}
														>
															{team.source === 'custom' ? 'Custom' : 'Preset'}
														</span>
													</div>
													<p className="text-[11px] text-[#737373] mt-1.5 leading-5">{team.description}</p>
													<TeamRosterPreview roles={team.roles} presetAgents={presetAgents} columns="wide" />
												</button>
											))}
										</div>
									)}

									{selectedTemplate && !teamConfirmed && (
										<button
											type="button"
											onClick={() => setTeamConfirmed(true)}
											className="mt-3 px-4 py-2 rounded-xl text-[12px] font-medium bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/30 hover:bg-[#22c55e]/20 transition-colors"
										>
											Bu takımı onayla
										</button>
									)}
									{teamConfirmed && (
										<p className="mt-3 text-[11px] text-[#22c55e]">Takım seçimi onaylandı</p>
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
												Planner her projede zorunlu; bu seçim planning persona'sını belirler.
											</p>
										</div>
									)}
								</div>
							)}

							{step === 5 && (
								<div className="rounded-2xl border border-[#1f1f1f] bg-[#0d0d0d] px-5 py-5 space-y-4">
									<div>
										<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280] mb-2">Step 5 — Team Apply</p>
										<h3 className="text-[15px] font-semibold text-[#fafafa]">Takımı projeye uygula ve tamamla.</h3>
										<p className="text-[12px] leading-6 text-[#737373] mt-2">
											Bu adım `applyProjectTeam` çağrısını manuel onayla tetikler.
										</p>
									</div>
									<div className="rounded-xl border border-[#262626] bg-[#090909] px-4 py-4 text-[12px]">
										<div className="flex items-center justify-between gap-4">
											<span className="text-[#525252]">Selected team</span>
											<span className="text-[#fafafa]">{selectedTeamName}</span>
										</div>
										<div className="flex items-center justify-between gap-4 mt-2">
											<span className="text-[#525252]">Scope approved</span>
											<span className={scopeApproved ? 'text-[#22c55e]' : 'text-[#f87171]'}>{scopeApproved ? 'Yes' : 'No'}</span>
										</div>
									</div>
									{teamApplied && <div className="text-[12px] text-[#86efac]">Team applied successfully.</div>}
								</div>
							)}
						</div>

						<div className="space-y-4 lg:sticky lg:top-0 self-start hidden">
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

				{architectRecommendation?.decision === 'need-more-info' && (
					<p className="text-[11px] text-[#f59e0b] px-6 pb-2">Team Architect daha fazla bilgi istiyor. Lütfen soruları yanıtlayın.</p>
				)}

				{/* Actions */}
				<div className="flex justify-end gap-2 px-6 py-4 border-t border-[#1f1f1f] shrink-0">
					<button
						onClick={onClose}
						className="px-4 py-2 rounded-lg text-[13px] text-[#a3a3a3] hover:text-[#fafafa] border border-[#262626] hover:border-[#333] transition-colors"
					>
						Cancel
					</button>
					{step > 1 && (
						<button
							onClick={() => setStep((prev) => (prev > 1 ? ((prev - 1) as 1 | 2 | 3 | 4 | 5) : prev))}
							className="px-4 py-2 rounded-lg text-[13px] text-[#a3a3a3] hover:text-[#fafafa] border border-[#262626] hover:border-[#333] transition-colors"
						>
							Back
						</button>
					)}
					{step === 1 ? (
						<button
							onClick={handleCreateShell}
							disabled={!canCreateShell || loading}
							className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
						>
							{loading ? 'Creating shell...' : 'Create Shell'}
						</button>
					) : step === 2 ? (
						<button
							onClick={handleSaveScopeDraft}
							disabled={!createdProject || loading || architectMessages.length < 2}
							className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
						>
							{loading ? 'Saving scope...' : 'Continue to Scope Review'}
						</button>
					) : step === 3 ? (
						<button
							onClick={handleApproveScope}
							disabled={!createdProject || loading}
							className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
						>
							{loading ? 'Approving...' : 'Approve Scope Contract'}
						</button>
					) : step === 4 ? (
						<button
							onClick={handleContinueToApply}
							disabled={!scopeApproved || !teamConfirmed}
							className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
						>
							Continue to Team Apply
						</button>
					) : (
						<button
							onClick={handleApplyTeam}
							disabled={!createdProject || !scopeApproved || loading}
							className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
						>
							{loading ? 'Applying...' : 'Apply Team & Finish'}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
