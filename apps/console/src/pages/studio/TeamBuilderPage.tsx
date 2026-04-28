import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Loader2, ArrowLeft, Pencil, Sparkles } from 'lucide-react';
import {
	fetchPresetAgents,
	fetchCustomTeams,
	fetchTeamTemplates,
	createCustomTeam,
	updateCustomTeam,
	deleteCustomTeam,
	type AgentConfig,
	type CustomTeamTemplate,
	type DependencyType,
	type TeamTemplate,
} from '../../lib/studio-api';
import PresetAgentSheet from './PresetAgentSheet';
import {
	FlowCanvas,
	TeamList,
	TeamNameModal,
	COLOR_MAP,
	EDGE_STYLES,
	EDGE_LABELS,
	EDGE_DESCRIPTIONS,
} from './team-builder/index.js';

export default function TeamBuilderPage() {
	const navigate = useNavigate();
	const [presets, setPresets] = useState<AgentConfig[]>([]);
	const [presetTeams, setPresetTeams] = useState<TeamTemplate[]>([]);
	const [teams, setTeams] = useState<CustomTeamTemplate[]>([]);
	const [loading, setLoading] = useState(true);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [showNameModal, setShowNameModal] = useState<'new' | 'edit' | null>(null);
	const [pendingCanvas, setPendingCanvas] = useState<{ roles: string[]; deps: { from: string; to: string; type: DependencyType }[] } | null>(null);
	const [sheetAgent, setSheetAgent] = useState<AgentConfig | null>(null);

	useEffect(() => {
		Promise.all([fetchPresetAgents(), fetchCustomTeams(), fetchTeamTemplates()])
			.then(([p, t, pt]) => {
				setPresets(p);
				setTeams(t);
				setPresetTeams(pt);
			})
			.catch(() => {})
			.finally(() => setLoading(false));
	}, []);

	const selected = teams.find((t) => t.id === selectedId);
	const selectedPreset = presetTeams.find((t) => t.id === selectedPresetId);

	const handleNew = useCallback(() => {
		setSelectedId(null);
		setSelectedPresetId(null);
	}, []);

	const handleSelectCustom = useCallback((id: string) => {
		setSelectedId(id);
		setSelectedPresetId(null);
	}, []);

	const handleSelectPreset = useCallback((id: string) => {
		setSelectedPresetId(id);
		setSelectedId(null);
	}, []);

	const handleSave = useCallback((roles: string[], deps: { from: string; to: string; type: string }[]) => {
		if (roles.length === 0) return;
		setPendingCanvas({ roles, deps: deps as { from: string; to: string; type: DependencyType }[] });
		setShowNameModal(selected ? 'edit' : 'new');
	}, [selected]);

	const handleNameSave = useCallback(async (name: string, description: string) => {
		if (!pendingCanvas) return;
		setSaving(true);
		try {
			if (selected && showNameModal === 'edit') {
				const updated = await updateCustomTeam(selected.id, {
					name,
					description,
					roles: pendingCanvas.roles,
					dependencies: pendingCanvas.deps,
				});
				setTeams((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
				setSelectedId(updated.id);
			} else {
				const created = await createCustomTeam({
					name,
					description,
					roles: pendingCanvas.roles,
					dependencies: pendingCanvas.deps,
				});
				setTeams((prev) => [created, ...prev]);
				setSelectedId(created.id);
				setSelectedPresetId(null);
			}
		} catch (err) {
			console.error('Failed to save team:', err);
		} finally {
			setSaving(false);
			setShowNameModal(null);
			setPendingCanvas(null);
		}
	}, [selected, showNameModal, pendingCanvas]);

	const handleDelete = useCallback(async (id: string) => {
		if (!confirm('Delete this custom team?')) return;
		try {
			await deleteCustomTeam(id);
			setTeams((prev) => prev.filter((t) => t.id !== id));
			if (selectedId === id) setSelectedId(null);
		} catch (err) {
			console.error('Failed to delete team:', err);
		}
	}, [selectedId]);

	if (loading) {
		return (
			<div className="flex items-center justify-center h-full">
				<Loader2 size={20} className="text-[#525252] animate-spin" />
			</div>
		);
	}

	return (
		<div className="flex flex-col h-[calc(100vh-56px)]">
			<div className="flex items-center justify-between px-6 py-3 border-b border-[#1f1f1f] bg-[#0a0a0a]">
				<div className="flex items-center gap-3">
					<button onClick={() => navigate('/studio')} className="text-[#525252] hover:text-[#a3a3a3] transition-colors">
						<ArrowLeft size={16} />
					</button>
					<div>
						<h1 className="text-[15px] font-semibold text-[#fafafa]">Team Builder</h1>
						<p className="text-[11px] text-[#525252]">Create reusable team configurations for your projects</p>
					</div>
				</div>
				{selected && (
					<button
						onClick={() => { setPendingCanvas({ roles: selected.roles, deps: selected.dependencies }); setShowNameModal('edit'); }}
						className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-[#a3a3a3] bg-[#111111] border border-[#262626] rounded-lg hover:bg-[#1a1a1a] transition-all"
					>
						<Pencil size={11} /> Rename
					</button>
				)}
				{selectedPreset && (
					<span className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] text-[#a78bfa] bg-[#a78bfa]/10 border border-[#a78bfa]/30 rounded-lg">
						<Sparkles size={10} /> Preset template — click Save to create a custom copy
					</span>
				)}
			</div>

			<div className="flex items-center gap-4 px-6 py-2 border-b border-[#1f1f1f] bg-[#0a0a0a]">
				<span className="text-[10px] text-[#525252] uppercase font-semibold">Edges:</span>
				{(['workflow', 'review', 'gate', 'hierarchy', 'escalation', 'pair', 'conditional', 'fallback', 'notification', 'handoff', 'approval', 'mentoring'] as DependencyType[]).map((type) => (
					<div key={type} className="relative group flex items-center gap-1.5 cursor-help">
						<span className="w-4 h-0.5 rounded-full inline-block" style={{ backgroundColor: EDGE_STYLES[type].stroke }} />
						<span className="text-[10px] text-[#737373] group-hover:text-[#e5e5e5] transition-colors">{EDGE_LABELS[type]}</span>
						<div className="absolute top-full left-0 mt-2 z-50 hidden group-hover:block pointer-events-none">
							<div className="bg-[#171717] border border-[#333] rounded-md shadow-lg px-3 py-2 w-64 leading-snug">
								<div className="flex items-center gap-2 mb-1">
									<span className="w-3 h-0.5 rounded-full" style={{ backgroundColor: EDGE_STYLES[type].stroke }} />
									<span className="text-[11px] font-semibold text-[#f5f5f5]">{EDGE_LABELS[type]}</span>
								</div>
								<div className="text-[11px] text-[#a3a3a3]">{EDGE_DESCRIPTIONS[type]}</div>
							</div>
						</div>
					</div>
				))}
			</div>

			<div className="flex flex-1 overflow-hidden">
				<TeamList
					presetTeams={presetTeams}
					teams={teams}
					selectedId={selectedId}
					selectedPresetId={selectedPresetId}
					onSelect={handleSelectCustom}
					onSelectPreset={handleSelectPreset}
					onNew={handleNew}
					onDelete={handleDelete}
				/>

				<ReactFlowProvider key={selectedId ?? selectedPresetId ?? '__new__'}>
					<FlowCanvas
						presets={presets}
						initialRoles={selected?.roles ?? selectedPreset?.roles ?? []}
						initialDeps={selected?.dependencies ?? selectedPreset?.dependencies ?? []}
						onSave={handleSave}
						saving={saving}
						onAgentClick={setSheetAgent}
					/>
				</ReactFlowProvider>
			</div>

			{showNameModal && (
				<TeamNameModal
					initial={showNameModal === 'edit' && selected ? { name: selected.name, description: selected.description } : undefined}
					onSave={handleNameSave}
					onCancel={() => { setShowNameModal(null); setPendingCanvas(null); }}
				/>
			)}

			{sheetAgent && (
				<PresetAgentSheet
					agent={sheetAgent}
					color={COLOR_MAP[sheetAgent.role] ?? '#525252'}
					onClose={() => setSheetAgent(null)}
				/>
			)}
		</div>
	);
}
