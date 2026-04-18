import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import {
	importProject,
	fetchTeamTemplates,
	fetchPresetAgents,
	roleLabel,
	type AgentConfig,
	type Project,
	type TeamTemplate,
} from '../../../lib/studio-api';
import { TeamRosterPreview } from './CreateProjectModal';

export function ImportProjectModal({
	onClose,
	onImport,
}: {
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
