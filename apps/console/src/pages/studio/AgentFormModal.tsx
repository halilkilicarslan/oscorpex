import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
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
	type AgentCliTool,
} from '../../lib/studio-api';
import { getModelsFromProviders } from '../../lib/model-options';
import AgentAvatar from '../../components/AgentAvatar';
import { AvatarPicker, SkillsField, SystemPromptField, ROLE_OPTIONS, CLI_TOOL_OPTIONS, inputClass, selectClass, labelClass } from './agent-form-modal';

interface AgentFormModalProps {
	mode: 'create' | 'edit';
	agent?: ProjectAgent;
	projectId: string;
	onClose: () => void;
	onSave: (agent: ProjectAgent) => void;
}

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

	const [avatarOptions, setAvatarOptions] = useState<AvatarOption[]>([]);
	const [showAvatarPicker, setShowAvatarPicker] = useState(false);

	const [providers, setProviders] = useState<AIProvider[]>([]);
	const [modelGroups, setModelGroups] = useState<{ label: string; models: string[] }[]>([]);

	const [promptMode, setPromptMode] = useState<'inline' | 'file'>('inline');
	const [skillsMode, setSkillsMode] = useState<'inline' | 'file'>('inline');
	const [skillsMdContent, setSkillsMdContent] = useState('');

	useEffect(() => {
		fetchProviders()
			.then((p) => {
				setProviders(p);
				setModelGroups(getModelsFromProviders(p));
			})
			.catch((err) => console.error("[AgentFormModal] Failed to load providers:", err));
	}, []);

	useEffect(() => {
		fetchAvatars(gender).then(setAvatarOptions).catch((err) => console.error("[AgentFormModal] Failed to load avatars:", err));
	}, [gender]);

	void providers;

	const loadPromptFile = async () => {
		if (!agent) return;
		try {
			const { content } = await fetchAgentFile(projectId, agent.id, 'system-prompt.md');
			const lines = content.split('\n');
			const bodyStart = lines.findIndex((l, i) => i > 0 && l.trim() === '') + 1;
			setSystemPrompt(lines.slice(bodyStart).join('\n').trim());
		} catch {
			// File may not exist yet
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
			// Best-effort
		}
	};

	const loadSkillsFile = async () => {
		if (!agent) return;
		try {
			const { content } = await fetchAgentFile(projectId, agent.id, 'skills.md');
			setSkillsMdContent(content);
		} catch {
			const seed = skills.length > 0 ? skills.map((s) => `- ${s}`).join('\n') : '';
			setSkillsMdContent(seed ? `# ${name} — Skills\n\n${seed}\n` : '');
		}
	};

	const saveSkillsFile = async () => {
		if (!agent) return;
		try {
			await writeAgentFile(projectId, agent.id, 'skills.md', skillsMdContent);
		} catch {
			// Best-effort
		}
	};

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

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div className="bg-[#111111] border border-[#262626] rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
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

				<div className="overflow-y-auto flex-1 px-6 py-5 flex flex-col gap-4">
					<div className="flex gap-3 items-end">
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

					<AvatarPicker
						avatar={avatar}
						name={name}
						gender={gender}
						avatarOptions={avatarOptions}
						showAvatarPicker={showAvatarPicker}
						onAvatarChange={setAvatar}
						onTogglePicker={() => setShowAvatarPicker(!showAvatarPicker)}
					/>

					<div className="flex gap-3">
						<div className="flex-1">
							<label className={labelClass}>
								Role <span className="text-[#ef4444]">*</span>
							</label>
							<div className="relative">
								<select value={role} onChange={(e) => setRole(e.target.value)} className={selectClass}>
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
									onChange={(e) => setCliTool(e.target.value as AgentCliTool)}
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

					<div>
						<label className={labelClass}>Model</label>
						{modelGroups.length > 0 ? (
							<select value={model} onChange={(e) => setModel(e.target.value)} className={selectClass}>
								<option value="">Select model...</option>
								{modelGroups.map((group) => (
									<optgroup key={group.label} label={group.label}>
										{group.models.map((m) => (
											<option key={m} value={m}>
												{m}
											</option>
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

					<SkillsField
						skills={skills}
						skillInput={skillInput}
						skillsMode={skillsMode}
						skillsMdContent={skillsMdContent}
						agent={agent}
						labelClass={labelClass}
						inputClass={inputClass}
						onSkillInputChange={setSkillInput}
						onAddSkill={addSkill}
						onRemoveSkill={removeSkill}
						onToggleMode={handleToggleSkillsMode}
						onMdContentChange={setSkillsMdContent}
						onLoadFile={loadSkillsFile}
						onSaveFile={saveSkillsFile}
					/>

					<SystemPromptField
						systemPrompt={systemPrompt}
						promptMode={promptMode}
						agent={agent}
						inputClass={inputClass}
						labelClass={labelClass}
						onPromptChange={setSystemPrompt}
						onToggleMode={handleTogglePromptMode}
						onLoadFile={loadPromptFile}
						onSaveFile={savePromptFile}
					/>

					{error && <p className="text-[12px] text-[#ef4444]">{error}</p>}
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
