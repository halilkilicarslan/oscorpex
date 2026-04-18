import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import {
	createProjectFromTemplate,
	fetchProjectTemplates,
	fetchPresetAgents,
	roleLabel,
	type AgentConfig,
	type Project,
	type ProjectTemplateInfo,
} from '../../../lib/studio-api';

export function TemplateProjectModal({
	onClose,
	onCreate,
}: {
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
		fetchProjectTemplates()
			.then((t) => {
				setTemplates(t);
				if (t.length > 0) setSelectedTemplate(t[0].id);
			})
			.catch(() => {});
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
											<span
												key={tech}
												className="text-[10px] px-1.5 py-0.5 rounded bg-[#1f1f1f] text-[#a3a3a3] border border-[#262626]"
											>
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
							Team: <span className="text-[#a3a3a3]">{selected.teamTemplate}</span> &middot; Tech:{' '}
							<span className="text-[#a3a3a3]">{selected.techStack.join(', ')}</span>
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
