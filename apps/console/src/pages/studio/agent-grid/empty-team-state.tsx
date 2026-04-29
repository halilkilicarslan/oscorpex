import { useState, useEffect } from 'react';
import { Users, Plus } from 'lucide-react';
import { fetchTeamTemplates, copyTeamFromTemplate, type TeamTemplate } from '../../../lib/studio-api';

interface EmptyTeamStateProps {
	projectId: string;
	onTeamCreated: () => void;
	onAddAgent: () => void;
}

export default function EmptyTeamState({ projectId, onTeamCreated, onAddAgent }: EmptyTeamStateProps) {
	const [templates, setTemplates] = useState<TeamTemplate[]>([]);
	const [applying, setApplying] = useState(false);

	useEffect(() => {
		fetchTeamTemplates().then(setTemplates).catch(() => {});
	}, []);

	const applyTemplate = async (templateId: string) => {
		setApplying(true);
		try {
			await copyTeamFromTemplate(projectId, templateId);
			onTeamCreated();
		} catch (err) {
			console.error('Failed to apply template:', err);
		} finally {
			setApplying(false);
		}
	};

	return (
		<div className="flex flex-col items-center justify-center py-12 text-center">
			<Users size={32} className="text-[#333] mb-3" />
			<h3 className="text-[14px] font-medium text-[#a3a3a3] mb-1">No Team Members</h3>
			<p className="text-[12px] text-[#525252] mb-5 max-w-md">
				This project has no agents yet. Pick a team template to get started or add agents manually.
			</p>

			{templates.length > 0 && (
				<div className="flex flex-wrap gap-2 mb-4 justify-center">
					{templates.map((t) => (
						<button
							key={t.id}
							onClick={() => applyTemplate(t.id)}
							disabled={applying}
							className="flex flex-col items-start px-4 py-3 rounded-lg border border-[#262626] bg-[#111111] hover:border-[#22c55e]/40 transition-colors text-left disabled:opacity-50 max-w-[200px]"
						>
							<span className="text-[12px] font-semibold text-[#fafafa]">{t.name}</span>
							<span className="text-[10px] text-[#525252] mt-0.5">{t.roles.length} agents — {t.roles.join(', ')}</span>
						</button>
					))}
				</div>
			)}

			<button
				onClick={onAddAgent}
				className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors"
			>
				<Plus size={13} />
				Add Agent Manually
			</button>
		</div>
	);
}
